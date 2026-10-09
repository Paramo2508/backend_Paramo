const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../repositories/userRepository', () => ({
  findById: jest.fn(),
  findByEmail: jest.fn(),
  findByGoogleId: jest.fn(),
  createUser: jest.fn(),
  linkGoogleAccount: jest.fn()
}));

const { getGoogleCallback } = require('../api/controllers/authController');
const { createApp } = require('../app');
const { env } = require('../config/env');
const { toGoogleIdentity } = require('../integrations/google/googleAuth');
const userRepository = require('../repositories/userRepository');
const { loginWithGoogle } = require('../services/auth/authService');

describe('Google login', () => {
  const original = { ...env };
  const identity = {
    googleId: 'google-123',
    email: 'Ana@Gmail.com',
    emailVerified: true,
    name: 'Ana López'
  };
  const user = { id: 3, name: 'Ana López', email: 'ana@gmail.com', googleId: 'google-123' };

  beforeEach(() => {
    Object.assign(env, {
      jwtSecret: 'test-secret',
      frontendUrl: 'http://front.test',
      googleClientId: '',
      googleClientSecret: ''
    });
    Object.values(userRepository).forEach((mock) => mock.mockReset());
  });

  afterAll(() => {
    Object.assign(env, original);
  });

  describe('routes', () => {
    it.each(['/api/auth/google', '/api/auth/google/callback?code=abc'])(
      'redirects %s back with an error when Google is not configured',
      async (url) => {
        const response = await request(createApp()).get(url);

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('http://front.test/#authError=google');
      }
    );

    it('sends the browser to Google when it is configured', async () => {
      Object.assign(env, { googleClientId: 'client-id', googleClientSecret: 'client-secret' });

      const response = await request(createApp()).get('/api/auth/google');

      expect(response.status).toBe(302);
      const location = new URL(response.headers.location);
      expect(location.origin).toBe('https://accounts.google.com');
      expect(location.searchParams.get('client_id')).toBe('client-id');
      expect(location.searchParams.get('scope')).toBe('profile email');
      expect(response.headers.location).not.toContain('client-secret');
    });

    it('returns to the frontend with an error when the user cancels on Google', async () => {
      Object.assign(env, { googleClientId: 'client-id', googleClientSecret: 'client-secret' });

      const response = await request(createApp()).get(
        '/api/auth/google/callback?error=access_denied'
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('http://front.test/#authError=google');
    });
  });

  describe('callback controller', () => {
    const response = () => ({ redirect: jest.fn() });

    it('redirects with the session token in the URL fragment', async () => {
      userRepository.findByGoogleId.mockResolvedValue(user);
      const res = response();

      await getGoogleCallback({ googleIdentity: identity }, res);

      const [location] = res.redirect.mock.calls[0];
      expect(location).toMatch(/^http:\/\/front\.test\/#authToken=/);
      const token = decodeURIComponent(location.split('#authToken=')[1]);
      expect(jwt.verify(token, 'test-secret').sub).toBe('3');
    });

    it('redirects with an error when the account cannot be resolved', async () => {
      const res = response();

      await getGoogleCallback({ googleIdentity: { ...identity, googleId: undefined } }, res);

      expect(res.redirect).toHaveBeenCalledWith('http://front.test/#authError=google');
    });
  });

  describe('loginWithGoogle', () => {
    it('reuses an account already linked to the Google id', async () => {
      userRepository.findByGoogleId.mockResolvedValue(user);

      const session = await loginWithGoogle(identity);

      expect(session.user).toEqual({ id: 3, name: 'Ana López', email: 'ana@gmail.com' });
      expect(userRepository.createUser).not.toHaveBeenCalled();
    });

    it('links Google to an existing account with the same verified email', async () => {
      userRepository.findByGoogleId.mockResolvedValue(null);
      userRepository.findByEmail.mockResolvedValue({ ...user, googleId: null });
      userRepository.linkGoogleAccount.mockResolvedValue(user);

      await loginWithGoogle(identity);

      expect(userRepository.findByEmail).toHaveBeenCalledWith('ana@gmail.com');
      expect(userRepository.linkGoogleAccount).toHaveBeenCalledWith(3, 'google-123');
    });

    it('creates a passwordless account for a new Google user', async () => {
      userRepository.findByGoogleId.mockResolvedValue(null);
      userRepository.findByEmail.mockResolvedValue(null);
      userRepository.createUser.mockImplementation(async (data) => ({ id: 9, ...data }));

      const session = await loginWithGoogle({ ...identity, name: undefined });

      expect(userRepository.createUser).toHaveBeenCalledWith({
        name: 'ana',
        email: 'ana@gmail.com',
        googleId: 'google-123'
      });
      expect(session.user.id).toBe(9);
    });

    it('refuses an unverified Google email', async () => {
      userRepository.findByGoogleId.mockResolvedValue(null);

      await expect(loginWithGoogle({ ...identity, emailVerified: false })).rejects.toMatchObject({
        status: 401
      });
      expect(userRepository.findByEmail).not.toHaveBeenCalled();
    });
  });

  it('maps the Google profile without leaking provider fields', () => {
    expect(
      toGoogleIdentity({
        id: 'google-123',
        displayName: 'Ana López',
        emails: [{ value: 'ana@gmail.com', verified: 'true' }],
        _json: { picture: 'x' }
      })
    ).toEqual({
      googleId: 'google-123',
      email: 'ana@gmail.com',
      emailVerified: true,
      name: 'Ana López'
    });
    expect(toGoogleIdentity({ id: 'google-123' })).toMatchObject({
      email: undefined,
      emailVerified: false
    });
  });
});
