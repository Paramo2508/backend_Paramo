// Openness of each street segment (PBI-8.3, ADR-028), rebuilt by "npm run compute:openness".
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      -- Means of the samples of the segment, in metres measured in EPSG:25830. width_m is the
      -- distance between the first facades on each side (each side at most the search distance);
      -- height_m the mean height of those facades (0 for a side without buildings).
      CREATE TABLE segment_openness (
        segment_id INTEGER PRIMARY KEY REFERENCES street_segments (id) ON DELETE CASCADE,
        samples INTEGER NOT NULL CHECK (samples > 0),
        width_m DOUBLE PRECISION NOT NULL CHECK (width_m >= 0),
        height_m DOUBLE PRECISION NOT NULL CHECK (height_m >= 0),
        hw_ratio DOUBLE PRECISION NOT NULL CHECK (hw_ratio >= 0),
        openness DOUBLE PRECISION NOT NULL CHECK (openness BETWEEN 0 AND 1),
        computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS segment_openness;');
  }
};
