import type { Pool } from "pg";
import { getContributionScores } from "../analytics/scoring.js";
import { getDbPool } from "../db/index.js";
import { collectPublicContributions, type PublicContributionExport } from "./export.js";

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
      [id, JSON.stringify(rows)],
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
      [id, JSON.stringify(rows)],
    );
    await client.query(
      `UPDATE contributors SET public_synced_at=CASE WHEN $2 THEN public_synced_at ELSE now() END,
         public_sync_truncated=$2, public_sync_incomplete=FALSE,
         public_sync_version=CASE WHEN $2 THEN public_sync_version ELSE 2 END WHERE id=$1`,
      [id, data.truncated],
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
): Promise<{ login: string; events: number }> {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username) || !githubToken.trim()) {
    throw new Error("A valid GitHub username and token are required");
  }
  const response = await fetcher(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "User-Agent": "LeaderBoard",
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`GitHub account lookup returned HTTP ${response.status}`);
  const user = await response.json() as { id?: unknown; login?: unknown; avatar_url?: unknown; type?: unknown };
  if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0
      || typeof user.login !== "string" || user.login.toLowerCase() !== username.toLowerCase()
      || user.type !== "User"
      || !(user.avatar_url === null || typeof user.avatar_url === "string")) {
    throw new Error("GitHub returned an invalid user account");
  }
  const previous = await pool.query<{ public_synced_at: Date | null; public_sync_version: number }>(
    "SELECT public_synced_at, public_sync_version FROM contributors WHERE github_id=$1", [String(user.id)],
  );
  const last = previous.rows[0];
  const since = last?.public_sync_version === 2 && last.public_synced_at
    ? new Date(last.public_synced_at.getTime() - 86400000).toISOString() : undefined;
  const data = await collectPublicContributions(user.login, githubToken, fetcher, since ? { since } : {});
  const repositoryIds = new Map<string, string>();
  for (const row of data.rows) if (row.repositoryGithubId) repositoryIds.set(row.repository.toLowerCase(), row.repositoryGithubId);
  for (const row of data.rows) {
    if (!repositoryIds.has(row.repository.toLowerCase())) {
      const repo = await fetcher(`https://api.github.com/repos/${row.repository}`, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "User-Agent": "LeaderBoard" },
        signal: AbortSignal.timeout(25000),
      });
      if (!repo.ok) throw new Error(`GitHub repository lookup returned HTTP ${repo.status}`);
      const meta = await repo.json() as { id?: unknown };
      if (typeof meta.id !== "number" || !Number.isSafeInteger(meta.id) || meta.id <= 0) throw new Error("Invalid GitHub repository ID");
      repositoryIds.set(row.repository.toLowerCase(), String(meta.id));
    }
    row.repositoryGithubId = repositoryIds.get(row.repository.toLowerCase())!;
  }
  await saveContributorActivity({ githubId: String(user.id), login: user.login, avatarUrl: user.avatar_url }, data, pool);
  return { login: user.login, events: data.rows.length };
}

export async function refreshEnrolledContributors(githubToken: string, pool: Pool = getDbPool()): Promise<void> {
  const result = await pool.query<{ login: string }>(
    `SELECT login FROM contributors WHERE enrolled_at IS NOT NULL
       AND (public_synced_at IS NULL OR public_synced_at < now() - interval '1 day' OR public_sync_version < 2)
     ORDER BY id`,
  );
  for (const row of result.rows) await enrollContributor(row.login, githubToken, pool);
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
