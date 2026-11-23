const {
  answersOf,
  hasPreference,
  parsePreferences,
  weightsFromAnswers
} = require('../../domain/routes/routePreferences');
const { calculateWeightedRouteComparison } = require('./weightedRouteService');

/**
 * The route of the user's answers (PBI-18, ADR-036): the answers become weights and the route is
 * calculated with the weighted comparison of PBI-6, which does not change. With every answer
 * indifferent the weights are 0 and only the fastest route is calculated (`fastest_only`).
 */
async function calculatePreferredRoute(
  input,
  { weightedComparison = calculateWeightedRouteComparison, ...dependencies } = {}
) {
  const preferences = parsePreferences(input?.preferences);
  const comparison = await weightedComparison(
    {
      origin: input.origin,
      destination: input.destination,
      date: input.date,
      time: input.time,
      timeZone: input.timeZone,
      wind: input.wind,
      weights: weightsFromAnswers(preferences),
      extraMinutes: preferences.extraMinutes
    },
    dependencies
  );
  return {
    ...comparison,
    preferences: { ...preferences, hasPreference: hasPreference(answersOf(preferences)) }
  };
}

module.exports = { calculatePreferredRoute };
