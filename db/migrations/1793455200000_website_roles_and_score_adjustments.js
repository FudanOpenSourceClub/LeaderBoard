export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE website_roles (
      github_id BIGINT PRIMARY KEY CHECK (github_id > 0), login TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner','admin')),
      granted_by BIGINT NOT NULL, granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      revoked_at TIMESTAMPTZ, revoked_by BIGINT, reason TEXT NOT NULL CHECK (length(trim(reason)) >= 5)
    );
    CREATE TABLE website_admin_audit (
      id BIGSERIAL PRIMARY KEY, actor_github_id BIGINT NOT NULL, actor_login TEXT NOT NULL,
      target_github_id BIGINT NOT NULL, target_login TEXT NOT NULL,
      action TEXT NOT NULL, reason TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE contributor_score_adjustments (
      id BIGSERIAL PRIMARY KEY, contributor_id BIGINT NOT NULL REFERENCES contributors(id),
      delta INTEGER NOT NULL CHECK (delta <> 0 AND delta BETWEEN -100000 AND 100000),
      reason TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
      actor_github_id BIGINT NOT NULL, actor_login TEXT NOT NULL,
      request_id UUID NOT NULL UNIQUE, reverses_id BIGINT UNIQUE REFERENCES contributor_score_adjustments(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX score_adjustment_contributor_time_idx ON contributor_score_adjustments(contributor_id,created_at);
    CREATE INDEX website_admin_audit_time_idx ON website_admin_audit(created_at DESC);
  `);
};
