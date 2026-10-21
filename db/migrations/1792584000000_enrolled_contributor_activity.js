/** @type {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contributors
      ADD COLUMN enrolled_at TIMESTAMPTZ,
      ADD COLUMN public_synced_at TIMESTAMPTZ,
      ADD COLUMN public_sync_truncated BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN public_sync_incomplete BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE contributor_public_activities (
      contributor_id BIGINT NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('commit', 'pull_request', 'issue')),
      repository TEXT NOT NULL,
      identifier TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      title TEXT NOT NULL,
      html_url TEXT NOT NULL,
      PRIMARY KEY (contributor_id, kind, repository, identifier)
    );
    CREATE INDEX contributor_public_activities_time_idx
      ON contributor_public_activities (contributor_id, occurred_at);
  `);
};
