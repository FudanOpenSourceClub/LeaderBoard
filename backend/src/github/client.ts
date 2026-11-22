import {
  GitHubRepositoryRefSchema,
  type AppConfig,
  type GitHubClient,
  type GitHubRepositoryRef,
} from "@leadboard/contracts";

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2026-03-10";
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_MAX_WAIT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

type RestMethod = "GET" | "POST" | "PATCH";
type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "HTTP_ERROR"
  | "GRAPHQL_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "RETRY_EXHAUSTED";

export class GitHubClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number | null,
    readonly attempts: number,
    message: string,
    readonly retryAt: Date | null = null,
  ) {
    super(message);
    this.name = "GitHubClientError";
  }
}

/** Dependencies are injectable so retries can be tested without real requests or timers. */
export interface GitHubClientOptions {
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
  maxWaitMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const match of header.matchAll(/<([^>]+)>\s*;\s*rel="?([^";,\s]+)"?/gi)) {
    if (match[2]?.toLowerCase() === "next") return match[1] ?? null;
  }
  return null;
}

function scalarQueryValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new GitHubClientError("INVALID_REQUEST", null, 0, "Unsupported GitHub REST query parameter");
}

function appendQuery(url: URL, params: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    url.searchParams.delete(key);
    if (Array.isArray(value)) {
      for (const entry of value) {
        const scalar = scalarQueryValue(entry);
        if (scalar !== null) url.searchParams.append(key, scalar);
      }
    } else {
      const scalar = scalarQueryValue(value);
      if (scalar !== null) url.searchParams.set(key, scalar);
    }
  }
}

function isGraphQLRateError(payload: unknown): boolean {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) return false;
  return payload.errors.some((error: unknown) => {
    if (!isRecord(error)) return false;
    const type = error.type;
    const message = error.message;
    return type === "RATE_LIMITED" ||
      (typeof message === "string" && /(?:secondary |primary )?rate limit|abuse detection/i.test(message));
  });
}

/** Backend-only implementation of the shared GitHubClient contract. */
export class GitHubApiClient implements GitHubClient {
  private readonly token: string;
  private readonly fetchRequest: typeof globalThis.fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly maxWaitMs: number;
  private cooldownUntil = 0;

  constructor(config: Pick<AppConfig, "githubToken">, options: GitHubClientOptions = {}) {
    if (typeof config.githubToken !== "string" || !config.githubToken.trim() || /[\r\n]/.test(config.githubToken)) {
      throw new GitHubClientError("INVALID_REQUEST", null, 0, "GitHub token is required");
    }
    this.token = config.githubToken.trim();
    this.fetchRequest = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 ||
        !Number.isSafeInteger(this.maxWaitMs) || this.maxWaitMs < 0) {
      throw new GitHubClientError("INVALID_REQUEST", null, 0, "Invalid GitHub retry settings");
    }
  }

  async listOrgRepositories(org: string): Promise<GitHubRepositoryRef[]> {
    const repositories = await this.paginateRest<unknown>(`/orgs/${encodeURIComponent(org)}/repos`, { type: "all" });
    return repositories.map((repository) => {
      if (!isRecord(repository) || !isRecord(repository.owner)) {
        throw new GitHubClientError("INVALID_RESPONSE", null, 0, "Invalid GitHub repository response");
      }
      const id = repository.id;
      const githubId = typeof id === "number" && Number.isSafeInteger(id) && id > 0
        ? String(id)
        : typeof id === "string" && /^[1-9]\d*$/.test(id) ? id : null;
      const parsed = GitHubRepositoryRefSchema.safeParse({
        githubId,
        nodeId: repository.node_id,
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        defaultBranch: repository.default_branch,
        htmlUrl: repository.html_url,
        archived: repository.archived,
        isFork: repository.fork,
        isPrivate: repository.private,
      });
      if (!parsed.success) {
        throw new GitHubClientError("INVALID_RESPONSE", null, 0, "Invalid GitHub repository response");
      }
      return parsed.data;
    });
  }

  async getRepositoryCustomProperties(owner: string, repo: string): Promise<Record<string, unknown>> {
    const properties = await this.requestRest<unknown>(
      "GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/properties/values`,
    );
    if (!Array.isArray(properties)) {
      throw new GitHubClientError("INVALID_RESPONSE", null, 0, "Invalid GitHub custom properties response");
    }
    const entries: [string, unknown][] = properties.map((property: unknown) => {
      if (!isRecord(property) || typeof property.property_name !== "string" || !("value" in property)) {
        throw new GitHubClientError("INVALID_RESPONSE", null, 0, "Invalid GitHub custom properties response");
      }
      return [property.property_name, property.value];
    });
    return Object.fromEntries(entries);
  }

  async requestRest<T>(method: RestMethod, path: string, params?: Record<string, unknown>): Promise<T> {
    const { data } = await this.request(method, path, params, false, method === "GET");
    return data as T;
  }

  async paginateRest<T>(path: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const first = this.apiUrl(path);
    if (!first.searchParams.has("per_page") && params.per_page === undefined) first.searchParams.set("per_page", "100");
    appendQuery(first, params);
    const visited = new Set<string>();
    const items: T[] = [];
    let next: string | null = first.toString();
    while (next !== null) {
      const url = this.apiUrl(next);
      if (visited.has(url.toString())) {
        throw new GitHubClientError("INVALID_RESPONSE", null, 0, "GitHub REST pagination contains a cycle");
      }
      visited.add(url.toString());
      const response = await this.request("GET", url.toString(), undefined, false, true);
      if (!Array.isArray(response.data)) {
        throw new GitHubClientError("INVALID_RESPONSE", null, 0, "GitHub REST page is not an array");
      }
      items.push(...response.data as T[]);
      next = nextLink(response.headers.get("link"));
    }
    return items;
  }

  async queryGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!query.trim()) {
      throw new GitHubClientError("INVALID_REQUEST", null, 0, "GraphQL query is required");
    }
    // A GraphQL mutation may change server state, so it must not be replayed.
    const isReadOnly = !/\bmutation\b/i.test(query);
    const { data } = await this.request("POST", "/graphql", { query, variables }, true, isReadOnly);
    if (!isRecord(data) || !("data" in data)) {
      throw new GitHubClientError("INVALID_RESPONSE", null, 0, "Invalid GitHub GraphQL response");
    }
    return data.data as T;
  }

  private apiUrl(path: string): URL {
    let url: URL;
    try { url = new URL(path, API_ORIGIN); }
    catch { throw new GitHubClientError("INVALID_REQUEST", null, 0, "Invalid GitHub API path"); }
    if (url.origin !== API_ORIGIN || url.username || url.password || url.hash) {
      throw new GitHubClientError("INVALID_REQUEST", null, 0, "GitHub API path must stay on api.github.com");
    }
    return url;
  }

  private rateDelay(headers: Headers): number {
    const retryAfter = headers.get("retry-after");
    let delay = 0;
    let hasHint = false;
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) { delay = seconds * 1000; hasHint = true; }
      else {
        const date = Date.parse(retryAfter);
        if (Number.isFinite(date)) { delay = Math.max(0, date - this.now()); hasHint = true; }
      }
    }
    if (headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(headers.get("x-ratelimit-reset"));
      if (Number.isFinite(reset) && reset > 0) {
        delay = Math.max(delay, reset * 1000 - this.now() + 1000);
        hasHint = true;
      }
    }
    return hasHint ? Math.max(0, delay) : 60_000;
  }

  private updateCooldown(headers: Headers): void {
    if (headers.get("x-ratelimit-remaining") !== "0") return;
    const reset = Number(headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) {
      this.cooldownUntil = Math.max(this.cooldownUntil, reset * 1000 + 1000);
    }
  }

  private async readPayload(response: Response, attempts: number): Promise<unknown> {
    if (response.status === 204) return undefined;
    let raw: string;
    try { raw = await response.text(); }
    catch { throw new GitHubClientError("INVALID_RESPONSE", response.status, attempts, "Unable to read GitHub API response"); }
    if (!raw) return undefined;
    try { return JSON.parse(raw) as unknown; }
    catch { throw new GitHubClientError("INVALID_RESPONSE", response.status, attempts, "Invalid GitHub API JSON response"); }
  }

  private async request(
    method: RestMethod,
    path: string,
    params: Record<string, unknown> | undefined,
    graphQL: boolean,
    safeToRetry: boolean,
  ): Promise<{ data: unknown; headers: Headers }> {
    const url = this.apiUrl(path);
    let body: string | undefined;
    if (method === "GET") {
      if (params) appendQuery(url, params);
    } else if (params !== undefined) {
      try { body = JSON.stringify(params); }
      catch { throw new GitHubClientError("INVALID_REQUEST", null, 0, "Invalid GitHub API request body"); }
    }

    let waitedMs = 0;
    const wait = async (milliseconds: number, attempts: number, status: number | null): Promise<void> => {
      const delay = Math.max(0, Math.ceil(milliseconds));
      if (waitedMs + delay > this.maxWaitMs) {
        throw new GitHubClientError(
          "RATE_LIMITED", status, attempts,
          "GitHub API retry wait budget exceeded", new Date(this.now() + delay),
        );
      }
      waitedMs += delay;
      await this.sleep(delay);
    };

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const cooldown = this.cooldownUntil - this.now();
      if (cooldown > 0) await wait(cooldown, attempt - 1, null);

      let response: Response;
      try {
        response = await this.fetchRequest(url.toString(), {
          method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "X-GitHub-Api-Version": API_VERSION,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (safeToRetry && attempt < this.maxAttempts) {
          await wait(Math.min(1000 * 2 ** (attempt - 1), 16_000), attempt, null);
          continue;
        }
        const exhausted = safeToRetry && attempt === this.maxAttempts;
        throw new GitHubClientError(
          exhausted ? "RETRY_EXHAUSTED" : "NETWORK_ERROR", null, attempt,
          exhausted ? `GitHub API network retry exhausted after ${attempt} attempts` : "GitHub API network request failed",
        );
      }

      if (!response.ok) {
        let rateMessage = "";
        if (response.status === 403) {
          try { rateMessage = await response.text(); } catch { /* Status and headers remain authoritative. */ }
        }
        const rateLimited = response.status === 429 ||
          (response.status === 403 &&
            (response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0" ||
              /secondary rate limit|rate limit exceeded|abuse detection/i.test(rateMessage)));
        const retryable = rateLimited || response.status >= 500;
        if (rateLimited) {
          const delay = this.rateDelay(response.headers);
          this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + delay);
        }
        if (retryable && safeToRetry && attempt < this.maxAttempts) {
          if (!rateLimited) await wait(Math.min(1000 * 2 ** (attempt - 1), 16_000), attempt, response.status);
          continue;
        }
        if (retryable && safeToRetry && attempt === this.maxAttempts) {
          throw new GitHubClientError(
            "RETRY_EXHAUSTED", response.status, attempt,
            `GitHub API retry exhausted after ${attempt} attempts (HTTP ${response.status})`,
          );
        }
        throw new GitHubClientError(
          rateLimited ? "RATE_LIMITED" : "HTTP_ERROR", response.status, attempt,
          `GitHub API request failed (HTTP ${response.status})`,
          rateLimited ? new Date(this.cooldownUntil) : null,
        );
      }

      const data = await this.readPayload(response, attempt);
      if (graphQL && isRecord(data) && Array.isArray(data.errors) && data.errors.length > 0) {
        const rateLimited = isGraphQLRateError(data);
        if (rateLimited) {
          const delay = this.rateDelay(response.headers);
          this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + delay);
        }
        if (rateLimited && safeToRetry && attempt < this.maxAttempts) continue;
        if (rateLimited && safeToRetry && attempt === this.maxAttempts) {
          throw new GitHubClientError(
            "RETRY_EXHAUSTED", response.status, attempt,
            `GitHub GraphQL retry exhausted after ${attempt} attempts`,
          );
        }
        throw new GitHubClientError(
          rateLimited ? "RATE_LIMITED" : "GRAPHQL_ERROR", response.status, attempt,
          rateLimited ? "GitHub GraphQL rate limited" : "GitHub GraphQL returned errors",
          rateLimited ? new Date(this.cooldownUntil) : null,
        );
      }
      this.updateCooldown(response.headers);
      return { data, headers: response.headers };
    }
    // The loop always returns or throws; this also keeps TypeScript's return path explicit.
    throw new GitHubClientError("RETRY_EXHAUSTED", null, this.maxAttempts, "GitHub API retry exhausted");
  }
}
