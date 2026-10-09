const request = require('supertest');

// Authentication is covered in auth.test.js; these tests focus on the endpoint itself.
jest.mock('../api/middleware/requireAuth', () => ({
  requireAuth: (_req, _res, next) => next()
}));

jest.mock('../integrations/openRouteService/directionsClient', () => ({
  getFastestWalkingRoute: jest.fn()
}));

const { createApp } = require('../app');
const { getFastestWalkingRoute } = require('../integrations/openRouteService/directionsClient');

describe('POST /api/routes/fastest', () => {
  const origin = { lat: 41.6488, lng: -0.8891 };
  const destination = { lat: 41.656, lng: -0.878 };
  const route = {
    geometry: {
      type: 'LineString',
      coordinates: [
        [-0.8891, 41.6488],
        [-0.884, 41.652],
        [-0.878, 41.656]
      ]
    },
    distance: 1250.4,
    duration: 930.2
  };

  beforeEach(() => {
    getFastestWalkingRoute.mockReset();
  });

  it('returns the normalized fastest walking route', async () => {
    getFastestWalkingRoute.mockResolvedValue(route);

    const response = await request(createApp())
      .post('/api/routes/fastest')
      .send({ origin, destination });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route });
    expect(getFastestWalkingRoute).toHaveBeenCalledTimes(1);
    expect(getFastestWalkingRoute).toHaveBeenCalledWith({ origin, destination });
  });

  it.each([
    undefined,
    {},
    { origin },
    { destination },
    { origin: null, destination },
    { origin: [], destination },
    { origin: { lat: '41.6488', lng: -0.8891 }, destination },
    { origin: { lat: 91, lng: -0.8891 }, destination },
    { origin, destination: { lat: 41.656, lng: -181 } }
  ])('returns 400 for invalid coordinates %#', async (body) => {
    let pendingRequest = request(createApp()).post('/api/routes/fastest');
    if (body !== undefined) pendingRequest = pendingRequest.send(body);
    const response = await pendingRequest;

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        message: 'Origin and destination must contain valid latitude and longitude coordinates.'
      }
    });
    expect(getFastestWalkingRoute).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'Route provider quota has been exceeded. Please try again shortly.'],
    [502, 'Route provider is unavailable.'],
    [504, 'Route calculation timed out. Please try again.']
  ])('preserves controlled provider error %s', async (status, message) => {
    getFastestWalkingRoute.mockRejectedValue(Object.assign(new Error(message), { status }));

    const response = await request(createApp())
      .post('/api/routes/fastest')
      .send({ origin, destination });

    expect(response.status).toBe(status);
    expect(response.body).toEqual({
      error: { message }
    });
  });

  it('does not expose unexpected provider details', async () => {
    getFastestWalkingRoute.mockRejectedValue(
      new Error('test-key and sensitive provider response body')
    );

    const response = await request(createApp())
      .post('/api/routes/fastest')
      .send({ origin, destination });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { message: 'Internal server error' }
    });
    expect(response.text).not.toContain('test-key');
    expect(response.text).not.toContain('sensitive provider response body');
  });
});
