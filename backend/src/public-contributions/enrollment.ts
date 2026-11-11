import type { Pool } from "pg";
import { getContributionScores } from "../analytics/scoring.js";
import { getDbPool } from "../db/index.js";
import { collectPublicContributions, type PublicContributionExport } from "./export.js";
import { refreshRepositoryStars } from "./repository-stars.js";

class UnavailableContributorError extends Error {
  constructor(message: string) { super(message); this.name = "UnavailableContributorError"; }
}

// HTTP 403 can mean global API rate limiting; only treat a clearly
// account-scoped permission denial as an unavailable user/repository.
async function unavailableGitHubResource(response: Response): Promise<boolean> {
  if (response.status === 404 || response.status === 410) return true;
  if (response.status !== 403 || response.headers.has("retry-after")
      || response.headers.get("x-ratelimit-remaining") === "0") return false;
  const body = await response.clone().json().catch(() => null) as { message?: unknown } | null;
  return typeof body?.message === "string"
    && /resource not accessible by integration|permission denied|account suspended/i.test(body.message);
}

export interface ContributorIdentity {
  githubId: string;
  login: string;
  avatarUrl: string | null;
}

/** Persist an administrator-enrolled account without inventing email/OAuth verification. */
export async function saveContributorActivity(
  identity: ContributorIdentity,
  data: PublicContributionExport,
  pool: Pool = getDbPool(),
): Promise<void> {
  if (data.incomplete) throw new Error("GitHub returned incomplete search results; keeping the previous snapshot");
  if (data.rows.some(row=>!row.repositoryGithubId || !/^[1-9]\d*$/.test(row.repositoryGithubId))) {
    throw new Error("Every imported contribution must have a verified GitHub repository ID");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query<{ id: string }>(
      `INSERT INTO contributors
        (github_id, login, avatar_url, actor_type, is_bot, enrolled_at)
       VALUES ($1,$2,$3,'User',FALSE,now())
       ON CONFLICT (github_id) DO UPDATE SET
         login=EXCLUDED.login, avatar_url=EXCLUDED.avatar_url,
         actor_type='User', is_bot=FALSE,
         enrolled_at=coalesce(contributors.enrolled_at, now()), updated_at=now()
       RETURNING id::text`,
      [identity.githubId, identity.login, identity.avatarUrl],
    );
    const id = actor.rows[0]!.id;
    // The contributor row lock serializes imports. Never replace full history.
    const rows = [...new Map(data.rows.map(row => [
      [row.kind, row.repositoryGithubId ?? row.repository.toLowerCase(), row.identifier].join(":"), row,
    ])).values()];
    // Count actual newly inserted rows, not search results or re-imports.
    // Locking the contributor row above serializes concurrent submissions.
    const quota = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM contributor_public_activities WHERE contributor_id=$1 AND first_seen_at>=now()-interval '6 hours'",
      [id],
    );
    const remaining = Math.max(0, 50 - Number(quota.rows[0]?.count ?? 0));
    const acceptedRows = rows.slice(0, remaining);
    const capped = data.truncated || acceptedRows.length < rows.length;
    await client.query(
      `UPDATE contributor_public_activities a SET repository_github_id=d."repositoryGithubId"::bigint
       FROM jsonb_to_recordset($2::jsonb) AS d
         (kind text, repository text, identifier text, "repositoryGithubId" text)
       WHERE a.contributor_id=$1 AND a.repository_github_id IS NULL
         AND lower(a.repository)=lower(d.repository) AND a.kind=d.kind AND a.identifier=d.identifier
         AND d."repositoryGithubId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM contributor_public_activities known
           WHERE known.contributor_id=$1 AND known.kind=d.kind
             AND known.repository_github_id=d."repositoryGithubId"::bigint AND known.identifier=d.identifier)`,
      [id, JSON.stringify(acceptedRows)],
    );
    await client.query(
      `INSERT INTO contributor_public_activities
        (contributor_id, kind, repository, repository_github_id, object_github_id, identifier, occurred_at, merged_at, title, html_url)
       SELECT $1, kind, repository, "repositoryGithubId"::bigint, "objectGithubId"::bigint,
         identifier, "occurredAt"::timestamptz, "mergedAt"::timestamptz, title, url
       FROM jsonb_to_recordset($2::jsonb) AS records
         (kind text, repository text, "repositoryGithubId" text, "objectGithubId" text,
          identifier text, "occurredAt" text, "mergedAt" text, title text, url text)
       ON CONFLICT (contributor_id, kind, repository_github_id, identifier) DO UPDATE SET
         repository=EXCLUDED.repository, object_github_id=EXCLUDED.object_github_id,
         merged_at=coalesce(EXCLUDED.merged_at,contributor_public_activities.merged_at),
         title=EXCLUDED.title, html_url=EXCLUDED.html_url, last_seen_at=now()`,
      [id, JSON.stringify(acceptedRows)],
    );
    await client.query(
      `UPDATE contributors SET public_synced_at=now(),
         public_sync_truncated=$2, public_sync_incomplete=FALSE,
         public_sync_version=2 WHERE id=$1`,
      [id, capped],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function enrollContributor(
  username: string,
  githubToken: string,
  pool: Pool = getDbPool(),
  fetcher: typeof fetch = fetch,
  expectedGithubId?: string,
): Promise<{ login: string; events: number }> {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username) || !githubToken.trim()) {
    throw new Error("A valid GitHub username and token are required");
  }
  if (expectedGithubId !== undefined && !/^[1-9]\d*$/.test(expectedGithubId)) throw new Error("Invalid stable GitHub ID");
  const accountPath = expectedGithubId ? `user/${expectedGithubId}` : `users/${encodeURIComponent(username)}`;
  const response = await fetcher(`https://api.github.com/${accountPath}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "User-Agent": "LeaderBoard",
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    if (await unavailableGitHubResource(response)) {
      throw new UnavailableContributorError(`GitHub account unavailable: HTTP ${response.status}`);
    }
    throw new Error(`GitHub account lookup returned HTTP ${response.status}`);
  }
  const user = await response.json() as { id?: unknown; login?: unknown; avatar_url?: unknown; type?: unknown };
  if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0
      || typeof user.login !== "string" || (expectedGithubId ? String(user.id) !== expectedGithubId : user.login.toLowerCase() !== username.toLowerCase())
      || user.type !== "User"
      || !(user.avatar_url === null || typeof user.avatar_url === "string")) {
    throw new UnavailableContributorError("GitHub account unavailable or stable ID mismatch");
  }
  // No catch-up: scan only the latest six hours, starting after the
  // previously completed refresh so discarded overflow is never backfilled.
  const lastResult = await pool.query<{ public_synced_at: Date | null }>(
    "SELECT public_synced_at FROM contributors WHERE github_id=$1", [String(user.id)],
  );
  const now = Date.now();
  const previous = lastResult.rows[0]?.public_synced_at?.getTime();
  const since = new Date(Math.max(now - 6 * 60 * 60 * 1000, previous && previous <= now ? previous : 0)).toISOString();
  const data = await collectPublicContributions(user.login, githubToken, fetcher, {since, contributorGithubId:String(user.id), maxRowsPerKind:50});
  // Rows arrive newest first; ignore anything beyond this run’s per-account limit.
  data.truncated ||= data.rows.length > 50 || Object.values(data.totals).reduce((a, b) => a + b, 0) > 50;
  data.rows = data.rows.slice(0, 50);
  const repositoryIds = new Map<string, string>();
  for (const row of data.rows) if (row.repositoryGithubId) repositoryIds.set(row.repository.toLowerCase(), row.repositoryGithubId);
  const validRows: typeof data.rows = [];
  for (const row of data.rows) {
    if (!repositoryIds.has(row.repository.toLowerCase())) {
      const repo = await fetcher(`https://api.github.com/repos/${row.repository}`, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "User-Agent": "LeaderBoard" },
        signal: AbortSignal.timeout(25000),
      });
      if (!repo.ok) {
        if (await unavailableGitHubResource(repo)) continue;
        throw new Error(`GitHub repository lookup returned HTTP ${repo.status}`);
      }
      const meta = await repo.json() as { id?: unknown };
      if (typeof meta.id !== "number" || !Number.isSafeInteger(meta.id) || meta.id <= 0) throw new Error("Invalid GitHub repository ID");
      repositoryIds.set(row.repository.toLowerCase(), String(meta.id));
    }
    row.repositoryGithubId = repositoryIds.get(row.repository.toLowerCase())!;
    validRows.push(row);
  }
  data.rows = validRows;
  await saveContributorActivity({ githubId: String(user.id), login: user.login, avatarUrl: user.avatar_url }, data, pool);
  // The global Star scheduler retries its own metadata failures; they must
  // not cause successfully saved contribution events to be marked as failed.
  try { await refreshRepositoryStars(githubToken, pool, fetcher, String(user.id)); }
  catch { console.warn("Contributor events saved; repository star refresh deferred"); }
  return { login: user.login, events: data.rows.length };
}

export async function refreshEnrolledContributors(githubToken: string, pool: Pool = getDbPool(), fetcher: typeof fetch = fetch): Promise<void> {
  const result = await pool.query<{ login: string; github_id: string }>(
    `SELECT login, github_id FROM (
       SELECT login, github_id::text,
         (row_number() OVER (ORDER BY id) - 1) % 12 AS batch
       FROM contributors WHERE enrolled_at IS NOT NULL
     ) enrolled WHERE batch = floor(extract(epoch FROM now()) / 1800)::bigint % 12
     ORDER BY github_id`,
  );
  let failures = 0;
  for (const row of result.rows) {
    try { await enrollContributor(row.login, githubToken, pool, fetcher, row.github_id); }
    catch (error) {
      if (error instanceof UnavailableContributorError) {
        console.info("Unavailable enrolled contributor skipped", row.github_id);
        continue;
      }
      failures++;
      console.warn("Contributor refresh failed", row.github_id, error instanceof Error ? error.message : "unknown error");
    }
  }
  if (failures) throw new Error(`${failures} enrolled contributor synchronization(s) failed`);
}

export async function getContributorActivityExport(
  username: string,
  pool: Pool = getDbPool(),
): Promise<PublicContributionExport | null> {
  const actor = await pool.query<{ id: string; public_sync_truncated: boolean; public_sync_incomplete: boolean }>(
    `SELECT id::text, public_sync_truncated, public_sync_incomplete FROM contributors
     WHERE lower(login)=lower($1) AND is_bot=FALSE LIMIT 1`,
    [username],
  );
  const user = actor.rows[0];
  if (!user) return null;
  const scored = await getContributionScores(pool, null, new Date().toISOString());
  const decisions = scored.decisions.filter(row => row.contributorId === user.id);
  const totals = { commit: 0, pull_request: 0, issue: 0 };
  const rows = decisions.map(row => {
    totals[row.kind]++;
    return {
      kind: row.kind, repository: row.repository, repositoryGithubId: row.repositoryGithubId,objectGithubId:row.objectGithubId??null,
      identifier: row.identifier, occurredAt: row.occurredAt, mergedAt: row.mergedAt,
      title: row.title, url: row.url, scoring: row,
    };
  }).sort((a,b) => b.occurredAt.localeCompare(a.occurredAt) || a.url.localeCompare(b.url));
  return { rows, totals, truncated: user.public_sync_truncated, incomplete: user.public_sync_incomplete };
}
