import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDbPool } from "../src/db/index.js";
import { enrollContributor, saveContributorActivity } from "../src/public-contributions/enrollment.js";
import { collectStoredPullRequestUpdates } from "../src/public-contributions/pull-request-refresh.js";
import { AnalyticsService } from "../src/analytics/index.js";

const pool = getDbPool();
const githubId = "354715810";
const repo = { id: 7508411, full_name: "ReactiveX/RxJava", private: false };
const mergedAt = "2026-11-16T09:34:17Z";
const empty = { rows: [], totals: { commit: 0, issue: 0, pull_request: 0 }, truncated: false, incomplete: false };
const identity = { githubId, login: "jimi-21", avatarUrl: null };
let contributorId: string;

function fetcher(merged: string | null = mergedAt) {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (url.pathname === `/user/${githubId}`) return Response.json({ id: Number(githubId), login: "jimi-21", avatar_url: null, type: "User" });
    if (url.pathname.startsWith("/search/")) return Response.json({ total_count: 0, incomplete_results: false, items: [] });
    if (url.pathname === "/repositories/7508411") return Response.json(repo);
    if (url.pathname.startsWith("/repos/ReactiveX/RxJava/pulls/")) {
      const number = Number(url.pathname.split("/").at(-1));
      return Response.json({ id: number + 10000, number, user: { id: Number(githubId) }, base: { repo }, merged_at: merged });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }) as typeof fetch;
}

beforeEach(async () => {
  await pool.query("TRUNCATE contributors,scoring_repositories,repository_star_counts RESTART IDENTITY CASCADE");
  contributorId = (await pool.query(`INSERT INTO contributors(github_id,login,enrolled_at,public_synced_at)
    VALUES($1,'hejingming368-max','2026-11-01','2026-11-16T06:00:00Z') RETURNING id::text`, [githubId])).rows[0].id;
  await pool.query(`INSERT INTO contributor_public_activities
    (contributor_id,kind,repository,repository_github_id,object_github_id,identifier,occurred_at,title,html_url,last_seen_at)
    VALUES($1,'pull_request','old-owner/old-name',7508411,18357,'8357','2026-11-16T05:53:11Z','PR',
      'https://github.com/ReactiveX/RxJava/pull/8357','2026-11-16T06:00:00Z')`, [contributorId]);
  await pool.query(`INSERT INTO scoring_repositories(github_id,full_name,html_url,enabled)
    VALUES(7508411,'ReactiveX/RxJava','https://github.com/ReactiveX/RxJava',TRUE)`);
});
afterAll(async () => { await pool.end(); });

describe("stored PR refresh persistence and scoring", () => {
  it("updates an old PR and scores its merge at a full insertion quota, preserving enrollment after rename", async () => {
    await pool.query(`INSERT INTO contributor_public_activities
      (contributor_id,kind,repository,repository_github_id,identifier,occurred_at,title,html_url)
      SELECT $1,'issue','fixture/quota',99,n::text,now(),'Quota','https://github.com/fixture/quota/issues/'||n
      FROM generate_series(1,49) n`, [contributorId]);
    // Avoid unrelated Star lookups for the quota fixtures.
    await pool.query("INSERT INTO repository_star_counts(github_id,stars,checked_at) VALUES(99,0,now())");
    const before = (await pool.query("SELECT id,enrolled_at FROM contributors WHERE github_id=$1", [githubId])).rows[0];
    const original = (await pool.query("SELECT occurred_at,first_seen_at FROM contributor_public_activities WHERE identifier='8357'")).rows[0];
    const api = fetcher();
    await enrollContributor("hejingming368-max", "fixture", pool, api, githubId);
    await enrollContributor("jimi-21", "fixture", pool, api, githubId);
    expect((await pool.query("SELECT count(*)::int AS n FROM contributor_public_activities")).rows[0].n).toBe(50);
    expect((await pool.query("SELECT id,login,enrolled_at FROM contributors WHERE github_id=$1", [githubId])).rows[0])
      .toEqual({ ...before, login: "jimi-21" });
    const updated = (await pool.query("SELECT occurred_at,first_seen_at,merged_at FROM contributor_public_activities WHERE identifier='8357'")).rows[0];
    expect(updated).toEqual({ ...original, merged_at: new Date(mergedAt) });
    const analytics = new AnalyticsService(pool, () => new Date("2026-11-17T12:00:00Z"));
    expect(await analytics.getContributorDetail("jimi-21", "all")).toMatchObject({ prs: 1, prOpenedScore: 20, prMergedScore: 30 });
    expect(vi.mocked(api).mock.calls.filter(([url]) => String(url).includes("/pulls/"))).toHaveLength(1);
  });

  it("rotates a bounded batch so older open PRs do not starve later rows", async () => {
    await pool.query(`INSERT INTO contributor_public_activities
      (contributor_id,kind,repository,repository_github_id,object_github_id,identifier,occurred_at,title,html_url,last_seen_at)
      SELECT $1,'pull_request','ReactiveX/RxJava',7508411,10000+n,n::text,'2026-11-01','Open PR',
        'https://github.com/ReactiveX/RxJava/pull/'||n,'2026-11-01' FROM generate_series(1,50) n`, [contributorId]);
    const api = fetcher(null);
    const first = await collectStoredPullRequestUpdates(githubId, "fixture", pool, api);
    expect(first).toHaveLength(50);
    expect(first.some(row => row.identifier === "8357")).toBe(false);
    await saveContributorActivity(identity, empty, pool, first);
    const next = await collectStoredPullRequestUpdates(githubId, "fixture", pool, api);
    expect(next[0]?.identifier).toBe("8357");
  });

  it("keeps the old snapshot and timestamp on API failure", async () => {
    const before = (await pool.query("SELECT login,public_synced_at FROM contributors WHERE github_id=$1", [githubId])).rows[0];
    const healthy = fetcher();
    const broken = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => String(input).includes("/pulls/")
      ? new Response("{}", { status: 503 }) : healthy(input, init)) as typeof fetch;
    await expect(enrollContributor("hejingming368-max", "fixture", pool, broken, githubId)).rejects.toThrow();
    expect((await pool.query("SELECT login,public_synced_at FROM contributors WHERE github_id=$1", [githubId])).rows[0]).toEqual(before);
    expect((await pool.query("SELECT merged_at FROM contributor_public_activities")).rows[0].merged_at).toBeNull();
  });

  it("only updates stored PRs and rolls back invalid updates with the timestamp", async () => {
    await saveContributorActivity(identity, empty, pool, [
      { repositoryGithubId: "7508411", identifier: "9999", mergedAt },
    ]);
    expect((await pool.query("SELECT count(*)::int AS n FROM contributor_public_activities")).rows[0].n).toBe(1);
    const before = (await pool.query("SELECT public_synced_at FROM contributors WHERE github_id=$1", [githubId])).rows[0];
    await expect(saveContributorActivity(identity, empty, pool, [
      { repositoryGithubId: "7508411", identifier: "8357", mergedAt: "invalid" },
    ])).rejects.toThrow();
    expect((await pool.query("SELECT public_synced_at FROM contributors WHERE github_id=$1", [githubId])).rows[0]).toEqual(before);
    expect((await pool.query("SELECT merged_at FROM contributor_public_activities")).rows[0].merged_at).toBeNull();
  });
});
