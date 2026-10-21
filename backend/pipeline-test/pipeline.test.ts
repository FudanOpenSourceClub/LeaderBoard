import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommitActivity, GitHubActivity, RepositorySyncResult } from "@leadboard/contracts";
import { AnalyticsService } from "../src/analytics/index.js";
import { getDbPool } from "../src/db/index.js";
import { applyRepositoryScope, ingestActivities } from "../src/ingestion/index.js";
import { getContributorActivityExport, saveContributorActivity } from "../src/public-contributions/enrollment.js";
import type { PublicContributionExport } from "../src/public-contributions/export.js";

const pool = getDbPool();
const NOW = new Date("2026-09-25T12:00:00.000Z");
const actor = {
  alice: { githubId: "2001", login: "alice", avatarUrl: "https://example.test/alice.png", type: "User" as const },
  bob: { githubId: "2002", login: "bob", avatarUrl: "https://example.test/bob.png", type: "User" as const },
  bot: { githubId: "2003", login: "dependency-bot[bot]", avatarUrl: "https://example.test/bot.png", type: "Bot" as const },
  unknown: { githubId: null, login: null, avatarUrl: null, type: "Unknown" as const },
  charlie: { githubId: "2004", login: "charlie", avatarUrl: null, type: "User" as const },
};
const repoA = {
  githubId: "1001", nodeId: "R_repo_a", owner: "leadboard-fixture", name: "repo-a",
  fullName: "leadboard-fixture/repo-a", defaultBranch: "main", group: "systems",
  htmlUrl: "https://github.com/leadboard-fixture/repo-a", archived: false,
};
const repoB = {
  githubId: "1002", nodeId: "R_repo_b", owner: "leadboard-fixture", name: "repo-b",
  fullName: "leadboard-fixture/repo-b", defaultBranch: "main", group: "ai",
  htmlUrl: "https://github.com/leadboard-fixture/repo-b", archived: false,
};
const repoOld = {
  githubId: "1003", nodeId: "R_repo_old", owner: "leadboard-fixture", name: "repo-old",
  fullName: "leadboard-fixture/repo-old", defaultBranch: "main", group: "legacy",
  htmlUrl: "https://github.com/leadboard-fixture/repo-old", archived: false,
};
const syncedAt = NOW.toISOString();

function commit(repo: string, id: string, who: typeof actor[keyof typeof actor], at: string): CommitActivity {
  return {
    kind: "commit", repositoryGithubId: repo, externalId: id, actor: who,
    occurredAt: at, additions: 1, deletions: 0, isMerge: false, rawUrl: null,
  };
}

beforeAll(async () => {
  await pool.query("TRUNCATE commits, pull_requests, issues, contributors, repositories, groups, sync_runs RESTART IDENTITY CASCADE");
  const scope: RepositorySyncResult = { trackedRepositories: [repoA, repoB, repoOld], syncedAt };
  await applyRepositoryScope(scope);

  const activities: GitHubActivity[] = [
    commit("1001", "C1", actor.alice, "2026-09-24T10:00:00.000Z"),
    { ...commit("1001", "C2", actor.alice, "2026-09-23T10:00:00.000Z"), isMerge: true },
    commit("1001", "C3", actor.bob, "2026-09-10T10:00:00.000Z"),
    commit("1001", "C4", actor.bot, "2026-09-24T11:00:00.000Z"),
    commit("1001", "C5", actor.unknown, "2026-09-22T10:00:00.000Z"),
    commit("1002", "C6", actor.bob, "2026-09-21T10:00:00.000Z"),
    commit("1002", "C7", actor.bob, "2026-08-30T10:00:00.000Z"),
    {
      kind: "pull_request", repositoryGithubId: "1001", externalId: "3001", number: 1, actor: actor.alice,
      occurredAt: "2026-09-20T10:00:00.000Z", state: "merged", closedAt: "2026-09-21T00:00:00.000Z",
      mergedAt: "2026-09-21T00:00:00.000Z", rawUrl: null,
    },
    {
      kind: "pull_request", repositoryGithubId: "1002", externalId: "3002", number: 2, actor: actor.alice,
      occurredAt: "2026-09-05T10:00:00.000Z", state: "open", closedAt: null, mergedAt: null, rawUrl: null,
    },
    {
      kind: "issue", repositoryGithubId: "1001", externalId: "4001", number: 3, actor: actor.bob,
      occurredAt: "2026-09-24T09:00:00.000Z", state: "open", closedAt: null, rawUrl: null,
    },
    {
      kind: "issue", repositoryGithubId: "1002", externalId: "4002", number: 4, actor: actor.bot,
      occurredAt: "2026-09-02T09:00:00.000Z", state: "closed", closedAt: "2026-09-03T00:00:00.000Z", rawUrl: null,
    },
    commit("1003", "OLD1", actor.charlie, "2026-09-24T10:00:00.000Z"),
    commit("1003", "OLD2", actor.charlie, "2026-09-24T11:00:00.000Z"),
    commit("1003", "OLD3", actor.charlie, "2026-09-24T12:00:00.000Z"),
    {
      kind: "pull_request", repositoryGithubId: "1003", externalId: "3999", number: 99, actor: actor.charlie,
      occurredAt: "2026-09-24T10:00:00.000Z", state: "open", closedAt: null, mergedAt: null, rawUrl: null,
    },
  ];
  await ingestActivities(activities);
  await applyRepositoryScope({ trackedRepositories: [repoA, repoB], syncedAt });
});

afterAll(async () => { await pool.end(); });

describe("Analytics pipeline fixture", () => {
  const analytics = new AnalyticsService(pool, () => NOW);

  it("matches canonical 30d organization and repository totals", async () => {
    await expect(analytics.getOrganizationActivitySummary("30d")).resolves.toEqual({
      range: "30d", repositories: 2, contributors: 2, commits: 7, prs: 2, issues: 2, total: 11,
    });
    const repositories = await analytics.getRepositoryStats("30d");
    expect(repositories).toEqual([
      { githubId: "1001", fullName: "leadboard-fixture/repo-a", group: "systems", commits: 5, prs: 1, issues: 1, contributors: 2, total: 7 },
      { githubId: "1002", fullName: "leadboard-fixture/repo-b", group: "ai", commits: 2, prs: 1, issues: 1, contributors: 2, total: 4 },
    ]);
  });

  it("uses [from,to), excludes bots/unknown/untracked from contributor ranking, and has stable ties", async () => {
    await expect(analytics.getOrganizationActivitySummary("7d")).resolves.toMatchObject({
      commits: 5, prs: 1, issues: 1, total: 7, contributors: 2, repositories: 2,
    });
    const ranking = await analytics.getContributorLeaderboard({ range: "30d", metric: "total", limit: 50 });
    expect(ranking.map(({ rank, login, total }) => ({ rank, login, total }))).toEqual([
      { rank: 1, login: "alice", total: 4 },
      { rank: 2, login: "bob", total: 4 },
    ]);
  });

  it("supports group filtering and contributor detail", async () => {
    const systems = await analytics.getRepositoryStats("30d", "systems");
    expect(systems).toHaveLength(1);
    expect(systems[0]?.fullName).toBe("leadboard-fixture/repo-a");

    const alice = await analytics.getContributorDetail("alice", "30d");
    expect(alice).toMatchObject({ login: "alice", commits: 2, prs: 2, issues: 0, total: 4 });
    expect(alice?.repositories).toHaveLength(2);
    await expect(analytics.getContributorDetail("charlie", "30d")).resolves.toBeNull();
  });

  it("persists enrolled users, deduplicates tracked events, and uses the same history for ranking, profile and export", async () => {
    const identity = { githubId: "2001", login: "alice", avatarUrl: "https://example.test/alice.png" };
    const data: PublicContributionExport = {
      rows: [
        { kind: "commit", repository: repoA.fullName, identifier: "C1", occurredAt: "2026-09-24T10:00:00Z", title: "Tracked change", url: `https://github.com/${repoA.fullName}/commit/C1` },
        { kind: "commit", repository: "other/community", identifier: "EXTERNAL", occurredAt: "2026-08-01T10:00:00Z", title: "Older change", url: "https://github.com/other/community/commit/EXTERNAL" },
        { kind: "pull_request", repository: "other/community", identifier: "10", occurredAt: "2026-09-24T10:00:00Z", title: "Feature", url: "https://github.com/other/community/pull/10" },
        { kind: "issue", repository: "other/community", identifier: "11", occurredAt: "2026-09-24T10:00:00Z", title: "Discussion", url: "https://github.com/other/community/issues/11" },
      ],
      totals: { commit: 2, pull_request: 1, issue: 1 }, truncated: false, incomplete: false,
    };
    await saveContributorActivity(identity, data, pool);
    await saveContributorActivity(identity, data, pool);
    const all = await analytics.getContributorLeaderboard({ range: "all", metric: "total", limit: 50 });
    expect(all[0]).toMatchObject({ login: "alice", commits: 3, prs: 3, issues: 1, total: 7 });
    const month = await analytics.getContributorLeaderboard({ range: "30d", metric: "total", limit: 50 });
    expect(month[0]).toMatchObject({ login: "alice", commits: 2, prs: 3, issues: 1, total: 6 });
    const week = await analytics.getContributorLeaderboard({ range: "7d", metric: "total", limit: 50 });
    expect(week[0]).toMatchObject({ login: "alice", total: 5 });
    const systems = await analytics.getContributorLeaderboard({ range: "all", metric: "total", group: "systems", limit: 50 });
    expect(systems.find((item) => item.login === "alice")?.total).toBe(3);
    const personal = await analytics.getContributorLeaderboard({ range: "all", metric: "total", group: "个人开源贡献", limit: 50 });
    expect(personal).toHaveLength(1);
    expect(personal[0]?.total).toBe(3);
    const detail = await analytics.getContributorDetail("ALICE", "all");
    expect(detail?.total).toBe(7);
    expect(detail?.repositories.find((r) => r.fullName === "other/community")).toMatchObject({ githubId: null, commits: 1, prs: 1, issues: 1, total: 3 });
    const exported = await getContributorActivityExport("alice", pool);
    expect(exported?.rows).toHaveLength(7);
    expect(exported?.totals).toEqual({ commit: 3, pull_request: 3, issue: 1 });
    expect(exported?.rows.every((row) => row.url.startsWith("https://github.com/"))).toBe(true);
    await expect(analytics.getOrganizationActivitySummary("30d")).resolves.toMatchObject({ repositories: 2, total: 11 });
    await expect(saveContributorActivity(identity, { ...data, rows: [], incomplete: true }, pool)).rejects.toThrow("incomplete");
    expect((await getContributorActivityExport("alice", pool))?.rows).toHaveLength(7);

    await saveContributorActivity({ githubId: "2010", login: "new-member", avatarUrl: null }, {
      rows: [], totals: { commit: 0, pull_request: 0, issue: 0 }, truncated: false, incomplete: false,
    }, pool);
    const withNewMember = await analytics.getContributorLeaderboard({ range: "7d", metric: "total", limit: 50 });
    expect(withNewMember.find((item) => item.login === "new-member")).toMatchObject({ commits: 0, prs: 0, issues: 0, total: 0 });
    await expect(analytics.getContributorDetail("new-member", "7d")).resolves.toMatchObject({ login: "new-member", total: 0, repositories: [] });
    await expect(getContributorActivityExport("missing-user", pool)).resolves.toBeNull();
  });
});
