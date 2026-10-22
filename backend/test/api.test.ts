import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type {
  ContributorDetail,
  ContributorRank,
  GroupSummary,
  LeaderboardQuery,
  OrganizationActivitySummary,
  RepositoryStat,
  SyncStatus,
  TimeRange,
} from "@leadboard/contracts";
import { createApp } from "../src/app.js";
import { createApiRouter } from "../src/api/router.js";

function dependencies() {
  const summary: OrganizationActivitySummary = {
    range: "30d", repositories: 2, contributors: 2, commits: 7, prs: 2, issues: 2, total: 11,
  };
  const sync: SyncStatus = {
    lastSuccessfulRunAt: "2026-09-25T12:00:00.000Z",
    lastRunStatus: "success", nextScheduledRunAt: null, dataStatus: "fresh",
  };
  const analytics = {
    getGroups: vi.fn<() => Promise<GroupSummary[]>>().mockResolvedValue([{ name: "systems" }]),
    getOrganizationActivitySummary: vi.fn<(range: TimeRange) => Promise<OrganizationActivitySummary>>()
      .mockImplementation(async (range) => ({ ...summary, range })),
    getRepositoryStats: vi.fn<(range: TimeRange, group?: string) => Promise<RepositoryStat[]>>()
      .mockResolvedValue([{
        githubId: "1001", fullName: "leadboard-fixture/repo-a", group: "systems",
        commits: 5, prs: 1, issues: 1, contributors: 2, total: 7,
      }]),
    getContributorLeaderboard: vi.fn<(input: LeaderboardQuery) => Promise<ContributorRank[]>>()
      .mockResolvedValue([{
        rank: 1, login: "alice", avatarUrl: null, commits: 2, prs: 2, issues: 0, total: 4,
      }]),
    getContributorDetail: vi.fn<(username: string, range: TimeRange) => Promise<ContributorDetail | null>>()
      .mockImplementation(async (username, range) => username === "alice" ? {
        login: "alice", avatarUrl: null, range, commits: 2, prs: 2, issues: 0, total: 4, repositories: [],
      } : null),
  };
  return { analytics, getSyncStatus: vi.fn().mockResolvedValue(sync) };
}

describe("Phase 1 API router", () => {
  it("serves all six endpoints through the real /api/v1 mount", async () => {
    const deps = dependencies();
    const app = createApp({ apiRouter: createApiRouter(deps) });

    await request(app).get("/api/v1/organization/summary").expect(200)
      .expect((res) => expect(res.body).toMatchObject({ range: "30d", total: 11, dataStatus: "fresh" }));
    await request(app).get("/api/v1/organization/repositories?range=7d&group=systems").expect(200);
    await request(app).get("/api/v1/groups").expect(200, { items: [{ name: "systems" }] });
    await request(app).get("/api/v1/contributors/leaderboard?range=30d&metric=total&limit=10").expect(200);
    await request(app).get("/api/v1/contributors/alice?range=all").expect(200);
    await request(app).get("/api/v1/sync/status").expect(200);
  });

  it.each([
    ["/api/v1/organization/summary?range=nope", "INVALID_RANGE"],
    ["/api/v1/contributors/leaderboard?metric=nope", "INVALID_METRIC"],
    ["/api/v1/contributors/leaderboard?limit=0", "INVALID_LIMIT"],
    ["/api/v1/contributors/leaderboard?limit=1.5", "INVALID_LIMIT"],
    ["/api/v1/organization/repositories?group=", "INVALID_GROUP"],
  ])("returns a structured 4xx for invalid query %s", async (path, code) => {
    const app = createApp({ apiRouter: createApiRouter(dependencies()) });
    const response = await request(app).get(path).expect(400);
    expect(response.body.error.code).toBe(code);
  });

  it("rejects repeated query parameters instead of silently choosing one", async () => {
    const app = createApp({ apiRouter: createApiRouter(dependencies()) });
    const response = await request(app).get("/api/v1/organization/summary?range=7d&range=30d").expect(400);
    expect(response.body.error.code).toBe("INVALID_RANGE");
  });

  it("returns 404 for an unknown contributor", async () => {
    const app = createApp({ apiRouter: createApiRouter(dependencies()) });
    const response = await request(app).get("/api/v1/contributors/missing").expect(404);
    expect(response.body.error.code).toBe("CONTRIBUTOR_NOT_FOUND");
  });

  it("disables profile and legacy contribution export routes",async()=>{
    const contributorExport=vi.fn();const app=createApp({apiRouter:createApiRouter({...dependencies(),contributorExport})});
    for(const prefix of ["contributors","public-contributors"]){
      const response=await request(app).get(`/api/v1/${prefix}/alice/export.csv`).expect(410);
      expect(response.body.error.code).toBe("EXPORT_DISABLED");
    }
    expect(contributorExport).not.toHaveBeenCalled();
  });
});
