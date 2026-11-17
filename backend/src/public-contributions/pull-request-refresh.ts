import type { Pool } from "pg";
import { GitHubApiClient, GitHubClientError } from "../github/client.js";

export interface PullRequestUpdate {
  repositoryGithubId: string;
  identifier: string;
  mergedAt: string | null;
}

interface StoredPullRequest {
  repository_github_id: string;
  object_github_id: string | null;
  identifier: string;
}

interface Repository {
  id: number;
  full_name: string;
  private: boolean;
}

interface PullRequest {
  id: number;
  number: number;
  user: { id: number } | null;
  base: { repo: Repository };
  merged_at: string | null;
}

function matchesId(value: unknown, expected: string): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && String(value) === expected;
}

/** Recheck stored PRs independently of the new-event window and insertion quota.
 * Oldest checks go first so open/closed-unmerged PRs cannot starve later rows.
 * Return updates for the caller's transaction; never import historical events.
 */
export async function collectStoredPullRequestUpdates(
  githubId: string,
  githubToken: string,
  pool: Pool,
  fetcher: typeof fetch = fetch,
): Promise<PullRequestUpdate[]> {
  const stored = await pool.query<StoredPullRequest>(
    `SELECT a.repository_github_id::text, a.object_github_id::text, a.identifier
     FROM contributor_public_activities a JOIN contributors c ON c.id=a.contributor_id
     WHERE c.github_id=$1 AND a.kind='pull_request' AND a.merged_at IS NULL
       AND a.repository_github_id IS NOT NULL
     ORDER BY a.last_seen_at, a.repository_github_id, a.identifier LIMIT 50`,
    [githubId],
  );
  if (!stored.rows.length) return [];
  const github = new GitHubApiClient({ githubToken }, {
    fetch: fetcher, maxAttempts: 3, maxWaitMs: 30_000,
    ...(fetcher === fetch ? {} : { sleep: async () => undefined }),
  });
  const repositories = new Map<string, Repository | null>();
  const updates: PullRequestUpdate[] = [];
  for (const row of stored.rows) {
    let mergedAt: string | null = null;
    try {
      if (!repositories.has(row.repository_github_id)) {
        // Resolve the current name by immutable ID, even after a transfer or rename.
        const repo = await github.requestRest<Repository>("GET", `/repositories/${row.repository_github_id}`);
        if (!matchesId(repo?.id, row.repository_github_id)
            || typeof repo.full_name !== "string" || !/^[^/]+\/[^/]+$/.test(repo.full_name)
            || typeof repo.private !== "boolean") {
          throw new Error("Invalid GitHub repository identity for stored PR");
        }
        repositories.set(row.repository_github_id, repo.private ? null : repo);
      }
      const repo = repositories.get(row.repository_github_id);
      if (repo) {
        const path = repo.full_name.split("/").map(encodeURIComponent).join("/");
        const pr = await github.requestRest<PullRequest>("GET", `/repos/${path}/pulls/${encodeURIComponent(row.identifier)}`);
        if (!matchesId(pr?.user?.id, githubId)
            || !matchesId(pr?.base?.repo?.id, row.repository_github_id)
            || !matchesId(pr?.number, row.identifier)
            || (row.object_github_id !== null && !matchesId(pr?.id, row.object_github_id))
            || typeof pr?.base?.repo?.private !== "boolean"
            || !(pr.merged_at === null || (typeof pr.merged_at === "string" && Number.isFinite(Date.parse(pr.merged_at))))) {
          throw new Error("Invalid GitHub pull request identity or merge metadata");
        }
        if (!pr.base.repo.private) mergedAt = pr.merged_at;
      }
    } catch (error) {
      // Unavailable records remain unchanged and rotate to the back of the queue.
      // Rate limits, auth failures and invalid payloads must not mark a sync successful.
      if (!(error instanceof GitHubClientError && (error.status === 404 || error.status === 410))) throw error;
      if (!repositories.has(row.repository_github_id)) repositories.set(row.repository_github_id, null);
    }
    updates.push({ repositoryGithubId: row.repository_github_id, identifier: row.identifier, mergedAt });
  }
  return updates;
}
