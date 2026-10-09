const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { UniqueConstraintError } = require('sequelize');

jest.mock('../repositories/userRepository', () => ({
  findById: jest.fn(),
  findByEmail: jest.fn(),
  findByGoogleId: jest.fn(),
  createUser: jest.fn(),
  linkGoogleAccount: jest.fn()
}));

const { createApp } = require('../app');
const { env } = require('../config/env');
const userRepository = require('../repositories/userRepository');
const { signToken } = require('../services/auth/tokenService');

describe('authentication API', () => {
  const originalSecret = env.jwtSecret;
  const registration = { name: 'Ana López', email: 'Ana@Correo.es', password: 'segura123' };
  let storedUser;

  beforeAll(async () => {
    storedUser = {
      id: 7,
      name: 'Ana López',
      email: 'ana@correo.es',
      passwordHash: await bcrypt.hash('segura123', 4),
      googleId: null
    };
  });

  beforeEach(() => {
    env.jwtSecret = 'test-secret';
    Object.values(userRepository).forEach((mock) => mock.mockReset());
  });

  afterAll(() => {
    env.jwtSecret = originalSecret;
  });

  describe('POST /api/auth/register', () => {
    it('creates the account with a hashed password and returns a session', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      userRepository.createUser.mockImplementation(async (data) => ({ id: 7, ...data }));

      const response = await request(createApp()).post('/api/auth/register').send(registration);

      expect(response.status).toBe(201);
      expect(response.body.user).toEqual({ id: 7, name: 'Ana López', email: 'ana@correo.es' });
      expect(jwt.verify(response.body.token, 'test-secret').sub).toBe('7');
      const [{ passwordHash }] = userRepository.createUser.mock.calls[0];
      expect(passwordHash).not.toBe('segura123');
      await expect(bcrypt.compare('segura123', passwordHash)).resolves.toBe(true);
      expect(response.text).not.toContain(passwordHash);
    });

    it('returns 400 with a message per invalid field', async () => {
      const response = await request(createApp())
        .post('/api/auth/register')
        .send({ name: 'Ana', email: 'ana', password: '123' });

      expect(response.status).toBe(400);
      expect(response.body.error.fields).toEqual({
        email: 'Introduce un correo electrónico válido.',
        password: 'La contraseña debe tener al menos 8 caracteres.'
      });
      expect(userRepository.createUser).not.toHaveBeenCalled();
    });

    it('returns 409 when the email is already registered', async () => {
      userRepository.findByEmail.mockResolvedValue(storedUser);

      const response = await request(createApp()).post('/api/auth/register').send(registration);

      expect(response.status).toBe(409);
      expect(response.body.error.fields).toEqual({
        email: 'Ya existe una cuenta con este correo electrónico.'
      });
    });

    it('returns 409 when a simultaneous registration wins the unique index', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      userRepository.createUser.mockRejectedValue(new UniqueConstraintError({}));

      const response = await request(createApp()).post('/api/auth/register').send(registration);

      expect(response.status).toBe(409);
    });

    it('does not expose unexpected database errors', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      userRepository.createUser.mockRejectedValue(new Error('connection refused to db-secret'));

      const response = await request(createApp()).post('/api/auth/register').send(registration);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: { message: 'Internal server error' } });
    });

    it('returns 503 when JWT_SECRET is not configured', async () => {
      env.jwtSecret = '';
      userRepository.findByEmail.mockResolvedValue(null);
      userRepository.createUser.mockImplementation(async (data) => ({ id: 7, ...data }));

      const response = await request(createApp()).post('/api/auth/register').send(registration);

      expect(response.status).toBe(503);
      expect(response.body.error.message).toBe('La autenticación no está configurada.');
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns a session for valid credentials', async () => {
      userRepository.findByEmail.mockResolvedValue(storedUser);

      const response = await request(createApp())
        .post('/api/auth/login')
        .send({ email: ' ANA@correo.es ', password: 'segura123' });

      expect(response.status).toBe(200);
      expect(userRepository.findByEmail).toHaveBeenCalledWith('ana@correo.es');
      expect(response.body.user).toEqual({ id: 7, name: 'Ana López', email: 'ana@correo.es' });
      expect(jwt.verify(response.body.token, 'test-secret').sub).toBe('7');
    });

    it.each([
      ['wrong password', { password: 'otra-cosa' }, () => storedUser],
      ['unknown email', { password: 'segura123' }, () => null],
      [
        'Google-only account',
        { password: 'segura123' },
        () => ({ ...storedUser, passwordHash: null })
      ]
    ])('returns the same 401 for %s', async (_case, body, user) => {
      userRepository.findByEmail.mockResolvedValue(user());

      const response = await request(createApp())
        .post('/api/auth/login')
        .send({ email: 'ana@correo.es', ...body });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { message: 'El correo o la contraseña no son correctos.' }
      });
    });

    it('returns 400 when a field is missing', async () => {
      const response = await request(createApp())
        .post('/api/auth/login')
        .send({ email: 'ana@correo.es' });

      expect(response.status).toBe(400);
      expect(response.body.error.fields).toEqual({ password: 'Introduce tu contraseña.' });
    });
  });

  describe('GET /api/auth/me and protected endpoints', () => {
    it('returns the current user for a valid token', async () => {
      userRepository.findById.mockResolvedValue(storedUser);

      const response = await request(createApp())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${signToken(storedUser)}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: { id: 7, name: 'Ana López', email: 'ana@correo.es' }
      });
      expect(userRepository.findById).toHaveBeenCalledWith(7);
    });

    it('returns 401 when the user no longer exists', async () => {
      userRepository.findById.mockResolvedValue(null);

      const response = await request(createApp())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${signToken(storedUser)}`);

      expect(response.status).toBe(401);
    });

    it.each([
      ['no header', undefined],
      ['another scheme', 'Basic abc'],
      ['a tampered token', `Bearer ${jwt.sign({ sub: '7' }, 'otro-secreto')}`],
      ['an expired token', `Bearer ${jwt.sign({ sub: '7', exp: 1 }, 'test-secret')}`],
      ['a token without user id', `Bearer ${jwt.sign({ sub: 'abc' }, 'test-secret')}`]
    ])('rejects %s', async (_case, header) => {
      let pending = request(createApp()).get('/api/auth/me');
      if (header) pending = pending.set('Authorization', header);
      const response = await pending;

      expect(response.status).toBe(401);
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it.each([
      ['post', '/api/routes/fastest'],
      ['get', '/api/geocoding/autocomplete?text=Plaza']
    ])('protects %s %s', async (method, url) => {
      const response = await request(createApp())[method](url);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: { message: 'Necesitas iniciar sesión.' } });
    });

    it('keeps the health check public', async () => {
      const response = await request(createApp()).get('/api/health');

      expect(response.status).toBe(200);
    });
  });
});
