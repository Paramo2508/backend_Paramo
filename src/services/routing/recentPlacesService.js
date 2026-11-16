const { importConfig } = require('../../config/importConfig');
const { parseRecentPlaces } = require('../../domain/routes/recentPlaces');
const defaultRepository = require('../../repositories/recentPlacesRepository');

// #180 (changes PBI-12). Enough to reuse the usual places without keeping more personal locations
// than the list of suggestions shows.
const MAX_RECENT_PLACES = 6;

function createRecentPlacesService(
  repository = defaultRepository,
  serviceArea = importConfig.zaragozaBbox
) {
  return {
    listPlaces: (userId) => repository.listPlaces(userId, MAX_RECENT_PLACES),

    async recordPlaces(userId, input) {
      return repository.recordPlaces(
        userId,
        parseRecentPlaces(input, serviceArea),
        MAX_RECENT_PLACES
      );
    },

    clearPlaces: (userId) => repository.clearPlaces(userId)
  };
}

module.exports = {
  MAX_RECENT_PLACES,
  createRecentPlacesService,
  recentPlacesService: createRecentPlacesService()
};
