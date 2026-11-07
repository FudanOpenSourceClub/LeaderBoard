import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientReturning(body: unknown, status = 200) {
  const fetcher = vi.fn(async () => jsonResponse(body, status));
  return { client: createApiClient(fetcher), fetcher };
}

describe("LeadBoard API client", () => {
  it("gets and validates the organization summary", async () => {
    const summary = {
      range: "30d", repositories: 2, contributors: 3,
      commits: 4, prs: 5, issues: 6, total: 15,
      lastUpdatedAt: null, dataStatus: "missing",
    };
    const { client, fetcher } = clientReturning(summary);

    await expect(client.getOrganizationSummary("30d")).resolves.toEqual(summary);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/organization/summary?range=30d",
      { headers: { Accept: "application/json" } },
    );
  });

  it("gets repositories and encodes the group name", async () => {
    const repositories = { items: [{
      githubId: "123", fullName: "club/repo", group: "AI & Data",
      commits: 4, prs: 2, issues: 1, contributors: 3, total: 7,
    }] };
    const { client, fetcher } = clientReturning(repositories);

    await expect(client.getRepositories("7d", "AI & Data")).resolves.toEqual(repositories);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/organization/repositories?range=7d&group=AI+%26+Data",
      { headers: { Accept: "application/json" } },
    );
  });

  it("gets groups", async () => {
    const groups = { items: [{ name: "AI" }] };
    const { client, fetcher } = clientReturning(groups);

    await expect(client.getGroups()).resolves.toEqual(groups);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/groups", { headers: { Accept: "application/json" } });
  });

  it("gets the leaderboard and leaves out an unspecified limit", async () => {
    const leaderboard = { range: "30d", metric: "total", items: [{
      rank: 1, login: "alice", avatarUrl: null,
      commits: 4, prs: 2, issues: 1, total: 7,
    }] };
    const { client, fetcher } = clientReturning(leaderboard);

    await expect(client.getContributorLeaderboard({ range: "30d", metric: "total" }))
      .resolves.toEqual(leaderboard);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/contributors/leaderboard?range=30d&metric=total",
      { headers: { Accept: "application/json" } },
    );
  });

  it("passes an explicit group and limit to the leaderboard", async () => {
    const { client, fetcher } = clientReturning({ range: "90d", metric: "prs", items: [] });

    await client.getContributorLeaderboard({ range: "90d", metric: "prs", group: "AI", limit: 10 });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/contributors/leaderboard?range=90d&metric=prs&group=AI&limit=10",
      { headers: { Accept: "application/json" } },
    );
  });

  it("gets contributor details and encodes the username", async () => {
    const detail = {
      login: "alice/bob", avatarUrl: null, range: "all",
      commits: 4, prs: 2, issues: 1, total: 7, repositories: [],
    };
    const { client, fetcher } = clientReturning(detail);

    await expect(client.getContributorDetail("alice/bob", "all")).resolves.toEqual(detail);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/contributors/alice%2Fbob?range=all",
      { headers: { Accept: "application/json" } },
    );
  });

  it("gets the sync status", async () => {
    const status = {
      lastSuccessfulRunAt: null, lastRunStatus: null,
      nextScheduledRunAt: null, dataStatus: "missing",
    };
    const { client, fetcher } = clientReturning(status);

    await expect(client.getSyncStatus()).resolves.toEqual(status);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/sync/status",
      { headers: { Accept: "application/json" } },
    );
  });

  it("preserves the shared API error code and HTTP status", async () => {
    const { client } = clientReturning({ error: { code: "CONTRIBUTOR_NOT_FOUND", message: "Unknown contributor" } }, 404);

    await expect(client.getContributorDetail("missing", "30d")).rejects.toMatchObject({
      name: "ApiClientError", code: "CONTRIBUTOR_NOT_FOUND", status: 404,
      message: "Unknown contributor",
    });
  });

  it("normalizes network failures and malformed error bodies", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(createApiClient(fetcher).getGroups()).rejects.toMatchObject({
      code: "NETWORK_ERROR", status: null,
    });

    const badResponse = vi.fn(async () => new Response("not JSON", { status: 503 }));
    await expect(createApiClient(badResponse).getGroups()).rejects.toMatchObject({
      code: "HTTP_ERROR", status: 503,
    });
  });

  it("rejects incompatible success responses", async () => {
    const { client } = clientReturning({ items: [{ wrong: "field" }] });

    await expect(client.getGroups()).rejects.toMatchObject({
      name: "ApiClientError", code: "INVALID_RESPONSE", status: 200,
    });
  });
});

it('loads the public Outstanding boards with the shared response schema',async()=>{
  const boards={asOf:'2026-11-07T03:00:00.000Z',month:'2026-11',boards:[]};
  const {client,fetcher}=clientReturning(boards);
  expect(await client.getOutstandingBoards()).toEqual(boards);
  expect(fetcher).toHaveBeenCalledWith('/api/v1/contributors/outstanding',{headers:{Accept:'application/json'}});
});
