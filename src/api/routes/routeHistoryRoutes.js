const { Router } = require('express');

const {
  addFavorite,
  clearSearches,
  listFavorites,
  listSearches,
  recordSearch,
  removeFavorite
} = require('../controllers/routeHistoryController');

const routeHistoryRouter = Router();
routeHistoryRouter.get('/', listSearches);
routeHistoryRouter.post('/', recordSearch);
routeHistoryRouter.delete('/', clearSearches);

const routeFavoriteRouter = Router();
routeFavoriteRouter.get('/', listFavorites);
routeFavoriteRouter.post('/', addFavorite);
routeFavoriteRouter.delete('/:id', removeFavorite);

module.exports = { routeFavoriteRouter, routeHistoryRouter };
