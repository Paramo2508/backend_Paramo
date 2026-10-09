const request = require('supertest');

// Authentication is covered in auth.test.js; these tests focus on the endpoint itself.
jest.mock('../api/middleware/requireAuth', () => ({
  requireAuth: (_req, _res, next) => next()
}));

const { createApp } = require('../app');
const { env } = require('../config/env');

describe('GET /api/geocoding/autocomplete', () => {
  const originalFetch = global.fetch;
  const originalApiKey = env.openRouteServiceApiKey;

  afterEach(() => {
    global.fetch = originalFetch;
    env.openRouteServiceApiKey = originalApiKey;
  });

  it('returns no results for short input without calling the provider', async () => {
    global.fetch = jest.fn();

    const response = await request(createApp()).get('/api/geocoding/autocomplete?text=za');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('normalizes autocomplete provider results', async () => {
    env.openRouteServiceApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: {
              type: 'Point',
              coordinates: [-0.878, 41.656]
            },
            properties: {
              gid: 'pelias:venue:1',
              label: 'Plaza del Pilar, Zaragoza, Spain'
            }
          }
        ]
      })
    });

    const response = await request(createApp()).get(
      '/api/geocoding/autocomplete?text=Plaza%20del%20Pilar'
    );

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([
      {
        id: 'pelias:venue:1',
        label: 'Plaza del Pilar, Zaragoza, Spain',
        lat: 41.656,
        lng: -0.878,
        source: 'search'
      }
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('test-key');
  });

  it('returns 503 when the API key is not configured', async () => {
    env.openRouteServiceApiKey = '';

    const response = await request(createApp()).get(
      '/api/geocoding/autocomplete?text=Plaza%20del%20Pilar'
    );

    expect(response.status).toBe(503);
  });
});
