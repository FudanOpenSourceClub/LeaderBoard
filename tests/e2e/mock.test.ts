import {createHash} from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GitHubActivity, RepositorySyncResult } from "@leadboard/contracts";
import { getDbPool } from "../../backend/src/db/index.js";
import { applyRepositoryScope, ingestActivities } from "../../backend/src/ingestion/index.js";

const pool = getDbPool();
const processes: ChildProcess[] = [];
const backendPort = 3099;
const frontendPort = 4173;
const sessionToken='E'.repeat(43);
const apiFetch=(url:string)=>fetch(url,{headers:{Cookie:'leaderboard_session='+sessionToken}});

const repoA = {
  githubId: "1001", nodeId: "R_repo_a", owner: "leadboard-fixture", name: "repo-a",
  fullName: "leadboard-fixture/repo-a", defaultBranch: "main", group: "systems",
  htmlUrl: "https://github.com/leadboard-fixture/repo-a", archived: false,
};
const alice = { githubId: "2001", login: "alice", avatarUrl: "https://example.test/alice.png", type: "User" as const };

async function waitFor(url: string, attempts = 60): Promise<Response> {
  let last: unknown;
  for (let index = 0; index < attempts; index++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      last = new Error(`HTTP ${response.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw last instanceof Error ? last : new Error("Process did not become ready");
}

beforeAll(async () => {
  await pool.query("TRUNCATE commits, pull_requests, issues, contributors, repositories, groups, sync_runs RESTART IDENTITY CASCADE");
  const scope: RepositorySyncResult = {
    trackedRepositories: [repoA],
    syncedAt: new Date().toISOString(),
  };
  await applyRepositoryScope(scope);
  const activities: GitHubActivity[] = [
    {
      kind: "commit", repositoryGithubId: "1001", externalId: "e2e-c1", actor: alice,
      occurredAt: new Date(Date.now() - 60_000).toISOString(), additions: 5, deletions: 1,
      isMerge: false, rawUrl: null,
    },
    {
      kind: "issue", repositoryGithubId: "1001", externalId: "9001", number: 1, actor: alice,
      occurredAt: new Date(Date.now() - 30_000).toISOString(), state: "open", closedAt: null, rawUrl: null,
    },
  ];
  await ingestActivities(activities);
  await ingestActivities(activities);
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO sync_runs
      (trigger, range_from, range_to, started_at, finished_at, status, repositories_ok, repositories_failed)
     VALUES ('manual', $1, $2, $1, $2, 'success', 1, 0)`,
    [new Date(Date.now() - 120_000).toISOString(), now],
  );

  await pool.query("INSERT INTO website_roles(github_id,login,role,granted_by,reason) VALUES(2001,'alice','owner',2001,'E2E fixture') ON CONFLICT(github_id) DO UPDATE SET role='owner',revoked_at=NULL");
  await pool.query("INSERT INTO website_sessions(token_hash,github_id,login,csrf_token,expires_at) VALUES($1,2001,'alice','e2e-csrf',now()+interval '1 hour') ON CONFLICT(token_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at",[createHash('sha256').update(sessionToken).digest('hex')]);

  const env = {
    ...process.env,
    PORT: String(backendPort),
    GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "mock-only",
    GITHUB_ORG: process.env.GITHUB_ORG ?? "leadboard-fixture",
    INGESTION_CRON_SCHEDULE: "0 0 1 1 *",
    DATA_STALE_AFTER_HOURS: "12",
  };

  const backend = spawn(process.execPath, ["backend/dist/server.js"], { env, stdio: "ignore" });
  processes.push(backend);
  await waitFor(`http://127.0.0.1:${backendPort}/health`);

  const frontend = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "preview", "--workspace=@leadboard/frontend", "--", "--port", String(frontendPort), "--strictPort"],
    { env, stdio: "ignore" },
  );
  processes.push(frontend);
  await waitFor(`http://127.0.0.1:${frontendPort}/dashboard`);
});

afterAll(async () => {
  for (const child of processes.reverse()) child.kill("SIGTERM");
  await pool.end();
});

describe("Phase 1 mocked end-to-end smoke", () => {
  it("serves the built SPA and proxies real API responses through the frontend process", async () => {
    for (const route of ["/dashboard", "/contributors", "/contributors/alice"]) {
      const html = await (await fetch(`http://127.0.0.1:${frontendPort}${route}`)).text();
      expect(html).toContain("id=\"root\"");
    }

    expect((await fetch(`http://127.0.0.1:${frontendPort}/api/v1/contributors/leaderboard`)).status).toBe(401);
    const summary = await (await apiFetch(
      `http://127.0.0.1:${frontendPort}/api/v1/organization/summary?range=30d`,
    )).json() as { repositories: number; commits: number; issues: number; total: number; dataStatus: string };
    expect(summary).toMatchObject({ repositories: 1, commits: 1, issues: 1, total: 2, dataStatus: "fresh" });

    const repositories = await (await apiFetch(
      `http://127.0.0.1:${frontendPort}/api/v1/organization/repositories?range=30d`,
    )).json() as { items: Array<{ fullName: string; total: number }> };
    expect(repositories.items).toEqual([
      expect.objectContaining({ fullName: "leadboard-fixture/repo-a", total: 2 }),
    ]);

    const sync = await (await apiFetch(
      `http://127.0.0.1:${frontendPort}/api/v1/sync/status`,
    )).json() as { lastRunStatus: string; dataStatus: string };
    expect(sync).toMatchObject({ lastRunStatus: "success", dataStatus: "fresh" });

    const leaderboard = await (await apiFetch(
      `http://127.0.0.1:${frontendPort}/api/v1/contributors/leaderboard?range=30d&metric=total`,
    )).json() as { items: Array<{ login: string; total: number }> };
    expect(leaderboard.items).toEqual([expect.objectContaining({ login: "alice", total: 2 })]);

    const detail = await (await apiFetch(
      `http://127.0.0.1:${frontendPort}/api/v1/contributors/alice?range=30d`,
    )).json() as { login: string; repositories: unknown[] };
    expect(detail.login).toBe("alice");
    expect(detail.repositories).toHaveLength(1);
  });

  it("keeps fact rows idempotent after the repeated fixture ingestion", async () => {
    const result = await pool.query<{ commits: number; issues: number }>(
      `SELECT
        (SELECT count(*)::int FROM commits) AS commits,
        (SELECT count(*)::int FROM issues) AS issues`,
    );
    expect(result.rows[0]).toEqual({ commits: 1, issues: 1 });
  });
});
