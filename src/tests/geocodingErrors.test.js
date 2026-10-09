const request = require('supertest');

// Authentication is covered in auth.test.js; these tests focus on the endpoint itself.
jest.mock('../api/middleware/requireAuth', () => ({
  requireAuth: (_req, _res, next) => next()
}));

const { createApp } = require('../app');
const { env } = require('../config/env');
const { autocompletePlaces } = require('../integrations/openRouteService/geocodingClient');

describe('geocoding validation and provider failures', () => {
  const originalFetch = global.fetch;
  const originalKey = env.openRouteServiceApiKey;
  beforeEach(() => {
    env.openRouteServiceApiKey = 'test-key';
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    env.openRouteServiceApiKey = originalKey;
    jest.useRealTimers();
  });

  it.each([
    'text=a&text=b',
    `text=${'x'.repeat(201)}`,
    'text=Pilar&limit=0',
    'text=Pilar&limit=11',
    'text=Pilar&limit=1.5',
    'text=Pilar&limit=abc',
    'text=Pilar&limit=2&limit=3'
  ])('rejects invalid query %s without calling the provider', async (query) => {
    const response = await request(createApp()).get(`/api/geocoding/autocomplete?${query}`);
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 502],
    [403, 502],
    [429, 429],
    [500, 502]
  ])('maps provider %s to %s', async (providerStatus, expected) => {
    global.fetch.mockResolvedValue({ ok: false, status: providerStatus });
    const response = await request(createApp()).get('/api/geocoding/autocomplete?text=Pilar');
    expect(response.status).toBe(expected);
    expect(JSON.stringify(response.body)).not.toContain('test-key');
  });

  it.each([null, {}, { features: {} }])('rejects malformed response bodies', async (body) => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => body });
    const response = await request(createApp()).get('/api/geocoding/autocomplete?text=Pilar');
    expect(response.status).toBe(502);
  });

  it('normalizes, validates, deduplicates and limits provider points with Zaragoza focus', async () => {
    const place = {
      geometry: { type: 'Point', coordinates: [-0.88, 41.65] },
      properties: { gid: '1', label: 'Pilar' }
    };
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          null,
          {},
          { ...place, geometry: { type: 'Point', coordinates: ['bad', 41] } },
          { ...place, geometry: { type: 'Point', coordinates: [0, 100] } },
          {
            ...place,
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1]
              ]
            }
          },
          place,
          place,
          { ...place, properties: { gid: '2', name: 'Second' } }
        ]
      })
    });
    const result = await autocompletePlaces({ text: 'Pilar', limit: 1 });
    expect(result).toEqual([{ id: '1', label: 'Pilar', lat: 41.65, lng: -0.88, source: 'search' }]);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url.searchParams.get('focus.point.lat')).toBe('41.6488');
    expect(url.searchParams.get('focus.point.lon')).toBe('-0.8891');
    expect(url.searchParams.get('boundary.country')).toBe('ESP');
    expect(url.searchParams.has('api_key')).toBe(false);
    expect(options.headers.Authorization).toBe('test-key');
  });

  it('handles empty results and network failures without exposing provider errors', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) })
      .mockRejectedValueOnce(new Error('sensitive provider details'));
    await expect(autocompletePlaces({ text: 'Pilar' })).resolves.toEqual([]);
    await expect(autocompletePlaces({ text: 'Pilar' })).rejects.toThrow(
      'Place search provider is unavailable.'
    );
  });

  it('aborts slow provider calls', async () => {
    jest.useFakeTimers();
    global.fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const result = autocompletePlaces({ text: 'Pilar' });
    const assertion = expect(result).rejects.toMatchObject({ status: 504 });
    await jest.advanceTimersByTimeAsync(8000);
    await assertion;
  });
});
