// #180 (changes PBI-12): the history keeps places instead of trips. The places used recently as
// origin or destination of each user, without repeating a place (unique index on the rounded
// point), at most 6 (see recentPlacesService). They are personal locations: they go away with the
// user (ON DELETE CASCADE).
//
// The places of the trip history (route_searches) are copied: origin and destination, the latest
// use of each place, newest first and at most 6 per user. The destination of a search counts as used
// just after its origin. Points of the device location ("Ubicación actual", later "Mi ubicación")
// are not copied: their coordinates were only valid at that moment. The log says how many places
// were copied and for how many users, for the deployment.
//
// route_searches is left as it is, unused: it will be dropped by a later migration once this is in
// production and checked. down() only drops recent_places.
const { logger } = require('../../utils/logger');

// The limit of recentPlacesService when this migration was written.
const MAX_RECENT_PLACES = 6;
const DEVICE_LABELS = ['Ubicación actual', 'Mi ubicación'];

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    return sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `CREATE TABLE recent_places (
           id SERIAL PRIMARY KEY,
           user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
           lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
           lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
           label VARCHAR(200),
           used_at TIMESTAMPTZ NOT NULL DEFAULT now()
         );
         CREATE UNIQUE INDEX recent_places_user_place_idx ON recent_places (user_id, lat, lng);
         CREATE INDEX recent_places_user_time_idx ON recent_places (user_id, used_at DESC);`,
        { transaction }
      );
      const [copied] = await sequelize.query(
        `INSERT INTO recent_places (user_id, lat, lng, label, used_at)
         SELECT user_id, lat, lng, label, used_at FROM (
           SELECT latest.*, row_number() OVER (
             PARTITION BY user_id ORDER BY used_at DESC, lat, lng
           ) AS position
           FROM (
             SELECT DISTINCT ON (user_id, lat, lng) user_id, lat, lng, label, used_at
             FROM (
               SELECT user_id, origin_lat AS lat, origin_lng AS lng, origin_label AS label,
                 searched_at - interval '1 millisecond' AS used_at
               FROM route_searches
               UNION ALL
               SELECT user_id, destination_lat, destination_lng, destination_label, searched_at
               FROM route_searches
             ) places
             WHERE label IS NULL OR label NOT IN (:deviceLabels)
             ORDER BY user_id, lat, lng, used_at DESC
           ) latest
         ) ranked
         WHERE position <= :keep
         RETURNING user_id AS "userId"`,
        { replacements: { deviceLabels: DEVICE_LABELS, keep: MAX_RECENT_PLACES }, transaction }
      );
      const counts = {
        places: copied.length,
        users: new Set(copied.map((row) => row.userId)).size
      };
      logger.info(
        `create-recent-places: ${counts.places} place(s) copied from route_searches for ` +
          `${counts.users} user(s); route_searches is left unused`
      );
      return counts;
    });
  },

  // Only the new table: route_searches was never changed.
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS recent_places;');
  }
};
