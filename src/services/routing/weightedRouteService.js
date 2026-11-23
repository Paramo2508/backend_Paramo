const {
  alternativesWeightFactor,
  parseExtraMinutes
} = require('../../domain/routes/routePreferences');
const {
  hasEnvironmentalWeight,
  hasShadeWeight,
  hasVegetationWeight,
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

/*
 * How much longer than the fastest route the chosen one may be. Since PBI-18 it is `extraMinutes`
 * over the fastest route (ADR-036). The provisional "Según el tiempo" (the recommended route of
 * PBI-9.1, until PBI-21) still sends `maxDetourPercentage`, the 25 % of ADR-023: the alternatives are
 * asked and chosen exactly as before.
 */
function extraTimeLimit(input) {
  if (input?.maxDetourPercentage !== undefined && input?.extraMinutes === undefined) {
    const maxDurationFactor = 1 + parseMaxDetour(input.maxDetourPercentage) / 100;
    return {
      strategy: { maximumDurationFactor: maxDurationFactor },
      weightFactor: Math.max(MAX_DURATION_FACTOR, maxDurationFactor),
      selection: { maxDurationFactor }
    };
  }
  const extraMinutes = parseExtraMinutes(input?.extraMinutes);
  return {
    strategy: { maximumExtraMinutes: extraMinutes },
    weightFactor: alternativesWeightFactor(extraMinutes),
    selection: { maxExtraSeconds: extraMinutes * 60 }
  };
}

/**
 * The fastest route and, if one of the ORS alternatives suits the weights better and takes at most
 * `extraMinutes` more, that one (ADR-023, wind in ADR-025, minutes in ADR-036). With every weight at 0
 * only time matters: no alternatives or shadows are calculated; with only wind, no shadows.
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
  const limit = extraTimeLimit(input);
  const requestedWind = parseRouteWind(input?.wind);
  const strategy = {
    ...limit.strategy,
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
      greenChangePercentagePoints: null,
      candidatesEvaluated: 1,
      strategy
    };
  }

  const { weightFactor } = limit;
  const { routes, exposureStatus, reference } = await evaluateRouteCandidates(input, {
    routesProvider: (points) => alternativesProvider(points, { weightFactor }),
    includeShade: hasShadeWeight(weights),
    // The green percentage is also shown when shade or sun weigh: their segments are already known.
    includeVegetation: hasVegetationWeight(weights) || hasShadeWeight(weights),
    ...dependencies
  });
  const selection = selectWeightedRoute(
    await withWindExposures(routes, wind, opennessRepository),
    weights,
    limit.selection
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
    greenChangePercentagePoints: isSelected ? selection.greenChangePercentagePoints : null,
    candidatesEvaluated: routes.length,
    strategy
  };
}

module.exports = { calculateWeightedRouteComparison };
