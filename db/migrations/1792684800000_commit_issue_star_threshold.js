export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE repository_star_counts (
      github_id BIGINT PRIMARY KEY CHECK (github_id > 0),
      stars INTEGER CHECK (stars >= 0),
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};
