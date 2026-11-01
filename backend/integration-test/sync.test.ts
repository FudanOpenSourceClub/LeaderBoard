import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type {
  IngestionResult,
  RepositorySyncResult,
  SyncConfig,
  TrackedRepository,
} from "@leadboard/contracts";
import { getDbPool } from "../src/db/index.js";
import { applyRepositoryScope } from "../src/ingestion/index.js";
import {
  SyncAlreadyRunningError,
  SyncCoordinator,
  type SyncDependencies,
} from "../src/sync/index.js";

const pool = getDbPool();
const repoA: TrackedRepository = {
  githubId: "1001", nodeId: "R_repo_a", owner: "leadboard-fixture", name: "repo-a",
  fullName: "leadboard-fixture/repo-a", defaultBranch: "main", group: "systems",
  htmlUrl: "https://github.com/leadboard-fixture/repo-a", archived: false,
};
const repoB: TrackedRepository = {
  githubId: "1002", nodeId: "R_repo_b", owner: "leadboard-fixture", name: "repo-b",
  fullName: "leadboard-fixture/repo-b", defaultBranch: "main", group: "ai",
  htmlUrl: "https://github.com/leadboard-fixture/repo-b", archived: false,
};
const config: SyncConfig = {
  githubOrg: "leadboard-fixture",
  groupProperty: "leadboard_group",
  ingestionCronSchedule: "0 */6 * * *",
  initialSyncDays: 30,
  syncOverlapMinutes: 10,
  dataStaleAfterHours: 12,
};

beforeEach(async () => {
  await pool.query("TRUNCATE commits, pull_requests, issues, contributors, repositories, groups, sync_runs RESTART IDENTITY CASCADE");
});
afterAll(async () => { await pool.end(); });

function fixture(initialScope: RepositorySyncResult) {
  let scope = initialScope;
  let scopeFailure = false;
  const failedRepositories = new Set<string>();
  const commitRanges: Array<{ githubId: string; from: string; to: string }> = [];
  let applyCalls = 0;

  const dependencies: SyncDependencies = {
    repositories: {
      async syncRepositories() {
        if (scopeFailure) throw new Error("scope failed");
        return scope;
      },
    },
    commits: {
      async collectCommits(repository, range) {
        commitRanges.push({ githubId: repository.githubId, ...range });
        if (failedRepositories.has(repository.githubId)) throw new Error("collector failed");
        return [];
      },
    },
    pullIssues: {
      async collectPullRequests(repository) {
        if (failedRepositories.has(repository.githubId)) throw new Error("collector failed");
        return [];
      },
      async collectIssues(repository) {
        if (failedRepositories.has(repository.githubId)) throw new Error("collector failed");
        return [];
      },
    },
    async applyScope(value) {
      applyCalls++;
      return applyRepositoryScope(value);
    },
    async ingest(activities): Promise<IngestionResult> {
      return { inserted: 0, updated: 0, skipped: activities.length, errors: 0 };
    },
  };

  return {
    dependencies,
    commitRanges,
    failedRepositories,
    setScope(value: RepositorySyncResult) { scope = value; },
    failScope(value = true) { scopeFailure = value; },
    get applyCalls() { return applyCalls; },
  };
}

describe("SyncCoordinator PostgreSQL integration", () => {
  it("uses initial, overlap and new-repository windows without advancing a failed cursor", async () => {
    let now = new Date("2026-09-25T12:00:00.000Z");
    const fx = fixture({ trackedRepositories: [repoA], syncedAt: now.toISOString() });
    const coordinator = new SyncCoordinator(config, fx.dependencies, pool, () => now);

    const first = await coordinator.runSync({ trigger: "manual" });
    expect(first).toMatchObject({
      status: "success",
      rangeFrom: "2026-08-26T12:00:00.000Z",
      rangeTo: "2026-09-25T12:00:00.000Z",
      repositoriesOk: 1,
      repositoriesFailed: 0,
    });
    expect(fx.commitRanges).toEqual([{
      githubId: "1001",
      from: "2026-08-26T12:00:00.000Z",
      to: "2026-09-25T12:00:00.000Z",
    }]);

    now = new Date("2026-09-25T13:00:00.000Z");
    fx.commitRanges.length = 0;
    fx.setScope({ trackedRepositories: [repoA, repoB], syncedAt: now.toISOString() });
    const second = await coordinator.runSync({ trigger: "manual" });
    expect(second).toMatchObject({
      status: "success",
      rangeFrom: "2026-09-25T11:50:00.000Z",
      rangeTo: "2026-09-25T13:00:00.000Z",
      repositoriesOk: 2,
    });
    expect(fx.commitRanges).toEqual([
      { githubId: "1001", from: "2026-09-25T11:50:00.000Z", to: "2026-09-25T13:00:00.000Z" },
      { githubId: "1002", from: "2026-08-26T13:00:00.000Z", to: "2026-09-25T13:00:00.000Z" },
    ]);

    now = new Date("2026-09-25T14:00:00.000Z");
    fx.commitRanges.length = 0;
    fx.failedRepositories.add("1002");
    const partial = await coordinator.runSync({ trigger: "manual" });
    expect(partial.status).toBe("partial");

    now = new Date("2026-09-25T15:00:00.000Z");
    fx.failedRepositories.clear();
    fx.commitRanges.length = 0;
    const afterPartial = await coordinator.runSync({ trigger: "manual" });
    expect(afterPartial.rangeFrom).toBe("2026-09-25T12:50:00.000Z");
  });

  it("does not apply repository scope after discovery failure and records a failed run", async () => {
    const now = new Date("2026-09-25T12:00:00.000Z");
    const fx = fixture({ trackedRepositories: [repoA], syncedAt: now.toISOString() });
    fx.failScope();
    const coordinator = new SyncCoordinator(config, fx.dependencies, pool, () => now);

    const result = await coordinator.runSync({ trigger: "manual" });
    expect(result).toMatchObject({ status: "failed", repositoriesOk: 0, repositoriesFailed: 0 });
    expect(fx.applyCalls).toBe(0);

    const stored = await pool.query<{ status: string; finished_at: Date | null }>(
      "SELECT status, finished_at FROM sync_runs ORDER BY id DESC LIMIT 1",
    );
    expect(stored.rows[0]?.status).toBe("failed");
    expect(stored.rows[0]?.finished_at).toBeInstanceOf(Date);
  });

  it("marks all-repository failure as failed and partial failure as partial", async () => {
    const now = new Date("2026-09-25T12:00:00.000Z");
    const fx = fixture({ trackedRepositories: [repoA, repoB], syncedAt: now.toISOString() });
    const coordinator = new SyncCoordinator(config, fx.dependencies, pool, () => now);

    fx.failedRepositories.add("1002");
    await expect(coordinator.runSync({ trigger: "manual" })).resolves.toMatchObject({
      status: "partial", repositoriesOk: 1, repositoriesFailed: 1,
    });

    fx.failedRepositories.add("1001");
    await expect(coordinator.runSync({ trigger: "manual" })).resolves.toMatchObject({
      status: "failed", repositoriesOk: 0, repositoriesFailed: 2,
    });
  });

  it("uses a PostgreSQL advisory lock to reject a concurrent process", async () => {
    const lockClient = await pool.connect();
    try {
      await lockClient.query("SELECT pg_advisory_lock($1::integer)", [1279411268]);
      const now = new Date("2026-09-25T12:00:00.000Z");
      const fx = fixture({ trackedRepositories: [], syncedAt: now.toISOString() });
      const coordinator = new SyncCoordinator(config, fx.dependencies, pool, () => now);
      await expect(coordinator.runSync({ trigger: "manual" })).rejects.toBeInstanceOf(SyncAlreadyRunningError);
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1::integer)", [1279411268]);
      lockClient.release();
    }
  });

  it("reports missing, stale and fresh data while ignoring unfinished runs", async () => {
    let now = new Date("2026-09-25T12:00:00.000Z");
    const fx = fixture({ trackedRepositories: [], syncedAt: now.toISOString() });
    const coordinator = new SyncCoordinator(config, fx.dependencies, pool, () => now);

    await expect(coordinator.getSyncStatus()).resolves.toMatchObject({
      lastSuccessfulRunAt: null, lastRunStatus: null, dataStatus: "missing",
    });

    const oldFinished = new Date(now.getTime() - 13 * 3_600_000).toISOString();
    await pool.query(
      `INSERT INTO sync_runs
        (trigger, range_from, range_to, started_at, finished_at, status)
       VALUES ('manual',$1,$2,$1,$2,'success')`,
      [new Date(Date.parse(oldFinished) - 60_000).toISOString(), oldFinished],
    );
    await expect(coordinator.getSyncStatus()).resolves.toMatchObject({
      lastRunStatus: "success", dataStatus: "stale",
    });

    now = new Date(oldFinished);
    coordinator.setNextScheduledRunAt(new Date("2026-09-26T00:00:00.000Z"));
    await expect(coordinator.getSyncStatus()).resolves.toMatchObject({
      lastRunStatus: "success",
      dataStatus: "fresh",
      nextScheduledRunAt: "2026-09-26T00:00:00.000Z",
    });

    await pool.query(
      `INSERT INTO sync_runs
        (trigger, range_from, range_to, started_at, status)
       VALUES ('scheduled',$1,$2,$1,'running')`,
      [oldFinished, "2026-09-25T13:00:00.000Z"],
    );
    await expect(coordinator.getSyncStatus()).resolves.toMatchObject({
      lastRunStatus: "success",
    });
  });
});
