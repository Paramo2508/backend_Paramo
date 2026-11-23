const { httpError } = require('../../utils/httpError');

/*
 * Simple route preferences (PBI-18, ADR-036): the user answers a few questions instead of editing
 * weights. The answers become the same weights of ADR-023, ADR-025 and ADR-031, with the values of
 * the old presets (Sombreada and Soleada, 50) and of the recommended route (wind 50, ADR-029); the
 * weighted calculation does not change. The extra time is a number of minutes over the fastest route.
 */

const SUN_SHADE_OPTIONS = ['shade', 'sun', 'any'];
const EXTRA_MINUTES_OPTIONS = [0, 2, 5, 10, 15];
const DEFAULT_EXTRA_MINUTES = 5;
// The weight of a "yes": the shade and sun presets of ADR-023 and the wind of ADR-029.
const PREFERENCE_WEIGHT = 50;

const DEFAULT_PREFERENCES = Object.freeze({
  sunShade: 'any',
  avoidWind: false,
  preferParks: false,
  extraMinutes: DEFAULT_EXTRA_MINUTES
});

// Up to the 25 % of ADR-014 ORS is asked exactly as for the Shaded Route; for 10 and 15 minutes,
// its default 1.4 (the maximum of ADR-023): longer alternatives have not been checked.
const SHORT_EXTRA_WEIGHT_FACTOR = 1.25;
const LONG_EXTRA_WEIGHT_FACTOR = 1.4;
const LONG_EXTRA_FROM_MINUTES = 10;

const EXTRA_MINUTES_MESSAGE = 'Elige 0, 2, 5, 10 o 15 minutos.';

function parseExtraMinutes(value = DEFAULT_EXTRA_MINUTES) {
  if (!EXTRA_MINUTES_OPTIONS.includes(value)) {
    throw httpError(400, 'El tiempo extra no es válido.', { extraMinutes: EXTRA_MINUTES_MESSAGE });
  }
  return value;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The three answers and the minutes, as stored in the account and sent to calculate a route. Every
 * field is required: a PUT replaces them all. "Según el tiempo" is not stored until PBI-21 (ADR-036).
 */
function parsePreferences(input) {
  const invalid = (fields) => httpError(400, 'Las preferencias no son válidas.', fields);
  if (!isObject(input)) throw invalid({ preferences: 'Indica tus preferencias.' });
  const fields = {};
  ['avoidWind', 'preferParks'].forEach((field) => {
    if (typeof input[field] !== 'boolean') fields[field] = 'Debe ser sí o no.';
  });
  if (!SUN_SHADE_OPTIONS.includes(input.sunShade)) {
    fields.sunShade = 'Elige «Sombra», «Sol» o «Me da igual».';
  }
  if (!EXTRA_MINUTES_OPTIONS.includes(input.extraMinutes)) {
    fields.extraMinutes = EXTRA_MINUTES_MESSAGE;
  }
  if (Object.keys(fields).length) throw invalid(fields);
  return {
    sunShade: input.sunShade,
    avoidWind: input.avoidWind,
    preferParks: input.preferParks,
    extraMinutes: input.extraMinutes
  };
}

/*
 * «Según el tiempo de hoy» (PBI-21, ADR-037) is kept in the account with the answers: on for a new
 * user (DEFAULT_SAVED_PREFERENCES), and afterwards whatever the user chose last. It is not part of
 * the preferences of a route (parsePreferences): the weather only marks the answers. A client that
 * does not send it (before PBI-21) leaves it off.
 */
const DEFAULT_SAVED_PREFERENCES = Object.freeze({ ...DEFAULT_PREFERENCES, byWeather: true });

function parseSavedPreferences(input) {
  const byWeather = isObject(input) ? input.byWeather : undefined;
  const fields = {};
  let preferences;
  try {
    preferences = parsePreferences(input);
  } catch (error) {
    if (!error.fields) throw error;
    Object.assign(fields, error.fields);
  }
  if (byWeather !== undefined && typeof byWeather !== 'boolean')
    fields.byWeather = 'Debe ser sí o no.';
  if (Object.keys(fields).length) throw httpError(400, 'Las preferencias no son válidas.', fields);
  return { ...preferences, byWeather: byWeather ?? false };
}

// The answers to the three questions, without the minutes.
const answersOf = ({ sunShade, avoidWind, preferParks }) => ({ sunShade, avoidWind, preferParks });

function hasPreference(answers) {
  return answers.sunShade !== 'any' || answers.avoidWind || answers.preferParks;
}

function weightsFromAnswers({ sunShade, avoidWind, preferParks }) {
  return {
    shade: sunShade === 'shade' ? PREFERENCE_WEIGHT : 0,
    sun: sunShade === 'sun' ? PREFERENCE_WEIGHT : 0,
    wind: avoidWind ? PREFERENCE_WEIGHT : 0,
    vegetation: preferParks ? PREFERENCE_WEIGHT : 0
  };
}

function alternativesWeightFactor(extraMinutes) {
  return extraMinutes >= LONG_EXTRA_FROM_MINUTES
    ? LONG_EXTRA_WEIGHT_FACTOR
    : SHORT_EXTRA_WEIGHT_FACTOR;
}

module.exports = {
  DEFAULT_EXTRA_MINUTES,
  DEFAULT_PREFERENCES,
  DEFAULT_SAVED_PREFERENCES,
  EXTRA_MINUTES_OPTIONS,
  PREFERENCE_WEIGHT,
  SUN_SHADE_OPTIONS,
  alternativesWeightFactor,
  answersOf,
  hasPreference,
  parseExtraMinutes,
  parsePreferences,
  parseSavedPreferences,
  weightsFromAnswers
};
