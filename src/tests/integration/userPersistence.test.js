const { sequelize } = require('../../config/database');
const { env } = require('../../config/env');
const userRepository = require('../../repositories/userRepository');
const authService = require('../../services/auth/authService');

const originalSecret = env.jwtSecret;

describe('user persistence (PostgreSQL)', () => {
  beforeAll(() => {
    env.jwtSecret = 'test-secret';
  });

  beforeEach(async () => {
    await sequelize.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    env.jwtSecret = originalSecret;
    await sequelize.close();
  });

  it('never stores the password in plain text', async () => {
    await authService.register({ name: 'Ana', email: 'ana@correo.es', password: 'segura123' });

    const [stored] = await sequelize.query(
      "SELECT password_hash FROM users WHERE email = 'ana@correo.es'",
      { type: 'SELECT' }
    );
    expect(stored.password_hash).not.toContain('segura123');
    expect(stored.password_hash).toMatch(/^\$2[aby]\$10\$/);
    await expect(
      authService.login({ email: 'ana@correo.es', password: 'segura123' })
    ).resolves.toMatchObject({ user: { email: 'ana@correo.es' } });
  });

  it('keeps emails unique regardless of case', async () => {
    await userRepository.createUser({ name: 'Ana', email: 'ana@correo.es', passwordHash: 'x' });

    await expect(
      userRepository.createUser({ name: 'Otra', email: 'ANA@correo.es', passwordHash: 'y' })
    ).rejects.toThrow();
  });

  it('requires a password or a Google account', async () => {
    await expect(
      userRepository.createUser({ name: 'Sin credenciales', email: 'nadie@correo.es' })
    ).rejects.toThrow();
  });

  it('links a Google account to an existing user', async () => {
    const { id } = await userRepository.createUser({
      name: 'Ana',
      email: 'ana@correo.es',
      passwordHash: 'x'
    });

    const linked = await userRepository.linkGoogleAccount(id, 'google-123');

    expect(linked).toMatchObject({ id, googleId: 'google-123', passwordHash: 'x' });
    expect(await userRepository.findByGoogleId('google-123')).toMatchObject({ id });
  });
});
