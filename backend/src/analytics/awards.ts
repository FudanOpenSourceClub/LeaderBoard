import type { Pool } from "pg";

/** Awards have their own ledger; never fabricate a Commit, PR or Issue. */
export async function getContributorAwards(pool: Pool, from: string | null, to: string): Promise<Map<string, number>> {
  const result = await pool.query<{ contributor_id: string; points: string }>(
    `SELECT a.contributor_id::text, sum(a.points)::text AS points
     FROM contributor_score_awards a JOIN contributors c ON c.id=a.contributor_id
     WHERE c.is_bot=FALSE AND ($1::timestamptz IS NULL OR a.awarded_at >= $1::timestamptz)
       AND a.awarded_at < $2::timestamptz
     GROUP BY a.contributor_id`, [from, to],
  );
  return new Map(result.rows.map(row => {
    const points = Number(row.points);
    if (!Number.isSafeInteger(points) || points < 0) throw new Error("Invalid contributor award total");
    return [row.contributor_id, points];
  }));
}
