import type { Pool } from "pg";
import { setTimeout as sleep } from "node:timers/promises";
import { GitHubApiClient, GitHubClientError } from "../github/client.js";
import { saveContributorActivity } from "./enrollment.js";
import { collectPublicContributions, type ContributionPeriod } from "./export.js";

export const LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

function unavailable(error: unknown): boolean {
  return error instanceof GitHubClientError && (error.status === 404 || error.status === 410);
}

export async function backfillPublicContributions(
  pool: Pool,
  githubToken: string,
  options: { period: ContributionPeriod; githubId?: string; apply: boolean },
): Promise<{ accounts: number; completed: number; unavailable: number; failed: number; found: number; inserted: number; skippedRows: number }> {
  const { period, githubId, apply } = options;
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  if (!(from < to && to <= Date.now() - LIVE_WINDOW_MS)) throw new Error("Backfill dates must precede the live six-hour window");
  if (githubId && !/^[1-9]\d*$/.test(githubId)) throw new Error("Invalid contributor GitHub ID");

  const github = new GitHubApiClient({ githubToken });
  const accounts = await pool.query<{ github_id: string }>(
    `SELECT github_id::text FROM contributors
     WHERE enrolled_at IS NOT NULL AND is_bot=FALSE AND github_id IS NOT NULL
       AND ($1::bigint IS NULL OR github_id=$1) ORDER BY id`,
    [githubId ?? null],
  );
  if (githubId && !accounts.rows.length) throw new Error("Requested GitHub account is not enrolled");

  const summary = { accounts: accounts.rows.length, completed: 0, unavailable: 0, failed: 0, found: 0, inserted: 0, skippedRows: 0 };
  const repositories = new Map<string, string | null>();
  let nextSearch = 0;
  const beforeSearch = async () => {
    await sleep(Math.max(0, nextSearch - Date.now()));
    nextSearch = Date.now() + 3_000;
  };

  for (const account of accounts.rows) {
    try {
      let user: { id: number; login: string; type: string; avatar_url: string | null };
      try {
        user = await github.requestRest("GET", `/user/${account.github_id}`);
      } catch (error) {
        if (!unavailable(error)) throw error;
        summary.unavailable++;
        console.warn(`GitHub account ${account.github_id} is unavailable`);
        continue;
      }
      if (String(user.id) !== account.github_id || user.type !== "User") throw new Error("GitHub account identity mismatch");

      const data = await collectPublicContributions(user.login, githubToken, fetch, {
        period, contributorGithubId: account.github_id, beforeSearch,
      });
      if (data.incomplete || data.truncated) throw new Error("GitHub returned partial historical search results");

      const rows = [];
      for (const row of data.rows) {
        const key = row.repository.toLowerCase();
        let id = row.repositoryGithubId ?? repositories.get(key);
        if (id === undefined) {
          const path = row.repository.split("/").map(encodeURIComponent).join("/");
          try {
            const repo = await github.requestRest<{ id: number; private: boolean }>("GET", `/repos/${path}`);
            if (!Number.isSafeInteger(repo.id) || repo.id <= 0 || typeof repo.private !== "boolean") {
              throw new Error(`Invalid GitHub repository metadata for ${row.repository}`);
            }
            id = repo.private ? null : String(repo.id);
          } catch (error) {
            if (!unavailable(error)) throw error;
            id = null;
          }
          repositories.set(key, id);
        }
        if (id === null) { summary.skippedRows++; continue; }
        rows.push({ ...row, repositoryGithubId: id });
      }

      const inserted = apply && rows.length ? await saveContributorActivity(
        { githubId: account.github_id, login: user.login, avatarUrl: user.avatar_url },
        { ...data, rows }, pool, [], true,
      ) : 0;
      summary.completed++;
      summary.found += rows.length;
      summary.inserted += inserted;
      console.info(JSON.stringify({ githubId: account.github_id, found: rows.length, inserted }));
    } catch (error) {
      summary.failed++;
      console.error(`Backfill failed for GitHub ID ${account.github_id}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return summary;
}
