const {
  ZARAGOZA_CENTRE,
  createRoutePreferencesService
} = require('../../services/routing/routePreferencesService');
const {
  preferencesFromRoute
} = require('../../repositories/migrations/20261123000001-create-route-preferences');

const saved = {
  sunShade: 'sun',
  avoidWind: false,
  preferParks: true,
  extraMinutes: 2,
  byWeather: false
};

describe('route preferences service (PBI-18, ADR-036; PBI-21, ADR-037)', () => {
  const repository = { findForUser: jest.fn(), saveForUser: jest.fn() };
  const service = createRoutePreferencesService(repository);

  beforeEach(() => jest.clearAllMocks());

  it('gives the saved preferences of the user', async () => {
    repository.findForUser.mockResolvedValue(saved);
    await expect(service.getPreferences(3)).resolves.toEqual(saved);
    expect(repository.findForUser).toHaveBeenCalledWith(3);
  });

  it('gives the defaults to a user who never saved any, with «Según el tiempo de hoy» on', async () => {
    repository.findForUser.mockResolvedValue(null);
    await expect(service.getPreferences(3)).resolves.toEqual({
      sunShade: 'any',
      avoidWind: false,
      preferParks: false,
      extraMinutes: 5,
      byWeather: true
    });
  });

  it('validates before saving', async () => {
    repository.saveForUser.mockResolvedValue(saved);
    await expect(service.savePreferences(3, { ...saved, extra: 1 })).resolves.toEqual(saved);
    expect(repository.saveForUser).toHaveBeenCalledWith(3, saved);

    expect(() => service.savePreferences(3, { ...saved, sunShade: 'both' })).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(repository.saveForUser).toHaveBeenCalledTimes(1);
  });

  it('saves «Según el tiempo de hoy» on, and off when a client does not send it', async () => {
    repository.saveForUser.mockImplementation(async (_id, preferences) => preferences);
    await service.savePreferences(3, { ...saved, byWeather: true });
    expect(repository.saveForUser).toHaveBeenLastCalledWith(3, { ...saved, byWeather: true });

    const withoutIt = { ...saved };
    delete withoutIt.byWeather;
    await service.savePreferences(3, withoutIt);
    expect(repository.saveForUser).toHaveBeenLastCalledWith(3, { ...saved, byWeather: false });
  });

  it('rejects a «Según el tiempo de hoy» that is not yes or no, with the other wrong fields', () => {
    expect(() =>
      service.savePreferences(3, { ...saved, byWeather: 'yes', extraMinutes: 7 })
    ).toThrow(
      expect.objectContaining({
        status: 400,
        fields: expect.objectContaining({
          byWeather: expect.any(String),
          extraMinutes: expect.any(String)
        })
      })
    );
    expect(repository.saveForUser).not.toHaveBeenCalled();
  });

  describe('weather suggestion', () => {
    const hot = {
      temperature: 32,
      apparentTemperature: 34,
      windSpeed: 8,
      windGusts: 15,
      windDirection: 300,
      time: '2026-07-10T16:45',
      timeZone: 'Europe/Madrid'
    };
    // 16:45 in summer in Zaragoza: the Sun is high.
    const now = () => new Date('2026-07-10T14:45:00Z');
    const solarCalculator = jest.fn(() => ({ elevationDegrees: 45 }));

    it('marks shade with heat, without calculating a route, with the Sun at the centre of Zaragoza', async () => {
      const suggestion = await service.getWeatherSuggestion({
        weather: async () => hot,
        now,
        solarCalculator
      });
      expect(suggestion).toMatchObject({
        status: 'available',
        criterion: 'hot',
        answers: { sunShade: 'shade', avoidWind: false },
        message: 'Hace calor (sensación de 34 °C): he marcado «Sombra».',
        weather: { temperature: 32, apparentTemperature: 34, source: 'open-meteo' },
        calculatedAt: { date: '2026-07-10', time: '16:45', timeZone: 'Europe/Madrid' }
      });
      expect(solarCalculator).toHaveBeenCalledWith(
        expect.objectContaining({ latitude: ZARAGOZA_CENTRE.lat, longitude: ZARAGOZA_CENTRE.lng })
      );
      expect(repository.saveForUser).not.toHaveBeenCalled();
    });

    it('without Open-Meteo says so and changes nothing', async () => {
      const suggestion = await service.getWeatherSuggestion({
        weather: async () => {
          throw new Error('Open-Meteo down');
        },
        now,
        solarCalculator
      });
      expect(suggestion).toMatchObject({
        status: 'unavailable',
        answers: null,
        weather: null,
        message:
          'No se ha podido consultar el tiempo actual: tus preferencias se quedan como estaban.'
      });
    });
  });
});

describe('migration create-route-preferences: a saved route as preferences', () => {
  const route = (shadeWeight, sunWeight, windWeight, vegetationWeight, maxDetourPercentage) => ({
    shadeWeight,
    sunWeight,
    windWeight,
    vegetationWeight,
    maxDetourPercentage
  });

  it.each([
    // The routes of the local database on 2026-11-23 (user 3).
    ['Soleada edited to shade 60', route(60, 0, 0, 0, 40), 'shade', false, false, 15],
    ['verde', route(0, 0, 0, 100, 40), 'any', false, true, 15],
    ['Asistente', route(0, 75, 25, 0, 25), 'sun', true, false, 5],
    ['Rápida', route(0, 0, 0, 0, 25), 'any', false, false, 5],
    ['light weights stay indifferent', route(24, 0, 24, 24, 12), 'any', false, false, 2],
    ['no extra time', route(50, 0, 0, 0, 0), 'shade', false, false, 0],
    ['30 % is 10 minutes', route(0, 50, 0, 0, 30), 'sun', false, false, 10]
  ])('%s', (_name, savedRoute, sunShade, avoidWind, preferParks, extraMinutes) => {
    expect(preferencesFromRoute(savedRoute)).toEqual({
      sunShade,
      avoidWind,
      preferParks,
      extraMinutes
    });
  });
});
