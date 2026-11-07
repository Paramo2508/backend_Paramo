const {
  hasEnvironmentalWeight,
  hasShadeWeight,
  parseMaxDetour,
  parseWeights
} = require('../../domain/routes/routeWeights');
const {
  MAX_DURATION_FACTOR,
  MIN_IMPROVEMENT_PERCENTAGE_POINTS,
  selectWeightedRoute
} = require('../../domain/routes/weightedRouteSelection');
const {
  calculatePiecesWindExposure,
  parseRouteWind,
  routePieces,
  unavailableRouteWindExposure
} = require('../../domain/wind/routeWindExposure');
const { DEFAULT_OPENNESS } = require('../../domain/wind/streetOpenness');
const { windIntensity } = require('../../domain/wind/windExposure');
const {
  getAlternativeWalkingRoutes
} = require('../../integrations/openRouteService/directionsClient');
const defaultOpenness = require('../../repositories/opennessRepository');
const { getZaragozaWeather } = require('../weather/weatherService');

// How far the street segment of each piece of a route is searched for its openness (ADR-028).
const OPENNESS_SEARCH_M = 10;
const { calculateFastestRoute } = require('./fastestRouteService');
const { evaluateRouteCandidates } = require('./routeCandidates');

// Up to the 25 % of ADR-014 ORS is asked exactly as for the Shaded Route; beyond it, alternatives
// that are as long as the user accepts.
function alternativesWeightFactor(maxDurationFactor) {
  return Math.max(MAX_DURATION_FACTOR, maxDurationFactor);
}

/*
 * The wind of the request or, without one, the current Open-Meteo wind (PBI-7, cached five
 * minutes), whatever the date and time of the route (ADR-025). If Open-Meteo fails and wind does not
 * weigh, the routes are still calculated without their wind exposure.
 */
async function resolveWind(requested, weights, weather) {
  if (requested) return { ...requested, source: 'request', time: null };
  try {
    const current = await weather();
    return {
      speedKmh: current.windSpeed,
      directionDeg: current.windDirection,
      source: 'open-meteo',
      time: current.time
    };
  } catch (error) {
    if (weights.wind > 0) throw error;
    return null;
  }
}

/*
 * Each route with its wind exposure. Every straight piece takes the openness of the nearest street
 * segment (PBI-8.3), all in one query; with calm wind the exposure is 0 anyway and it is skipped.
 */
async function withWindExposures(routes, wind, opennessRepository) {
  if (!wind) {
    return routes.map((route) => ({
      ...route,
      windExposure: unavailableRouteWindExposure('weather_unavailable')
    }));
  }
  const piecesByRoute = routes.map((route) => routePieces(route.geometry));
  const allPieces = piecesByRoute.flat();
  const openness =
    windIntensity(wind.speedKmh) > 0
      ? await opennessRepository.findOpennessNearPoints(
          allPieces.map((piece) => piece.midpoint),
          OPENNESS_SEARCH_M
        )
      : [];
  let offset = 0;
  return routes.map((route, index) => {
    const pieces = piecesByRoute[index].map((piece, pieceIndex) => ({
      ...piece,
      openness: openness.length ? (openness[offset + pieceIndex] ?? DEFAULT_OPENNESS) : undefined
    }));
    offset += pieces.length;
    return { ...route, windExposure: calculatePiecesWindExposure(pieces, wind) };
  });
}

/**
 * The fastest route and, if one of the ORS alternatives suits the weights better, that one
 * (ADR-023, wind in ADR-025). With every weight at 0 only time matters: no alternatives or shadows
 * are calculated; with only wind, no shadows.
 */
async function calculateWeightedRouteComparison(
  input,
  {
    fastestRouteCalculator = calculateFastestRoute,
    alternativesProvider = getAlternativeWalkingRoutes,
    weather = getZaragozaWeather,
    opennessRepository = defaultOpenness,
    ...dependencies
  } = {}
) {
  const weights = parseWeights(input?.weights);
  const maxDetourPercentage = parseMaxDetour(input?.maxDetourPercentage);
  const requestedWind = parseRouteWind(input?.wind);
  const maxDurationFactor = 1 + maxDetourPercentage / 100;
  const strategy = {
    maximumDurationFactor: maxDurationFactor,
    minimumImprovementPercentagePoints: MIN_IMPROVEMENT_PERCENTAGE_POINTS
  };
  const wind = await resolveWind(requestedWind, weights, weather);

  if (!hasEnvironmentalWeight(weights)) {
    const fastest = await fastestRouteCalculator(input);
    return {
      status: 'fastest_only',
      weights,
      wind,
      fastest: (await withWindExposures([fastest], wind, opennessRepository))[0],
      selected: null,
      additionalDurationSeconds: null,
      shadeChangePercentagePoints: null,
      windChangePoints: null,
      candidatesEvaluated: 1,
      strategy
    };
  }

  const weightFactor = alternativesWeightFactor(maxDurationFactor);
  const { routes, exposureStatus, reference } = await evaluateRouteCandidates(input, {
    routesProvider: (points) => alternativesProvider(points, { weightFactor }),
    includeShade: hasShadeWeight(weights),
    ...dependencies
  });
  const selection = selectWeightedRoute(
    await withWindExposures(routes, wind, opennessRepository),
    weights,
    { maxDurationFactor }
  );
  const status = exposureStatus || selection.status;
  const isSelected = status === 'selected';

  return {
    status,
    reference,
    weights,
    wind,
    fastest: selection.fastest,
    selected: isSelected ? selection.selected : null,
    additionalDurationSeconds: isSelected ? selection.additionalDurationSeconds : null,
    shadeChangePercentagePoints: isSelected ? selection.shadeChangePercentagePoints : null,
    windChangePoints: isSelected ? selection.windChangePoints : null,
    candidatesEvaluated: routes.length,
    strategy
  };
}

module.exports = { calculateWeightedRouteComparison };
