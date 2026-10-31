import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const timestamp = "timestamp with time zone";
const required = (type, defaultValue = null) => ({ type, nullable: false, defaultValue });
const optional = (type) => ({ type, nullable: true, defaultValue: null });
const id = () => required("bigint", "serial");

// Expected columns, nullability and defaults come from docs/data-model.md.
const tables = {
  website_roles: {github_id:required("bigint"),login:required("text"),role:required("text"),granted_by:required("bigint"),granted_at:required(timestamp,"clock_timestamp()"),revoked_at:optional(timestamp),revoked_by:optional("bigint"),reason:required("text")},
  website_admin_audit: {id:id(),actor_github_id:required("bigint"),actor_login:required("text"),target_github_id:required("bigint"),target_login:required("text"),action:required("text"),reason:required("text"),details:required("jsonb","'{}'::jsonb"),created_at:required(timestamp,"clock_timestamp()")},
  contributor_score_adjustments: {id:id(),contributor_id:required("bigint"),delta:required("integer"),reason:required("text"),actor_github_id:required("bigint"),actor_login:required("text"),request_id:required("uuid"),reverses_id:optional("bigint"),created_at:required(timestamp,"clock_timestamp()")},
  groups: {
    id: id(), name: required("text"),
    created_at: required(timestamp, "now()"), updated_at: required(timestamp, "now()"),
  },
  repositories: {
    id: id(), github_id: required("bigint"), node_id: required("text"),
    owner: required("text"), name: required("text"), full_name: required("text"),
    default_branch: required("text"), group_id: optional("bigint"),
    html_url: required("text"), archived: required("boolean", "false"),
    tracked: required("boolean", "true"), last_synced_at: optional(timestamp),
    created_at: required(timestamp, "now()"), updated_at: required(timestamp, "now()"),
  },
  contributors: {
    id: id(), github_id: optional("bigint"), login: optional("text"), avatar_url: optional("text"),
    actor_type: required("text", "'Unknown'::text"), is_bot: required("boolean", "false"),
    enrolled_at: optional(timestamp), public_synced_at: optional(timestamp),
    public_sync_version: required("integer", "0"),
    public_sync_truncated: required("boolean", "false"), public_sync_incomplete: required("boolean", "false"),
    created_at: required(timestamp, "now()"), updated_at: required(timestamp, "now()"),
  },
  contributor_score_awards: {
    contributor_id: required("bigint"), award_key: required("text"), points: required("integer"),
    reason: required("text"), awarded_at: required(timestamp,"now()"),
  },
  scoring_repositories: {github_id:required("bigint"),full_name:required("text"),html_url:required("text"),enabled:required("boolean","false"),updated_at:required(timestamp,"now()")},
  repository_star_counts: {github_id:required("bigint"),stars:optional("integer"),checked_at:required(timestamp,"now()")},
  contributor_public_activities: {
    id:id(),repository_github_id:optional("bigint"),object_github_id:optional("bigint"),merged_at:optional(timestamp),
    first_seen_at:required(timestamp,"now()"),last_seen_at:required(timestamp,"now()"),
    contributor_id: required("bigint"), kind: required("text"), repository: required("text"),
    identifier: required("text"), occurred_at: required(timestamp), title: required("text"), html_url: required("text"),
  },
  commits: {
    id: id(), repository_id: required("bigint"), sha: required("text"),
    contributor_id: optional("bigint"), authored_at: required(timestamp),
    additions: required("integer", "0"), deletions: required("integer", "0"),
    is_merge: required("boolean", "false"), html_url: optional("text"),
    created_at: required(timestamp, "now()"),
  },
  pull_requests: {
    id: id(), repository_id: required("bigint"), github_id: required("bigint"),
    number: required("integer"), contributor_id: optional("bigint"), state: required("text"),
    created_at: required(timestamp), closed_at: optional(timestamp), merged_at: optional(timestamp),
    html_url: optional("text"), ingested_at: required(timestamp, "now()"),
  },
  issues: {
    id: id(), repository_id: required("bigint"), github_id: required("bigint"),
    number: required("integer"), contributor_id: optional("bigint"), state: required("text"),
    created_at: required(timestamp), closed_at: optional(timestamp), html_url: optional("text"),
    ingested_at: required(timestamp, "now()"),
  },
  sync_runs: {
    id: id(), trigger: required("text"), range_from: required(timestamp), range_to: required(timestamp),
    started_at: required(timestamp), finished_at: optional(timestamp), status: required("text"),
    repositories_ok: required("integer", "0"), repositories_failed: required("integer", "0"),
    error_message: optional("text"), created_at: required(timestamp, "now()"),
  },
  members: {
    student_fingerprint:optional("text"),registration_github_id:optional("bigint"),
    registration_session_hash:optional("text"),registration_session_expires_at:optional(timestamp),
    id: id(), email_fingerprint: required("text"), email_domain: required("text"),
    verification_status: required("text", "'verified'::text"), verified_at: required(timestamp),
    last_reverified_at: required(timestamp), created_at: required(timestamp, "now()"),
    updated_at: required(timestamp, "now()"),
  },
  email_verification_challenges: {
    student_fingerprint:optional("text"),requested_github_id:optional("bigint"),requested_github_login:optional("text"),
    id: id(), email_fingerprint: required("text"), email_domain: required("text"),
    requester_ip_fingerprint: required("text"), code_hash: required("text"), code_salt: required("text"),
    expires_at: required(timestamp), attempt_count: required("integer", "0"), used_at: optional(timestamp),
    delivery_status: required("text", "'pending'::text"), sent_at: optional(timestamp),
    created_at: required(timestamp, "now()"),
  },
  github_accounts: {
    github_id: required("bigint"), login: required("text"), avatar_url: optional("text"),
    created_at: required(timestamp, "now()"), updated_at: required(timestamp, "now()"),
  },
  member_github_accounts: {
    member_id: required("bigint"), github_id: required("bigint"),
    linked_at: required(timestamp, "now()"), is_primary: required("boolean", "false"),
  },
  github_oauth_states: {
    id: id(), member_id: required("bigint"), state_hash: required("text"),
    expires_at: required(timestamp), used_at: optional(timestamp),
    created_at: required(timestamp, "now()"),
  },
  website_sessions: {token_hash:required("text"),github_id:required("bigint"),login:required("text"),csrf_token:required("text"),expires_at:required(timestamp),created_at:required(timestamp,"now()")},
  website_login_states: {state_hash:required("text"),browser_hash:required("text"),return_path:required("text"),expires_at:required(timestamp),used_at:optional(timestamp),created_at:required(timestamp,"now()")},
  campus_projects: {id:id(),repository_github_id:required("bigint"),full_name:required("text"),name:required("text"),html_url:required("text"),lab_name:required("text"),lab_url:optional("text"),description:required("text"),tags:required("ARRAY","'{}'::text[]"),proposal_id:optional("bigint"),created_at:required(timestamp,"now()")},
  project_notification_outbox: {id:id(),proposal_id:required("bigint"),attempt_count:required("integer","0"),sent_at:optional(timestamp),next_attempt_at:required(timestamp,"now()"),lease_until:optional(timestamp),last_error:optional("text"),created_at:required(timestamp,"now()")},
  project_proposals: {
    member_id:optional("bigint"),repository_github_id:optional("bigint"),reviewed_by:optional("bigint"),reviewed_at:optional(timestamp),review_notes:required("text","''::text"),
    id: id(), project_url: required("text"), lab_name: required("text"), notes: required("text"),
    status: required("text", "'pending'::text"),
    created_at: required(timestamp, "now()"), updated_at: required(timestamp, "now()"),
  },
};

const foreignKeys = [
  ["contributor_score_adjustments","contributor_id","contributors","id"],
  ["contributor_score_adjustments","reverses_id","contributor_score_adjustments","id"],
  ["project_proposals","member_id","members","id"],
  ["campus_projects","proposal_id","project_proposals","id"],
  ["project_notification_outbox","proposal_id","project_proposals","id"],
  ["contributor_score_awards", "contributor_id", "contributors", "id"],
  ["repositories", "group_id", "groups", "id"],
  ["commits", "repository_id", "repositories", "id"],
  ["commits", "contributor_id", "contributors", "id"],
  ["pull_requests", "repository_id", "repositories", "id"],
  ["pull_requests", "contributor_id", "contributors", "id"],
  ["issues", "repository_id", "repositories", "id"],
  ["issues", "contributor_id", "contributors", "id"],
  ["member_github_accounts", "member_id", "members", "id"],
  ["member_github_accounts", "github_id", "github_accounts", "github_id"],
  ["github_oauth_states", "member_id", "members", "id"],
  ["contributor_public_activities", "contributor_id", "contributors", "id"],
];
const uniques = [
  ["contributor_score_adjustments","request_id"],["contributor_score_adjustments","reverses_id"],
  ["campus_projects","repository_github_id"],["campus_projects","html_url"],["campus_projects","proposal_id"],
  ["project_notification_outbox","proposal_id"],
  ["groups", "name"], ["repositories", "github_id"], ["repositories", "node_id"],
  ["contributors", "github_id"], ["commits", "repository_id", "sha"],
  ["pull_requests", "repository_id", "github_id"], ["issues", "repository_id", "github_id"],
  ["members", "student_fingerprint"], ["members", "registration_github_id"], ["members", "registration_session_hash"],
  ["contributor_public_activities", "contributor_id", "kind", "repository_github_id", "identifier"],
  ["members", "email_fingerprint"], ["github_oauth_states", "state_hash"],
];
const indexes = {
  score_adjustment_contributor_time_idx:["contributor_score_adjustments","contributor_id","created_at"],
  member_single_github_account_idx:["member_github_accounts","member_id"],
  repositories_tracked_idx: ["repositories", "tracked"],
  repositories_group_id_idx: ["repositories", "group_id"],
  commits_authored_at_idx: ["commits", "authored_at"],
  commits_repository_time_idx: ["commits", "repository_id", "authored_at"],
  commits_contributor_time_idx: ["commits", "contributor_id", "authored_at"],
  prs_created_at_idx: ["pull_requests", "created_at"],
  prs_repository_time_idx: ["pull_requests", "repository_id", "created_at"],
  prs_contributor_time_idx: ["pull_requests", "contributor_id", "created_at"],
  issues_created_at_idx: ["issues", "created_at"],
  issues_repository_time_idx: ["issues", "repository_id", "created_at"],
  issues_contributor_time_idx: ["issues", "contributor_id", "created_at"],
  sync_runs_status_finished_idx: ["sync_runs", "status", "finished_at"],
  email_verification_email_time_idx: ["email_verification_challenges", "email_fingerprint", "created_at"],
  email_verification_ip_time_idx: ["email_verification_challenges", "requester_ip_fingerprint", "created_at"],
  member_github_primary_idx: ["member_github_accounts", "member_id"],
  member_github_account_owner_idx: ["member_github_accounts", "github_id"],
  github_oauth_states_member_time_idx: ["github_oauth_states", "member_id", "created_at"],
  project_proposals_status_time_idx: ["project_proposals", "status", "created_at"],
  contributor_public_activities_time_idx: ["contributor_public_activities", "contributor_id", "occurred_at"],
};

const primaryKeys = {
  website_roles:["github_id"],website_admin_audit:["id"],contributor_score_adjustments:["id"],
  website_sessions:["token_hash"],website_login_states:["state_hash"],campus_projects:["id"],project_notification_outbox:["id"],
  groups: ["id"],
  repositories: ["id"],
  contributors: ["id"],
  contributor_score_awards: ["contributor_id", "award_key"],
  scoring_repositories:["github_id"],
  repository_star_counts:["github_id"],
  contributor_public_activities: ["id"],
  commits: ["id"],
  pull_requests: ["id"],
  issues: ["id"],
  sync_runs: ["id"],
  members: ["id"],
  email_verification_challenges: ["id"],
  github_accounts: ["github_id"],
  member_github_accounts: ["member_id", "github_id"],
  github_oauth_states: ["id"],
  project_proposals: ["id"],
};

const pool = new pg.Pool({ connectionString: databaseUrl });
const problems = [];
try {
  const columns = (await pool.query(`SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = current_schema()`)).rows;
  const foundColumns = new Map(columns.map(row => [`${row.table_name}.${row.column_name}`, row]));
  for (const [table, expectedColumns] of Object.entries(tables)) {
    const tableExists = await pool.query(`SELECT to_regclass(format('%I.%I', current_schema(), $1::text)) AS name`, [table]);
    if (!tableExists.rows[0].name) problems.push(`missing table ${table}`);
    for (const [column, expected] of Object.entries(expectedColumns)) {
      const actual = foundColumns.get(`${table}.${column}`);
      if (!actual) problems.push(`missing column ${table}.${column}`);
      else {
        if (actual.data_type !== expected.type) problems.push(`wrong type ${table}.${column}: ${actual.data_type}`);
        if ((actual.is_nullable === "YES") !== expected.nullable) problems.push(`wrong nullability ${table}.${column}: ${actual.is_nullable}`);
        const defaultMatches = expected.defaultValue === "serial"
          ? actual.column_default?.startsWith("nextval(") && actual.column_default.includes(`${table}_id_seq`)
          : actual.column_default === expected.defaultValue;
        if (!defaultMatches) problems.push(`wrong default ${table}.${column}: ${actual.column_default ?? "NULL"}`);
      }
    }
    for (const actual of columns.filter(row => row.table_name === table)) {
      if (!(actual.column_name in expectedColumns)) problems.push(`unexpected column ${table}.${actual.column_name}`);
    }
  }

  const constraints = (await pool.query(`SELECT c.contype, c.conrelid::regclass::text AS table_name,
      c.confrelid::regclass::text AS referenced_table,
      ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord)::text[] AS columns,
      ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord)::text[] AS referenced_columns
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = current_schema()`)).rows;
  for (const [table, column, target, targetColumn] of foreignKeys) {
    if (!constraints.some(c => c.contype === "f" && c.table_name === table && c.referenced_table === target && c.columns.join() === column && c.referenced_columns.join() === targetColumn)) problems.push(`missing FK ${table}.${column} -> ${target}.${targetColumn}`);
  }
  for (const [table, columns] of Object.entries(primaryKeys)) {
    if (!constraints.some(c => c.contype === "p" && c.table_name === table && c.columns.join() === columns.join())) {
      problems.push(`missing primary key ${table}(${columns.join(", ")})`);
    }
  }
  for (const [table, ...columns] of uniques) {
    if (!constraints.some(c => c.contype === "u" && c.table_name === table && c.columns.join() === columns.join())) problems.push(`missing UNIQUE ${table}(${columns.join(", ")})`);
  }

  const actualIndexes = (await pool.query(`SELECT t.relname AS table_name, i.relname AS index_name,
      pg_get_indexdef(x.indexrelid) AS definition,
      ARRAY(SELECT pg_get_indexdef(x.indexrelid, n, true) FROM generate_series(1, x.indnkeyatts) AS n ORDER BY n) AS columns
    FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace WHERE ns.nspname = current_schema()`)).rows;
  for (const [name, [table, ...columns]] of Object.entries(indexes)) {
    if (!actualIndexes.some(index => index.index_name === name && index.table_name === table && index.columns.join() === columns.join())) problems.push(`missing index ${name} on ${table}(${columns.join(", ")})`);
  }
  if (!actualIndexes.some(index => index.index_name === "sync_runs_status_finished_idx" && index.definition.includes("(status, finished_at DESC)"))) problems.push("sync_runs_status_finished_idx must sort finished_at DESC");
  if (!actualIndexes.some(index => index.index_name === "member_github_primary_idx" && /WHERE is_primary/.test(index.definition))) problems.push("member_github_primary_idx must be partial on is_primary");
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else console.info("Database schema verified: required tables, columns, foreign keys, unique constraints, and indexes.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
