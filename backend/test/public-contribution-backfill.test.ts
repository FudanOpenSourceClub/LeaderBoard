import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backfillPublicContributions } from "../src/public-contributions/backfill.js";
import { saveContributorActivity } from "../src/public-contributions/enrollment.js";

vi.mock("../src/public-contributions/enrollment.js", () => ({
  saveContributorActivity: vi.fn(async (_identity, data) => data.rows.length),
}));

const options = {
  period: { from: "2025-01-01T00:00:00Z", to: "2025-02-01T00:00:00Z" },
  apply: true,
};
const pool = { query: async () => ({ rows: [{ github_id: "111" }] }) } as unknown as Pool;

function fixture(lookup: (authorization: string | null) => Response) {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/user/111") return Response.json({ id: 111, type: "User", login: "renamed", avatar_url: null });
    if (url.pathname === "/repos/example/other") return lookup(new Headers(init?.headers).get("authorization"));

    const commit = {
      author: { id: 111 }, sha: "abc", html_url: "https://github.com/example/repo/commit/abc",
      repository: { full_name: "example/repo", id: 100, private: false },
      commit: { author: { date: "2025-01-02T00:00:00Z" } },
    };
    const pullRequest = {
      user: { id: 111 }, number: 123, html_url: "https://github.com/example/other/pull/123",
      repository_url: "https://api.github.com/repos/example/other", created_at: "2025-01-03T00:00:00Z",
    };
    const items = url.pathname === "/search/commits" ? [commit]
      : url.searchParams.get("q")?.includes("is:pr") ? [pullRequest] : [];
    return Response.json({ total_count: items.length, items, incomplete_results: false });
  }) as typeof fetch;
}

describe("Public contribution history backfill", () => {
  beforeEach(() => {
    vi.mocked(saveContributorActivity).mockClear();
  });

  it("resolves a public repository without authorization after a token permission error", async () => {
    const headers: (string | null)[] = [];
    const fetcher = fixture(authorization => {
      headers.push(authorization);
      return authorization
        ? Response.json({ message: "Resource not accessible by personal access token" }, { status: 403 })
        : Response.json({ id: 101, private: false });
    });
    await expect(backfillPublicContributions(pool, "test-token", options, fetcher))
      .resolves.toMatchObject({ completed: 1, failed: 0, inserted: 2 });
    expect(headers).toEqual(["Bearer test-token", null]);
    expect(vi.mocked(saveContributorActivity).mock.calls[0]?.[1].rows.map(row => row.repositoryGithubId)).toEqual(["101", "100"]);
  });

  it("saves verified records and reports the account when its other repository cannot be resolved", async () => {
    const fetcher = fixture(() => Response.json({ message: "Forbidden" }, { status: 403 }));
    await expect(backfillPublicContributions(pool, "test-token", options, fetcher))
      .resolves.toMatchObject({ completed: 0, failed: 1, inserted: 1, skippedRows: 0 });
    expect(vi.mocked(saveContributorActivity).mock.calls[0]?.[1].rows.map(row => row.repositoryGithubId)).toEqual(["100"]);
  });

  it("retries an explicit rate limit with the same authorization", async () => {
    const headers: (string | null)[] = [];
    const fetcher = fixture(authorization => {
      headers.push(authorization);
      return headers.length === 1
        ? Response.json({ message: "Forbidden" }, { status: 403, headers: { "Retry-After": "0" } })
        : Response.json({ id: 101, private: false });
    });
    await expect(backfillPublicContributions(pool, "test-token", options, fetcher))
      .resolves.toMatchObject({ completed: 1, failed: 0, inserted: 2 });
    expect(headers).toEqual(["Bearer test-token", "Bearer test-token"]);
  });
});
