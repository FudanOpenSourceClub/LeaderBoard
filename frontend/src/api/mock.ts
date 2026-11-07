import {
  OutstandingBoardsResponseSchema,
  OUTSTANDING_LABELS,
  ContributorDetailSchema,
  ContributorLeaderboardResponseSchema,
  GroupsResponseSchema,
  OrganizationSummaryResponseSchema,
  RepositoryStatsResponseSchema,
  SyncStatusSchema,
} from "@leadboard/contracts";
import { ApiClientError, type LeadBoardApiClient } from "./client";

const DEMO_GROUP = "demo";
const EMPTY_GROUP = "empty-demo";
const DEMO_LOGIN = "demo-contributor";
const DEMO_SYNCED_AT = "2026-09-25T00:00:00.000Z";

const repository = {
  githubId: "1001",
  fullName: "demo/leadboard",
  group: DEMO_GROUP,
  commits: 8,
  prs: 3,
  issues: 1,
  contributors: 1,
  total: 12,
};

const contributor = {
  rank: 1,
  login: DEMO_LOGIN,
  avatarUrl: null,
  commits: 8,
  prs: 3,
  issues: 1,
  total: 12,
};

async function mockResponse<T>(schema: { parse(value: unknown): T }, value: unknown): Promise<T> {
  // Keep the loading state visible during manual development checks.
  if (import.meta.env.MODE !== "test") {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return schema.parse(value);
}

/** A development fixture with the same methods and schemas as the HTTP client. */
export function createMockApiClient(): LeadBoardApiClient {
  if (!import.meta.env.DEV && import.meta.env.MODE !== "test") {
    throw new Error("Mock API is available only in development or tests");
  }

  return {
    async getOutstandingBoards(){return mockResponse(OutstandingBoardsResponseSchema,{
      asOf:new Date().toISOString(),month:new Date(Date.now()+8*3600000).toISOString().slice(0,7),
      boards:Object.entries(OUTSTANDING_LABELS).map(([category,title])=>({category,title,people:[]})),
    })},
    async getOrganizationSummary(range) {
      return mockResponse(OrganizationSummaryResponseSchema, {
        range,
        repositories: 1,
        contributors: 1,
        commits: 8,
        prs: 3,
        issues: 1,
        total: 12,
        lastUpdatedAt: DEMO_SYNCED_AT,
        dataStatus: "fresh",
      });
    },
    async getRepositories(_range, group) {
      return mockResponse(RepositoryStatsResponseSchema, {
        items: group === undefined || group === DEMO_GROUP ? [repository] : [],
      });
    },
    async getGroups() {
      return mockResponse(GroupsResponseSchema, {
        items: [{ name: DEMO_GROUP }, { name: EMPTY_GROUP }],
      });
    },
    async getContributorLeaderboard({ range, metric, group, limit }) {
      const items = group === undefined || group === DEMO_GROUP ? [contributor] : [];
      return mockResponse(ContributorLeaderboardResponseSchema, {
        range,
        metric,
        items: limit === undefined ? items : items.slice(0, limit),
      });
    },
    async getContributorDetail(username, range) {
      if (username !== DEMO_LOGIN) {
        throw new ApiClientError("贡献者不存在", "CONTRIBUTOR_NOT_FOUND", 404);
      }
      return mockResponse(ContributorDetailSchema, {
        login: DEMO_LOGIN,
        avatarUrl: null,
        range,
        commits: 8,
        prs: 3,
        issues: 1,
        total: 12,
        repositories: [{
          githubId: repository.githubId,
          fullName: repository.fullName,
          group: repository.group,
          commits: repository.commits,
          prs: repository.prs,
          issues: repository.issues,
          total: repository.total,
        }],
      });
    },
    async getSyncStatus() {
      return mockResponse(SyncStatusSchema, {
        lastSuccessfulRunAt: DEMO_SYNCED_AT,
        lastRunStatus: "success",
        nextScheduledRunAt: null,
        dataStatus: "fresh",
      });
    },
  };
}
