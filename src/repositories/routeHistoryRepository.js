const { UniqueConstraintError } = require('sequelize');

const { httpError } = require('../utils/httpError');
const { sequelize, RouteFavorite, RouteSearch } = require('./models');

// PBI-12: route history and favourite trips of each user.

const TRIP_ATTRIBUTES = [
  'id',
  'originLat',
  'originLng',
  'originLabel',
  'destinationLat',
  'destinationLng',
  'destinationLabel'
];

const toTrip = (row) => ({
  id: row.id,
  origin: { lat: row.originLat, lng: row.originLng, label: row.originLabel },
  destination: { lat: row.destinationLat, lng: row.destinationLng, label: row.destinationLabel }
});

const toSearch = (row) => ({ ...toTrip(row), searchedAt: new Date(row.searchedAt).toISOString() });

const toFavorite = (row) => ({
  ...toTrip(row),
  name: row.name,
  createdAt: new Date(row.createdAt).toISOString()
});

const tripReplacements = (userId, { origin, destination }) => ({
  userId,
  originLat: origin.lat,
  originLng: origin.lng,
  originLabel: origin.label,
  destinationLat: destination.lat,
  destinationLng: destination.lng,
  destinationLabel: destination.label
});

async function listSearches(userId) {
  const rows = await RouteSearch.findAll({
    where: { userId },
    attributes: [...TRIP_ATTRIBUTES, 'searchedAt'],
    order: [
      ['searchedAt', 'DESC'],
      ['id', 'DESC']
    ],
    raw: true
  });
  return rows.map(toSearch);
}

/*
 * The same trip searched again moves to the top with the latest names instead of repeating
 * (unique index on the rounded points). Then only the newest `keep` searches stay, so the table
 * never holds more personal locations than the history shows.
 */
async function recordSearch(userId, trip, keep) {
  return sequelize.transaction(async (transaction) => {
    const [row] = await sequelize.query(
      `INSERT INTO route_searches (user_id, origin_lat, origin_lng, origin_label,
         destination_lat, destination_lng, destination_label)
       VALUES (:userId, :originLat, :originLng, :originLabel,
         :destinationLat, :destinationLng, :destinationLabel)
       ON CONFLICT (user_id, origin_lat, origin_lng, destination_lat, destination_lng)
       DO UPDATE SET searched_at = now(), origin_label = EXCLUDED.origin_label,
         destination_label = EXCLUDED.destination_label
       RETURNING id, origin_lat AS "originLat", origin_lng AS "originLng",
         origin_label AS "originLabel", destination_lat AS "destinationLat",
         destination_lng AS "destinationLng", destination_label AS "destinationLabel",
         searched_at AS "searchedAt"`,
      {
        replacements: tripReplacements(userId, trip),
        type: sequelize.QueryTypes.SELECT,
        transaction
      }
    );
    await sequelize.query(
      `DELETE FROM route_searches WHERE user_id = :userId AND id NOT IN (
         SELECT id FROM route_searches WHERE user_id = :userId
         ORDER BY searched_at DESC, id DESC LIMIT :keep)`,
      { replacements: { userId, keep }, transaction }
    );
    return toSearch(row);
  });
}

function clearSearches(userId) {
  return RouteSearch.destroy({ where: { userId } });
}

async function listFavorites(userId) {
  const rows = await RouteFavorite.findAll({
    where: { userId },
    attributes: [...TRIP_ATTRIBUTES, 'name', 'createdAt'],
    order: [['id', 'ASC']],
    raw: true
  });
  return rows.map(toFavorite);
}

function countFavorites(userId) {
  return RouteFavorite.count({ where: { userId } });
}

async function createFavorite(userId, { name, ...trip }) {
  try {
    const row = await RouteFavorite.create({ ...tripReplacements(userId, trip), name });
    return toFavorite(row.get({ plain: true }));
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw httpError(409, 'Ese trayecto ya está en tus favoritos.');
    }
    throw error;
  }
}

async function deleteFavorite(userId, id) {
  return (await RouteFavorite.destroy({ where: { id, userId } })) > 0;
}

module.exports = {
  clearSearches,
  countFavorites,
  createFavorite,
  deleteFavorite,
  listFavorites,
  listSearches,
  recordSearch
};
