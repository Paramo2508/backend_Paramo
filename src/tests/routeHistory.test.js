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

jest.mock('../services/routing/routeHistoryService', () => ({
  routeHistoryService: {
    listFavorites: jest.fn(),
    addFavorite: jest.fn(),
    removeFavorite: jest.fn()
  }
}));

const { createApp } = require('../app');
const { routeHistoryService } = require('../services/routing/routeHistoryService');
const { httpError } = require('../utils/httpError');

const auth = { Authorization: 'Bearer token' };
const trip = {
  origin: { lat: 41.6572, lng: -0.88039, label: 'Plaza del Pilar' },
  destination: { lat: 41.65069, lng: -0.88005, label: 'Plaza de España' }
};

describe('/api/route-favorites', () => {
  beforeEach(() => jest.clearAllMocks());

  it('needs a session', async () => {
    const app = createApp();
    expect((await request(app).get('/api/route-favorites')).status).toBe(401);
    expect(routeHistoryService.listFavorites).not.toHaveBeenCalled();
  });

  it('no longer has the history of trips (#180: recent places instead)', async () => {
    const app = createApp();
    expect((await request(app).get('/api/route-history').set(auth)).status).toBe(404);
    expect((await request(app).post('/api/route-history').set(auth).send(trip)).status).toBe(404);
  });

  it('lists, adds and removes the favourites of the user', async () => {
    const favorite = { id: 2, name: 'Casa', ...trip, createdAt: '2026-11-14T20:00:00.000Z' };
    routeHistoryService.listFavorites.mockResolvedValue([favorite]);
    routeHistoryService.addFavorite.mockResolvedValue(favorite);
    routeHistoryService.removeFavorite.mockResolvedValue();
    const app = createApp();

    const listed = await request(app).get('/api/route-favorites').set(auth);
    const added = await request(app)
      .post('/api/route-favorites')
      .set(auth)
      .send({ ...trip, name: 'Casa' });
    const removed = await request(app).delete('/api/route-favorites/2').set(auth);

    expect(listed.body).toEqual({ favorites: [favorite] });
    expect(added.status).toBe(201);
    expect(added.body).toEqual({ favorite });
    expect(routeHistoryService.addFavorite).toHaveBeenCalledWith(7, { ...trip, name: 'Casa' });
    expect(removed.status).toBe(204);
    expect(routeHistoryService.removeFavorite).toHaveBeenCalledWith(7, '2');
  });

  it('passes the validation errors and conflicts to the client', async () => {
    routeHistoryService.addFavorite
      .mockRejectedValueOnce(
        httpError(400, 'El origen y el destino tienen que estar en Zaragoza.', {
          origin: 'Fuera de Zaragoza.'
        })
      )
      .mockRejectedValueOnce(httpError(409, 'Ese trayecto ya está en tus favoritos.'));
    routeHistoryService.removeFavorite.mockRejectedValue(httpError(404, 'No existe ese favorito.'));
    const app = createApp();

    const invalid = await request(app).post('/api/route-favorites').set(auth).send({});
    const repeated = await request(app).post('/api/route-favorites').set(auth).send(trip);
    const missing = await request(app).delete('/api/route-favorites/99').set(auth);

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.fields).toEqual({ origin: 'Fuera de Zaragoza.' });
    expect(repeated.status).toBe(409);
    expect(missing.status).toBe(404);
  });
});
