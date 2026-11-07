const {
  CANYON_HW_RATIO,
  CROSSWIND_FACTOR,
  OPEN_HW_RATIO,
  opennessFromRatio,
  withCrosswind
} = require('../../domain/wind/streetOpenness');
const { directionalAlignment } = require('../../domain/wind/routeWindExposure');
const { calculateWindExposure, windAlignment } = require('../../domain/wind/windExposure');

const street = (bearingDeg) => [{ bearingDeg, lengthM: 100 }];
const strong = (directionDeg) => ({ speedKmh: 50, directionDeg });

describe('opennessFromRatio (Oke 1988)', () => {
  it.each([
    [0, 1],
    [OPEN_HW_RATIO, 1],
    [(OPEN_HW_RATIO + CANYON_HW_RATIO) / 2, 0.5],
    [CANYON_HW_RATIO, 0],
    [2, 0]
  ])('maps an H/W of %s to %s', (ratio, openness) => {
    expect(opennessFromRatio(ratio)).toBeCloseTo(openness);
  });

  it('treats a missing ratio (no buildings) as open', () => {
    expect(opennessFromRatio(null)).toBe(1);
    expect(opennessFromRatio(Number.NaN)).toBe(1);
  });
});

describe('withCrosswind', () => {
  it('adds the part across the street only in open spaces', () => {
    expect(withCrosswind(0, 90, 0)).toBe(0);
    expect(withCrosswind(0, 90, 1)).toBeCloseTo(CROSSWIND_FACTOR);
    expect(withCrosswind(0, 90, 0.5)).toBeCloseTo(CROSSWIND_FACTOR / 2);
    expect(withCrosswind(1, 0, 1)).toBe(1);
  });

  it('never goes above 1 and ignores an invalid openness', () => {
    expect(withCrosswind(Math.SQRT1_2, 45, 1)).toBe(1);
    expect(withCrosswind(0.2, 90, undefined)).toBe(0.2);
    expect(withCrosswind(0.2, 90, 3)).toBeCloseTo(0.2 + CROSSWIND_FACTOR);
  });
});

describe('wind exposure with the openness of the street (PBI-8.3)', () => {
  it('makes a perpendicular wind count in an open street and not in a canyon', () => {
    const open = calculateWindExposure(street(0), strong(90), { openness: 1 });
    const canyon = calculateWindExposure(street(0), strong(90), { openness: 0 });

    expect(open.windExposure).toBeCloseTo(50);
    expect(canyon.windExposure).toBeCloseTo(0);
  });

  it.each([0, 0.5, 1])(
    'keeps an aligned street above a perpendicular one with openness %s',
    (openness) => {
      expect(windAlignment(street(90), 90, openness)).toBeGreaterThan(
        windAlignment(street(0), 90, openness)
      );
    }
  );

  it('keeps PBI-8.1 for canyons, the default', () => {
    expect(windAlignment(street(45), 90)).toBeCloseTo(Math.SQRT1_2);
    expect(windAlignment(street(45), 90, 0)).toBeCloseTo(Math.SQRT1_2);
  });

  it('applies to the walking direction of the routes too', () => {
    // Walking north with wind from the east: crosswind.
    expect(directionalAlignment(0, 90, 0)).toBeCloseTo(0);
    expect(directionalAlignment(0, 90, 1)).toBeCloseTo(CROSSWIND_FACTOR);
    // Headwind stays 1 and tailwind 0.5 in a canyon.
    expect(directionalAlignment(0, 0, 1)).toBeCloseTo(1);
    expect(directionalAlignment(0, 180, 0)).toBeCloseTo(0.5);
  });
});
