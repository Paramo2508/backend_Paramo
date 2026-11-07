const { calculateWeightedRouteComparison } = require('../../services/routing/weightedRouteService');

const geometry = (offset = 0) => ({
  type: 'LineString',
  coordinates: [
    [-0.889 + offset, 41.6488],
    [-0.878 + offset, 41.656]
  ]
});

const input = {
  origin: { lat: 41.6488, lng: -0.8891 },
  destination: { lat: 41.656, lng: -0.878 },
  date: '2026-06-21',
  time: '14:00',
  timeZone: 'Europe/Madrid'
};

const solarPosition = {
  instant: '2026-06-21T12:00:00Z',
  localDateTime: '2026-06-21T14:00:00+02:00',
  timeZone: 'Europe/Madrid',
  latitude: 41.6488,
  longitude: -0.8891,
  aboveHorizon: true
};

describe('weighted route service', () => {
  const routesProvider = jest.fn();
  const findSegmentsForRoutes = jest.fn();
  const exposureCalculator = jest.fn();
  const solarCalculator = jest.fn();
  const fastestRouteCalculator = jest.fn();
  const weather = jest.fn();
  const findOpennessNearPoints = jest.fn();
  const dependencies = {
    weather,
    opennessRepository: { findOpennessNearPoints },
    alternativesProvider: routesProvider,
    routeSegmentRepository: { findSegmentsForRoutes },
    exposureCalculator,
    solarCalculator,
    fastestRouteCalculator
  };

  beforeEach(() => {
    jest.clearAllMocks();
    solarCalculator.mockReturnValue(solarPosition);
    // Calm by default: the wind does not change the PBI-6 cases.
    weather.mockResolvedValue({ windSpeed: 5, windDirection: 0, time: '2026-06-21T14:00' });
    // Canyons by default: the model of PBI-8.2, only the wind along the streets counts.
    findOpennessNearPoints.mockImplementation(async (points) => points.map(() => 0));
    // A sunny fastest route and a shaded alternative 10 % longer.
    routesProvider.mockResolvedValue([
      { geometry: geometry(), distance: 1000, duration: 600 },
      { geometry: geometry(0.001), distance: 1100, duration: 660 }
    ]);
    findSegmentsForRoutes.mockResolvedValue([
      { routeIndex: 0, segmentId: 1, overlapLengthM: 1000 },
      { routeIndex: 1, segmentId: 2, overlapLengthM: 1100 }
    ]);
    exposureCalculator.mockResolvedValue({
      status: 'calculated',
      reference: solarPosition,
      segments: [
        { segmentId: 1, status: 'available', shadeRatio: 0.1 },
        { segmentId: 2, status: 'available', shadeRatio: 0.8 }
      ]
    });
  });

  it('chooses the alternative that suits the weights', async () => {
    const result = await calculateWeightedRouteComparison(
      { ...input, weights: { shade: 50, sun: 0 } },
      dependencies
    );

    expect(result).toMatchObject({
      status: 'selected',
      weights: { shade: 50, sun: 0 },
      fastest: { duration: 600 },
      selected: { duration: 660 },
      additionalDurationSeconds: 60,
      candidatesEvaluated: 2,
      strategy: { maximumDurationFactor: 1.25, minimumImprovementPercentagePoints: 5 }
    });
    expect(result.shadeChangePercentagePoints).toBeCloseTo(70);
    expect(exposureCalculator).toHaveBeenCalledTimes(1);
    // Up to 25 %, ORS is asked exactly as for the Shaded Route.
    expect(routesProvider).toHaveBeenCalledWith(expect.any(Object), { weightFactor: 1.25 });
  });

  it('only accepts the extra time chosen by the user', async () => {
    const result = await calculateWeightedRouteComparison(
      { ...input, weights: { shade: 50, sun: 0 }, maxDetourPercentage: 5 },
      dependencies
    );

    expect(result).toMatchObject({
      status: 'no_better_alternative',
      strategy: { maximumDurationFactor: 1.05 }
    });
  });

  it('asks ORS for longer alternatives when the user accepts more time', async () => {
    await calculateWeightedRouteComparison(
      { ...input, weights: { shade: 50, sun: 0 }, maxDetourPercentage: 40 },
      dependencies
    );

    expect(routesProvider).toHaveBeenCalledWith(expect.any(Object), { weightFactor: 1.4 });
  });

  it('keeps the fastest route when the weights favour what it already has', async () => {
    const result = await calculateWeightedRouteComparison(
      { ...input, weights: { shade: 0, sun: 50 } },
      dependencies
    );

    expect(result).toMatchObject({ status: 'no_better_alternative', selected: null });
  });

  it('only asks for the fastest route when every weight is 0', async () => {
    fastestRouteCalculator.mockResolvedValue({ distance: 1000, duration: 600 });

    const result = await calculateWeightedRouteComparison(
      { ...input, weights: { shade: 0, sun: 0 } },
      dependencies
    );

    expect(result).toMatchObject({
      status: 'fastest_only',
      fastest: { duration: 600 },
      selected: null
    });
    expect(routesProvider).not.toHaveBeenCalled();
    expect(exposureCalculator).not.toHaveBeenCalled();
  });

  it('explains why there are no shadows', async () => {
    exposureCalculator.mockResolvedValue({ status: 'sun_too_low', reference: solarPosition });

    const result = await calculateWeightedRouteComparison(
      { ...input, weights: { shade: 50, sun: 0 } },
      dependencies
    );

    expect(result).toMatchObject({ status: 'sun_too_low', selected: null });
  });

  it('rejects invalid weights before spending provider quota', async () => {
    await expect(
      calculateWeightedRouteComparison({ ...input, weights: { shade: 200 } }, dependencies)
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      calculateWeightedRouteComparison(
        { ...input, weights: { shade: 50 }, maxDetourPercentage: 80 },
        dependencies
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(routesProvider).not.toHaveBeenCalled();
    expect(fastestRouteCalculator).not.toHaveBeenCalled();
  });

  describe('wind (PBI-8.2)', () => {
    // The fastest route goes straight north; the alternative, 10 % longer, east and then north.
    const straightNorth = {
      type: 'LineString',
      coordinates: [
        [-0.88, 41.65],
        [-0.88, 41.66]
      ]
    };
    const eastThenNorth = {
      type: 'LineString',
      coordinates: [
        [-0.88, 41.65],
        [-0.87, 41.65],
        [-0.87, 41.66]
      ]
    };
    const northWind = { speedKmh: 50, directionDeg: 0 };

    beforeEach(() => {
      routesProvider.mockResolvedValue([
        { geometry: straightNorth, distance: 1000, duration: 600 },
        { geometry: eastThenNorth, distance: 1100, duration: 660 }
      ]);
    });

    it('avoids the headwind with a high wind weight and does not calculate shadows', async () => {
      const result = await calculateWeightedRouteComparison(
        { ...input, weights: { wind: 100 }, wind: northWind },
        dependencies
      );

      expect(result).toMatchObject({
        status: 'selected',
        weights: { shade: 0, sun: 0, wind: 100 },
        wind: { speedKmh: 50, directionDeg: 0, source: 'request', time: null },
        selected: { duration: 660, windExposure: { status: 'available' } },
        shadeChangePercentagePoints: null
      });
      expect(result.fastest.windExposure.exposure).toBeCloseTo(100);
      expect(result.selected.windExposure.exposure).toBeLessThan(60);
      expect(result.windChangePoints).toBeLessThan(-40);
      expect(findSegmentsForRoutes).not.toHaveBeenCalled();
      expect(exposureCalculator).not.toHaveBeenCalled();
      expect(weather).not.toHaveBeenCalled();
    });

    it('keeps the fastest route with the wind weight at 0', async () => {
      fastestRouteCalculator.mockResolvedValue({
        geometry: straightNorth,
        distance: 1000,
        duration: 600
      });

      const result = await calculateWeightedRouteComparison(
        { ...input, weights: { wind: 0 }, wind: northWind },
        dependencies
      );

      expect(result).toMatchObject({ status: 'fastest_only', selected: null });
      expect(result.fastest.windExposure.exposure).toBeCloseTo(100);
    });

    it('minds a tailwind less: with the same weight it only avoids the headwind', async () => {
      const weights = { wind: 30 };
      const headwind = await calculateWeightedRouteComparison(
        { ...input, weights, wind: northWind },
        dependencies
      );
      const tailwind = await calculateWeightedRouteComparison(
        { ...input, weights, wind: { speedKmh: 50, directionDeg: 180 } },
        dependencies
      );

      expect(headwind.status).toBe('selected');
      expect(tailwind.status).toBe('no_better_alternative');
      expect(tailwind.fastest.windExposure.exposure).toBeCloseTo(50);
    });

    it('does not count a crosswind', async () => {
      const result = await calculateWeightedRouteComparison(
        { ...input, weights: { wind: 100 }, wind: { speedKmh: 50, directionDeg: 90 } },
        dependencies
      );

      expect(result.fastest.windExposure.exposure).toBeCloseTo(0, 1);
      expect(result.status).toBe('no_better_alternative');
    });

    it('uses the current Open-Meteo wind without a wind in the request', async () => {
      weather.mockResolvedValue({ windSpeed: 50, windDirection: 0, time: '2026-11-06T12:00' });

      const result = await calculateWeightedRouteComparison(
        { ...input, weights: { wind: 100 } },
        dependencies
      );

      expect(result.wind).toEqual({
        speedKmh: 50,
        directionDeg: 0,
        source: 'open-meteo',
        time: '2026-11-06T12:00'
      });
      expect(result.status).toBe('selected');
    });

    it('still compares shade when Open-Meteo fails and wind does not weigh', async () => {
      weather.mockRejectedValue(Object.assign(new Error('down'), { status: 502 }));

      const result = await calculateWeightedRouteComparison(
        { ...input, weights: { shade: 50 } },
        dependencies
      );

      expect(result).toMatchObject({ status: 'selected', wind: null });
      expect(result.fastest.windExposure).toMatchObject({
        status: 'unavailable',
        reason: 'weather_unavailable'
      });
    });

    it('fails when Open-Meteo fails and wind weighs', async () => {
      weather.mockRejectedValue(Object.assign(new Error('down'), { status: 502 }));

      await expect(
        calculateWeightedRouteComparison({ ...input, weights: { wind: 50 } }, dependencies)
      ).rejects.toMatchObject({ status: 502 });
      expect(routesProvider).not.toHaveBeenCalled();
    });

    it('rejects an invalid wind before spending provider quota', async () => {
      await expect(
        calculateWeightedRouteComparison(
          { ...input, weights: { wind: 50 }, wind: { speedKmh: -1, directionDeg: 0 } },
          dependencies
        )
      ).rejects.toMatchObject({ status: 400 });
      expect(routesProvider).not.toHaveBeenCalled();
      expect(weather).not.toHaveBeenCalled();
    });

    it('counts the crosswind in open streets (PBI-8.3)', async () => {
      const crosswind = { speedKmh: 50, directionDeg: 90 };
      const inCanyons = await calculateWeightedRouteComparison(
        { ...input, weights: { wind: 100 }, wind: crosswind },
        dependencies
      );
      findOpennessNearPoints.mockImplementation(async (points) => points.map(() => 1));
      const inTheOpen = await calculateWeightedRouteComparison(
        { ...input, weights: { wind: 100 }, wind: crosswind },
        dependencies
      );

      expect(inCanyons.fastest.windExposure.exposure).toBeCloseTo(0, 1);
      expect(inTheOpen.fastest.windExposure).toMatchObject({ openness: 1 });
      expect(inTheOpen.fastest.windExposure.exposure).toBeCloseTo(50);
    });

    it('treats pieces without a nearby street as open', async () => {
      findOpennessNearPoints.mockImplementation(async (points) => points.map(() => null));

      const result = await calculateWeightedRouteComparison(
        { ...input, weights: { wind: 100 }, wind: { speedKmh: 50, directionDeg: 90 } },
        dependencies
      );

      expect(result.fastest.windExposure.openness).toBe(1);
    });

    it('asks for the openness of every piece of every route in one query', async () => {
      await calculateWeightedRouteComparison(
        { ...input, weights: { wind: 100 }, wind: northWind },
        dependencies
      );

      expect(findOpennessNearPoints).toHaveBeenCalledTimes(1);
      // One piece in the fastest route and two in the alternative.
      expect(findOpennessNearPoints.mock.calls[0][0]).toHaveLength(3);
      expect(findOpennessNearPoints.mock.calls[0][1]).toBe(10);
    });

    it('does not look for the openness with calm wind', async () => {
      await calculateWeightedRouteComparison(
        { ...input, weights: { wind: 100 }, wind: { speedKmh: 5, directionDeg: 0 } },
        dependencies
      );

      expect(findOpennessNearPoints).not.toHaveBeenCalled();
    });
  });
});
