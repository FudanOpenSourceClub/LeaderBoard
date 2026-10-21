export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contributors ADD COLUMN public_sync_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_public_activities
      ADD COLUMN id BIGSERIAL,
      ADD COLUMN repository_github_id BIGINT,
      ADD COLUMN object_github_id BIGINT,
      ADD COLUMN merged_at TIMESTAMPTZ,
      ADD COLUMN first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE contributor_public_activities DROP CONSTRAINT contributor_public_activities_pkey;
    ALTER TABLE contributor_public_activities ADD PRIMARY KEY (id);
    ALTER TABLE contributor_public_activities ADD CONSTRAINT contributor_activity_stable_identity
      UNIQUE (contributor_id, kind, repository_github_id, identifier);
    CREATE UNIQUE INDEX contributor_activity_legacy_identity ON contributor_public_activities
      (contributor_id, kind, lower(repository), identifier) WHERE repository_github_id IS NULL;

    CREATE TABLE scoring_repositories (
      github_id BIGINT PRIMARY KEY, full_name TEXT NOT NULL, html_url TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE members
      ADD COLUMN student_fingerprint TEXT UNIQUE CHECK (student_fingerprint IS NULL OR length(student_fingerprint)=64),
      ADD COLUMN registration_github_id BIGINT UNIQUE,
      ADD COLUMN registration_session_hash TEXT UNIQUE,
      ADD COLUMN registration_session_expires_at TIMESTAMPTZ;
    ALTER TABLE email_verification_challenges
      ADD COLUMN student_fingerprint TEXT,
      ADD COLUMN requested_github_id BIGINT,
      ADD COLUMN requested_github_login TEXT;
    CREATE UNIQUE INDEX member_single_github_account_idx ON member_github_accounts (member_id);
  `);
};
