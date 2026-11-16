const request = require('supertest');

jest.mock('../api/middleware/requireAuth', () => ({
  requireAuth: (req, res, next) => {
    if (!req.headers.authorization) {
      res.status(401).json({ error: { message: 'Necesitas iniciar sesión.' } });
      return;
    }
    req.userId = 7;
    next();
  }
}));

jest.mock('../services/routing/recentPlacesService', () => ({
  recentPlacesService: {
    listPlaces: jest.fn(),
    recordPlaces: jest.fn(),
    clearPlaces: jest.fn()
  }
}));

const { createApp } = require('../app');
const { recentPlacesService } = require('../services/routing/recentPlacesService');
const { httpError } = require('../utils/httpError');

const auth = { Authorization: 'Bearer token' };
const place = {
  id: 1,
  lat: 41.6572,
  lng: -0.88039,
  label: 'Plaza del Pilar',
  usedAt: '2026-11-16T20:00:00.000Z'
};
const body = { places: [{ lat: 41.6572, lng: -0.88039, label: 'Plaza del Pilar' }] };

describe('/api/recent-places', () => {
  beforeEach(() => jest.clearAllMocks());

  it('needs a session', async () => {
    const app = createApp();
    expect((await request(app).get('/api/recent-places')).status).toBe(401);
    expect((await request(app).post('/api/recent-places').send(body)).status).toBe(401);
    expect((await request(app).delete('/api/recent-places')).status).toBe(401);
    expect(recentPlacesService.listPlaces).not.toHaveBeenCalled();
  });

  it('lists, records and clears the recent places of the user', async () => {
    recentPlacesService.listPlaces.mockResolvedValue([place]);
    recentPlacesService.recordPlaces.mockResolvedValue([place]);
    recentPlacesService.clearPlaces.mockResolvedValue(1);
    const app = createApp();

    const listed = await request(app).get('/api/recent-places').set(auth);
    const recorded = await request(app).post('/api/recent-places').set(auth).send(body);
    const cleared = await request(app).delete('/api/recent-places').set(auth);

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ places: [place] });
    expect(recentPlacesService.listPlaces).toHaveBeenCalledWith(7);
    // The updated list comes back, so the client does not have to ask again.
    expect(recorded.status).toBe(200);
    expect(recorded.body).toEqual({ places: [place] });
    expect(recentPlacesService.recordPlaces).toHaveBeenCalledWith(7, body);
    expect(cleared.status).toBe(204);
    expect(recentPlacesService.clearPlaces).toHaveBeenCalledWith(7);
  });

  it('passes the validation errors to the client', async () => {
    recentPlacesService.recordPlaces.mockRejectedValue(
      httpError(400, 'El origen y el destino tienen que estar en Zaragoza.', {
        'places[0]': 'Fuera de Zaragoza.'
      })
    );
    const app = createApp();

    const invalid = await request(app).post('/api/recent-places').set(auth).send(body);

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.fields).toEqual({ 'places[0]': 'Fuera de Zaragoza.' });
  });
});
