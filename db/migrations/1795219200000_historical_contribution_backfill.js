export const up = (pgm) => {
  pgm.sql(`ALTER TABLE contributor_public_activities
    ADD COLUMN historical_backfill BOOLEAN NOT NULL DEFAULT FALSE`);
};

export const down = (pgm) => {
  pgm.dropColumn("contributor_public_activities", "historical_backfill");
};
