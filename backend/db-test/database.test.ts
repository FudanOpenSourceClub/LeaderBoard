import {readdirSync} from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { runner } from "node-pg-migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDbPool, withTransaction } from "../src/db/index.js";

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL is required for database integration tests");

const schema = `leadboard_test_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(baseUrl);
testUrl.searchParams.set("options", `-c search_path=${schema}`);
const adminPool = new pg.Pool({ connectionString: baseUrl });
const migrationsDir = resolve(fileURLToPath(new URL("../../db/migrations/", import.meta.url)));
let schemaCreated = false;

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  process.env.DATABASE_URL = testUrl.toString();
});

afterAll(async () => {
  try {
    if (schemaCreated) {
      await getDbPool().end();
      process.env.DATABASE_URL = baseUrl;
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  } finally {
    await adminPool.end();
  }
});

async function runMigration() {
  await runner({
    databaseUrl: testUrl.toString(),
    dir: migrationsDir,
    direction: "up",
    migrationsTable: "pgmigrations",
    migrationsSchema: schema,
    schema,
    count: Infinity,
  });
}

describe("PostgreSQL schema and transaction integration", () => {
  it("creates the application schema including Outstanding reviews", async () => {
    await runMigration();
    const first = await getDbPool().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [schema],
    );
    expect(first.rows.map(row => row.table_name).sort()).toEqual([
      "commits", "contributors", "groups", "issues", "pull_requests", "repositories", "sync_runs", "pgmigrations",
      "members", "email_verification_challenges", "github_accounts", "member_github_accounts", "github_oauth_states", "project_proposals",
      "contributor_public_activities", "scoring_repositories", "contributor_score_awards", "website_sessions", "website_login_states",
      "campus_projects", "project_notification_outbox", "repository_star_counts", "website_roles", "website_admin_audit", "contributor_score_adjustments",
      "contribution_tags", "project_submission_awards", "outstanding_applications",
    ].sort());
  });

  it("succeeds on a second migration without duplicating it", async () => {
    await runMigration();
    const second = await getDbPool().query<{ count: string }>("SELECT count(*) AS count FROM pgmigrations");
    expect(Number(second.rows[0]?.count)).toBe(readdirSync(migrationsDir).filter(name=>/^\d+.*\.js$/.test(name)).length);
  });

  it.each([
    ["groups", "created_at"], ["groups", "updated_at"],
    ["repositories", "created_at"], ["repositories", "updated_at"],
    ["contributors", "created_at"], ["contributors", "updated_at"],
    ["commits", "created_at"], ["pull_requests", "ingested_at"],
    ["issues", "ingested_at"], ["sync_runs", "created_at"],
  ])("defines %s.%s as TIMESTAMPTZ NOT NULL DEFAULT now()", async (table, column) => {
    const result = await getDbPool().query<{
      data_type: string; is_nullable: string; column_default: string | null;
    }>(`SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`, [schema, table, column]);
    expect(result.rows).toEqual([{
      data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()",
    }]);
  });

  it.each([
    ["commits", "sha, authored_at", "'orphan', now()"],
    ["pull_requests", "github_id, number, state, created_at", "1, 1, 'open', now()"],
    ["issues", "github_id, number, state, created_at", "1, 1, 'open', now()"],
  ])("rejects %s with NULL repository_id", async (table, columns, values) => {
    await expect(getDbPool().query(
      `INSERT INTO ${table} (repository_id, ${columns}) VALUES (NULL, ${values})`,
    )).rejects.toMatchObject({ code: "23502" });
  });

  it("uses the sync run created_at default on insert", async () => {
    const result = await getDbPool().query<{ created_at: Date }>(`INSERT INTO sync_runs
      (trigger, range_from, range_to, started_at, status)
      VALUES ('manual', now(), now(), now(), 'success') RETURNING created_at`);
    expect(result.rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it("commits successful work and keeps BIGINT IDs as strings", async () => {
    const name = `commit-${randomUUID()}`;
    const id = await withTransaction(async client => {
      const inserted = await client.query<{ id: string }>("INSERT INTO groups (name) VALUES ($1) RETURNING id", [name]);
      return inserted.rows[0]?.id;
    });
    expect(typeof id).toBe("string");
    const result = await getDbPool().query("SELECT name FROM groups WHERE id = $1", [id]);
    expect(result.rows[0]?.name).toBe(name);
  });

  it("rolls back failed work", async () => {
    const name = `rollback-${randomUUID()}`;
    await expect(withTransaction(async client => {
      await client.query("INSERT INTO groups (name) VALUES ($1)", [name]);
      throw new Error("fixture failure");
    })).rejects.toThrow("fixture failure");
    const result = await getDbPool().query("SELECT id FROM groups WHERE name = $1", [name]);
    expect(result.rows).toHaveLength(0);
  });

  it.each([
    ["commits", "sha", "abc123", "authored_at", "now()", "created_at"],
    ["pull_requests", "github_id", "987654321", "number, state, created_at", "1, 'open', now()", "ingested_at"],
    ["issues", "github_id", "987654321", "number, state, created_at", "1, 'open', now()", "ingested_at"],
  ] as const)("rejects duplicate %s identity", async (table, key, value, extraColumns, extraValues, auditColumn) => {
    const githubId = Math.floor(Math.random() * 1000000000);
    const repo = await getDbPool().query<{ id: string }>(`INSERT INTO repositories
      (github_id, node_id, owner, name, full_name, default_branch, html_url)
      VALUES ($1, $2, 'owner', 'repo', 'owner/repo', 'main', 'https://example.test/repo') RETURNING id`, [githubId, `node-${randomUUID()}`]);
    const repoId = repo.rows[0]?.id;
    const sql = `INSERT INTO ${table} (repository_id, ${key}, ${extraColumns}) VALUES ($1, $2, ${extraValues})`;
    const inserted = await getDbPool().query(`${sql} RETURNING ${auditColumn}`, [repoId, value]);
    expect(inserted.rows[0]?.[auditColumn]).toBeInstanceOf(Date);
    await expect(getDbPool().query(sql, [repoId, value])).rejects.toMatchObject({ code: "23505" });
  });
});
