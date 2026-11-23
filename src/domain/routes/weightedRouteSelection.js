// Choice among the ORS candidates with the user's weights (ADR-023). It generalises the cost of
// ADR-014: with a shade weight of 50 % and a 25 % detour it is exactly the Shaded Route of PBI-5.4.
// Since PBI-18 (ADR-036) the extra time of the user is a number of minutes (maxExtraSeconds); the
// factor is kept for the Shaded Route of PBI-5.4.
const MAX_DURATION_FACTOR = 1.25;
const MIN_IMPROVEMENT_PERCENTAGE_POINTS = 5;

const shadowValue = (route, key) =>
  route?.exposure?.status === 'available' ? route.exposure[key] : null;

const greenValue = (route) =>
  route?.vegetation?.status === 'available' ? route.vegetation.greenPercentage : null;

// What each weight penalises, from 0 to 100: sun for shade, shade for sun, the wind exposure of the
// walking direction for wind (ADR-025) and what is not green for vegetation (100 − % green,
// ADR-026 and ADR-031). null when the route has no data for it.
const FACTOR_PENALTIES = {
  shade: (route) => shadowValue(route, 'sunPercentage'),
  sun: (route) => shadowValue(route, 'shadePercentage'),
  wind: (route) =>
    route?.windExposure?.status === 'available' ? route.windExposure.exposure : null,
  vegetation: (route) => {
    const green = greenValue(route);
    return green === null ? null : 100 - green;
  }
};

const weightedFactors = (weights) =>
  Object.keys(FACTOR_PENALTIES).filter((factor) => weights[factor] > 0);

// A route can only be compared with the data of every factor that weighs.
function hasRequiredExposure(route, weights) {
  return weightedFactors(weights).every((factor) => FACTOR_PENALTIES[factor](route) !== null);
}

function weightedSum(route, weights) {
  return weightedFactors(weights).reduce(
    (sum, factor) => sum + weights[factor] * FACTOR_PENALTIES[factor](route),
    0
  );
}

// Weighted mean of the penalties: what the improvement of at least 5 points is measured on.
function exposurePenalty(route, weights) {
  const total = weightedFactors(weights).reduce((sum, factor) => sum + weights[factor], 0);
  if (total === 0) return 0;
  return weightedSum(route, weights) / total;
}

function weightedCost(route, weights) {
  if (!hasRequiredExposure(route, weights)) return Number.POSITIVE_INFINITY;
  return route.duration * (1 + weightedSum(route, weights) / 10000);
}

function change(selected, fastest, value) {
  const before = value(fastest);
  const after = value(selected);
  return before === null || after === null ? null : after - before;
}

// A route that improves the weighted factors by at least 5 points (ADR-014).
function improves(route, weights, fastestPenalty) {
  return (
    hasRequiredExposure(route, weights) &&
    exposurePenalty(route, weights) <= fastestPenalty - MIN_IMPROVEMENT_PERCENTAGE_POINTS
  );
}

/**
 * @param {object} [limit] maxExtraSeconds (the minutes of the user, ADR-036) or, without it,
 *   maxDurationFactor (the 25 % of the Shaded Route, ADR-014).
 */
function selectWeightedRoute(
  routes,
  weights,
  { maxDurationFactor = MAX_DURATION_FACTOR, maxExtraSeconds = null } = {}
) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new TypeError('routes must be a non-empty array');
  }

  const fastest = [...routes].sort((left, right) => left.duration - right.duration)[0];
  if (!hasRequiredExposure(fastest, weights)) {
    return { status: 'insufficient_exposure_data', fastest, selected: null };
  }

  const maximumDuration =
    maxExtraSeconds === null
      ? fastest.duration * maxDurationFactor
      : fastest.duration + maxExtraSeconds;
  const fastestPenalty = exposurePenalty(fastest, weights);
  const better = routes.filter(
    (route) => route !== fastest && improves(route, weights, fastestPenalty)
  );
  const eligible = better
    .filter((route) => route.duration <= maximumDuration)
    .sort((left, right) => weightedCost(left, weights) - weightedCost(right, weights));

  const selected = eligible[0] || null;
  if (!selected || weightedCost(selected, weights) >= weightedCost(fastest, weights)) {
    // There are routes that suit the preferences better, but all of them take longer than the extra
    // time the user accepts (ADR-036): the fastest one is shown and the user is told why.
    const isOverExtraTime =
      maxExtraSeconds !== null && better.some((route) => route.duration > maximumDuration);
    return {
      status: isOverExtraTime ? 'over_extra_time' : 'no_better_alternative',
      fastest,
      selected: null
    };
  }

  return {
    status: 'selected',
    fastest,
    selected,
    additionalDurationSeconds: Math.max(0, selected.duration - fastest.duration),
    shadeChangePercentagePoints: change(selected, fastest, (route) =>
      shadowValue(route, 'shadePercentage')
    ),
    windChangePoints: change(selected, fastest, FACTOR_PENALTIES.wind),
    greenChangePercentagePoints: change(selected, fastest, greenValue)
  };
}

module.exports = {
  MAX_DURATION_FACTOR,
  MIN_IMPROVEMENT_PERCENTAGE_POINTS,
  exposurePenalty,
  hasRequiredExposure,
  selectWeightedRoute,
  weightedCost
};
