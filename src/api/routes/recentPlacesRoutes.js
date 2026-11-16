const { Router } = require('express');

const { clearPlaces, listPlaces, recordPlaces } = require('../controllers/recentPlacesController');

const recentPlacesRouter = Router();
recentPlacesRouter.get('/', listPlaces);
recentPlacesRouter.post('/', recordPlaces);
recentPlacesRouter.delete('/', clearPlaces);

module.exports = { recentPlacesRouter };
