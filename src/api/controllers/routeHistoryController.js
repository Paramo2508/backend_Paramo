const { routeHistoryService } = require('../../services/routing/routeHistoryService');

// PBI-12: favourite trips of the signed-in user. The recent places (#180) have their own controller.
const handle = (action) => async (req, res, next) => {
  try {
    await action(req, res);
  } catch (error) {
    next(error);
  }
};

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

module.exports = { addFavorite, listFavorites, removeFavorite };
