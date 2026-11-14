// Route history and favourite trips of each user (PBI-12). Both keep the points with the name the
// user saw, so a trip can be repeated without searching again. They are personal locations: they
// go away with the user (ON DELETE CASCADE) and the history keeps only the last searches (see
// routeHistoryService).
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE route_searches (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        origin_lat DOUBLE PRECISION NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
        origin_lng DOUBLE PRECISION NOT NULL CHECK (origin_lng BETWEEN -180 AND 180),
        origin_label VARCHAR(200),
        destination_lat DOUBLE PRECISION NOT NULL CHECK (destination_lat BETWEEN -90 AND 90),
        destination_lng DOUBLE PRECISION NOT NULL CHECK (destination_lng BETWEEN -180 AND 180),
        destination_label VARCHAR(200),
        searched_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX route_searches_user_trip_idx
        ON route_searches (user_id, origin_lat, origin_lng, destination_lat, destination_lng);
      CREATE INDEX route_searches_user_time_idx ON route_searches (user_id, searched_at DESC);

      CREATE TABLE route_favorites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name VARCHAR(60) NOT NULL CHECK (btrim(name) <> ''),
        origin_lat DOUBLE PRECISION NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
        origin_lng DOUBLE PRECISION NOT NULL CHECK (origin_lng BETWEEN -180 AND 180),
        origin_label VARCHAR(200),
        destination_lat DOUBLE PRECISION NOT NULL CHECK (destination_lat BETWEEN -90 AND 90),
        destination_lng DOUBLE PRECISION NOT NULL CHECK (destination_lng BETWEEN -180 AND 180),
        destination_label VARCHAR(200),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX route_favorites_user_trip_idx
        ON route_favorites (user_id, origin_lat, origin_lng, destination_lat, destination_lng);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS route_favorites;
      DROP TABLE IF EXISTS route_searches;
    `);
  }
};
