import cron from "node-cron";
import {
  CollectRangeSchema,
  RunSyncInputSchema,
  SyncRunResultSchema,
  SyncStatusSchema,
  type RunSyncInput,
  type SyncConfig,
  type SyncRunResult,
  type SyncRunStatus,
  type SyncStatus,
} from "@leadboard/contracts";
import type { Pool } from "pg";
import { CommitCollector } from "../collectors/commits.js";
import { PullRequestIssueCollector } from "../collectors/pr-issues.js";
import { loadConfig } from "../config/index.js";
import { getDbPool } from "../db/index.js";
import { GitHubApiClient } from "../github/client.js";
import { applyRepositoryScope, ingestActivities } from "../ingestion/index.js";
import { RepositorySync } from "../repositories/sync.js";
import { refreshEnrolledContributors } from "../public-contributions/enrollment.js";
import { refreshRepositoryStars } from "../public-contributions/repository-stars.js";

const SYNC_LOCK_KEY = 1279411268;

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super("A synchronization run is already active");
    this.name = "SyncAlreadyRunningError";
  }
}

interface RepositorySyncLike {
  syncRepositories(input: { org: string; groupProperty: string }): Promise<{
    trackedRepositories: Array<{
      githubId: string; nodeId: string; owner: string; name: string; fullName: string;
      defaultBranch: string; group: string; htmlUrl: string; archived: boolean;
    }>;
    syncedAt: string;
  }>;
}
interface CommitCollectorLike {
  collectCommits(repo: Parameters<CommitCollector["collectCommits"]>[0], range: Parameters<CommitCollector["collectCommits"]>[1]): ReturnType<CommitCollector["collectCommits"]>;
}
interface PullIssueCollectorLike {
  collectPullRequests(repo: Parameters<PullRequestIssueCollector["collectPullRequests"]>[0], range: Parameters<PullRequestIssueCollector["collectPullRequests"]>[1]): ReturnType<PullRequestIssueCollector["collectPullRequests"]>;
  collectIssues(repo: Parameters<PullRequestIssueCollector["collectIssues"]>[0], range: Parameters<PullRequestIssueCollector["collectIssues"]>[1]): ReturnType<PullRequestIssueCollector["collectIssues"]>;
}

export interface SyncDependencies {
  repositories: RepositorySyncLike;
  commits: CommitCollectorLike;
  pullIssues: PullIssueCollectorLike;
  applyScope: typeof applyRepositoryScope;
  ingest: typeof ingestActivities;
  refreshContributors?(): Promise<void>;
  refreshStars?(): Promise<void>;
}

function initialFrom(to: string, days: number): string {
  return new Date(Date.parse(to) - days * 86_400_000).toISOString();
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "SynchronizationError";
}

export class SyncCoordinator {
  private nextScheduledRunAt: string | null = null;

  setNextScheduledRunAt(next: Date | null): void {
    this.nextScheduledRunAt = next?.toISOString() ?? null;
  }

  constructor(
    private readonly config: SyncConfig,
    private readonly dependencies: SyncDependencies,
    private readonly pool: Pool = getDbPool(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async latestSuccessfulRangeTo(): Promise<string | null> {
    const result = await this.pool.query<{ range_to: Date }>(
      `SELECT range_to FROM sync_runs
       WHERE status = 'success' AND finished_at IS NOT NULL
       ORDER BY finished_at DESC, id DESC LIMIT 1`,
    );
    return result.rows[0]?.range_to.toISOString() ?? null;
  }

  private async resolveRange(input: RunSyncInput): Promise<{ from: string; to: string }> {
    const parsed = RunSyncInputSchema.parse(input);
    const to = parsed.to ?? this.clock().toISOString();
    let from = parsed.from;
    if (from === undefined) {
      const last = await this.latestSuccessfulRangeTo();
      from = last === null
        ? initialFrom(to, this.config.initialSyncDays)
        : new Date(Date.parse(last) - this.config.syncOverlapMinutes * 60_000).toISOString();
    }
    return CollectRangeSchema.parse({ from, to });
  }

  async runSync(input: RunSyncInput): Promise<SyncRunResult> {
    const parsed = RunSyncInputSchema.parse(input);
    const lockClient = await this.pool.connect();
    let locked = false;
    try {
      const lock = await lockClient.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1::integer) AS locked",
        [SYNC_LOCK_KEY],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) throw new SyncAlreadyRunningError();

      const range = await this.resolveRange(parsed);
      const startedAt = this.clock().toISOString();
      const run = await this.pool.query<{ id: string }>(
        `INSERT INTO sync_runs
          (trigger, range_from, range_to, started_at, status, repositories_ok, repositories_failed)
         VALUES ($1,$2,$3,$4,'running',0,0) RETURNING id`,
        [parsed.trigger, range.from, range.to, startedAt],
      );
      const runId = run.rows[0]?.id;
      if (!runId) throw new Error("Failed to create sync run");

      const finish = async (
        status: SyncRunStatus,
        repositoriesOk: number,
        repositoriesFailed: number,
        errorName: string | null = null,
      ): Promise<SyncRunResult> => {
        const finishedAt = this.clock().toISOString();
        await this.pool.query(
          `UPDATE sync_runs SET status=$2, repositories_ok=$3, repositories_failed=$4,
             finished_at=$5, error_message=$6 WHERE id=$1`,
          [runId, status, repositoriesOk, repositoriesFailed, finishedAt, errorName],
        );
        return SyncRunResultSchema.parse({
          status,
          trigger: parsed.trigger,
          rangeFrom: range.from,
          rangeTo: range.to,
          repositoriesOk,
          repositoriesFailed,
          startedAt,
          finishedAt,
        });
      };

      try {
        let contributorSyncFailed = false;
        try { await this.dependencies.refreshContributors?.(); }
        catch { contributorSyncFailed = true; }
        // Personal repository snapshots must refresh even if organization discovery fails.
        let starSyncFailed = false;
        try { await this.dependencies.refreshStars?.(); }
        catch { starSyncFailed = true; }
        const oldTracked = await this.pool.query<{ github_id: string }>(
          "SELECT github_id::text AS github_id FROM repositories WHERE tracked = TRUE",
        );
        const oldTrackedIds = new Set(oldTracked.rows.map((row) => row.github_id));

        const scope = await this.dependencies.repositories.syncRepositories({
          org: this.config.githubOrg,
          groupProperty: this.config.groupProperty,
        });
        await this.dependencies.applyScope(scope);

        let repositoriesOk = 0;
        let repositoriesFailed = 0;
        for (const repository of scope.trackedRepositories) {
          const repoFrom = parsed.from === undefined && !oldTrackedIds.has(repository.githubId)
            ? initialFrom(range.to, this.config.initialSyncDays)
            : range.from;
          const repoRange = CollectRangeSchema.parse({
            from: Date.parse(repoFrom) < Date.parse(range.from) ? repoFrom : range.from,
            to: range.to,
          });

          try {
            const [commits, pulls, issues] = await Promise.all([
              this.dependencies.commits.collectCommits(repository, repoRange),
              this.dependencies.pullIssues.collectPullRequests(repository, repoRange),
              this.dependencies.pullIssues.collectIssues(repository, repoRange),
            ]);
            const ingestion = await this.dependencies.ingest([...commits, ...pulls, ...issues]);
            if (ingestion.errors > 0) throw new Error("Activity ingestion reported errors");
            repositoriesOk++;
          } catch {
            repositoriesFailed++;
          }
        }

        // Newly ingested repositories may not have existed in the first snapshot pass.
        try { await this.dependencies.refreshStars?.(); }
        catch { starSyncFailed = true; }
        const status: SyncRunStatus = repositoriesFailed === 0 && !contributorSyncFailed && !starSyncFailed
          ? "success"
          : repositoriesOk === 0 ? "failed" : "partial";
        return await finish(status, repositoriesOk, repositoriesFailed,
          contributorSyncFailed ? "ContributorSynchronizationError" : starSyncFailed ? "RepositoryStarSynchronizationError" : null);
      } catch (error) {
        return await finish("failed", 0, 0, safeErrorName(error));
      }
    } finally {
      if (locked) {
        try { await lockClient.query("SELECT pg_advisory_unlock($1::integer)", [SYNC_LOCK_KEY]); }
        catch { /* connection release will discard the session if needed */ }
      }
      lockClient.release();
    }
  }

  async getSyncStatus(): Promise<SyncStatus> {
    const [lastFinished, lastSuccess] = await Promise.all([
      this.pool.query<{ status: SyncRunStatus }>(
        `SELECT status FROM sync_runs
         WHERE finished_at IS NOT NULL AND status IN ('success','partial','failed')
         ORDER BY finished_at DESC, id DESC LIMIT 1`,
      ),
      this.pool.query<{ finished_at: Date }>(
        `SELECT finished_at FROM sync_runs
         WHERE status='success' AND finished_at IS NOT NULL
         ORDER BY finished_at DESC, id DESC LIMIT 1`,
      ),
    ]);

    const successfulAt = lastSuccess.rows[0]?.finished_at?.toISOString() ?? null;
    const age = successfulAt === null ? Number.POSITIVE_INFINITY : this.clock().getTime() - Date.parse(successfulAt);
    const dataStatus = successfulAt === null
      ? "missing"
      : age > this.config.dataStaleAfterHours * 3_600_000 ? "stale" : "fresh";

    return SyncStatusSchema.parse({
      lastSuccessfulRunAt: successfulAt,
      lastRunStatus: lastFinished.rows[0]?.status ?? null,
      nextScheduledRunAt: this.nextScheduledRunAt,
      dataStatus,
    });
  }
}

export function createDefaultSyncCoordinator(config: SyncConfig): SyncCoordinator {
  const github = new GitHubApiClient({ githubToken: loadConfig().githubToken });
  return new SyncCoordinator(config, {
    repositories: new RepositorySync(github),
    commits: new CommitCollector(github),
    pullIssues: new PullRequestIssueCollector(github),
    applyScope: applyRepositoryScope,
    ingest: ingestActivities,
    refreshContributors: () => refreshEnrolledContributors(loadConfig().githubToken),
    refreshStars: async () => { await refreshRepositoryStars(loadConfig().githubToken); },
  });
}

export async function runSync(input: RunSyncInput): Promise<SyncRunResult> {
  const config = loadConfig();
  return createDefaultSyncCoordinator(config).runSync(input);
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const config = loadConfig();
  return createDefaultSyncCoordinator(config).getSyncStatus();
}

export function startSyncScheduler(
  coordinator: SyncCoordinator,
  schedule: string,
): { stop(): Promise<void> } {
  let active: Promise<void> | null = null;
  const task = cron.schedule(schedule, () => {
    const run = coordinator.runSync({ trigger: "scheduled" })
      .catch((error: unknown) => {
        if (error instanceof SyncAlreadyRunningError) return;
        console.error("Scheduled synchronization failed");
      })
      .then(() => undefined)
      .finally(() => {
        active = null;
        coordinator.setNextScheduledRunAt(task.getNextRun());
      });
    active = run;
  });
  coordinator.setNextScheduledRunAt(task.getNextRun());

  return {
    async stop(): Promise<void> {
      await Promise.resolve(task.stop());
      coordinator.setNextScheduledRunAt(null);
      await active;
    },
  };
}
