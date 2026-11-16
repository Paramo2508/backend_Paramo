const { Router } = require('express');

const {
  addFavorite,
  listFavorites,
  removeFavorite
} = require('../controllers/routeHistoryController');

// PBI-12: favourite trips. The history of trips (/api/route-history) was replaced by the recent
// places (#180, recentPlacesRoutes).
const routeFavoriteRouter = Router();
routeFavoriteRouter.get('/', listFavorites);
routeFavoriteRouter.post('/', addFavorite);
routeFavoriteRouter.delete('/:id', removeFavorite);

module.exports = { routeFavoriteRouter };
