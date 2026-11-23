const { recommendationConfig } = require('../../config/recommendationConfig');
const { recommendRoute } = require('../../domain/routes/routeRecommendation');
const { weightsFromAnswers } = require('../../domain/routes/routePreferences');

// One case per row of ADR-029 and the exact limits of every threshold.
const config = recommendationConfig;
const DAY = { elevationDeg: 45 };
const NIGHT = { elevationDeg: -20 };

const weather = (overrides = {}) => ({
  temperature: 18,
  apparentTemperature: 18,
  windSpeed: 5,
  windGusts: 10,
  windDirection: 300,
  time: '2026-11-12T12:00',
  ...overrides
});

const recommend = (weatherOverrides, sun = DAY) =>
  recommendRoute({ weather: weather(weatherOverrides), sun }, config);

// The weights of the old presets, now those of the answers "Sombra" and "Sol" (ADR-036).
const SUN_SHADE = { fastest: 'any', shaded: 'shade', sunny: 'sun' };
const presetWeights = (presetKey) =>
  weightsFromAnswers({ sunShade: SUN_SHADE[presetKey], avoidWind: false, preferParks: false });

describe('recommended route rule (ADR-029)', () => {
  it('uses the thresholds confirmed by the product owner', () => {
    expect(config).toMatchObject({
      hotApparentTemperatureC: 26,
      coldApparentTemperatureC: 9,
      windSpeedKmh: 30,
      windGustsKmh: 50,
      windWeight: 50,
      minSunElevationDeg: 10
    });
  });

  describe('one case per row', () => {
    it('heat: the weights of the Shaded preset', () => {
      const result = recommend({ temperature: 30, apparentTemperature: 31 });
      expect(result).toMatchObject({
        criterion: 'hot',
        label: 'Calor',
        weights: { shade: 50, sun: 0, wind: 0 },
        maxDetourPercentage: 25
      });
      expect(result.reason).toBe(
        'Hace calor (sensación de 31 °C): se busca sombra aceptando hasta un 25 % más de tiempo.'
      );
      expect(result.rules).toContainEqual({
        variable: 'apparentTemperature',
        operator: '>=',
        threshold: 26,
        value: 31,
        unit: '°C'
      });
    });

    it('cold: the weights of the Sunny preset', () => {
      const result = recommend({ temperature: 6, apparentTemperature: 3 });
      expect(result).toMatchObject({
        criterion: 'cold',
        label: 'Frío',
        weights: { shade: 0, sun: 50, wind: 0 }
      });
      expect(result.reason).toBe(
        'Hace frío (sensación de 3 °C): se buscan calles al sol aceptando hasta un 25 % más de tiempo.'
      );
    });

    it('strong wind with a mild temperature: only wind weighs', () => {
      const result = recommend({ windSpeed: 40, windGusts: 65, windDirection: 300 });
      expect(result).toMatchObject({
        criterion: 'windy',
        label: 'Cierzo',
        weights: { shade: 0, sun: 0, wind: 50 }
      });
      expect(result.reason).toBe(
        'Sopla cierzo de 40 km/h con rachas de 65 km/h: se evita el viento de cara aceptando hasta un 25 % más de tiempo.'
      );
    });

    it('mild: the fastest route', () => {
      const result = recommend({ temperature: 17.5, apparentTemperature: 17, windSpeed: 12.6 });
      expect(result).toMatchObject({
        criterion: 'mild',
        label: 'Tiempo templado',
        weights: { shade: 0, sun: 0, wind: 0 }
      });
      expect(result.reason).toBe(
        'Temperatura agradable (sensación de 17 °C) y poco viento (13 km/h): la ruta recomendada es la más rápida.'
      );
    });

    it('heat and cierzo: shade and wind', () => {
      const result = recommend({ apparentTemperature: 30, windSpeed: 35, windGusts: 55 });
      expect(result).toMatchObject({
        criterion: 'hot_windy',
        label: 'Calor y cierzo',
        weights: { shade: 50, sun: 0, wind: 50 }
      });
      expect(result.reason).toBe(
        'Hace calor (sensación de 30 °C) y sopla cierzo de 35 km/h con rachas de 55 km/h: se busca sombra y evitar el viento de cara, aceptando hasta un 25 % más de tiempo.'
      );
    });

    it('cold and cierzo: sun and wind', () => {
      const result = recommend({ temperature: 7, apparentTemperature: 1, windSpeed: 45 });
      expect(result).toMatchObject({
        criterion: 'cold_windy',
        label: 'Frío y cierzo',
        weights: { shade: 0, sun: 50, wind: 50 }
      });
    });

    it('night without wind: the fastest route, whatever the temperature', () => {
      const result = recommend({ apparentTemperature: 30 }, NIGHT);
      expect(result).toMatchObject({
        criterion: 'low_sun',
        label: 'Noche',
        weights: { shade: 0, sun: 0, wind: 0 }
      });
      expect(result.reason).toBe(
        'Es de noche y hay poco viento (5 km/h): la ruta recomendada es la más rápida.'
      );
      expect(result.rules[0]).toEqual({
        variable: 'sunElevation',
        operator: '<',
        threshold: 10,
        value: -20,
        unit: '°'
      });
    });

    it('night with cierzo: only wind, which works at night (ADR-025)', () => {
      const result = recommend({ apparentTemperature: 2, windSpeed: 40 }, NIGHT);
      expect(result).toMatchObject({
        criterion: 'low_sun_windy',
        label: 'Noche y cierzo',
        weights: { shade: 0, sun: 0, wind: 50 }
      });
    });

    it('low Sun above the horizon: neither shade nor sun', () => {
      const result = recommend({ apparentTemperature: 30 }, { elevationDeg: 6 });
      expect(result).toMatchObject({ criterion: 'low_sun', label: 'Sol bajo' });
      expect(result.reason).toMatch(/^El Sol está bajo \(6° sobre el horizonte\)/);
    });

    it('Open-Meteo failed: the fastest route with a clear reason', () => {
      const result = recommendRoute({ weather: null, sun: DAY }, config);
      expect(result).toEqual({
        criterion: 'weather_unavailable',
        label: 'Sin datos del tiempo',
        weights: presetWeights('fastest'),
        maxDetourPercentage: 25,
        cause: 'No se ha podido consultar el tiempo actual',
        reason: 'No se ha podido consultar el tiempo actual: la ruta recomendada es la más rápida.',
        rules: []
      });
    });

    it.each([
      ['no temperature', { temperature: null }],
      ['no wind speed', { windSpeed: undefined }],
      ['no wind direction', { windDirection: Number.NaN }]
    ])('incomplete weather (%s): like Open-Meteo failing', (_case, overrides) => {
      expect(recommend(overrides).criterion).toBe('weather_unavailable');
    });
  });

  describe('exact limits', () => {
    it.each([
      [25.9, 'mild'],
      [26, 'hot'],
      [9.1, 'mild'],
      [9, 'cold']
    ])('apparent temperature %s °C → %s', (apparentTemperature, criterion) => {
      expect(recommend({ apparentTemperature }).criterion).toBe(criterion);
    });

    it.each([
      [29.9, 'mild'],
      [30, 'windy']
    ])('mean wind %s km/h → %s', (windSpeed, criterion) => {
      expect(recommend({ windSpeed, windGusts: 40 }).criterion).toBe(criterion);
    });

    it.each([
      [49.9, 'mild'],
      [50, 'windy']
    ])('gusts %s km/h with a weak mean wind → %s', (windGusts, criterion) => {
      expect(recommend({ windSpeed: 20, windGusts }).criterion).toBe(criterion);
    });

    it.each([
      [9.9, 'low_sun'],
      [10, 'hot']
    ])('solar elevation %s° → %s', (elevationDeg, criterion) => {
      expect(recommend({ apparentTemperature: 30 }, { elevationDeg }).criterion).toBe(criterion);
    });

    it.each([
      [269, 'Viento fuerte'],
      [270, 'Cierzo'],
      [340, 'Cierzo'],
      [341, 'Viento fuerte']
    ])('wind from %s° is called %s, with the same weights', (windDirection, label) => {
      const result = recommend({ windSpeed: 40, windDirection });
      expect(result.label).toBe(label);
      expect(result.weights).toEqual({ shade: 0, sun: 0, wind: 50, vegetation: 0 });
    });
  });

  describe('variables used', () => {
    it('falls back to the air temperature without the apparent one', () => {
      const result = recommend({ temperature: 27, apparentTemperature: null });
      expect(result.criterion).toBe('hot');
      expect(result.reason).toContain('temperatura de 27 °C');
      expect(result.rules[0]).toMatchObject({ variable: 'temperature', value: 27 });
    });

    it('decides with the mean wind alone when there are no gusts', () => {
      const calm = recommend({ windSpeed: 20, windGusts: null });
      expect(calm.criterion).toBe('mild');
      expect(calm.rules.map(({ variable }) => variable)).not.toContain('windGusts');
      const windy = recommend({ windSpeed: 30, windGusts: null });
      expect(windy.reason).toBe(
        'Sopla cierzo de 30 km/h: se evita el viento de cara aceptando hasta un 25 % más de tiempo.'
      );
    });

    it('lists only the wind rules that were met when the wind is strong', () => {
      const { rules } = recommend({ windSpeed: 20, windGusts: 60 });
      expect(rules.filter(({ variable }) => variable.startsWith('wind'))).toEqual([
        { variable: 'windGusts', operator: '>=', threshold: 50, value: 60, unit: 'km/h' }
      ]);
    });

    it('lists every condition of a mild day', () => {
      expect(recommend({}).rules).toEqual([
        { variable: 'apparentTemperature', operator: '>', threshold: 9, value: 18, unit: '°C' },
        { variable: 'apparentTemperature', operator: '<', threshold: 26, value: 18, unit: '°C' },
        { variable: 'windSpeed', operator: '<', threshold: 30, value: 5, unit: 'km/h' },
        { variable: 'windGusts', operator: '<', threshold: 50, value: 10, unit: 'km/h' },
        { variable: 'sunElevation', operator: '>=', threshold: 10, value: 45, unit: '°' }
      ]);
    });

    it('takes the thresholds from the configuration', () => {
      const result = recommendRoute(
        { weather: weather({ apparentTemperature: 22 }), sun: DAY },
        { ...config, hotApparentTemperatureC: 22, windWeight: 80 }
      );
      expect(result.criterion).toBe('hot');
    });

    it('reuses the preset weights instead of repeating them', () => {
      expect(recommend({ apparentTemperature: 30 }).weights).toEqual({
        ...presetWeights('shaded'),
        wind: 0
      });
      expect(recommend({ apparentTemperature: 0 }).weights).toEqual({
        ...presetWeights('sunny'),
        wind: 0
      });
    });

    it('rounds the solar elevation of the rule to a tenth of a degree', () => {
      const { rules } = recommend({}, { elevationDeg: 27.482022 });
      expect(rules.at(-1)).toMatchObject({ variable: 'sunElevation', value: 27.5 });
    });

    it.each([
      ['no sun', null],
      ['no elevation', {}],
      ['a non-finite elevation', { elevationDeg: Number.NaN }]
    ])('without the solar position (%s): like a low Sun, never an error', (_case, sun) => {
      const result = recommendRoute({ weather: weather({ apparentTemperature: 30 }), sun }, config);
      expect(result).toMatchObject({
        criterion: 'low_sun',
        label: 'Sol no disponible',
        weights: { shade: 0, sun: 0, wind: 0 }
      });
      expect(result.reason).toBe(
        'No se ha podido calcular la posición del Sol y hay poco viento (5 km/h): la ruta recomendada es la más rápida.'
      );
      expect(result.rules[0]).toEqual({
        variable: 'sunElevation',
        operator: 'unavailable',
        threshold: 10,
        value: null,
        unit: '°'
      });
    });

    it('without the solar position and with cierzo: only wind', () => {
      const result = recommendRoute(
        { weather: weather({ apparentTemperature: 2, windSpeed: 40 }), sun: null },
        config
      );
      expect(result).toMatchObject({
        criterion: 'low_sun_windy',
        label: 'Sol no disponible y cierzo',
        weights: { shade: 0, sun: 0, wind: 50 }
      });
      expect(result.reason).toMatch(/^No se ha podido calcular la posición del Sol y sopla cierzo/);
    });

    it('without weather and without the solar position: the weather comes first', () => {
      expect(recommendRoute({ weather: null, sun: null }, config).criterion).toBe(
        'weather_unavailable'
      );
    });
  });
});
