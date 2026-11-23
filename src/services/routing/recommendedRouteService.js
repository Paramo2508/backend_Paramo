const { DateTime } = require('luxon');

const { importConfig } = require('../../config/importConfig');
const { recommendationConfig } = require('../../config/recommendationConfig');
const { recommendRoute } = require('../../domain/routes/routeRecommendation');
const { validateRoutePoints } = require('../../domain/routes/routeRequest');
const { ZARAGOZA_TIME_ZONE, calculateSolarPosition } = require('../../domain/solar/solarPosition');
const { httpError } = require('../../utils/httpError');
const { logger } = require('../../utils/logger');
const { getZaragozaWeather } = require('../weather/weatherService');
const { calculateWeightedRouteComparison } = require('./weightedRouteService');

const NOW_ONLY = 'La ruta recomendada se calcula para ahora, con el tiempo actual.';

// The weather is the current one, so the route is always for now: a date or time is an error.
function validateRecommendedRequest(input) {
  const fields = {};
  ['date', 'time', 'timeZone'].forEach((field) => {
    if (input?.[field] !== undefined) fields[field] = NOW_ONLY;
  });
  if (Object.keys(fields).length) throw httpError(400, NOW_ONLY, fields);
  validateRoutePoints(input, importConfig.zaragozaBbox);
}

function momentIn(now, timeZone) {
  const local = DateTime.fromJSDate(now, { zone: timeZone });
  return { date: local.toFormat('yyyy-MM-dd'), time: local.toFormat('HH:mm'), timeZone };
}

/*
 * The Sun now, in Zaragoza time. If it cannot be calculated (the repeated hour when the clocks go
 * back is ambiguous, or any other error) the recommendation must not fail: the rule treats it as an
 * unavailable Sun (ADR-029) and the route uses the same instant in UTC, which is never ambiguous.
 */
function sunNow(now, origin, solarCalculator) {
  const moment = momentIn(now, ZARAGOZA_TIME_ZONE);
  try {
    const sun = solarCalculator({ ...moment, latitude: origin.lat, longitude: origin.lng });
    if (!Number.isFinite(sun?.elevationDegrees)) throw new TypeError('Invalid solar elevation');
    return { moment, elevationDeg: sun.elevationDegrees };
  } catch (error) {
    logger.warn(`Recommended route without solar position: ${error.message}`);
    return { moment: momentIn(now, 'UTC'), elevationDeg: null };
  }
}

// Open-Meteo failing is not an error here: the rule recommends the fastest route (ADR-029).
async function currentWeather(weather) {
  try {
    return { value: await weather(), error: null };
  } catch (error) {
    logger.warn(`Recommended route without weather: ${error.message}`);
    return { value: null, error };
  }
}

function weatherUsed(weather) {
  if (!weather) return null;
  return {
    temperature: weather.temperature,
    apparentTemperature: weather.apparentTemperature ?? null,
    windSpeed: weather.windSpeed,
    windGusts: weather.windGusts ?? null,
    windDirection: weather.windDirection,
    observedAt: weather.time,
    timeZone: weather.timeZone,
    source: 'open-meteo'
  };
}

/**
 * The route recommended for the current weather (PBI-9.1, ADR-029): the weather and the height of
 * the Sun now choose the weights, and the route is calculated with them exactly as a weighted route
 * (ADR-023, ADR-025). The weather is asked for once and handed to the weighted route.
 */
async function calculateRecommendedRoute(
  input,
  {
    weather = getZaragozaWeather,
    now = () => new Date(),
    solarCalculator = calculateSolarPosition,
    weightedComparison = calculateWeightedRouteComparison,
    config = recommendationConfig,
    ...dependencies
  } = {}
) {
  validateRecommendedRequest(input);
  const { moment, elevationDeg } = sunNow(now(), input.origin, solarCalculator);
  const current = await currentWeather(weather);
  const recommendation = recommendRoute({ weather: current.value, sun: { elevationDeg } }, config);

  const comparison = await weightedComparison(
    {
      origin: input.origin,
      destination: input.destination,
      ...moment,
      weights: recommendation.weights,
      maxDetourPercentage: recommendation.maxDetourPercentage
    },
    {
      ...dependencies,
      solarCalculator,
      weather: async () => {
        if (current.error) throw current.error;
        return current.value;
      }
    }
  );

  return {
    ...comparison,
    recommendation: {
      ...recommendation,
      weather: weatherUsed(current.value),
      sun: { elevationDeg: elevationDeg === null ? null : Math.round(elevationDeg * 10) / 10 },
      calculatedAt: { ...moment }
    }
  };
}

module.exports = { calculateRecommendedRoute, currentWeather, sunNow, weatherUsed };
