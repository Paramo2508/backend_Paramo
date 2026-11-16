const { importConfig } = require('../../config/importConfig');
const { parseFavorite } = require('../../domain/routes/routeTrips');
const defaultRepository = require('../../repositories/routeHistoryRepository');
const { httpError } = require('../../utils/httpError');

// PBI-12: favourite trips. The history of trips was replaced by the recent places (#180,
// recentPlacesService).
// The same limit as the saved routes (PBI-6).
const MAX_FAVORITES_PER_USER = 20;
const FAVORITE_NOT_FOUND = 'No existe ese favorito.';

function parseFavoriteId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw httpError(404, FAVORITE_NOT_FOUND);
  return id;
}

function createRouteHistoryService(
  repository = defaultRepository,
  serviceArea = importConfig.zaragozaBbox
) {
  return {
    listFavorites: (userId) => repository.listFavorites(userId),

    async addFavorite(userId, input) {
      const favorite = parseFavorite(input, serviceArea);
      if ((await repository.countFavorites(userId)) >= MAX_FAVORITES_PER_USER) {
        throw httpError(409, `Puedes guardar como máximo ${MAX_FAVORITES_PER_USER} favoritos.`);
      }
      return repository.createFavorite(userId, favorite);
    },

    async removeFavorite(userId, id) {
      if (!(await repository.deleteFavorite(userId, parseFavoriteId(id)))) {
        throw httpError(404, FAVORITE_NOT_FOUND);
      }
    }
  };
}

module.exports = {
  MAX_FAVORITES_PER_USER,
  createRouteHistoryService,
  routeHistoryService: createRouteHistoryService()
};
