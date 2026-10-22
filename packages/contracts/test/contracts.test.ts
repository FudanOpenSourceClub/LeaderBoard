import { describe, expect, it } from "vitest";
import * as c from "../src/index.js";

const at = "2026-09-25T12:00:00Z";
const before = "2026-09-24T12:00:00Z";
const actor = { githubId: "2001", login: "alice", avatarUrl: "https://example.test/alice.png", type: "User" };
const unknown = { githubId: null, login: null, avatarUrl: null, type: "Unknown" };
const repo = { githubId: "1001", nodeId: "R_repo_a", owner: "leadboard-fixture", name: "repo-a", fullName: "leadboard-fixture/repo-a", defaultBranch: "main", group: "systems", htmlUrl: "https://github.com/leadboard-fixture/repo-a", archived: false };
const base = { repositoryGithubId: "1001", actor, rawUrl: null };
const commit = { ...base, kind: "commit", externalId: "abc123", occurredAt: before, additions: 3, deletions: 1, isMerge: false };
const pr = { ...base, kind: "pull_request", externalId: "3001", number: 1, occurredAt: before, state: "merged", closedAt: at, mergedAt: at };
const issue = { ...base, kind: "issue", externalId: "4001", number: 2, occurredAt: before, state: "open", closedAt: null };
const counts = { commits: 7, prs: 2, issues: 2, total: 11 };
const summary = { range: "30d", repositories: 2, contributors: 2, ...counts };
const repositoryStat = { githubId: "1001", fullName: repo.fullName, group: "systems", commits: 5, prs: 1, issues: 1, total: 7 };
const rank = { rank: 1, login: "alice", avatarUrl: null, commits: 2, prs: 2, issues: 0, total: 4 };
const config = { githubToken: "test-only", githubOrg: "fixture", groupProperty: "leadboard_group", databaseUrl: "postgresql://localhost/fixture", port: 3000, ingestionCronSchedule: "0 */6 * * *", initialSyncDays: 30, syncOverlapMinutes: 10, dataStaleAfterHours: 12 };
const status = { lastSuccessfulRunAt: null, lastRunStatus: null, nextScheduledRunAt: null, dataStatus: "missing" };
const fixtures = [
  [c.LeaderboardQuerySchema, { range: "30d", metric: "total", limit: 50 }],
  [c.SyncConfigSchema, config],
  [c.GitHubActorTypeSchema, "Unknown"], [c.GitHubActorRefSchema, actor],
  [c.AppConfigSchema, config], [c.RepositorySyncInputSchema, { org: "fixture", groupProperty: "leadboard_group" }],
  [c.TrackedRepositorySchema, repo], [c.RepositorySyncResultSchema, { trackedRepositories: [repo], syncedAt: at }],
  [c.GitHubRepositoryRefSchema, { ...repo, isFork: false, isPrivate: false }],
  [c.ActivityBaseSchema, base], [c.CommitActivitySchema, commit], [c.PullRequestActivitySchema, pr], [c.IssueActivitySchema, issue],
  [c.GitHubActivitySchema, commit], [c.CollectRangeSchema, { from: before, to: at }],
  [c.RepositoryScopeApplyResultSchema, { tracked: 2, untracked: 1, upserted: 2 }],
  [c.IngestionResultSchema, { inserted: 11, updated: 0, skipped: 0, errors: 0 }],
  [c.SyncRunStatusSchema, "partial"], [c.SyncTriggerSchema, "manual"], [c.RunSyncInputSchema, { trigger: "manual" }],
  [c.SyncRunResultSchema, { status: "success", trigger: "manual", rangeFrom: before, rangeTo: at, repositoriesOk: 2, repositoriesFailed: 0, startedAt: at, finishedAt: at }],
  [c.SyncStatusSchema, status], [c.TimeRangeSchema, "all"], [c.LeaderboardMetricSchema, "total"],
  [c.GroupSummarySchema, { name: "systems" }], [c.OrganizationActivitySummarySchema, summary],
  [c.RepositoryStatSchema, { ...repositoryStat, contributors: 2 }], [c.ContributorRankSchema, rank],
  [c.ContributorRepositoryStatSchema, repositoryStat],
  [c.ContributorDetailSchema, { ...rank, range: "30d", repositories: [repositoryStat] }],
  [c.HealthResponseSchema, { status: "ok" }],
  [c.OrganizationSummarySchema, { ...summary, lastUpdatedAt: null, dataStatus: "missing" }],
  [c.RepositoryStatsResponseSchema, { items: [{ ...repositoryStat, contributors: 2 }] }],
  [c.GroupsResponseSchema, { items: [{ name: "systems" }] }],
  [c.ContributorLeaderboardResponseSchema, { range: "30d", metric: "total", items: [rank] }],
  [c.EmailCodeRequestSchema, { email: "student@fudan.edu.cn",studentId:"26300000001",githubLogin:"octocat" }],
  [c.EmailCodeVerifyRequestSchema, { email: "student@fudan.edu.cn", code: "012345" }],
  [c.EmailCodeSendResponseSchema, { sent: true, retryAfterSeconds: 60, expiresInSeconds: 600 }],
  [c.RegistrationStatusSchema, {registered: true, login: "alice"}],
  [c.GitHubLinkInfoSchema, { available: false }],
  [c.EmailCodeVerifyResponseSchema, { verified: true, githubLink: { available: false } }],
  [c.ProjectProposalRequestSchema, { projectUrl: "https://github.com/fudan/example", labName: "复旦大学示例实验室", notes: "这是一个用于测试的校内开源项目提议。" }],
  [c.ProjectProposalResponseSchema, { submitted: true, id: 1 }],
  [c.ApiErrorResponseSchema, { error: { code: "INTERNAL_ERROR", message: "Request failed" } }],
] as const;

describe("documented shared boundaries", () => {
  it.each(fixtures.map(([schema, input], index) => ({ schema, input, index })))("accepts contract fixture $index", ({ schema, input }) => {
    expect(schema.safeParse(input).success).toBe(true);
  });
  it("tests every exported schema", () => {
    const schemas = Object.entries(c).filter(([key]) => key.endsWith("Schema")).map(([, schema]) => schema);
    expect(new Set(fixtures.map(([schema]) => schema))).toEqual(new Set(schemas));
  });
  it.each([commit, pr, issue])("round trips $kind without losing ingestion fields", (input) => {
    expect(c.GitHubActivitySchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });
  it.each([unknown, { ...actor, type: "Bot", login: "dependency-bot[bot]" }])("preserves unknown and bot actors", (input) => {
    expect(c.CommitActivitySchema.parse({ ...commit, actor: input }).actor).toEqual(input);
  });
  it.each([
    { ...commit, additions: -1 }, { ...commit, deletions: 0.5 },
    { ...commit, additions: Number.MAX_SAFE_INTEGER + 1 },
    { ...commit, repositoryGithubId: 1001 }, { ...commit, repositoryGithubId: "abc" },
    { ...commit, occurredAt: "2026-09-25T12:00:00+08:00" },
    { ...commit, occurredAt: "2026-02-30T12:00:00Z" },
    { ...commit, kind: "review" }, { ...pr, mergedAt: undefined },
    { ...pr, number: 0 }, { ...pr, externalId: 3001 },
    { ...issue, state: "merged" }, { ...commit, actor: undefined },
  ])("rejects malformed activity %#", (input) => expect(c.GitHubActivitySchema.safeParse(input).success).toBe(false));
  it("keeps stable IDs beyond JS safe integer range as strings", () => {
    expect(c.TrackedRepositorySchema.parse({ ...repo, githubId: "9007199254740993" }).githubId).toBe("9007199254740993");
  });
  it.each([{ from: at, to: before }, { from: at, to: at }])("rejects empty or reversed ranges", (input) => {
    expect(c.CollectRangeSchema.safeParse(input).success).toBe(false);
    expect(c.RunSyncInputSchema.safeParse({ ...input, trigger: "manual" }).success).toBe(false);
  });
  it("allows an empty complete repository snapshot", () => {
    expect(c.RepositorySyncResultSchema.parse({ trackedRepositories: [], syncedAt: at }).trackedRepositories).toEqual([]);
  });
  it.each(["fresh", "stale", "missing"])("accepts %s freshness", (dataStatus) => {
    expect(c.SyncStatusSchema.safeParse({ ...status, dataStatus }).success).toBe(true);
  });
  it("requires the composed organization freshness fields", () => {
    expect(c.OrganizationSummarySchema.safeParse(summary).success).toBe(false);
    expect(c.OrganizationSummarySchema.parse({ ...summary, lastUpdatedAt: at, dataStatus: "fresh" }).total).toBe(11);
  });
  it("rejects invalid response enums, fractional counts and missing items", () => {
    expect(c.OrganizationActivitySummarySchema.safeParse({ ...summary, range: "1d" }).success).toBe(false);
    expect(c.ContributorLeaderboardResponseSchema.safeParse({ range: "all", metric: "invalid", items: [] }).success).toBe(false);
    expect(c.RepositoryStatsResponseSchema.safeParse({}).success).toBe(false);
    expect(c.ContributorRankSchema.safeParse({ ...rank, total: 0.5 }).success).toBe(false);
  });
  it("provides a typed discriminated union to downstream collectors", () => {
    const activity: c.GitHubActivity = c.GitHubActivitySchema.parse(pr);
    if (activity.kind === "pull_request") expect(activity.mergedAt).toBe(at);
    else throw new Error("Expected PR variant");
  });
});

it("exports Issue handoff names without duplicating schemas", () => {
  const response: c.OrganizationSummaryResponse = c.OrganizationSummaryResponseSchema.parse({ ...summary, lastUpdatedAt: null, dataStatus: "missing" });
  const repository: c.RepositoryContributorStat = c.RepositoryContributorStatSchema.parse(repositoryStat);
  const query: c.LeaderboardQuery = { range: "all", metric: "total", limit: 50 };
  const sync: c.SyncConfig = c.SyncConfigSchema.parse(config);
  expect(c.OrganizationSummaryResponseSchema).toBe(c.OrganizationSummarySchema);
  expect(c.RepositoryContributorStatSchema).toBe(c.ContributorRepositoryStatSchema);
  expect(response.total).toBe(11);
  expect(repository.githubId).toBe("1001");
  expect(c.LeaderboardQuerySchema.parse(query).limit).toBe(50);
  expect(sync.githubOrg).toBe("fixture");
  for (const limit of [0, -1, 1.5, "50"]) {
    expect(c.LeaderboardQuerySchema.safeParse({ ...query, limit }).success).toBe(false);
  }
});
