// Stable GitHub IDs verified against the four human repository contributors.
// Enrollment is not identity verification: no member or OAuth record is invented.
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE contributor_score_awards (
      contributor_id BIGINT NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
      award_key TEXT NOT NULL,
      points INTEGER NOT NULL CHECK (points > 0),
      reason TEXT NOT NULL,
      awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (contributor_id, award_key)
    );
    INSERT INTO contributors (github_id, login, avatar_url, actor_type, is_bot, enrolled_at)
    VALUES
      (333234233, 'swiftgorge5-eng', 'https://avatars.githubusercontent.com/u/333234233?v=4', 'User', FALSE, now()),
      (234397891, 'Alpha-dev-code', 'https://avatars.githubusercontent.com/u/234397891?v=4', 'User', FALSE, now()),
      (49949859, 'Linscon', 'https://avatars.githubusercontent.com/u/49949859?v=4', 'User', FALSE, now()),
      (187583840, 'Joseph2433', 'https://avatars.githubusercontent.com/u/187583840?v=4', 'User', FALSE, now())
    ON CONFLICT (github_id) DO UPDATE SET
      login=EXCLUDED.login, avatar_url=EXCLUDED.avatar_url,
      enrolled_at=coalesce(contributors.enrolled_at, EXCLUDED.enrolled_at);
    INSERT INTO contributor_score_awards (contributor_id, award_key, points, reason)
    SELECT id, 'leaderboard-development-v1', 50, 'LeaderBoard 开发贡献奖励'
    FROM contributors WHERE github_id IN (333234233,234397891,49949859,187583840)
    ON CONFLICT (contributor_id, award_key) DO NOTHING;
  `);
};
