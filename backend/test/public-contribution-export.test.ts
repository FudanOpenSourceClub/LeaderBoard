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

describe("Public contributor activity export", () => {
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
    expect(csv).toContain("公开 GitHub 贡献记录");
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

  it("retries transient GitHub failures before collecting the contribution snapshot", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockImplementation(mockFetcher) as unknown as typeof fetch;
    const result = await collectPublicContributions("Zecyel", "token", fetcher);
    expect(result.rows).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("uses update time for incremental PR/Issue collection so later merges are refreshed",async()=>{
    const fetcher=vi.fn(mockFetcher) as unknown as typeof fetch;
    await collectPublicContributions("Zecyel","token",fetcher,{since:"2026-10-01T12:00:00Z"});
    const queries=vi.mocked(fetcher).mock.calls.map(([url])=>new URL(String(url)).searchParams.get("q"));
    expect(queries[0]).toContain("committer-date:>=2026-10-01");
    expect(queries[1]).toContain("updated:>=2026-10-01");
    expect(queries[2]).toContain("updated:>=2026-10-01");
  });

  it("retrieves more than GitHub's per-query 1000 cap by splitting date windows", async () => {
    const commits = Array.from({ length: 1200 }, (_, i) => {
      const day = i < 600 ? "2025-01-12" : "2026-02-02";
      return {
        html_url: "https://github.com/test/project/commit/" + String(i).padStart(40, "0"),
        sha: String(i).padStart(40, "0"),
        repository: { full_name: "test/project" },
        commit: { author: { date: day + "T10:00:00Z" }, message: "Change " + i },
      };
    });
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/issues")) {
        const type = url.searchParams.get("q")?.includes("is:pr") ? "pr" : "issue";
        return new Response(JSON.stringify(endpointPayloads[type]), { status: 200 });
      }
      const query = url.searchParams.get("q") ?? "";
      const match = /author-date:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/.exec(query);
      const subset = match
        ? commits.filter((item) =>
            item.commit.author.date.slice(0, 10) >= match[1]! &&
            item.commit.author.date.slice(0, 10) <= match[2]!)
        : commits;
      const page = Number(url.searchParams.get("page") ?? 1);
      return new Response(JSON.stringify({
        total_count: subset.length, incomplete_results: false,
        items: subset.slice((page - 1) * 100, page * 100),
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await collectPublicContributions("Zecyel", "token", fetcher);
    expect(result.totals.commit).toBe(1200);
    expect(result.rows.filter((item) => item.kind === "commit")).toHaveLength(1200);
    expect(new Set(result.rows.map((item) => item.kind + item.url)).size).toBe(result.rows.length);
    expect(result.truncated).toBe(false);
    expect(vi.mocked(fetcher).mock.calls.some(([url]) => 
      String(url).includes("author-date%3A"))).toBe(true);
  });

});
