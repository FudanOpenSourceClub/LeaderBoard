import type { Pool } from "pg";
import { getDbPool } from "../db/index.js";
import { GitHubApiClient, GitHubClientError } from "../github/client.js";

/** Refresh all Commit/Issue repositories, including those with no new activity.
 * The cache is shared by stable repository ID and is independent of the PR whitelist.
 */
export async function refreshRepositoryStars(
  githubToken: string,
  pool: Pool = getDbPool(),
  fetcher: typeof fetch = fetch,
  contributorGithubId?: string,
): Promise<{ refreshed: number }> {
  if (contributorGithubId !== undefined && !/^[1-9]\d*$/.test(contributorGithubId)) {
    throw new Error("Invalid contributor GitHub ID");
  }
  const result = await pool.query<{ github_id: string }>(`WITH active_repositories AS (
    SELECT a.repository_github_id AS github_id FROM contributor_public_activities a
    JOIN contributors c ON c.id=a.contributor_id AND c.enrolled_at IS NOT NULL AND c.is_bot=FALSE
    WHERE a.kind IN ('commit','issue') AND a.repository_github_id IS NOT NULL
      AND ($1::text IS NULL OR c.github_id::text=$1)
    UNION
    SELECT r.github_id FROM commits a JOIN repositories r ON r.id=a.repository_id AND r.tracked=TRUE
    JOIN contributors c ON c.id=a.contributor_id AND c.is_bot=FALSE
    WHERE ($1::text IS NULL OR c.github_id::text=$1)
    UNION
    SELECT r.github_id FROM issues a JOIN repositories r ON r.id=a.repository_id AND r.tracked=TRUE
    JOIN contributors c ON c.id=a.contributor_id AND c.is_bot=FALSE
    WHERE ($1::text IS NULL OR c.github_id::text=$1)
  ) SELECT r.github_id::text FROM active_repositories r
    LEFT JOIN repository_star_counts s ON s.github_id=r.github_id
    WHERE s.github_id IS NULL OR s.checked_at<=now()-interval '1 day'
    ORDER BY r.github_id`, [contributorGithubId ?? null]);
  if (!result.rows.length) return { refreshed: 0 };
  const github = new GitHubApiClient({ githubToken }, {
    fetch: fetcher, maxAttempts: 3, maxWaitMs: 30_000,
    ...(fetcher === fetch ? {} : { sleep: async () => undefined }),
  });
  let next = 0;
  let refreshed = 0;
  let failed = 0;
  let stopped = false;
  await Promise.all(Array.from({ length: Math.min(3, result.rows.length) }, async () => {
    while (!stopped && next < result.rows.length) {
      const id = result.rows[next++]!.github_id;
      try {
        let stars: number | null = null;
        try {
          const repository = await github.requestRest<{ id: unknown; private: unknown; stargazers_count: unknown }>(
            "GET", `/repositories/${id}`,
          );
          if (typeof repository.id !== "number" || !Number.isSafeInteger(repository.id) || String(repository.id) !== id
            || typeof repository.private !== "boolean" || typeof repository.stargazers_count !== "number"
            || !Number.isSafeInteger(repository.stargazers_count) || repository.stargazers_count < 0) {
            throw new Error("Invalid GitHub repository star metadata");
          }
          if (!repository.private) stars = repository.stargazers_count;
        } catch (error) {
          // Deleted, unavailable or private repositories cannot satisfy the public Star threshold.
          if (!(error instanceof GitHubClientError && (error.status === 404 || error.status === 410))) throw error;
        }
        await pool.query(`INSERT INTO repository_star_counts(github_id,stars,checked_at) VALUES ($1,$2,now())
          ON CONFLICT (github_id) DO UPDATE SET stars=EXCLUDED.stars,checked_at=EXCLUDED.checked_at`, [id, stars]);
        refreshed++;
      } catch (error) {
        // Preserve the last verified snapshot on transient failures; never invent a qualifying count.
        failed++;
        if (error instanceof GitHubClientError &&
          (error.code === "RATE_LIMITED" || [401, 403, 429].includes(error.status ?? 0))) stopped = true;
      }
    }
  }));
  if (failed) throw new Error(`Repository star refresh incomplete: ${failed + result.rows.length - next} repository lookup(s) failed or deferred`);
  return { refreshed };
}
