// PBI-18 (ADR-036): the saved routes give way to simple preferences, one row per user, kept in the
// account so they come back on any device: shade or sun ("any" = "Me da igual"), avoid the wind,
// go through parks and the extra minutes (0, 2, 5, 10 or 15). A user without a row has the defaults:
// everything indifferent and 5 minutes. "Según el tiempo" is not stored until PBI-21 (#185).
//
// Each user takes the preferences of the saved route they touched most recently: one they created
// (no preset_key) or a preset they edited (updated_at > created_at); the newest updated_at wins.
// A user who never touched a route keeps the defaults. The weights become answers with the
// threshold of 25 (closer to 50, the weight of a "yes", than to 0) and the % of extra time becomes
// minutes: 0 → 0, 1-12 → 2, 13-29 → 5, 30-39 → 10, 40 → 15 (the default 25 % is the default 5
// minutes and the maximum 40 % the maximum 15). The log says how many users and routes were read
// and how many users were given preferences, for the deployment.
//
// route_profiles and users.route_profiles_seeded are left as they are, unused: a later migration
// will drop them once this is in production and checked. down() only drops route_preferences.
const { logger } = require('../../utils/logger');

// The rule of ADR-036 when this migration was written.
const ANSWER_THRESHOLD = 25;

function minutesFromPercentage(percentage) {
  if (percentage <= 0) return 0;
  if (percentage <= 12) return 2;
  if (percentage <= 29) return 5;
  if (percentage <= 39) return 10;
  return 15;
}

/** The preferences of one saved route (a row of route_profiles). */
function preferencesFromRoute(route) {
  const yes = (weight) => weight >= ANSWER_THRESHOLD;
  let sunShade = 'any';
  if (yes(route.shadeWeight) && route.shadeWeight >= route.sunWeight) sunShade = 'shade';
  else if (yes(route.sunWeight)) sunShade = 'sun';
  return {
    sunShade,
    avoidWind: yes(route.windWeight),
    preferParks: yes(route.vegetationWeight),
    extraMinutes: minutesFromPercentage(route.maxDetourPercentage)
  };
}

module.exports = {
  preferencesFromRoute,

  async up(queryInterface) {
    const { sequelize } = queryInterface;
    return sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `CREATE TABLE route_preferences (
           user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
           sun_shade VARCHAR(5) NOT NULL DEFAULT 'any' CHECK (sun_shade IN ('shade', 'sun', 'any')),
           avoid_wind BOOLEAN NOT NULL DEFAULT false,
           prefer_parks BOOLEAN NOT NULL DEFAULT false,
           extra_minutes SMALLINT NOT NULL DEFAULT 5 CHECK (extra_minutes IN (0, 2, 5, 10, 15)),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         );`,
        { transaction }
      );
      const [[read]] = await sequelize.query(
        `SELECT count(*)::int AS routes, count(DISTINCT user_id)::int AS users
         FROM route_profiles`,
        { transaction }
      );
      const [touched] = await sequelize.query(
        `SELECT DISTINCT ON (user_id) user_id AS "userId", shade_weight AS "shadeWeight",
           sun_weight AS "sunWeight", wind_weight AS "windWeight",
           vegetation_weight AS "vegetationWeight", max_detour_percentage AS "maxDetourPercentage",
           updated_at AS "updatedAt"
         FROM route_profiles
         WHERE preset_key IS NULL OR updated_at > created_at
         ORDER BY user_id, updated_at DESC, id DESC`,
        { transaction }
      );
      for (const route of touched) {
        const preferences = preferencesFromRoute(route);
        // eslint-disable-next-line no-await-in-loop
        await sequelize.query(
          `INSERT INTO route_preferences (user_id, sun_shade, avoid_wind, prefer_parks,
             extra_minutes, updated_at)
           VALUES (:userId, :sunShade, :avoidWind, :preferParks, :extraMinutes, :updatedAt)`,
          {
            replacements: { userId: route.userId, updatedAt: route.updatedAt, ...preferences },
            transaction
          }
        );
      }
      const counts = { users: read.users, routes: read.routes, migrated: touched.length };
      logger.info(
        `create-route-preferences: ${counts.routes} saved route(s) of ${counts.users} user(s) ` +
          `read; preferences migrated for ${counts.migrated} user(s) from the route they touched ` +
          'last; route_profiles and users.route_profiles_seeded are left unused'
      );
      return counts;
    });
  },

  // Only the new table: route_profiles was never changed.
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS route_preferences;');
  }
};
