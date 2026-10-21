import {
  ContributorDetailSchema,
  ContributorRankSchema,
  GroupSummarySchema,
  OrganizationActivitySummarySchema,
  RepositoryStatSchema,
  type ContributorDetail,
  type ContributorRank,
  type GroupSummary,
  type LeaderboardQuery,
  type OrganizationActivitySummary,
  type RepositoryStat,
  type TimeRange,
} from "@leadboard/contracts";
import type { Pool } from "pg";
import { getDbPool } from "../db/index.js";

type Clock = () => Date;

function safeNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Database count is outside JavaScript safe integer range");
  return number;
}

function rangeBounds(range: TimeRange, now: Date): { from: string | null; to: string } {
  const to = now.toISOString();
  if (range === "all") return { from: null, to };
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to };
}

const TRACKED_EVENTS_SQL = `
    SELECT r.id AS repository_id, r.github_id::text AS github_id, r.full_name,
           g.name AS group_name, c.contributor_id, 'commit'::text AS kind, c.authored_at AS occurred_at,
           c.sha AS identifier
    FROM commits c
    JOIN repositories r ON r.id = c.repository_id AND r.tracked = TRUE
    LEFT JOIN groups g ON g.id = r.group_id
    UNION ALL
    SELECT r.id, r.github_id::text, r.full_name, g.name, p.contributor_id, 'pull_request', p.created_at, p.number::text
    FROM pull_requests p
    JOIN repositories r ON r.id = p.repository_id AND r.tracked = TRUE
    LEFT JOIN groups g ON g.id = r.group_id
    UNION ALL
    SELECT r.id, r.github_id::text, r.full_name, g.name, i.contributor_id, 'issue', i.created_at, i.number::text
    FROM issues i
    JOIN repositories r ON r.id = i.repository_id AND r.tracked = TRUE
    LEFT JOIN groups g ON g.id = r.group_id
`;
const FILTERED_EVENTS_SQL = `
  filtered AS (
    SELECT * FROM events
    WHERE ($1::timestamptz IS NULL OR occurred_at >= $1::timestamptz)
      AND occurred_at < $2::timestamptz
  )
`;
const EVENTS_CTE = `WITH events AS (${TRACKED_EVENTS_SQL}), ${FILTERED_EVENTS_SQL}`;

// Individual public activity belongs to the contributor board. Keep project /
// organization aggregates scoped to their existing tracked repositories.
const CONTRIBUTOR_EVENTS_CTE = `
  WITH tracked_events AS (${TRACKED_EVENTS_SQL}),
  events AS (
    SELECT * FROM tracked_events
    UNION ALL
    SELECT r.id, r.github_id::text, a.repository,
           coalesce(g.name, '个人开源贡献'), a.contributor_id, a.kind, a.occurred_at, a.identifier
    FROM contributor_public_activities a
    JOIN contributors con ON con.id=a.contributor_id AND con.enrolled_at IS NOT NULL
    LEFT JOIN repositories r ON lower(r.full_name)=lower(a.repository) AND r.tracked=TRUE
    LEFT JOIN groups g ON g.id=r.group_id
    WHERE NOT EXISTS (
      SELECT 1 FROM tracked_events t
      WHERE t.contributor_id=a.contributor_id AND t.kind=a.kind
        AND lower(t.full_name)=lower(a.repository) AND t.identifier=a.identifier
    )
  ), ${FILTERED_EVENTS_SQL}
`;

export class AnalyticsService {
  constructor(
    private readonly pool: Pool = getDbPool(),
    private readonly clock: Clock = () => new Date(),
  ) {}

  async getGroups(): Promise<GroupSummary[]> {
    const result = await this.pool.query<{ name: string }>(
      `SELECT DISTINCT g.name
       FROM groups g JOIN repositories r ON r.group_id = g.id
       WHERE r.tracked = TRUE
       UNION
       SELECT '个人开源贡献' AS name
       WHERE EXISTS (
         SELECT 1 FROM contributor_public_activities a
         JOIN contributors c ON c.id=a.contributor_id
         WHERE c.enrolled_at IS NOT NULL AND c.is_bot=FALSE
       )
       ORDER BY name ASC`,
    );
    return result.rows.map((row) => GroupSummarySchema.parse(row));
  }

  async getOrganizationActivitySummary(range: TimeRange): Promise<OrganizationActivitySummary> {
    const bounds = rangeBounds(range, this.clock());
    const result = await this.pool.query<{
      repositories: string; contributors: string; commits: string; prs: string; issues: string; total: string;
    }>(
      EVENTS_CTE + `
      SELECT
        (SELECT count(*) FROM repositories WHERE tracked = TRUE) AS repositories,
        count(DISTINCT f.contributor_id) FILTER (
          WHERE f.contributor_id IS NOT NULL AND coalesce(con.is_bot, FALSE) = FALSE
        ) AS contributors,
        count(*) FILTER (WHERE f.kind = 'commit') AS commits,
        count(*) FILTER (WHERE f.kind = 'pull_request') AS prs,
        count(*) FILTER (WHERE f.kind = 'issue') AS issues,
        count(*) AS total
      FROM filtered f
      LEFT JOIN contributors con ON con.id = f.contributor_id`,
      [bounds.from, bounds.to],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Organization aggregate query returned no row");
    return OrganizationActivitySummarySchema.parse({
      range,
      repositories: safeNumber(row.repositories),
      contributors: safeNumber(row.contributors),
      commits: safeNumber(row.commits),
      prs: safeNumber(row.prs),
      issues: safeNumber(row.issues),
      total: safeNumber(row.total),
    });
  }

  async getRepositoryStats(range: TimeRange, group?: string): Promise<RepositoryStat[]> {
    const bounds = rangeBounds(range, this.clock());
    const result = await this.pool.query<{
      github_id: string; full_name: string; group_name: string;
      commits: string; prs: string; issues: string; contributors: string; total: string;
    }>(
      EVENTS_CTE + `
      SELECT r.github_id::text AS github_id, r.full_name, g.name AS group_name,
        count(f.repository_id) FILTER (WHERE f.kind = 'commit') AS commits,
        count(f.repository_id) FILTER (WHERE f.kind = 'pull_request') AS prs,
        count(f.repository_id) FILTER (WHERE f.kind = 'issue') AS issues,
        count(DISTINCT f.contributor_id) FILTER (
          WHERE f.contributor_id IS NOT NULL AND coalesce(con.is_bot, FALSE) = FALSE
        ) AS contributors,
        count(f.repository_id) AS total
      FROM repositories r
      LEFT JOIN groups g ON g.id = r.group_id
      LEFT JOIN filtered f ON f.repository_id = r.id
      LEFT JOIN contributors con ON con.id = f.contributor_id
      WHERE r.tracked = TRUE AND ($3::text IS NULL OR g.name = $3)
      GROUP BY r.id, r.github_id, r.full_name, g.name
      ORDER BY r.full_name ASC`,
      [bounds.from, bounds.to, group ?? null],
    );
    return result.rows.map((row) => RepositoryStatSchema.parse({
      githubId: row.github_id,
      fullName: row.full_name,
      group: row.group_name,
      commits: safeNumber(row.commits),
      prs: safeNumber(row.prs),
      issues: safeNumber(row.issues),
      contributors: safeNumber(row.contributors),
      total: safeNumber(row.total),
    }));
  }

  async getContributorLeaderboard(input: LeaderboardQuery): Promise<ContributorRank[]> {
    const bounds = rangeBounds(input.range, this.clock());
    const result = await this.pool.query<{
      login: string; avatar_url: string | null; commits: string; prs: string; issues: string; total: string;
    }>(
      CONTRIBUTOR_EVENTS_CTE + `
      SELECT con.login, con.avatar_url,
        count(f.kind) FILTER (WHERE f.kind = 'commit') AS commits,
        count(f.kind) FILTER (WHERE f.kind = 'pull_request') AS prs,
        count(f.kind) FILTER (WHERE f.kind = 'issue') AS issues,
        count(f.kind) AS total
      FROM contributors con
      LEFT JOIN filtered f ON con.id = f.contributor_id
        AND ($3::text IS NULL OR f.group_name = $3)
      WHERE con.is_bot = FALSE AND con.login IS NOT NULL
        AND (f.contributor_id IS NOT NULL OR (con.enrolled_at IS NOT NULL AND $3::text IS NULL))
      GROUP BY con.id, con.login, con.avatar_url`,
      [bounds.from, bounds.to, input.group ?? null],
    );

    const rows = result.rows.map((row) => ({
      login: row.login,
      avatarUrl: row.avatar_url,
      commits: safeNumber(row.commits),
      prs: safeNumber(row.prs),
      issues: safeNumber(row.issues),
      total: safeNumber(row.total),
    }));
    rows.sort((a, b) => b[input.metric] - a[input.metric] || a.login.localeCompare(b.login));
    return rows.slice(0, input.limit).map((row, index) =>
      ContributorRankSchema.parse({ rank: index + 1, ...row }),
    );
  }

  async getContributorDetail(username: string, range: TimeRange): Promise<ContributorDetail | null> {
    const contributor = await this.pool.query<{ id: string; login: string; avatar_url: string | null; enrolled_at: Date | null }>(
      `SELECT id, login, avatar_url, enrolled_at FROM contributors
       WHERE lower(login) = lower($1) AND is_bot = FALSE
       ORDER BY updated_at DESC, id ASC LIMIT 1`,
      [username],
    );
    const actor = contributor.rows[0];
    if (!actor) return null;

    const bounds = rangeBounds(range, this.clock());
    const result = await this.pool.query<{
      github_id: string | null; full_name: string; group_name: string;
      commits: string; prs: string; issues: string; total: string;
    }>(
      CONTRIBUTOR_EVENTS_CTE + `
      SELECT f.github_id, f.full_name, f.group_name,
        count(*) FILTER (WHERE f.kind = 'commit') AS commits,
        count(*) FILTER (WHERE f.kind = 'pull_request') AS prs,
        count(*) FILTER (WHERE f.kind = 'issue') AS issues,
        count(*) AS total
      FROM filtered f WHERE f.contributor_id=$3
      GROUP BY f.github_id, f.full_name, f.group_name
      ORDER BY f.full_name ASC`,
      [bounds.from, bounds.to, actor.id],
    );

    const repositories = result.rows.map((row) => ({
      githubId: row.github_id,
      fullName: row.full_name,
      group: row.group_name,
      commits: safeNumber(row.commits),
      prs: safeNumber(row.prs),
      issues: safeNumber(row.issues),
      total: safeNumber(row.total),
    }));
    if (repositories.length === 0 && actor.enrolled_at === null) return null;
    const commits = repositories.reduce((sum, row) => sum + row.commits, 0);
    const prs = repositories.reduce((sum, row) => sum + row.prs, 0);
    const issues = repositories.reduce((sum, row) => sum + row.issues, 0);

    return ContributorDetailSchema.parse({
      login: actor.login,
      avatarUrl: actor.avatar_url,
      range,
      commits,
      prs,
      issues,
      total: commits + prs + issues,
      repositories,
    });
  }
}

const defaultService = () => new AnalyticsService();

export async function getGroups(): Promise<GroupSummary[]> {
  return defaultService().getGroups();
}
export async function getOrganizationActivitySummary(range: TimeRange): Promise<OrganizationActivitySummary> {
  return defaultService().getOrganizationActivitySummary(range);
}
export async function getRepositoryStats(range: TimeRange, group?: string): Promise<RepositoryStat[]> {
  return defaultService().getRepositoryStats(range, group);
}
export async function getContributorLeaderboard(input: LeaderboardQuery): Promise<ContributorRank[]> {
  return defaultService().getContributorLeaderboard(input);
}
export async function getContributorDetail(username: string, range: TimeRange): Promise<ContributorDetail | null> {
  return defaultService().getContributorDetail(username, range);
}
