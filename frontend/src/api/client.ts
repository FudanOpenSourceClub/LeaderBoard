import {
  OutstandingBoardsResponseSchema,
  type OutstandingBoardsResponse,
  ApiErrorResponseSchema,
  ContributorDetailSchema,
  ContributorLeaderboardResponseSchema,
  GroupsResponseSchema,
  OrganizationSummaryResponseSchema,
  RepositoryStatsResponseSchema,
  SyncStatusSchema,
  type ContributorDetail,
  type ContributorLeaderboardResponse,
  type GroupsResponse,
  type LeaderboardMetric,
  type OrganizationSummaryResponse,
  type RepositoryStatsResponse,
  type SyncStatus,
  type TimeRange,
} from "@leadboard/contracts";

export interface LeadBoardApiClient {
  getOutstandingBoards():Promise<OutstandingBoardsResponse>;
  getOrganizationSummary(range: TimeRange): Promise<OrganizationSummaryResponse>;
  getRepositories(range: TimeRange, group?: string): Promise<RepositoryStatsResponse>;
  getGroups(): Promise<GroupsResponse>;
  getContributorLeaderboard(input: {
    range: TimeRange;
    metric: LeaderboardMetric;
    group?: string;
    limit?: number;
  }): Promise<ContributorLeaderboardResponse>;
  getContributorDetail(username: string, range: TimeRange): Promise<ContributorDetail>;
  getSyncStatus(): Promise<SyncStatus>;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiClientError";
  }
}

type ResponseSchema<T> = { parse(value: unknown): T };

export function createApiClient(fetcher: typeof fetch = globalThis.fetch): LeadBoardApiClient {
  async function requestJson<T>(path: string, schema: ResponseSchema<T>): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(path, { headers: { Accept: "application/json" } });
    } catch (cause) {
      throw new ApiClientError("无法连接服务器", "NETWORK_ERROR", null, { cause });
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error = ApiErrorResponseSchema.safeParse(body);
      throw new ApiClientError(
        error.success ? error.data.error.message : `请求失败 (HTTP ${response.status})`,
        error.success ? error.data.error.code : "HTTP_ERROR",
        response.status,
      );
    }

    try {
      return schema.parse(await response.json());
    } catch (cause) {
      throw new ApiClientError("服务器返回的数据格式不正确", "INVALID_RESPONSE", response.status, { cause });
    }
  }

  return {
    getOutstandingBoards(){return requestJson("/api/v1/contributors/outstanding",OutstandingBoardsResponseSchema)},
    getOrganizationSummary(range) {
      const query = new URLSearchParams({ range });
      return requestJson(`/api/v1/organization/summary?${query}`, OrganizationSummaryResponseSchema);
    },
    getRepositories(range, group) {
      const query = new URLSearchParams({ range });
      if (group !== undefined) query.set("group", group);
      return requestJson(`/api/v1/organization/repositories?${query}`, RepositoryStatsResponseSchema);
    },
    getGroups() {
      return requestJson("/api/v1/groups", GroupsResponseSchema);
    },
    getContributorLeaderboard({ range, metric, group, limit }) {
      const query = new URLSearchParams({ range, metric });
      if (group !== undefined) query.set("group", group);
      if (limit !== undefined) query.set("limit", String(limit));
      return requestJson(`/api/v1/contributors/leaderboard?${query}`, ContributorLeaderboardResponseSchema);
    },
    getContributorDetail(username, range) {
      const query = new URLSearchParams({ range });
      return requestJson(`/api/v1/contributors/${encodeURIComponent(username)}?${query}`, ContributorDetailSchema);
    },
    getSyncStatus() {
      return requestJson("/api/v1/sync/status", SyncStatusSchema);
    },
  };
}
