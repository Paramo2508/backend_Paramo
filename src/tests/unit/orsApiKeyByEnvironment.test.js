const request = require('supertest');

const { warnAboutMissingSettings } = require('../../config/startupChecks');

// One OpenRouteService key per environment (#160): tests never use the key of the environment, and
// production warns at start-up when it is missing without stopping the API.
describe('OpenRouteService key by environment', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  function loadEnv(variables) {
    process.env = { ...originalEnv, ...variables };
    let loaded;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      loaded = require('../../config/env').env;
    });
    return loaded;
  }

  it('ignores ORS_API_KEY and OPENROUTESERVICE_API_KEY when NODE_ENV is test', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      ORS_API_KEY: 'key-from-a-local-env-file',
      OPENROUTESERVICE_API_KEY: 'legacy-key-from-a-local-env-file'
    });

    expect(env.openRouteServiceApiKey).toBe('');
  });

  it('reads ORS_API_KEY outside the tests', () => {
    expect(
      loadEnv({ NODE_ENV: 'development', ORS_API_KEY: 'dev-key' }).openRouteServiceApiKey
    ).toBe('dev-key');
    expect(
      loadEnv({ NODE_ENV: 'production', ORS_API_KEY: 'prod-key' }).openRouteServiceApiKey
    ).toBe('prod-key');
  });

  describe('start-up warning', () => {
    function warningsFor(env) {
      const logger = { warn: jest.fn() };
      warnAboutMissingSettings({ env, logger });
      return logger.warn.mock.calls.map(([message]) => message);
    }

    it('warns once in production when the key is missing', () => {
      const warnings = warningsFor({ nodeEnv: 'production', openRouteServiceApiKey: '' });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('ORS_API_KEY is not set');
    });

    it('does not warn in production with a key, nor in development or tests', () => {
      expect(warningsFor({ nodeEnv: 'production', openRouteServiceApiKey: 'prod-key' })).toEqual(
        []
      );
      expect(warningsFor({ nodeEnv: 'development', openRouteServiceApiKey: '' })).toEqual([]);
      expect(warningsFor({ nodeEnv: 'test', openRouteServiceApiKey: '' })).toEqual([]);
    });

    it('keeps /api/health answering in production without the key', async () => {
      process.env = { ...originalEnv, NODE_ENV: 'production', ORS_API_KEY: '' };
      let app;
      let checks;
      jest.isolateModules(() => {
        /* eslint-disable global-require */
        checks = require('../../config/startupChecks');
        app = require('../../app').createApp();
        /* eslint-enable global-require */
      });
      const logger = { warn: jest.fn() };

      expect(() => checks.warnAboutMissingSettings({ logger })).not.toThrow();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });
});
