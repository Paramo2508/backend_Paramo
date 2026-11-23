const request = require('supertest');

jest.mock('../api/middleware/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.userId = 7;
    next();
  }
}));

jest.mock('../services/routing/routeProfileService', () => ({
  routeProfileService: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn()
  }
}));

const { createApp } = require('../app');
const { routeProfileService } = require('../services/routing/routeProfileService');

const profile = { id: 4, name: 'Verano', presetKey: null, weights: { shade: 80, sun: 0 } };

describe('/api/route-profiles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists the routes of the user', async () => {
    routeProfileService.list.mockResolvedValue([profile]);

    const response = await request(createApp()).get('/api/route-profiles');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ profiles: [profile] });
    expect(routeProfileService.list).toHaveBeenCalledWith(7);
  });

  it('creates, updates and deletes a route of the user', async () => {
    routeProfileService.create.mockResolvedValue(profile);
    routeProfileService.update.mockResolvedValue(profile);
    routeProfileService.remove.mockResolvedValue();
    const body = { name: 'Verano', weights: { shade: 80 } };
    const app = createApp();

    const created = await request(app).post('/api/route-profiles').send(body);
    const updated = await request(app).put('/api/route-profiles/4').send(body);
    const deleted = await request(app).delete('/api/route-profiles/4');

    expect(created.status).toBe(201);
    expect(created.body).toEqual({ profile });
    expect(routeProfileService.create).toHaveBeenCalledWith(7, body);
    expect(updated.status).toBe(200);
    expect(routeProfileService.update).toHaveBeenCalledWith(7, '4', body);
    expect(deleted.status).toBe(204);
    expect(routeProfileService.remove).toHaveBeenCalledWith(7, '4');
  });

  it('returns the fields to fix', async () => {
    routeProfileService.create.mockRejectedValue(
      Object.assign(new Error('El nombre no es válido.'), {
        status: 400,
        fields: { name: 'Escribe un nombre.' }
      })
    );

    const response = await request(createApp()).post('/api/route-profiles').send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { message: 'El nombre no es válido.', fields: { name: 'Escribe un nombre.' } }
    });
  });
});

describe('/api/route-profiles with a repeated name (#165)', () => {
  const duplicate = () =>
    Object.assign(new Error('Ya tienes una ruta llamada «Verano».'), {
      status: 409,
      fields: { name: 'Ya tienes una ruta llamada «Verano».' },
      existingId: 4
    });

  it('says which route already has the name, when creating and when renaming', async () => {
    routeProfileService.create.mockRejectedValue(duplicate());
    routeProfileService.update.mockRejectedValue(duplicate());
    const app = createApp();

    const created = await request(app).post('/api/route-profiles').send({ name: ' verano ' });
    const renamed = await request(app).put('/api/route-profiles/9').send({ name: 'VERANO' });

    [created, renamed].forEach((response) => {
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: {
          message: 'Ya tienes una ruta llamada «Verano».',
          fields: { name: 'Ya tienes una ruta llamada «Verano».' },
          existingId: 4
        }
      });
    });
  });

  it('keeps any other 409 as before, without existingId', async () => {
    routeProfileService.create.mockRejectedValue(
      Object.assign(new Error('Puedes guardar como máximo 20 rutas.'), { status: 409 })
    );

    const response = await request(createApp()).post('/api/route-profiles').send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { message: 'Puedes guardar como máximo 20 rutas.' } });
  });
});
