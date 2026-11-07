export const up = pgm => pgm.sql(`
  ALTER TABLE contribution_tags ADD COLUMN expires_at TIMESTAMPTZ
    GENERATED ALWAYS AS (((created_at AT TIME ZONE 'Asia/Shanghai') + interval '1 month') AT TIME ZONE 'Asia/Shanghai') STORED NOT NULL;
  DROP INDEX contribution_tag_active_idx;
  CREATE INDEX contribution_tag_lookup_idx ON contribution_tags(contributor_id,category,lower(repository),expires_at) WHERE revoked_at IS NULL;

  CREATE TABLE project_submission_awards (
    proposal_id BIGINT PRIMARY KEY REFERENCES project_proposals(id),
    repository_github_id BIGINT NOT NULL UNIQUE,
    contributor_id BIGINT NOT NULL REFERENCES contributors(id),
    points INTEGER NOT NULL DEFAULT 20 CHECK(points=20),
    awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX project_submission_award_time_idx ON project_submission_awards(contributor_id,awarded_at);

  INSERT INTO contributors(github_id,login,avatar_url,is_bot,enrolled_at)
    SELECT DISTINCT g.github_id,g.login,g.avatar_url,FALSE,now()
    FROM project_proposals p JOIN member_github_accounts a ON a.member_id=p.member_id AND a.is_primary=TRUE
    JOIN github_accounts g ON g.github_id=a.github_id
    WHERE p.status='approved' AND p.repository_github_id IS NOT NULL
    ON CONFLICT(github_id) DO NOTHING;
  INSERT INTO project_submission_awards(proposal_id,repository_github_id,contributor_id,awarded_at)
    SELECT DISTINCT ON (p.repository_github_id) p.id,p.repository_github_id,c.id,coalesce(p.reviewed_at,p.updated_at)
    FROM project_proposals p JOIN member_github_accounts a ON a.member_id=p.member_id AND a.is_primary=TRUE
    JOIN contributors c ON c.github_id=a.github_id
    WHERE p.status='approved' AND p.repository_github_id IS NOT NULL
    ORDER BY p.repository_github_id,p.reviewed_at,p.id
    ON CONFLICT DO NOTHING;
`);
