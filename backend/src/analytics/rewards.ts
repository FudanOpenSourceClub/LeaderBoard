import type { Pool } from "pg";
import { OUTSTANDING_TAG_POINTS, type ContributionCategory } from "@leadboard/contracts";

/** Expiring labels count only while valid, and belong to the selected grant-time range. */
export async function getOutstandingScores(pool: Pick<Pool, "query">, from: string | null, to: string, group?: string) {
  const result = await pool.query<{ contributor_id: string; points: string }>(`
    SELECT t.contributor_id::text,(count(*) * $3::int)::text AS points
    FROM contribution_tags t JOIN contributors c ON c.id=t.contributor_id AND c.is_bot=FALSE
    WHERE t.revoked_at IS NULL AND t.created_at<$2::timestamptz AND t.expires_at>$2::timestamptz
      AND ($1::timestamptz IS NULL OR t.created_at >= $1::timestamptz)
      AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM repositories r JOIN groups g ON g.id=r.group_id
        WHERE lower(r.full_name)=lower(t.repository) AND g.name=$4))
    GROUP BY t.contributor_id`, [from, to, OUTSTANDING_TAG_POINTS, group ?? null]);
  return new Map(result.rows.map(r => [r.contributor_id, Number(r.points)]));
}

export async function getProjectSubmissionScores(pool: Pick<Pool, "query">, from: string | null, to: string) {
  const result = await pool.query<{ contributor_id: string; points: string }>(`
    SELECT a.contributor_id::text,sum(a.points)::text AS points FROM project_submission_awards a
    JOIN contributors c ON c.id=a.contributor_id AND c.is_bot=FALSE
    WHERE ($1::timestamptz IS NULL OR a.awarded_at >= $1::timestamptz) AND a.awarded_at<$2::timestamptz
    GROUP BY a.contributor_id`, [from, to]);
  return new Map(result.rows.map(r => [r.contributor_id, Number(r.points)]));
}

export const outstandingCategories: ContributionCategory[] = ["contributor", "committer", "maintainer"];
