const { routePreferencesService } = require('../../services/routing/routePreferencesService');

// PBI-18 (ADR-036): the simple route preferences of the signed-in user.
async function getPreferences(req, res, next) {
  try {
    res.status(200).json({ preferences: await routePreferencesService.getPreferences(req.userId) });
  } catch (error) {
    next(error);
  }
}

async function putPreferences(req, res, next) {
  try {
    const preferences = await routePreferencesService.savePreferences(req.userId, req.body);
    res.status(200).json({ preferences });
  } catch (error) {
    next(error);
  }
}

// PBI-21 (ADR-037): what «Según el tiempo de hoy» marks with the current weather.
async function getWeatherSuggestion(req, res, next) {
  try {
    res.status(200).json({ suggestion: await routePreferencesService.getWeatherSuggestion() });
  } catch (error) {
    next(error);
  }
}

module.exports = { getPreferences, getWeatherSuggestion, putPreferences };
