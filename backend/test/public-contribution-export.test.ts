import { describe, expect, it, vi } from "vitest";
import { collectPublicContributions, publicContributionCsv } from "../src/public-contributions/export.js";

const endpointPayloads: Record<string, unknown> = {
  commits: {
    total_count: 1, incomplete_results: false,
    items: [{
      html_url: "https://github.com/example/repo/commit/abcdef",
      sha: "abcdef", repository: { full_name: "example/repo" },
      commit: { author: { date: "2026-10-18T00:00:00Z" }, message: "=SUM(1,2)\nextra" },
    }],
  },
  pr: {
    total_count: 1, incomplete_results: false,
    items: [{
      html_url: "https://github.com/example/repo/pull/12",
      repository_url: "https://api.github.com/repos/example/repo",
      created_at: "2026-10-19T00:00:00Z", number: 12, title: "Feature",
    }],
  },
  issue: {
    total_count: 1, incomplete_results: false,
    items: [{
      html_url: "https://github.com/example/repo/issues/13",
      repository_url: "https://api.github.com/repos/example/repo",
      created_at: "2026-10-20T00:00:00Z", number: 13, title: "Bug",
    }],
  },
};

function mockFetcher(url: URL | RequestInfo) {
  const parsed = new URL(String(url));
  const kind = parsed.pathname.endsWith("commits") ? "commits"
    : parsed.searchParams.get("q")?.includes("is:pr") ? "pr" : "issue";
  return Promise.resolve(new Response(JSON.stringify(endpointPayloads[kind]), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

describe("Zecyel public contribution pilot", () => {
  it("collects real-source-shaped Commit/PR/Issue data and exports safe CSV", async () => {
    const fetcher = vi.fn(mockFetcher) as unknown as typeof fetch;
    const result = await collectPublicContributions("Zecyel", "test-token", fetcher);
    expect(result.rows).toHaveLength(3);
    expect(result.totals).toEqual({ commit: 1, pull_request: 1, issue: 1 });
    expect(result.rows.map((row) => row.kind)).toEqual(["issue", "pull_request", "commit"]);
    expect(result.truncated).toBe(false);
    expect(result.incomplete).toBe(false);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(3);
    const csv = publicContributionCsv(result);
    expect(csv).toContain("https://github.com/example/repo/pull/12");
    expect(csv).toContain("'=SUM(1,2)");
    expect(csv).toContain("不等于已认证复旦贡献");
  });

  it("rejects invalid login and missing token before accessing GitHub", async () => {
    const fetcher = vi.fn(mockFetcher) as unknown as typeof fetch;
    await expect(collectPublicContributions("../../evil", "token", fetcher)).rejects.toThrow("Invalid");
    await expect(collectPublicContributions("Zecyel", "", fetcher)).rejects.toThrow("token");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces GitHub failures instead of exporting invented zero counts", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("rate limited", { status: 403 })) as unknown as typeof fetch;
    await expect(collectPublicContributions("Zecyel", "token", fetcher)).rejects.toThrow("HTTP 403");
  });
});
