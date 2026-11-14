const { routeHistoryService } = require('../../services/routing/routeHistoryService');

// PBI-12: history of route searches and favourite trips of the signed-in user.
const handle = (action) => async (req, res, next) => {
  try {
    await action(req, res);
  } catch (error) {
    next(error);
  }
};

const listSearches = handle(async (req, res) => {
  res.status(200).json({ searches: await routeHistoryService.listSearches(req.userId) });
});

const recordSearch = handle(async (req, res) => {
  res.status(201).json({ search: await routeHistoryService.recordSearch(req.userId, req.body) });
});

const clearSearches = handle(async (req, res) => {
  await routeHistoryService.clearSearches(req.userId);
  res.status(204).end();
});

const listFavorites = handle(async (req, res) => {
  res.status(200).json({ favorites: await routeHistoryService.listFavorites(req.userId) });
});

const addFavorite = handle(async (req, res) => {
  res.status(201).json({ favorite: await routeHistoryService.addFavorite(req.userId, req.body) });
});

const removeFavorite = handle(async (req, res) => {
  await routeHistoryService.removeFavorite(req.userId, req.params.id);
  res.status(204).end();
});

module.exports = {
  addFavorite,
  clearSearches,
  listFavorites,
  listSearches,
  recordSearch,
  removeFavorite
};
