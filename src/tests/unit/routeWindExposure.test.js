const {
  TAILWIND_FACTOR,
  calculateRouteWindExposure,
  directionalAlignment,
  parseRouteWind,
  routePieces
} = require('../../domain/wind/routeWindExposure');

const route = (...coordinates) => ({ geometry: { type: 'LineString', coordinates } });
// About 1.1 km north and about 0.83 km east of the centre of Zaragoza.
const north = route([-0.88, 41.65], [-0.88, 41.66]);
const south = route([-0.88, 41.66], [-0.88, 41.65]);
const east = route([-0.88, 41.65], [-0.87, 41.65]);
const strong = (directionDeg) => ({ speedKmh: 50, directionDeg });

describe('routePieces', () => {
  it('measures the walking direction and length of each straight piece', () => {
    const [piece] = routePieces(north.geometry);

    expect(piece.bearingDeg).toBeCloseTo(0);
    expect(piece.lengthM).toBeCloseTo(1112, -1);
    expect(routePieces(east.geometry)[0].bearingDeg).toBeCloseTo(90, 1);
    expect(routePieces(south.geometry)[0].bearingDeg).toBeCloseTo(180);
  });

  it('skips repeated points and handles a missing geometry', () => {
    expect(
      routePieces(route([-0.88, 41.65], [-0.88, 41.65], [-0.88, 41.66]).geometry)
    ).toHaveLength(1);
    expect(routePieces(undefined)).toEqual([]);
  });
});

describe('directionalAlignment', () => {
  it('counts a headwind in full, a tailwind reduced and a crosswind as 0', () => {
    expect(directionalAlignment(0, 0)).toBeCloseTo(1);
    expect(directionalAlignment(0, 180)).toBeCloseTo(TAILWIND_FACTOR);
    expect(directionalAlignment(0, 90)).toBeCloseTo(0);
    expect(directionalAlignment(0, 45)).toBeCloseTo(Math.SQRT1_2);
    expect(directionalAlignment(0, 225)).toBeCloseTo(Math.SQRT1_2 * TAILWIND_FACTOR);
  });
});

describe('calculateRouteWindExposure', () => {
  // Wind comes "from" its direction: walking north into a north wind is a headwind.
  it('scores a headwind higher than a tailwind on the same street', () => {
    const headwind = calculateRouteWindExposure(north, strong(0));
    const tailwind = calculateRouteWindExposure(south, strong(0));

    expect(headwind).toMatchObject({ status: 'available', reason: null, intensity: 1 });
    expect(headwind.exposure).toBeCloseTo(100);
    expect(tailwind.exposure).toBeCloseTo(100 * TAILWIND_FACTOR);
  });

  it('scores a crosswind as 0', () => {
    expect(calculateRouteWindExposure(east, strong(0)).exposure).toBeCloseTo(0, 1);
  });

  it('weights each piece of a route with turns by its length', () => {
    // North (1.11 km, headwind) and then east (0.83 km, crosswind).
    const turning = route([-0.88, 41.65], [-0.88, 41.66], [-0.87, 41.66]);
    const [up, across] = routePieces(turning.geometry);

    expect(calculateRouteWindExposure(turning, strong(0)).exposure).toBeCloseTo(
      (100 * up.lengthM) / (up.lengthM + across.lengthM),
      0
    );
  });

  it('uses the intensity of PBI-8.1: calm wind does not count', () => {
    expect(calculateRouteWindExposure(north, { speedKmh: 5, directionDeg: 0 }).exposure).toBe(0);
    expect(
      calculateRouteWindExposure(north, { speedKmh: 30, directionDeg: 0 }).exposure
    ).toBeCloseTo(50);
  });

  it('is unavailable without a usable geometry', () => {
    expect(calculateRouteWindExposure(route([-0.88, 41.65]), strong(0))).toEqual({
      status: 'unavailable',
      reason: 'invalid_route_geometry',
      exposure: null,
      alignment: null,
      intensity: null,
      openness: null
    });
  });
});

describe('parseRouteWind', () => {
  it('returns null without a wind and the wind when it is valid', () => {
    expect(parseRouteWind(undefined)).toBeNull();
    expect(parseRouteWind(null)).toBeNull();
    expect(parseRouteWind({ speedKmh: 40, directionDeg: 300 })).toEqual({
      speedKmh: 40,
      directionDeg: 300
    });
  });

  it.each([
    [{ speedKmh: '40', directionDeg: 300 }, 'windSpeedKmh'],
    [{ speedKmh: 201, directionDeg: 300 }, 'windSpeedKmh'],
    [{ speedKmh: 40, directionDeg: 361 }, 'windDirectionDeg'],
    [{ speedKmh: 40 }, 'windDirectionDeg'],
    ['strong', 'windSpeedKmh']
  ])('rejects %j with a 400 on %s', (wind, field) => {
    expect(() => parseRouteWind(wind)).toThrow(
      expect.objectContaining({
        status: 400,
        fields: expect.objectContaining({ [field]: expect.any(String) })
      })
    );
  });
});
