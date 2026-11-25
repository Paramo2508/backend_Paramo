const { Router } = require('express');

const {
  getPreferences,
  getWeatherSuggestion,
  putPreferences
} = require('../controllers/routePreferencesController');

const routePreferencesRouter = Router();
routePreferencesRouter.get('/', getPreferences);
routePreferencesRouter.put('/', putPreferences);
routePreferencesRouter.get('/weather', getWeatherSuggestion);

module.exports = { routePreferencesRouter };
