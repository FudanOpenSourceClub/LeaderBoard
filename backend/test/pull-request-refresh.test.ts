import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { collectStoredPullRequestUpdates } from "../src/public-contributions/pull-request-refresh.js";

const stored = { repository_github_id: "42", object_github_id: "900", identifier: "12" };
const repo = { id: 42, full_name: "new-owner/renamed-repo", private: false };
const mergedAt = "2026-11-16T09:34:17Z";
const pr = { id: 900, number: 12, user: { id: 111, login: "new-name" }, base: { repo }, merged_at: mergedAt };

function fixture(rows = [stored], pull: unknown = pr, repository: unknown = repo) {
  const pool = { query: vi.fn(async () => ({ rows })) } as unknown as Pool;
  const fetcher = vi.fn(async (input: URL | RequestInfo) => new Response(JSON.stringify(
    String(input).includes("/repositories/") ? repository : pull,
  ))) as typeof fetch;
  return { pool, fetcher };
}

describe("refreshing stored PR merge status", () => {
  it("uses stable IDs after account/repository renames, without a creation-time filter", async () => {
    const { pool, fetcher } = fixture();
    expect(await collectStoredPullRequestUpdates("111", "fixture", pool, fetcher)).toEqual([
      { repositoryGithubId: "42", identifier: "12", mergedAt },
    ]);
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repositories/42",
      "https://api.github.com/repos/new-owner/renamed-repo/pulls/12",
    ]);
  });

  it("makes no requests when there are no stored unmerged PRs", async () => {
    const { pool, fetcher } = fixture([]);
    expect(await collectStoredPullRequestUpdates("111", "fixture", pool, fetcher)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shares repository lookups and rotates unmerged records", async () => {
    const { pool, fetcher } = fixture([stored, { ...stored, object_github_id: "901", identifier: "13" }]);
    vi.mocked(fetcher).mockImplementation(async input => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes("/repositories/") ? repo : {
        ...pr, id: url.endsWith("/13") ? 901 : 900, number: url.endsWith("/13") ? 13 : 12, merged_at: null,
      }));
    });
    expect(await collectStoredPullRequestUpdates("111", "fixture", pool, fetcher)).toEqual([
      { repositoryGithubId: "42", identifier: "12", mergedAt: null },
      { repositoryGithubId: "42", identifier: "13", mergedAt: null },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    { ...pr, user: { id: 999 } },
    { ...pr, base: { repo: { ...repo, id: 99 } } },
    { ...pr, id: 901 },
    { ...pr, number: 13 },
    { ...pr, merged_at: "not-a-date" },
    { ...pr, merged_at: undefined },
  ])("rejects mismatched identity or malformed merge metadata: %j", async pull => {
    const { pool, fetcher } = fixture([stored], pull);
    await expect(collectStoredPullRequestUpdates("111", "fixture", pool, fetcher)).rejects.toThrow("Invalid GitHub pull request");
  });

  it("rejects a repository ID mismatch", async () => {
    const { pool, fetcher } = fixture([stored], pr, { ...repo, id: 99 });
    await expect(collectStoredPullRequestUpdates("111", "fixture", pool, fetcher)).rejects.toThrow("repository identity");
  });

  it("does not collect private repository merge data", async () => {
    const { pool, fetcher } = fixture([stored], pr, { ...repo, private: true });
    expect(await collectStoredPullRequestUpdates("111", "fixture", pool, fetcher)).toEqual([
      { repositoryGithubId: "42", identifier: "12", mergedAt: null },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([404, 410])("keeps unavailable PRs unchanged on HTTP %s", async status => {
    const { pool, fetcher } = fixture();
    vi.mocked(fetcher).mockImplementation(async input => String(input).includes("/repositories/")
      ? new Response(JSON.stringify(repo)) : new Response("{}", { status }));
    expect(await collectStoredPullRequestUpdates("111", "fixture", pool, fetcher)).toEqual([
      { repositoryGithubId: "42", identifier: "12", mergedAt: null },
    ]);
  });

  it.each([401, 403, 429, 503])("surfaces HTTP %s instead of reporting success", async status => {
    const { pool, fetcher } = fixture();
    vi.mocked(fetcher).mockImplementation(async () => new Response("{}", { status }));
    await expect(collectStoredPullRequestUpdates("111", "fixture", pool, fetcher)).rejects.toThrow();
  });
});
