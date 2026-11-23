const { sequelize } = require('../../config/database');
const createRoutePreferences = require('../../repositories/migrations/20261123000001-create-route-preferences');
const repository = require('../../repositories/routePreferencesRepository');
const userRepository = require('../../repositories/userRepository');
const { logger } = require('../../utils/logger');

const newUser = (email) => userRepository.createUser({ name: 'Ana', email, passwordHash: 'x' });

const preferences = (overrides = {}) => ({
  sunShade: 'any',
  avoidWind: false,
  preferParks: false,
  extraMinutes: 5,
  ...overrides
});

describe('route preferences (PostgreSQL, PBI-18)', () => {
  beforeEach(async () => {
    await sequelize.query(
      'TRUNCATE users, route_preferences, route_profiles RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('keeps one set of preferences per user and replaces it', async () => {
    const ana = await newUser('ana@correo.es');
    const luis = await newUser('luis@correo.es');

    expect(await repository.findForUser(ana.id)).toBeNull();
    expect(await repository.saveForUser(ana.id, preferences({ sunShade: 'shade' }))).toEqual(
      preferences({ sunShade: 'shade' })
    );
    await repository.saveForUser(ana.id, preferences({ avoidWind: true, extraMinutes: 15 }));
    await repository.saveForUser(luis.id, preferences({ preferParks: true, extraMinutes: 0 }));

    expect(await repository.findForUser(ana.id)).toEqual(
      preferences({ avoidWind: true, extraMinutes: 15 })
    );
    expect(await repository.findForUser(luis.id)).toEqual(
      preferences({ preferParks: true, extraMinutes: 0 })
    );
    const [[{ rows }]] = await sequelize.query(
      'SELECT count(*)::int AS rows FROM route_preferences'
    );
    expect(rows).toBe(2);
  });

  it('only stores the options of the questions (CHECK)', async () => {
    const ana = await newUser('ana@correo.es');
    await expect(
      repository.saveForUser(ana.id, preferences({ extraMinutes: 7 }))
    ).rejects.toThrow();
    await expect(
      repository.saveForUser(ana.id, preferences({ sunShade: 'both' }))
    ).rejects.toThrow();
  });

  it('deletes the preferences with the user', async () => {
    const ana = await newUser('ana@correo.es');
    await repository.saveForUser(ana.id, preferences({ avoidWind: true }));

    await sequelize.query('DELETE FROM users WHERE id = :id', { replacements: { id: ana.id } });

    expect(await repository.findForUser(ana.id)).toBeNull();
  });

  describe('migration create-route-preferences', () => {
    const queryInterface = () => sequelize.getQueryInterface();

    async function savedRoute(
      userId,
      name,
      weights,
      detour,
      { presetKey = null, touched = 0 } = {}
    ) {
      await sequelize.query(
        `INSERT INTO route_profiles (user_id, name, preset_key, shade_weight, sun_weight,
           wind_weight, vegetation_weight, max_detour_percentage, created_at, updated_at)
         VALUES (:userId, :name, :presetKey, :shade, :sun, :wind, :vegetation, :detour,
           now() - interval '1 day', now() - interval '1 day' + make_interval(mins => :touched))`,
        { replacements: { userId, name, presetKey, detour, touched, ...weights } }
      );
    }
    const weights = (shade, sun, wind, vegetation) => ({ shade, sun, wind, vegetation });
    const presets = async (userId) => {
      await savedRoute(userId, 'Rápida', weights(0, 0, 0, 0), 25, { presetKey: 'fastest' });
      await savedRoute(userId, 'Sombreada', weights(50, 0, 0, 0), 25, { presetKey: 'shaded' });
      await savedRoute(userId, 'Soleada', weights(0, 50, 0, 0), 25, { presetKey: 'sunny' });
    };

    afterEach(async () => {
      // Back to the schema of the other tests.
      await sequelize.query('DROP TABLE IF EXISTS route_preferences');
      await createRoutePreferences.up(queryInterface());
    });

    it('takes the route each user touched last, logs how many, and leaves the routes untouched', async () => {
      const info = jest.spyOn(logger, 'info').mockImplementation(() => {});
      // Ana as in the local database on 2026-11-23: the edited "Soleada" is the latest.
      const ana = await newUser('ana@correo.es');
      await savedRoute(ana.id, 'Rápida', weights(0, 0, 0, 0), 25, { presetKey: 'fastest' });
      await savedRoute(ana.id, 'Sombreada', weights(50, 0, 0, 0), 25, { presetKey: 'shaded' });
      await savedRoute(ana.id, 'Soleada', weights(60, 0, 0, 0), 40, {
        presetKey: 'sunny',
        touched: 30
      });
      await savedRoute(ana.id, 'verde', weights(0, 0, 0, 100), 40, { touched: 20 });
      await savedRoute(ana.id, 'Asistente', weights(0, 75, 25, 0), 25, { touched: 10 });
      // Luis created one route of his own.
      const luis = await newUser('luis@correo.es');
      await presets(luis.id);
      await savedRoute(luis.id, 'Paseo', weights(0, 50, 0, 50), 10);
      // Eva never touched her presets; Pablo never listed his routes.
      const eva = await newUser('eva@correo.es');
      await presets(eva.id);
      const pablo = await newUser('pablo@correo.es');
      await createRoutePreferences.down(queryInterface());

      const counts = await createRoutePreferences.up(queryInterface());

      expect(counts).toEqual({ users: 3, routes: 12, migrated: 2 });
      expect(info).toHaveBeenCalledWith(
        'create-route-preferences: 12 saved route(s) of 3 user(s) read; preferences migrated ' +
          'for 2 user(s) from the route they touched last; route_profiles and ' +
          'users.route_profiles_seeded are left unused'
      );
      expect(await repository.findForUser(ana.id)).toEqual(
        preferences({ sunShade: 'shade', extraMinutes: 15 })
      );
      expect(await repository.findForUser(luis.id)).toEqual(
        preferences({ sunShade: 'sun', preferParks: true, extraMinutes: 2 })
      );
      expect(await repository.findForUser(eva.id)).toBeNull();
      expect(await repository.findForUser(pablo.id)).toBeNull();
      const [[{ routes }]] = await sequelize.query(
        'SELECT count(*)::int AS routes FROM route_profiles'
      );
      expect(routes).toBe(12);
      info.mockRestore();
    });

    it('down() drops route_preferences and keeps route_profiles', async () => {
      const ana = await newUser('ana@correo.es');
      await presets(ana.id);
      await repository.saveForUser(ana.id, preferences());

      await createRoutePreferences.down(queryInterface());

      const [[tables]] = await sequelize.query(
        `SELECT to_regclass('route_preferences') IS NULL AS "preferencesDropped",
                (SELECT count(*)::int FROM route_profiles) AS routes`
      );
      expect(tables).toEqual({ preferencesDropped: true, routes: 3 });
    });
  });
});
