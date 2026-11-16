const { recentPlacesService } = require('../../services/routing/recentPlacesService');

// #180 (changes PBI-12): places used recently as origin or destination by the signed-in user.
const handle = (action) => async (req, res, next) => {
  try {
    await action(req, res);
  } catch (error) {
    next(error);
  }
};

const listPlaces = handle(async (req, res) => {
  res.status(200).json({ places: await recentPlacesService.listPlaces(req.userId) });
});

const recordPlaces = handle(async (req, res) => {
  res.status(200).json({ places: await recentPlacesService.recordPlaces(req.userId, req.body) });
});

const clearPlaces = handle(async (req, res) => {
  await recentPlacesService.clearPlaces(req.userId);
  res.status(204).end();
});

module.exports = { clearPlaces, listPlaces, recordPlaces };
