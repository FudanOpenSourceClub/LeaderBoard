import type { Pool } from "pg";
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
    // The account row lock serializes repeat imports. A complete snapshot replaces
    // removed/private records; a capped snapshot retains earlier imported history.
    if (!data.truncated) {
      await client.query("DELETE FROM contributor_public_activities WHERE contributor_id=$1", [id]);
    }
    await client.query(
      `INSERT INTO contributor_public_activities
        (contributor_id, kind, repository, identifier, occurred_at, title, html_url)
       SELECT $1, kind, repository, identifier, "occurredAt"::timestamptz, title, url
       FROM jsonb_to_recordset($2::jsonb) AS records
         (kind text, repository text, identifier text, "occurredAt" text, title text, url text)
       ON CONFLICT (contributor_id, kind, repository, identifier) DO UPDATE SET
         occurred_at=EXCLUDED.occurred_at, title=EXCLUDED.title, html_url=EXCLUDED.html_url`,
      [id, JSON.stringify(data.rows)],
    );
    await client.query(
      `UPDATE contributors SET public_synced_at=now(), public_sync_truncated=$2,
         public_sync_incomplete=FALSE WHERE id=$1`,
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
  const data = await collectPublicContributions(user.login, githubToken, fetcher);
  await saveContributorActivity({ githubId: String(user.id), login: user.login, avatarUrl: user.avatar_url }, data, pool);
  return { login: user.login, events: data.rows.length };
}

export async function refreshEnrolledContributors(githubToken: string, pool: Pool = getDbPool()): Promise<void> {
  const result = await pool.query<{ login: string }>(
    `SELECT login FROM contributors WHERE enrolled_at IS NOT NULL
       AND (public_synced_at IS NULL OR public_synced_at < now() - interval '6 hours')
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
  const result = await pool.query<{
    kind: "commit" | "pull_request" | "issue";
    repository: string; identifier: string; occurred_at: Date; title: string; html_url: string;
  }>(
    `WITH source_events AS (
       SELECT a.kind, a.repository, a.identifier, a.occurred_at, a.title, a.html_url
       FROM contributor_public_activities a JOIN contributors c ON c.id=a.contributor_id
       WHERE a.contributor_id=$1 AND c.enrolled_at IS NOT NULL
       UNION ALL
       SELECT 'commit', r.full_name, c.sha, c.authored_at, '',
         coalesce(c.html_url, 'https://github.com/' || r.full_name || '/commit/' || c.sha)
       FROM commits c JOIN repositories r ON r.id=c.repository_id AND r.tracked=TRUE
       WHERE c.contributor_id=$1
       UNION ALL
       SELECT 'pull_request', r.full_name, p.number::text, p.created_at, '',
         coalesce(p.html_url, 'https://github.com/' || r.full_name || '/pull/' || p.number)
       FROM pull_requests p JOIN repositories r ON r.id=p.repository_id AND r.tracked=TRUE
       WHERE p.contributor_id=$1
       UNION ALL
       SELECT 'issue', r.full_name, i.number::text, i.created_at, '',
         coalesce(i.html_url, 'https://github.com/' || r.full_name || '/issues/' || i.number)
       FROM issues i JOIN repositories r ON r.id=i.repository_id AND r.tracked=TRUE
       WHERE i.contributor_id=$1
     ), unique_events AS (
       SELECT DISTINCT ON (kind, lower(repository), identifier) * FROM source_events
       ORDER BY kind, lower(repository), identifier, length(title) DESC
     )
     SELECT * FROM unique_events WHERE occurred_at < now() ORDER BY occurred_at DESC, html_url`,
    [user.id],
  );
  const totals = { commit: 0, pull_request: 0, issue: 0 };
  const rows = result.rows.map((row) => {
    totals[row.kind]++;
    return {
      kind: row.kind, repository: row.repository, identifier: row.identifier,
      occurredAt: row.occurred_at.toISOString(), title: row.title, url: row.html_url,
    };
  });
  return { rows, totals, truncated: user.public_sync_truncated, incomplete: user.public_sync_incomplete };
}
