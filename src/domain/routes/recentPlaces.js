const { httpError } = require('../../utils/httpError');
const { parsePoint } = require('./routeTrips');

// #180 (changes PBI-12): the places used recently as origin or destination. A route records its one
// or two places at once (the device location is not sent). Pure functions: no Express nor database.

const MAX_PLACES_PER_REQUEST = 2;

const placeKey = ({ lat, lng }) => `${lat},${lng}`;

/*
 * The places of a request, validated and rounded like the points of the favourites (about a metre,
 * inside Zaragoza). In the order they were used: the last one is the most recent. The same place
 * twice counts once, in its last position.
 */
function parseRecentPlaces(input, serviceArea) {
  const places = input?.places;
  if (!Array.isArray(places) || places.length === 0 || places.length > MAX_PLACES_PER_REQUEST) {
    throw httpError(400, 'Envía uno o dos lugares.', { places: 'Entre 1 y 2 lugares.' });
  }
  const parsed = places.map((place, index) => parsePoint(place, `places[${index}]`, serviceArea));
  return parsed.filter(
    (place, index) => !parsed.slice(index + 1).some((later) => placeKey(later) === placeKey(place))
  );
}

module.exports = { MAX_PLACES_PER_REQUEST, parseRecentPlaces };
