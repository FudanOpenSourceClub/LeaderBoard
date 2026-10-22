import { createHash, randomBytes } from "node:crypto";
import { getDbPool, withTransaction } from "../db/index.js";
import type { RegistrationStatus } from "@leadboard/contracts";

const STATE_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;

export type GitHubLinkInfo =
  | { available: false }
  | { available: true; authorizeUrl: string };

export interface GitHubLinkApi {
  createAuthorization(memberId: string): Promise<GitHubLinkInfo>;
  completeAuthorization(code: string, state: string, registrationToken: string): Promise<{ login: string }>;
}

export class GitHubLinkError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubLinkError";
  }
}

export class UnavailableGitHubLinkApi implements GitHubLinkApi {
  async createAuthorization(): Promise<GitHubLinkInfo> {
    return { available: false };
  }

  async completeAuthorization(): Promise<never> {
    throw new GitHubLinkError(
      "GITHUB_LINK_NOT_CONFIGURED",
      503,
      "GitHub 绑定服务尚未配置",
    );
  }
}

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

function stateHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Re-read committed records. Never infer success from URL parameters or an OAuth response alone. */
export async function getRegistrationStatus(token: string): Promise<RegistrationStatus> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { registered: false };
  const result = await getDbPool().query<{ login: string }>(
    `SELECT a.login FROM members m
     JOIN member_github_accounts link ON link.member_id=m.id AND link.is_primary=TRUE
     JOIN github_accounts a ON a.github_id=link.github_id AND a.github_id=m.registration_github_id
     JOIN contributors c ON c.github_id=a.github_id AND c.enrolled_at IS NOT NULL AND c.is_bot=FALSE
     WHERE m.registration_session_hash=$1 AND m.registration_session_expires_at>now()
       AND m.verification_status='verified' AND m.student_fingerprint IS NOT NULL
       AND (SELECT count(*) FROM member_github_accounts x WHERE x.member_id=m.id)=1
       AND (SELECT count(*) FROM member_github_accounts x WHERE x.github_id=a.github_id)=1
       AND NOT EXISTS (SELECT 1 FROM members other WHERE other.id<>m.id
         AND (other.student_fingerprint=m.student_fingerprint OR other.registration_github_id=a.github_id))`,
    [stateHash(token)],
  );
  return result.rows.length === 1 ? { registered: true, login: result.rows[0]!.login } : { registered: false };
}

function safeCallbackUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("GITHUB_OAUTH_CALLBACK_URL must be a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("GITHUB_OAUTH_CALLBACK_URL must use http or https");
  }
  return parsed.toString();
}

export async function exchangeCode(config: GitHubOAuthConfig, code: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "LeadBoard",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.callbackUrl,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GitHubLinkError(
      "GITHUB_OAUTH_UPSTREAM_ERROR",
      502,
      "暂时无法连接 GitHub 授权服务",
    );
  }

  if (!response.ok) {
    throw new GitHubLinkError(
      "GITHUB_OAUTH_UPSTREAM_ERROR",
      502,
      "GitHub 授权服务暂时不可用",
    );
  }

  const payload = await response.json().catch(() => null) as
    | { access_token?: unknown; error?: unknown }
    | null;

  if (!payload || typeof payload.access_token !== "string" || !payload.access_token) {
    throw new GitHubLinkError(
      "GITHUB_AUTHORIZATION_FAILED",
      400,
      "GitHub 授权未完成，请重新尝试",
    );
  }
  return payload.access_token;
}

export async function fetchGitHubIdentity(accessToken: string): Promise<{
  githubId: string;
  login: string;
  avatarUrl: string | null;
}> {
  let response: Response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "LeadBoard",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GitHubLinkError(
      "GITHUB_OAUTH_UPSTREAM_ERROR",
      502,
      "暂时无法读取 GitHub 身份",
    );
  }

  if (!response.ok) {
    throw new GitHubLinkError(
      "GITHUB_AUTHORIZATION_FAILED",
      400,
      "无法确认 GitHub 身份，请重新授权",
    );
  }

  const payload = await response.json().catch(() => null) as
    | { id?: unknown; login?: unknown; avatar_url?: unknown }
    | null;
  const id = payload?.id;
  const login = payload?.login;
  const avatarUrl = payload?.avatar_url;

  if (
    typeof id !== "number"
    || !Number.isSafeInteger(id)
    || id <= 0
    || typeof login !== "string"
    || login.length === 0
    || !(avatarUrl === null || typeof avatarUrl === "string")
  ) {
    throw new GitHubLinkError(
      "GITHUB_IDENTITY_INVALID",
      502,
      "GitHub 返回了无法识别的账号信息",
    );
  }

  return {
    githubId: String(id),
    login,
    avatarUrl: avatarUrl ?? null,
  };
}

export class GitHubOAuthLinkService implements GitHubLinkApi {
  private readonly config: GitHubOAuthConfig;

  constructor(config: GitHubOAuthConfig) {
    this.config = {
      clientId: config.clientId.trim(),
      clientSecret: config.clientSecret.trim(),
      callbackUrl: safeCallbackUrl(config.callbackUrl.trim()),
    };
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("GitHub OAuth client credentials are required");
    }
  }

  async createAuthorization(memberId: string): Promise<GitHubLinkInfo> {
    if (!/^[1-9]\d*$/.test(memberId)) {
      throw new GitHubLinkError("INVALID_MEMBER", 400, "无效的成员身份");
    }

    const state = randomBytes(32).toString("base64url");
    const hash = stateHash(state);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + STATE_TTL_MS);

    await getDbPool().query(
      `INSERT INTO github_oauth_states (member_id, state_hash, expires_at, created_at)
       VALUES ($1,$2,$3,$4)`,
      [memberId, hash, expiresAt, now],
    );

    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", this.config.clientId);
    authorize.searchParams.set("redirect_uri", this.config.callbackUrl);
    authorize.searchParams.set("state", state);

    return { available: true, authorizeUrl: authorize.toString() };
  }

  async completeAuthorization(code: string, state: string, registrationToken: string): Promise<{ login: string }> {
    if (!code || code.length > 1024 || !state || state.length > 512) {
      throw new GitHubLinkError("INVALID_GITHUB_CALLBACK", 400, "GitHub 回调参数无效");
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(registrationToken)) {
      throw new GitHubLinkError("REGISTRATION_SESSION_REQUIRED", 401, "请在验证邮箱的浏览器中继续 GitHub 绑定");
    }

    const hash = stateHash(state);
    const now = new Date();
    const memberId = await withTransaction(async (client) => {
      const found = await client.query<{ id: string; member_id: string }>(
        `SELECT s.id::text, s.member_id::text
           FROM github_oauth_states s JOIN members m ON m.id=s.member_id
          WHERE s.state_hash=$1
            AND s.used_at IS NULL
            AND s.expires_at > $2
            AND m.registration_session_hash=$3 AND m.registration_session_expires_at>$2
          LIMIT 1
          FOR UPDATE`,
        [hash, now, stateHash(registrationToken)],
      );
      const row = found.rows[0];
      if (!row) {
        throw new GitHubLinkError(
          "GITHUB_OAUTH_STATE_INVALID",
          400,
          "GitHub 授权已过期或已经使用，请重新验证邮箱",
        );
      }
      await client.query(
        "UPDATE github_oauth_states SET used_at=$2 WHERE id=$1",
        [row.id, now],
      );
      return row.member_id;
    });

    const accessToken = await exchangeCode(this.config, code);
    const identity = await fetchGitHubIdentity(accessToken);

    await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(1279411270)");
      const member=await client.query<{registration_github_id:string|null;student_fingerprint:string|null}>(
        `SELECT registration_github_id::text, student_fingerprint FROM members
         WHERE id=$1 AND verification_status='verified' AND registration_session_hash=$2
           AND registration_session_expires_at>now() FOR UPDATE`,[memberId,stateHash(registrationToken)]);
      const intended=member.rows[0]?.registration_github_id;
      if (!member.rows[0]?.student_fingerprint || intended!==identity.githubId) {
        throw new GitHubLinkError("GITHUB_ACCOUNT_MISMATCH",409,"请使用注册时填写的 GitHub 账号授权");
      }
      const duplicate = await client.query(
        `SELECT 1 FROM members WHERE id<>$1
         AND (student_fingerprint=$2 OR registration_github_id=$3) LIMIT 1`,
        [memberId, member.rows[0].student_fingerprint, identity.githubId],
      );
      if (duplicate.rows.length) throw new GitHubLinkError("GITHUB_ACCOUNT_ALREADY_LINKED",409,"该学号或 GitHub 账号已经注册");
      const bound=await client.query("SELECT 1 FROM member_github_accounts WHERE member_id=$1",[memberId]);
      if (bound.rows.length) throw new GitHubLinkError("GITHUB_ACCOUNT_ALREADY_LINKED",409,"此用户已经绑定 GitHub 账号");
      const existing = await client.query<{ member_id: string }>(
        `SELECT member_id::text
           FROM member_github_accounts
          WHERE github_id=$1
          LIMIT 1
          FOR UPDATE`,
        [identity.githubId],
      );
      const existingMemberId = existing.rows[0]?.member_id;
      if (existingMemberId && existingMemberId !== memberId) {
        throw new GitHubLinkError(
          "GITHUB_ACCOUNT_ALREADY_LINKED",
          409,
          "这个 GitHub 账号已经绑定到其他复旦身份",
        );
      }

      await client.query(
        `INSERT INTO github_accounts (github_id, login, avatar_url, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$4)
         ON CONFLICT (github_id) DO UPDATE SET
           login=EXCLUDED.login,
           avatar_url=EXCLUDED.avatar_url,
           updated_at=EXCLUDED.updated_at`,
        [identity.githubId, identity.login, identity.avatarUrl, now],
      );

      await client.query(
        "UPDATE member_github_accounts SET is_primary=FALSE WHERE member_id=$1 AND github_id<>$2",
        [memberId, identity.githubId],
      );
      await client.query(
        `INSERT INTO member_github_accounts (member_id, github_id, linked_at, is_primary)
         VALUES ($1,$2,$3,TRUE)
         ON CONFLICT (member_id, github_id) DO UPDATE SET
           linked_at=EXCLUDED.linked_at,
           is_primary=TRUE`,
        [memberId, identity.githubId, now],
      );
      await client.query(
        `INSERT INTO contributors (github_id,login,avatar_url,actor_type,is_bot,enrolled_at)
         VALUES ($1,$2,$3,'User',FALSE,$4)
         ON CONFLICT (github_id) DO UPDATE SET login=EXCLUDED.login,avatar_url=EXCLUDED.avatar_url,
           enrolled_at=coalesce(contributors.enrolled_at,EXCLUDED.enrolled_at),updated_at=$4`,
        [identity.githubId,identity.login,identity.avatarUrl,now],
      );
    });

    // This query uses a new database operation AFTER withTransaction committed.
    const confirmation = await getRegistrationStatus(registrationToken);
    if (!confirmation.registered || confirmation.login !== identity.login) {
      throw new GitHubLinkError("REGISTRATION_WRITE_NOT_CONFIRMED", 500, "未能确认注册记录，请重新检查注册状态");
    }
    return { login: confirmation.login };
  }
}

export function createGitHubLinkServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GitHubLinkApi {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const callbackUrl = env.GITHUB_OAUTH_CALLBACK_URL?.trim();
  if (!clientId || !clientSecret || !callbackUrl) {
    return new UnavailableGitHubLinkApi();
  }
  try {
    return new GitHubOAuthLinkService({ clientId, clientSecret, callbackUrl });
  } catch {
    return new UnavailableGitHubLinkApi();
  }
}
