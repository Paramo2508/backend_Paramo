const {
  DEFAULT_PREFERENCES,
  alternativesWeightFactor,
  hasPreference,
  parseExtraMinutes,
  parsePreferences,
  weightsFromAnswers
} = require('../../domain/routes/routePreferences');

const answers = (overrides = {}) => ({
  sunShade: 'any',
  avoidWind: false,
  preferParks: false,
  ...overrides
});

describe('route preferences (PBI-18, ADR-036)', () => {
  it('starts with every answer indifferent and 5 extra minutes', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      sunShade: 'any',
      avoidWind: false,
      preferParks: false,
      extraMinutes: 5
    });
  });

  describe('answers to weights', () => {
    it('reuses the weights of the old presets and of the recommended route (50)', () => {
      expect(weightsFromAnswers(answers({ sunShade: 'shade' }))).toEqual({
        shade: 50,
        sun: 0,
        wind: 0,
        vegetation: 0
      });
      expect(weightsFromAnswers(answers({ sunShade: 'sun' }))).toEqual({
        shade: 0,
        sun: 50,
        wind: 0,
        vegetation: 0
      });
      expect(
        weightsFromAnswers(answers({ sunShade: 'shade', avoidWind: true, preferParks: true }))
      ).toEqual({ shade: 50, sun: 0, wind: 50, vegetation: 50 });
    });

    it('gives every weight at 0 when everything is indifferent: the fastest route', () => {
      expect(weightsFromAnswers(answers())).toEqual({ shade: 0, sun: 0, wind: 0, vegetation: 0 });
      expect(hasPreference(answers())).toBe(false);
      expect(hasPreference(answers({ preferParks: true }))).toBe(true);
      expect(hasPreference(answers({ avoidWind: true }))).toBe(true);
      expect(hasPreference(answers({ sunShade: 'sun' }))).toBe(true);
    });
  });

  it('asks ORS like the Shaded Route up to 5 minutes and with 1.4 from 10', () => {
    expect([0, 2, 5, 10, 15].map(alternativesWeightFactor)).toEqual([1.25, 1.25, 1.25, 1.4, 1.4]);
  });

  describe('validation', () => {
    it('accepts the five minute options and 5 by default', () => {
      [0, 2, 5, 10, 15].forEach((minutes) => expect(parseExtraMinutes(minutes)).toBe(minutes));
      expect(parseExtraMinutes()).toBe(5);
      [1, 3, 20, -5, 2.5, '5', null].forEach((minutes) =>
        expect(() => parseExtraMinutes(minutes)).toThrow(
          expect.objectContaining({
            status: 400,
            fields: { extraMinutes: 'Elige 0, 2, 5, 10 o 15 minutos.' }
          })
        )
      );
    });

    it('needs every preference and keeps only the known fields', () => {
      const stored = { ...DEFAULT_PREFERENCES, sunShade: 'shade', other: 'x' };
      expect(parsePreferences(stored)).toEqual({ ...DEFAULT_PREFERENCES, sunShade: 'shade' });
    });

    it('says which fields are wrong', () => {
      expect(() => parsePreferences({ sunShade: 'both', avoidWind: 1, extraMinutes: 7 })).toThrow(
        expect.objectContaining({
          status: 400,
          fields: {
            sunShade: expect.any(String),
            avoidWind: expect.any(String),
            preferParks: expect.any(String),
            extraMinutes: expect.any(String)
          }
        })
      );
      [null, [], 'shade'].forEach((value) => {
        expect(() => parsePreferences(value)).toThrow(expect.objectContaining({ status: 400 }));
      });
    });
  });
});
