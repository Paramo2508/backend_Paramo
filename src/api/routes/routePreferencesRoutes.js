const { Router } = require('express');

const { getPreferences, putPreferences } = require('../controllers/routePreferencesController');

const routePreferencesRouter = Router();
routePreferencesRouter.get('/', getPreferences);
routePreferencesRouter.put('/', putPreferences);

module.exports = { routePreferencesRouter };
