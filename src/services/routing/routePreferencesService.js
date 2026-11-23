const { DEFAULT_PREFERENCES, parsePreferences } = require('../../domain/routes/routePreferences');
const defaultRepository = require('../../repositories/routePreferencesRepository');

// PBI-18 (ADR-036): the preferences are kept in the account so they come back on any device.
function createRoutePreferencesService(repository = defaultRepository) {
  return {
    async getPreferences(userId) {
      return (await repository.findForUser(userId)) ?? { ...DEFAULT_PREFERENCES };
    },

    savePreferences: (userId, input) => repository.saveForUser(userId, parsePreferences(input))
  };
}

module.exports = {
  createRoutePreferencesService,
  routePreferencesService: createRoutePreferencesService()
};
