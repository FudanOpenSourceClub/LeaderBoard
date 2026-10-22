import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDbPool } from "../src/db/index.js";
import { AnalyticsService } from "../src/analytics/index.js";
const { up } = await import(new URL("../../db/migrations/1792670400000_developer_awards.js", import.meta.url).href);

const pool = getDbPool();

beforeAll(async () => {
  await pool.query("TRUNCATE contributors RESTART IDENTITY CASCADE");
});
afterAll(async () => { await pool.end(); });

describe("developer enrollment and one-time awards", () => {
  it("seeds four real profiles and awards exactly 50 each even when replayed", async () => {
    let sql = "";
    up({ sql: (value: string) => { sql = value; } });
    // The table already exists after migration; replay the exact migration's data statements.
    const seed = sql.slice(sql.indexOf("INSERT INTO contributors"));
    await pool.query(seed);
    await pool.query(seed);
    const analytics = new AnalyticsService(pool, () => new Date(Date.now() + 10_000));
    const rows = await analytics.getContributorLeaderboard({range:"all",metric:"score",limit:10});
    expect(rows.map(row => row.login).sort()).toEqual(["Alpha-dev-code","Joseph2433","Linscon","swiftgorge5-eng"]);
    expect(rows.every(row => row.score===50 && row.bonusScore===50 && row.total===0)).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS count FROM contributor_score_awards")).rows[0].count).toBe(4);
    for (const row of rows) {
      await expect(analytics.getContributorDetail(row.login,"all"))
        .resolves.toMatchObject({score:50,bonusScore:50,commits:0,prs:0,issues:0});
    }
    // Administrative enrollment has not fabricated completed identity verification.
    expect((await pool.query(`SELECT count(*)::int AS count FROM member_github_accounts
      WHERE github_id IN (333234233,234397891,49949859,187583840)`)).rows[0].count).toBe(0);
  });

  it("honors award time and does not assign a global reward to a lab group", async () => {
    await pool.query("UPDATE contributor_score_awards SET awarded_at=now()-interval '40 days'");
    const analytics = new AnalyticsService(pool, () => new Date(Date.now()+10_000));
    const recent = await analytics.getContributorLeaderboard({range:"7d",metric:"score",limit:10});
    expect(recent.every(row=>row.score===0 && row.bonusScore===0)).toBe(true);
    expect(await analytics.getContributorLeaderboard({range:"all",metric:"score",group:"systems",limit:10})).toEqual([]);
    const historical = await analytics.getContributorDetail("Linscon","all");
    expect(historical?.score).toBe(50);
  });
});
