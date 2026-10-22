/**
 * Collect source-linked public activity for enrolled contributors and exports.
 * GitHub Search is not equivalent to GitHub's contribution graph.
 */
export interface PublicContribution {
  kind: "commit" | "pull_request" | "issue";
  repository: string;
  occurredAt: string;
  identifier: string;
  title: string;
  url: string;
  repositoryGithubId?: string | null;
  objectGithubId?: string | null;
  mergedAt?: string | null;
  scoring?: {
    whitelisted: boolean; month: string; repositoryMonthCount: number; monthCount: number;
    repositoryCapExceeded: boolean; monthlyCapExceeded: boolean; points: number;
    prOpenedPoints: number; prMergedPoints: number;
  };
}

export interface PublicContributionExport {
  rows: PublicContribution[];
  totals: Record<PublicContribution["kind"], number>;
  truncated: boolean;
  incomplete: boolean;
}

type SearchKind = PublicContribution["kind"];
interface SearchItem {
  author?: {id?: number} | null;
  user?: {id?: number} | null;
  id?: number;
  html_url?: string;
  repository_url?: string;
  repository?: { full_name?: string; id?: number };
  pull_request?: { merged_at?: string | null };
  created_at?: string;
  title?: string;
  number?: number;
  sha?: string;
  commit?: { author?: { date?: string }; message?: string };
}
interface SearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: SearchItem[];
}
const MAX_PER_KIND = 5000;
const GITHUB_SEARCH_LIMIT = 1000; // GitHub still caps each individual search query at 1000.
const DAY_MS = 86_400_000;
const SEARCH_KINDS: SearchKind[] = ["commit", "pull_request", "issue"];
const HEADER = ["类型", "仓库", "时间(UTC)", "SHA或编号", "标题", "原始链接", "统计口径", "GitHub仓库ID", "GitHub对象ID", "合并时间(UTC)", "白名单", "月份(北京时间)", "仓库月度次序", "月度有效次序", "超过仓库月限3次", "超过总月限10次", "得分", "PR提交得分", "PR合并得分"];

function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GitHub Search caps pagination at 1,000 entries PER QUERY. If a query has
 * more matches, bisect the time range into smaller queries and page each one.
 * The date intervals are disjoint, traversed newest-first, and bounded by a
 * 5,000-event export limit per activity kind.
 */
export async function collectPublicContributions(
  username: string,
  githubToken: string,
  fetcher: typeof fetch = fetch,
  options: { since?: string; contributorGithubId?: string } = {},
): Promise<PublicContributionExport> {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) {
    throw new Error("Invalid GitHub username");
  }
  if (!githubToken.trim()) throw new Error("GitHub token not configured");

  const rows: PublicContribution[] = [];
  const totals = { commit: 0, pull_request: 0, issue: 0 };
  let truncated = false;
  let incomplete = false;
  let requestCount = 0;

  async function search(kind: SearchKind, query: string, page: number): Promise<SearchResponse> {
    const endpoint = kind === "commit" ? "commits" : "issues";
    const url = new URL("https://api.github.com/search/" + endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    for (let attempt = 0; attempt < 4; attempt++) {
      // Keep authenticated GitHub search calls below roughly 30/minute.
      // Mock fetchers bypass the delay so unit tests remain fast.
      if (requestCount++ > 0 && fetcher === fetch) await delay(2200);
      let response: Response;
      try {
        response = await fetcher(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + githubToken,
          "User-Agent": "LeadBoard-Public-Contribution-Export",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(25000),
        });
      } catch (error) {
        if (attempt === 3) throw error;
        if (fetcher === fetch) await delay(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        const problem = await response.json().catch(() => null) as {message?:unknown}|null;
        const message = typeof problem?.message === "string" ? problem.message.slice(0,180) : "";
        const retryable = [429, 500, 502, 503, 504].includes(response.status) ||
          (response.status === 403 &&
            (response.headers.has("retry-after") ||
              response.headers.get("x-ratelimit-remaining") === "0" ||
              /rate.limit|secondary|abuse|temporar/i.test(message)));
        if (retryable && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const reset = Number(response.headers.get("x-ratelimit-reset"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Number.isFinite(reset) && reset > 0
              ? Math.max(1000, reset * 1000 - Date.now() + 1000)
              : response.status >= 500 ? 1000 * 2 ** attempt : 10000;
          if (fetcher === fetch) await delay(Math.min(wait, 65000));
          continue;
        }
        throw new Error("GitHub " + endpoint + " search returned HTTP " + response.status + (message ? ": "+message : ""));
      }
      const payload = await response.json() as SearchResponse;
      if (!Array.isArray(payload.items) ||
          !Number.isSafeInteger(payload.total_count) || payload.total_count < 0) {
        throw new Error("Invalid GitHub search response");
      }
      if (payload.incomplete_results && attempt < 3) {
        if (fetcher === fetch) await delay(1000 * 2 ** attempt);
        continue;
      }
      incomplete ||= payload.incomplete_results === true;
      return payload;
    }
    throw new Error("GitHub search retries exhausted");
  }

  for (const kind of SEARCH_KINDS) {
    const seen = new Set<string>();
    const since = options.since ? new Date(options.since).toISOString().slice(0, 10) : null;
    const baseQuery = "author:" + username + (kind === "commit" ? "" :
      " is:" + (kind === "pull_request" ? "pr" : "issue"))
      + (since ? (kind === "commit" ? " committer-date:>=" : " updated:>=") + since : "");

    function addItems(items: SearchItem[]) {
      for (const item of items) {
        if(options.contributorGithubId && String((kind==="commit"?item.author:item.user)?.id)!==options.contributorGithubId) {
          throw new Error("GitHub contribution author does not match the enrolled stable ID");
        }
        if (seen.size >= MAX_PER_KIND) break;
        const url = item.html_url;
        if (!url?.startsWith("https://github.com/") || seen.has(url)) continue;
        const repository = kind === "commit"
          ? item.repository?.full_name
          : item.repository_url?.replace("https://api.github.com/repos/", "");
        if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) continue;
        const occurredAt = kind === "commit" ? item.commit?.author?.date : item.created_at;
        const identifier = kind === "commit" ? item.sha : String(item.number ?? "");
        if (!occurredAt || !identifier || Number.isNaN(Date.parse(occurredAt))) continue;
        rows.push({
          kind, repository, occurredAt, identifier,
          title: kind === "commit" ? ((item.commit?.message ?? "").split("\n")[0] ?? "") : (item.title ?? ""),
          url,
          repositoryGithubId: item.repository?.id ? String(item.repository.id) : null,
          objectGithubId: item.id ? String(item.id) : null,
          mergedAt: kind === "pull_request" && item.pull_request?.merged_at
            && !Number.isNaN(Date.parse(item.pull_request.merged_at)) ? item.pull_request.merged_at : null,
        });
        seen.add(url);
      }
    }

    async function collectPages(query: string, first: SearchResponse) {
      addItems(first.items);
      const available = Math.min(first.total_count, GITHUB_SEARCH_LIMIT);
      for (let page = 2; page <= Math.ceil(available / 100) && seen.size < MAX_PER_KIND; page++) {
        const payload = await search(kind, query, page);
        addItems(payload.items);
        if (payload.items.length === 0) {
          incomplete = true;
          break;
        }
      }
    }

    // Search once without a date qualifier to retain GitHub's total count.
    const root = await search(kind, baseQuery, 1);
    totals[kind] = root.total_count;
    if (root.total_count <= GITHUB_SEARCH_LIMIT) {
      await collectPages(baseQuery, root);
      continue;
    }

    const qualifier = kind === "commit" ? "author-date:" : "created:";
    const start = Date.UTC(2008, 0, 1);
    const end = Math.floor((Date.now() + DAY_MS) / DAY_MS) * DAY_MS;

    async function visit(startDay: number, endDay: number): Promise<void> {
      if (seen.size >= MAX_PER_KIND) return;
      const query = baseQuery + " " + qualifier +
        utcDay(startDay) + ".." + utcDay(endDay);
      const result = await search(kind, query, 1);
      if (result.total_count > GITHUB_SEARCH_LIMIT && startDay < endDay) {
        const middle = startDay + Math.floor((endDay - startDay) / DAY_MS / 2) * DAY_MS;
        // More recent records first; the date ranges do not overlap.
        await visit(middle + DAY_MS, endDay);
        await visit(startDay, middle);
      } else {
        if (result.total_count > GITHUB_SEARCH_LIMIT) truncated = true;
        await collectPages(query, result);
      }
    }

    await visit(start, end);
    truncated ||= seen.size < root.total_count;
  }

  const dedup = new Map<string, PublicContribution>();
  for (const row of rows) dedup.set(row.kind + ":" + row.url, row);
  return {
    rows: [...dedup.values()].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt) || a.url.localeCompare(b.url)),
    totals,
    truncated,
    incomplete,
  };
}

function csvCell(value: string): string {
  // Guard against spreadsheet formula injection in GitHub-provided titles.
  const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
  return /[,"\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function publicContributionCsv(data: PublicContributionExport): string {
  const scope = "公开 GitHub 贡献记录（按 Commit、PR、Issue 统计）";
  const values = [
    HEADER,
    ...data.rows.map((r) => [
      r.kind, r.repository, r.occurredAt, r.identifier, r.title, r.url, scope,
      r.repositoryGithubId ?? "", r.objectGithubId ?? "", r.mergedAt ?? "",
      r.scoring ? String(r.scoring.whitelisted) : "", r.scoring?.month ?? "",
      r.scoring ? String(r.scoring.repositoryMonthCount) : "", r.scoring ? String(r.scoring.monthCount) : "",
      r.scoring ? String(r.scoring.repositoryCapExceeded) : "", r.scoring ? String(r.scoring.monthlyCapExceeded) : "",
      r.scoring ? String(r.scoring.points) : "", r.scoring ? String(r.scoring.prOpenedPoints) : "",
      r.scoring ? String(r.scoring.prMergedPoints) : "",
    ]),
  ];
  return "\uFEFF" + values.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
