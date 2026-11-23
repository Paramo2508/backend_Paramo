const { weightsFromAnswers } = require('../../domain/routes/routePreferences');
const { hasEnvironmentalWeight, parseWeights } = require('../../domain/routes/routeWeights');
const { environmentalCost } = require('../../domain/routes/shadedRouteSelection');
const {
  MAX_DURATION_FACTOR,
  exposurePenalty,
  selectWeightedRoute,
  weightedCost
} = require('../../domain/routes/weightedRouteSelection');

const route = (id, duration, shadePercentage, status = 'available') => ({
  id,
  duration,
  exposure: {
    status,
    shadePercentage: status === 'available' ? shadePercentage : null,
    sunPercentage: status === 'available' ? 100 - shadePercentage : null
  }
});
// The weights of the answers "Sombra" and "Sol" (the old presets Sombreada and Soleada).
const PRESETS = {
  shaded: weightsFromAnswers({ sunShade: 'shade', avoidWind: false, preferParks: false }),
  sunny: weightsFromAnswers({ sunShade: 'sun', avoidWind: false, preferParks: false })
};
const preset = (key) => PRESETS[key];
// Fast and sunny, a little longer and shaded, and something in between.
const candidates = [route('fast', 600, 20), route('shade', 680, 85), route('middle', 640, 50)];

describe('route weights', () => {
  it('accepts whole percentages and treats a missing factor as 0', () => {
    expect(parseWeights({ shade: 100 })).toEqual({ shade: 100, sun: 0, wind: 0, vegetation: 0 });
    expect(hasEnvironmentalWeight({ shade: 0, sun: 0 })).toBe(false);
    expect(hasEnvironmentalWeight({ shade: 0, sun: 1 })).toBe(true);
  });

  it.each([[{ shade: -1 }], [{ shade: 101 }], [{ sun: 12.5 }], [{ sun: '50' }]])(
    'rejects %j',
    (weights) => {
      expect(() => parseWeights(weights)).toThrow(expect.objectContaining({ status: 400 }));
    }
  );

  it('rejects shade and sun at the same time, with a message for each (ADR-030)', () => {
    expect(() => parseWeights({ shade: 50, sun: 5 })).toThrow(
      expect.objectContaining({
        status: 400,
        fields: {
          shade: 'Elige sombra o sol, no los dos a la vez.',
          sun: 'Elige sombra o sol, no los dos a la vez.'
        }
      })
    );
  });

  it.each([
    [{ shade: 50, sun: 0 }],
    [{ shade: 0, sun: 100 }],
    [{ shade: 0, sun: 0, wind: 80 }],
    [{ shade: 100, wind: 100 }]
  ])('accepts one side of the shade-sun scale: %j', (weights) => {
    expect(() => parseWeights(weights)).not.toThrow();
  });

  it.each([null, [], 'shade'])('rejects weights that are not an object: %j', (weights) => {
    expect(() => parseWeights(weights)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('weighted route selection', () => {
  it('keeps the cost of the Shaded Route of ADR-014 for the "Sombreada" preset', () => {
    candidates.forEach((candidate) => {
      expect(weightedCost(candidate, preset('shaded'))).toBeCloseTo(environmentalCost(candidate));
    });
  });

  it('chooses the shaded alternative with a shade weight', () => {
    expect(selectWeightedRoute(candidates, preset('shaded'))).toMatchObject({
      status: 'selected',
      selected: { id: 'shade' },
      additionalDurationSeconds: 80,
      shadeChangePercentagePoints: 65
    });
  });

  it('keeps the sunny fastest route with a sun weight, as nothing is sunnier', () => {
    expect(selectWeightedRoute(candidates, preset('sunny'))).toMatchObject({
      status: 'no_better_alternative',
      selected: null
    });
  });

  it('chooses a sunnier alternative when the fastest is shaded', () => {
    const shadedFastest = [route('fast', 600, 80), route('sunny', 660, 10)];

    expect(selectWeightedRoute(shadedFastest, preset('sunny'))).toMatchObject({
      status: 'selected',
      selected: { id: 'sunny' },
      shadeChangePercentagePoints: -70
    });
  });

  it('gives different routes for different weights over the same candidates', () => {
    const light = selectWeightedRoute(candidates, { shade: 15, sun: 0 });
    const strong = selectWeightedRoute(candidates, { shade: 100, sun: 0 });

    expect(light.selected).toBeNull();
    expect(strong.selected).toMatchObject({ id: 'shade' });
  });

  it('accepts as much extra time as the user allows', () => {
    const routes = [route('fast', 600, 10), route('detour', 780, 90)];

    expect(selectWeightedRoute(routes, { shade: 100, sun: 0 }).selected).toBeNull();
    expect(
      selectWeightedRoute(routes, { shade: 100, sun: 0 }, { maxDurationFactor: 1.3 }).selected
    ).toMatchObject({ id: 'detour' });
    // With less time to spare, the shaded route that takes less time wins.
    expect(
      selectWeightedRoute(candidates, { shade: 50, sun: 0 }, { maxDurationFactor: 1.1 }).selected
    ).toMatchObject({ id: 'middle' });
  });

  it('never accepts a detour longer than the limit, whatever the weight', () => {
    const result = selectWeightedRoute(
      [route('fast', 600, 0), route('long', 600 * MAX_DURATION_FACTOR + 1, 100)],
      { shade: 100, sun: 0 }
    );

    expect(result).toMatchObject({ status: 'no_better_alternative', selected: null });
  });

  describe('extra time in minutes (PBI-18, ADR-036)', () => {
    const shade = { shade: 50, sun: 0 };

    it('limits the alternatives to the fastest duration plus the seconds given', () => {
      // "shade" takes 80 s more and "middle" 40 s more.
      expect(
        selectWeightedRoute(candidates, shade, { maxExtraSeconds: 120 }).selected
      ).toMatchObject({ id: 'shade' });
      expect(
        selectWeightedRoute(candidates, shade, { maxExtraSeconds: 80 }).selected
      ).toMatchObject({ id: 'shade' });
      expect(
        selectWeightedRoute(candidates, shade, { maxExtraSeconds: 60 }).selected
      ).toMatchObject({ id: 'middle' });
    });

    it('says over_extra_time when every better route takes longer than allowed', () => {
      expect(selectWeightedRoute(candidates, shade, { maxExtraSeconds: 0 })).toMatchObject({
        status: 'over_extra_time',
        fastest: { id: 'fast' },
        selected: null
      });
    });

    it('says no_better_alternative when no route is better, whatever the time', () => {
      const sunny = [route('fast', 600, 20), route('long', 900, 10)];
      expect(selectWeightedRoute(sunny, shade, { maxExtraSeconds: 0 }).status).toBe(
        'no_better_alternative'
      );
    });

    it('keeps no_better_alternative for the factor of the Shaded Route (PBI-5.4)', () => {
      const result = selectWeightedRoute(
        [route('fast', 600, 0), route('long', 600 * MAX_DURATION_FACTOR + 1, 100)],
        { shade: 100, sun: 0 }
      );
      expect(result.status).toBe('no_better_alternative');
    });
  });

  it('asks for an improvement of at least 5 points in what the weights favour', () => {
    const result = selectWeightedRoute([route('fast', 600, 40), route('slightly', 601, 44)], {
      shade: 100,
      sun: 0
    });

    expect(result.selected).toBeNull();
  });

  it('weighs shade and sun against each other when both are set', () => {
    expect(exposurePenalty(route('r', 600, 30), { shade: 75, sun: 25 })).toBeCloseTo(60);
    // Shade and sun equally important: only time is left to decide.
    expect(selectWeightedRoute(candidates, { shade: 50, sun: 50 }).selected).toBeNull();
  });

  it('cannot choose without the exposure of the fastest route', () => {
    expect(
      selectWeightedRoute([route('fast', 600, 0, 'unavailable')], { shade: 50, sun: 0 })
    ).toMatchObject({ status: 'insufficient_exposure_data', selected: null });
  });

  it('requires candidates', () => {
    expect(() => selectWeightedRoute([], { shade: 50, sun: 0 })).toThrow(TypeError);
  });
});

describe('weighted route selection with wind (PBI-8.2)', () => {
  const windy = (id, duration, exposure, shadePercentage = null) => ({
    ...route(id, duration, shadePercentage, shadePercentage === null ? 'unavailable' : 'available'),
    windExposure:
      exposure === null
        ? { status: 'unavailable', exposure: null }
        : { status: 'available', exposure }
  });
  // Fastest straight into the wind and a sheltered alternative 10 % longer.
  const windCandidates = [windy('fast', 600, 90), windy('sheltered', 660, 30)];
  const onlyWind = (wind) => ({ shade: 0, sun: 0, wind });

  it('chooses the sheltered alternative with a high wind weight, without shadow data', () => {
    expect(selectWeightedRoute(windCandidates, onlyWind(100))).toMatchObject({
      status: 'selected',
      selected: { id: 'sheltered' },
      additionalDurationSeconds: 60,
      shadeChangePercentagePoints: null,
      windChangePoints: -60
    });
  });

  it('keeps the fastest route with a low wind weight', () => {
    // 600 × 1.045 = 627 is cheaper than 660 × 1.015 = 669.9.
    expect(selectWeightedRoute(windCandidates, onlyWind(5)).selected).toBeNull();
  });

  it('adds the wind to the cost like shade and sun', () => {
    const both = windy('r', 600, 40, 30);

    expect(weightedCost(both, { shade: 50, sun: 0, wind: 50 })).toBeCloseTo(
      600 * (1 + (50 * 70 + 50 * 40) / 10000)
    );
    expect(exposurePenalty(both, { shade: 50, sun: 0, wind: 50 })).toBeCloseTo(55);
  });

  it('needs the wind exposure of the fastest route when wind weighs', () => {
    expect(
      selectWeightedRoute([windy('fast', 600, null), windy('other', 620, 10)], onlyWind(50))
    ).toMatchObject({ status: 'insufficient_exposure_data', selected: null });
  });

  it('ignores the wind exposure when wind does not weigh', () => {
    const routes = [windy('fast', 600, null, 20), windy('shade', 680, null, 85)];

    expect(selectWeightedRoute(routes, { shade: 50, sun: 0, wind: 0 }).selected).toMatchObject({
      id: 'shade'
    });
  });
});

describe('vegetation weight (PBI-10 phase B, ADR-031)', () => {
  // The fastest route has no green; the greener ones are longer.
  const green = (id, duration, greenPercentage, status = 'available') => ({
    id,
    duration,
    exposure: { status: 'unavailable', shadePercentage: null, sunPercentage: null },
    vegetation: { status, greenPercentage: status === 'available' ? greenPercentage : null }
  });
  const greenCandidates = [green('fast', 600, 0), green('park', 740, 90), green('avenue', 630, 40)];

  it('penalises what is not green: 100 − % green', () => {
    expect(exposurePenalty(greenCandidates[0], { vegetation: 100 })).toBe(100);
    expect(exposurePenalty(greenCandidates[1], { vegetation: 100 })).toBe(10);
    expect(weightedCost(greenCandidates[1], { vegetation: 100 })).toBeCloseTo(740 * 1.1);
  });

  it('chooses a greener alternative within the extra time, and says how much greener', () => {
    const result = selectWeightedRoute(greenCandidates, { vegetation: 100 });

    expect(result).toMatchObject({
      status: 'selected',
      selected: { id: 'park' },
      additionalDurationSeconds: 140,
      greenChangePercentagePoints: 90
    });
  });

  it('with a lower weight accepts less extra time for the green', () => {
    expect(selectWeightedRoute(greenCandidates, { vegetation: 30 }).selected.id).toBe('avenue');
  });

  it('without vegetation weight the green does not count', () => {
    expect(selectWeightedRoute(greenCandidates, { vegetation: 0, wind: 0 })).toMatchObject({
      status: 'no_better_alternative',
      selected: null
    });
  });

  it('does not exceed the extra time allowed', () => {
    expect(
      selectWeightedRoute(greenCandidates, { vegetation: 100 }, { maxDurationFactor: 1.1 })
    ).toMatchObject({ selected: { id: 'avenue' } });
  });

  it('cannot compare without the green percentage of the fastest route', () => {
    const withoutData = [green('fast', 600, 0, 'unavailable'), greenCandidates[1]];
    expect(selectWeightedRoute(withoutData, { vegetation: 100 }).status).toBe(
      'insufficient_exposure_data'
    );
  });

  it('adds up with shade: a shaded park wins over a sunny one', () => {
    const both = [
      { ...green('fast', 600, 0), exposure: route('fast', 600, 10).exposure },
      { ...green('sunny park', 660, 90), exposure: route('x', 660, 10).exposure },
      { ...green('shaded park', 660, 90), exposure: route('y', 660, 70).exposure }
    ];
    expect(selectWeightedRoute(both, { shade: 50, vegetation: 50 })).toMatchObject({
      selected: { id: 'shaded park' },
      shadeChangePercentagePoints: 60,
      greenChangePercentagePoints: 90
    });
  });
});
