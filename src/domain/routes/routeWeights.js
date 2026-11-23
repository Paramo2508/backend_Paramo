const { httpError } = require('../../utils/httpError');

// Each weight is a percentage: how much the user cares about that factor (ADR-023). Wind came with
// PBI-8.2 (ADR-025) and vegetation with PBI-10 phase B (ADR-031), independent of shade (ADR-026).
// Since PBI-18 (ADR-036) users answer simple questions and routePreferences.js turns them into
// these weights; the saved routes and their extra time in % are gone.
const WEIGHT_FACTORS = ['shade', 'sun', 'wind', 'vegetation'];
const MAX_WEIGHT = 100;
// The extra time in % of ADR-023, only for the provisional "Según el tiempo" (the recommended route of
// PBI-9.1) until PBI-21 (ADR-036). Everything else uses minutes (routePreferences.js).
const DEFAULT_MAX_DETOUR_PERCENTAGE = 25;
const MAX_DETOUR_PERCENTAGE = 40;
// Shade and sun are the two ends of one scale (ADR-030): a route seeks one, the other or neither.
const SHADE_AND_SUN_MESSAGE = 'Elige sombra o sol, no los dos a la vez.';

function hasEnvironmentalWeight(weights) {
  return WEIGHT_FACTORS.some((factor) => weights[factor] > 0);
}

// Shadows are only needed when shade or sun weigh: a wind-only route also works at night.
function hasShadeWeight(weights) {
  return weights.shade > 0 || weights.sun > 0;
}

// The green of the route does not depend on the Sun either (ADR-026): it works at night too.
function hasVegetationWeight(weights) {
  return weights.vegetation > 0;
}

function parseWeights(weights) {
  if (weights === null || typeof weights !== 'object' || Array.isArray(weights)) {
    throw httpError(400, 'Los pesos no son válidos.', { weights: 'Indica los pesos de la ruta.' });
  }
  const fields = {};
  const parsed = {};
  WEIGHT_FACTORS.forEach((factor) => {
    const value = weights[factor] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > MAX_WEIGHT) {
      fields[factor] = `Debe ser un número entero entre 0 y ${MAX_WEIGHT}.`;
    } else {
      parsed[factor] = value;
    }
  });
  if (Object.keys(fields).length) throw httpError(400, 'Los pesos no son válidos.', fields);
  if (parsed.shade > 0 && parsed.sun > 0) {
    throw httpError(400, 'Los pesos no son válidos.', {
      shade: SHADE_AND_SUN_MESSAGE,
      sun: SHADE_AND_SUN_MESSAGE
    });
  }
  return parsed;
}

function parseMaxDetour(value = DEFAULT_MAX_DETOUR_PERCENTAGE) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_DETOUR_PERCENTAGE) {
    throw httpError(400, 'El tiempo extra no es válido.', {
      maxDetourPercentage: `Debe ser un número entero entre 0 y ${MAX_DETOUR_PERCENTAGE}.`
    });
  }
  return value;
}

module.exports = {
  MAX_DETOUR_PERCENTAGE,
  MAX_WEIGHT,
  SHADE_AND_SUN_MESSAGE,
  WEIGHT_FACTORS,
  hasEnvironmentalWeight,
  hasShadeWeight,
  hasVegetationWeight,
  parseMaxDetour,
  parseWeights
};
