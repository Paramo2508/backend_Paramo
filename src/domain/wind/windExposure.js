const { httpError } = require('../../utils/httpError');
const { withCrosswind } = require('./streetOpenness');

// Thresholds of ADR-024: calm below MIN, full effect from MAX (km/h).
const MIN_WIND_SPEED_KMH = 10;
const MAX_WIND_SPEED_KMH = 50;
const MAX_ACCEPTED_WIND_SPEED_KMH = 200;

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function windIntensity(speedKmh) {
  return clamp((speedKmh - MIN_WIND_SPEED_KMH) / (MAX_WIND_SPEED_KMH - MIN_WIND_SPEED_KMH), 0, 1);
}

const validPieces = (pieces) =>
  pieces.filter(
    ({ bearingDeg, lengthM }) =>
      Number.isFinite(bearingDeg) && Number.isFinite(lengthM) && lengthM > 0
  );

/*
 * Streets are axes, not vectors: wind along the street scores the same from either end, so the
 * alignment is |cos| of the angle between the wind and each straight piece, weighted by length.
 * With the openness of the street (PBI-8.3, ADR-028) the wind across it also counts; with 0, a
 * canyon, only the part along it does.
 */
function windAlignment(pieces, windDirectionDeg, openness = 0) {
  const valid = validPieces(pieces);
  const totalM = valid.reduce((sum, piece) => sum + piece.lengthM, 0);
  if (totalM <= 0) return null;
  const weighted = valid.reduce((sum, piece) => {
    const angleDeg = windDirectionDeg - piece.bearingDeg;
    const along = Math.abs(Math.cos(toRadians(angleDeg)));
    return sum + piece.lengthM * withCrosswind(along, angleDeg, openness);
  }, 0);
  return clamp(weighted / totalM, 0, 1);
}

// Dominant street axis (0-180°): mean of doubled angles, so 10° and 190° do not cancel out.
function streetOrientation(pieces) {
  let sin = 0;
  let cos = 0;
  validPieces(pieces).forEach(({ bearingDeg, lengthM }) => {
    sin += lengthM * Math.sin(toRadians(2 * bearingDeg));
    cos += lengthM * Math.cos(toRadians(2 * bearingDeg));
  });
  // Opposite axes of equal length (a perfect cross) have no dominant direction.
  if (Math.hypot(sin, cos) < 1e-9) return null;
  const degrees = (Math.atan2(sin, cos) * 180) / Math.PI / 2;
  return (degrees + 180) % 180;
}

function calculateWindExposure(pieces, { speedKmh, directionDeg }, { openness = 0 } = {}) {
  const alignment = windAlignment(pieces, directionDeg, openness);
  if (alignment === null) {
    return {
      status: 'unavailable',
      reason: 'invalid_segment_geometry',
      orientationDeg: null,
      alignment: null,
      intensity: null,
      windExposure: null
    };
  }
  const intensity = windIntensity(speedKmh);
  return {
    status: 'available',
    reason: null,
    orientationDeg: streetOrientation(pieces),
    alignment,
    intensity,
    windExposure: 100 * alignment * intensity
  };
}

function parseWindNumber(field, value, maximum) {
  const number = Number(value);
  if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(number)) {
    throw httpError(400, 'Parámetros no válidos.', { [field]: 'Debe ser un número.' });
  }
  if (number < 0 || number > maximum) {
    throw httpError(400, 'Parámetros no válidos.', { [field]: `Debe estar entre 0 y ${maximum}.` });
  }
  return number;
}

// Both or neither: half a wind would mix the request with the current weather.
function parseWindOverride({ windSpeed, windDirection } = {}) {
  if (windSpeed === undefined && windDirection === undefined) return null;
  if (windSpeed === undefined || windDirection === undefined) {
    const missing = windSpeed === undefined ? 'windSpeed' : 'windDirection';
    throw httpError(400, 'Parámetros no válidos.', {
      [missing]: 'Indica windSpeed y windDirection juntos.'
    });
  }
  return {
    speedKmh: parseWindNumber('windSpeed', windSpeed, MAX_ACCEPTED_WIND_SPEED_KMH),
    directionDeg: parseWindNumber('windDirection', windDirection, 360)
  };
}

module.exports = {
  MIN_WIND_SPEED_KMH,
  MAX_WIND_SPEED_KMH,
  windIntensity,
  windAlignment,
  streetOrientation,
  calculateWindExposure,
  parseWindOverride
};
