const { UniqueConstraintError } = require('sequelize');

const { httpError } = require('../utils/httpError');
const { RouteFavorite } = require('./models');

// PBI-12: favourite trips of each user. The table route_searches (the old history of trips) is no
// longer read nor written (#180): the recent places are in recentPlacesRepository.

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

module.exports = { countFavorites, createFavorite, deleteFavorite, listFavorites };
