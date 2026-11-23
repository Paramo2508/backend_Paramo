const { sequelize, RoutePreference } = require('./models');

// PBI-18 (ADR-036): the simple route preferences of each user, one row per user.

const ATTRIBUTES = ['sunShade', 'avoidWind', 'preferParks', 'extraMinutes'];

const toPreferences = (row) => ({
  sunShade: row.sunShade,
  avoidWind: row.avoidWind,
  preferParks: row.preferParks,
  extraMinutes: Number(row.extraMinutes)
});

// null when the user never saved any.
async function findForUser(userId) {
  const row = await RoutePreference.findByPk(userId, { attributes: ATTRIBUTES, raw: true });
  return row ? toPreferences(row) : null;
}

// Replaces the preferences of the user (one statement: two devices saving at once do not fail).
async function saveForUser(userId, preferences) {
  const [[row]] = await sequelize.query(
    `INSERT INTO route_preferences (user_id, sun_shade, avoid_wind, prefer_parks, extra_minutes,
       updated_at)
     VALUES (:userId, :sunShade, :avoidWind, :preferParks, :extraMinutes, now())
     ON CONFLICT (user_id) DO UPDATE SET sun_shade = EXCLUDED.sun_shade, avoid_wind = EXCLUDED.avoid_wind,
       prefer_parks = EXCLUDED.prefer_parks, extra_minutes = EXCLUDED.extra_minutes,
       updated_at = now()
     RETURNING sun_shade AS "sunShade", avoid_wind AS "avoidWind",
       prefer_parks AS "preferParks", extra_minutes AS "extraMinutes"`,
    { replacements: { userId, ...preferences } }
  );
  return toPreferences(row);
}

module.exports = { findForUser, saveForUser };
