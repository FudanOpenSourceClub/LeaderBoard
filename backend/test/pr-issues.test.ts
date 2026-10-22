import {
  IssueActivitySchema,
  PullRequestActivitySchema,
  type CollectRange,
  type GitHubClient,
  type TrackedRepository,
} from "@leadboard/contracts";
import { describe, expect, it, vi } from "vitest";
import { PullRequestIssueCollector } from "../src/collectors/pr-issues.js";
import { GitHubApiClient } from "../src/github/client.js";

const repo: TrackedRepository = {
  githubId: "1001", nodeId: "R_1001", owner: "example", name: "core",
  fullName: "example/core", defaultBranch: "main", group: "platform",
  htmlUrl: "https://github.com/example/core", archived: false,
};
const range: CollectRange = { from: "2026-09-18T12:00:00Z", to: "2026-09-25T12:00:00Z" };
const user = { id: 2001, login: "alice", avatar_url: "https://example.test/alice.png", type: "User" };
const bot = { id: 2003, login: "dependency-bot[bot]", avatar_url: "https://example.test/bot.png", type: "Bot" };
const organization = { id: 2004, login: "example-org", avatar_url: null, type: "Organization" };

function pull(overrides: Record<string, unknown> = {}) {
  return {
    id: 3001, number: 42, user, created_at: range.from, closed_at: null,
    merged_at: null, html_url: "https://github.com/example/core/pull/42", state: "open",
    updated_at: "2026-10-01T00:00:00Z", ...overrides,
  };
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: 4001, number: 52, user, created_at: range.from, closed_at: null,
    html_url: "https://github.com/example/core/issues/52", state: "open",
    updated_at: "2026-10-01T00:00:00Z", ...overrides,
  };
}

function mockCollector(items: unknown[]) {
  const paginateRest = vi.fn().mockResolvedValue(items);
  const client = { paginateRest } as unknown as GitHubClient;
  return { collector: new PullRequestIssueCollector(client), paginateRest };
}

describe("PullRequestIssueCollector", () => {
  it("maps open, closed without merge, and merged PRs with contract fields", async () => {
    const closedAt = "2026-09-21T10:00:00Z";
    const mergedAt = "2026-09-22T10:00:00Z";
    const { collector, paginateRest } = mockCollector([
      pull(),
      pull({ id: 3002, number: 43, state: "closed", closed_at: closedAt, user: bot }),
      pull({ id: 3003, number: 44, state: "closed", closed_at: closedAt, merged_at: mergedAt, user: organization }),
    ]);
    const result = await collector.collectPullRequests(repo, range);

    expect(paginateRest).toHaveBeenCalledWith("/repos/example/core/pulls", { state: "all" });
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      kind: "pull_request", repositoryGithubId: "1001", externalId: "3001", number: 42,
      actor: { githubId: "2001", login: "alice", avatarUrl: user.avatar_url, type: "User" },
      occurredAt: range.from, state: "open", closedAt: null, mergedAt: null,
      rawUrl: "https://github.com/example/core/pull/42",
    });
    expect(result[1]).toMatchObject({ externalId: "3002", state: "closed", closedAt, mergedAt: null,
      actor: { githubId: "2003", type: "Bot" } });
    expect(result[2]).toMatchObject({ externalId: "3003", state: "merged", closedAt, mergedAt,
      actor: { githubId: "2004", type: "Organization" } });
    expect(result.every((item) => PullRequestActivitySchema.safeParse(item).success)).toBe(true);
  });

  it("refreshes PRs created or updated in range without admitting future creations", async () => {
    const { collector } = mockCollector([
      pull({ id: 1, created_at: "2026-09-18T11:59:59Z" }),
      pull({ id: 2, created_at: range.from, updated_at: "2026-10-01T00:00:00Z" }),
      pull({ id: 3, created_at: range.to, updated_at: range.from }),
    ]);
    expect((await collector.collectPullRequests(repo, range)).map((item) => item.externalId)).toEqual(["2"]);
  });

  it("maps open and closed issues, filters PR markers, and handles unknown or missing actors", async () => {
    const closedAt = "2026-09-23T10:00:00Z";
    const { collector, paginateRest } = mockCollector([
      issue(),
      issue({ id: 4002, number: 53, state: "closed", closed_at: closedAt, user: bot }),
      issue({ id: 4003, number: 54, user: null, html_url: null }),
      issue({ id: 4004, number: 55, user: { ...user, type: "Mannequin" } }),
      issue({ id: 4999, number: 56, pull_request: { url: "https://api.github.com/pulls/56" } }),
    ]);
    const result = await collector.collectIssues(repo, range);

    expect(paginateRest).toHaveBeenCalledWith("/repos/example/core/issues", { state: "all" });
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({
      kind: "issue", repositoryGithubId: "1001", externalId: "4001", number: 52,
      actor: { githubId: "2001", login: "alice", avatarUrl: user.avatar_url, type: "User" },
      occurredAt: range.from, state: "open", closedAt: null,
      rawUrl: "https://github.com/example/core/issues/52",
    });
    expect(result[1]).toMatchObject({ externalId: "4002", state: "closed", closedAt,
      actor: { githubId: "2003", type: "Bot" } });
    expect(result[2]).toMatchObject({ actor: { githubId: null, login: null, avatarUrl: null, type: "Unknown" }, rawUrl: null });
    expect(result[3]).toMatchObject({ actor: { githubId: "2001", type: "Unknown" } });
    expect(result.every((item) => IssueActivitySchema.safeParse(item).success)).toBe(true);
  });

  it("refreshes old issues updated in range without changing their creation time", async () => {
    const { collector, paginateRest } = mockCollector([
      issue({ id: 1, created_at: "2026-09-18T11:59:59Z", updated_at: range.from }),
      issue({ id: 2, created_at: range.from, updated_at: "2026-10-01T00:00:00Z" }),
      issue({ id: 3, created_at: range.to, updated_at: range.from }),
    ]);
    expect((await collector.collectIssues(repo, range)).map((item) => item.externalId)).toEqual(["1", "2"]);
    expect(paginateRest.mock.calls[0]?.[1]).not.toHaveProperty("since");
  });

  it("refreshes an old PR merged now so its merge award can be calculated",async()=>{
    const {collector}=mockCollector([pull({created_at:"2026-01-01T00:00:00Z",updated_at:range.from,merged_at:range.from,state:"closed"})]);
    const result=await collector.collectPullRequests(repo,range);
    expect(result).toHaveLength(1);expect(result[0]).toMatchObject({occurredAt:"2026-01-01T00:00:00Z",state:"merged",mergedAt:range.from});
  });

  it("propagates GitHubClient failures without returning partial results", async () => {
    const failure = new Error("second page failed");
    const paginateRest = vi.fn().mockRejectedValue(failure);
    const collector = new PullRequestIssueCollector({ paginateRest } as unknown as GitHubClient);
    await expect(collector.collectPullRequests(repo, range)).rejects.toBe(failure);
    await expect(collector.collectIssues(repo, range)).rejects.toBe(failure);
  });

  it("receives all REST pages through the existing GitHubApiClient", async () => {
    const next = "https://api.github.com/repos/example/core/pulls?state=all&per_page=100&page=2";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([pull({ id: 1 })]), {
        headers: { link: `<${next}>; rel="next"` },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([pull({ id: 2 })])));
    const client = new GitHubApiClient({ githubToken: "fixture-token" }, { fetch: fetchMock });
    const result = await new PullRequestIssueCollector(client).collectPullRequests(repo, range);
    expect(result.map((item) => item.externalId)).toEqual(["1", "2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(next);
  });

  it("receives all issue REST pages through the existing GitHubApiClient", async () => {
    const next = "https://api.github.com/repos/example/core/issues?state=all&per_page=100&page=2";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([issue({ id: 1 })]), {
        headers: { link: `<${next}>; rel="next"` },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([issue({ id: 2 })])));
    const client = new GitHubApiClient({ githubToken: "fixture-token" }, { fetch: fetchMock });
    const result = await new PullRequestIssueCollector(client).collectIssues(repo, range);
    expect(result.map((item) => item.externalId)).toEqual(["1", "2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(next);
  });
});
