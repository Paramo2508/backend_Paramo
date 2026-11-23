const request = require('supertest');

jest.mock('../api/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.userId = 7;
    next();
  }
}));

jest.mock('../services/routing/routePreferencesService', () => ({
  routePreferencesService: {
    getPreferences: jest.fn(),
    savePreferences: jest.fn(),
    getWeatherSuggestion: jest.fn()
  }
}));

const { createApp } = require('../app');
const { routePreferencesService } = require('../services/routing/routePreferencesService');

const preferences = {
  sunShade: 'shade',
  avoidWind: true,
  preferParks: false,
  extraMinutes: 10
};

describe('/api/route-preferences (PBI-18, ADR-036)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET returns the preferences of the signed-in user', async () => {
    routePreferencesService.getPreferences.mockResolvedValue(preferences);

    const response = await request(createApp()).get('/api/route-preferences');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ preferences });
    expect(routePreferencesService.getPreferences).toHaveBeenCalledWith(7);
  });

  it('PUT replaces them and returns what was saved', async () => {
    routePreferencesService.savePreferences.mockResolvedValue(preferences);

    const response = await request(createApp()).put('/api/route-preferences').send(preferences);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ preferences });
    expect(routePreferencesService.savePreferences).toHaveBeenCalledWith(7, preferences);
  });

  it('PUT passes on a validation error as 400 with its fields', async () => {
    routePreferencesService.savePreferences.mockRejectedValue(
      Object.assign(new Error('Las preferencias no son válidas.'), {
        status: 400,
        fields: { extraMinutes: 'Elige 0, 2, 5, 10 o 15 minutos.' }
      })
    );

    const response = await request(createApp())
      .put('/api/route-preferences')
      .send({ ...preferences, extraMinutes: 7 });

    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({ extraMinutes: 'Elige 0, 2, 5, 10 o 15 minutos.' });
  });

  it('GET /weather returns what «Según el tiempo de hoy» marks now (PBI-21, ADR-037)', async () => {
    const suggestion = {
      status: 'available',
      criterion: 'hot',
      answers: { sunShade: 'shade', avoidWind: false },
      message: 'Hace calor (sensación de 31 °C): he marcado «Sombra».',
      weather: { temperature: 30, source: 'open-meteo' },
      calculatedAt: { date: '2026-07-10', time: '16:45', timeZone: 'Europe/Madrid' }
    };
    routePreferencesService.getWeatherSuggestion.mockResolvedValue(suggestion);

    const response = await request(createApp()).get('/api/route-preferences/weather');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ suggestion });
  });

  it('no longer offers the saved routes of PBI-6', async () => {
    const app = createApp();
    expect((await request(app).get('/api/route-profiles')).status).toBe(404);
    expect((await request(app).post('/api/route-profiles').send({})).status).toBe(404);
  });
});
