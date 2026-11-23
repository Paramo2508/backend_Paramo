const request = require('supertest');

jest.mock('../api/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.userId = 7;
    next();
  }
}));

jest.mock('../services/routing/weightedRouteService', () => ({
  calculateWeightedRouteComparison: jest.fn()
}));

const { createApp } = require('../app');
const { calculateWeightedRouteComparison } = require('../services/routing/weightedRouteService');

const body = {
  origin: { lat: 41.6488, lng: -0.8891 },
  destination: { lat: 41.656, lng: -0.878 },
  date: '2026-06-21',
  time: '14:00',
  timeZone: 'Europe/Madrid',
  preferences: { sunShade: 'shade', avoidWind: false, preferParks: true, extraMinutes: 10 }
};

describe('POST /api/routes/preferred (PBI-18, ADR-036)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calculates the weighted route of the answers', async () => {
    calculateWeightedRouteComparison.mockResolvedValue({ status: 'over_extra_time' });

    const response = await request(createApp()).post('/api/routes/preferred').send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      comparison: {
        status: 'over_extra_time',
        preferences: { ...body.preferences, hasPreference: true }
      }
    });
    expect(calculateWeightedRouteComparison).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: body.origin,
        destination: body.destination,
        weights: { shade: 50, sun: 0, wind: 0, vegetation: 50 },
        extraMinutes: 10
      }),
      {}
    );
  });

  it('rejects answers that are not one of the options with 400', async () => {
    const response = await request(createApp())
      .post('/api/routes/preferred')
      .send({ ...body, preferences: { ...body.preferences, sunShade: 'both', extraMinutes: 7 } });

    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({
      sunShade: 'Elige «Sombra», «Sol» o «Me da igual».',
      extraMinutes: 'Elige 0, 2, 5, 10 o 15 minutos.'
    });
    expect(calculateWeightedRouteComparison).not.toHaveBeenCalled();
  });

  it('no longer offers POST /api/routes/weighted: weights are not part of the API', async () => {
    const response = await request(createApp())
      .post('/api/routes/weighted')
      .send({ ...body, weights: { shade: 50 } });

    expect(response.status).toBe(404);
  });
});
