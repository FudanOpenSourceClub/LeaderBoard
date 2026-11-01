export const up=pgm=>pgm.sql(`
  CREATE TABLE contribution_tags(
    id BIGSERIAL PRIMARY KEY,contributor_id BIGINT NOT NULL REFERENCES contributors(id),
    category TEXT NOT NULL CHECK(category IN ('contributor','committer','maintainer')),
    repository TEXT NOT NULL,evidence_urls JSONB NOT NULL,reason TEXT NOT NULL CHECK(length(trim(reason))>=5),
    actor_github_id BIGINT NOT NULL,actor_login TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),revoked_at TIMESTAMPTZ,revoked_by BIGINT
  );
  CREATE UNIQUE INDEX contribution_tag_active_idx ON contribution_tags(contributor_id,category,lower(repository)) WHERE revoked_at IS NULL;
`);
