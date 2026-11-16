const { env: defaultEnv } = require('./env');
const { logger: defaultLogger } = require('../utils/logger');

// Warnings shown when the server starts (#160). They never stop it: without the OpenRouteService
// key, place search and routes answer 503 but /api/health keeps answering.
function warnAboutMissingSettings({ env = defaultEnv, logger = defaultLogger } = {}) {
  if (env.nodeEnv === 'production' && !env.openRouteServiceApiKey) {
    logger.warn(
      'ORS_API_KEY is not set: place search and routes will answer 503. Set the production key in /opt/weathermapz/.env.'
    );
  }
}

module.exports = { warnAboutMissingSettings };
