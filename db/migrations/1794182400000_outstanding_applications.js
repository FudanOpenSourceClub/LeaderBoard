export const up = pgm => pgm.sql(`
  CREATE TABLE outstanding_applications (
    id BIGSERIAL PRIMARY KEY,
    contributor_id BIGINT NOT NULL REFERENCES contributors(id),
    category TEXT NOT NULL CHECK(category IN ('contributor','committer','maintainer')),
    repository TEXT NOT NULL,
    evidence_urls JSONB NOT NULL,
    reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 1000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    reviewed_at TIMESTAMPTZ, reviewer_github_id BIGINT, reviewer_login TEXT,
    review_note TEXT NOT NULL DEFAULT '', tag_id BIGINT UNIQUE REFERENCES contribution_tags(id),
    CHECK((status='pending' AND reviewed_at IS NULL AND reviewer_github_id IS NULL AND reviewer_login IS NULL AND tag_id IS NULL)
      OR (status='approved' AND reviewed_at IS NOT NULL AND reviewer_github_id IS NOT NULL AND reviewer_login IS NOT NULL AND tag_id IS NOT NULL)
      OR (status='rejected' AND reviewed_at IS NOT NULL AND reviewer_github_id IS NOT NULL AND reviewer_login IS NOT NULL AND tag_id IS NULL AND length(trim(review_note))>=5))
  );
  CREATE UNIQUE INDEX outstanding_application_pending_idx ON outstanding_applications(contributor_id,category,lower(repository)) WHERE status='pending';
  CREATE INDEX outstanding_application_queue_idx ON outstanding_applications(status,created_at);
`);
