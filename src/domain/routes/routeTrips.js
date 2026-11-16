const { httpError } = require('../../utils/httpError');
const { isValidPoint } = require('./routeRequest');
const { isInsideBbox } = require('../geo/geometryValidation');

// PBI-12: a favourite trip is an origin and a destination with the name the user saw for each one.
// The points of the recent places (#180) are validated the same way. Pure functions: no Express nor
// database.

const LABEL_MAX_LENGTH = 200;
const FAVORITE_NAME_MAX_LENGTH = 60;
// About one metre: the same trip searched again keeps a single row (the unique index compares the
// stored values).
const COORDINATE_DECIMALS = 5;

const roundCoordinate = (value) => Number(value.toFixed(COORDINATE_DECIMALS));

function parseLabel(label, field) {
  if (label === undefined || label === null) return null;
  if (typeof label !== 'string')
    throw httpError(400, 'El nombre del lugar no es válido.', { [field]: 'No válido.' });
  const trimmed = label.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, LABEL_MAX_LENGTH);
}

function parsePoint(point, field, serviceArea) {
  if (!isValidPoint(point)) {
    throw httpError(400, 'El origen y el destino necesitan coordenadas válidas.', {
      [field]: 'Coordenadas no válidas.'
    });
  }
  if (!isInsideBbox([point.lng, point.lat], serviceArea)) {
    throw httpError(400, 'El origen y el destino tienen que estar en Zaragoza.', {
      [field]: 'Fuera de Zaragoza.'
    });
  }
  return {
    lat: roundCoordinate(point.lat),
    lng: roundCoordinate(point.lng),
    label: parseLabel(point.label, field)
  };
}

function parseTrip(input, serviceArea) {
  return {
    origin: parsePoint(input?.origin, 'origin', serviceArea),
    destination: parsePoint(input?.destination, 'destination', serviceArea)
  };
}

const shortLabel = (point, fallback) => (point.label ?? fallback).split(',')[0].trim() || fallback;

// Without a name, "Origin → Destination" with the first part of each place name.
function defaultFavoriteName(trip) {
  return `${shortLabel(trip.origin, 'Origen')} → ${shortLabel(trip.destination, 'Destino')}`.slice(
    0,
    FAVORITE_NAME_MAX_LENGTH
  );
}

function parseFavorite(input, serviceArea) {
  const trip = parseTrip(input, serviceArea);
  const { name } = input ?? {};
  if (name !== undefined && name !== null && typeof name !== 'string') {
    throw httpError(400, 'El nombre no es válido.', { name: 'No válido.' });
  }
  const trimmed = (name ?? '').trim();
  if (trimmed.length > FAVORITE_NAME_MAX_LENGTH) {
    throw httpError(
      400,
      `El nombre puede tener como mucho ${FAVORITE_NAME_MAX_LENGTH} caracteres.`,
      {
        name: `Como mucho ${FAVORITE_NAME_MAX_LENGTH} caracteres.`
      }
    );
  }
  return { ...trip, name: trimmed || defaultFavoriteName(trip) };
}

module.exports = {
  FAVORITE_NAME_MAX_LENGTH,
  LABEL_MAX_LENGTH,
  defaultFavoriteName,
  parseFavorite,
  parsePoint,
  parseTrip
};
