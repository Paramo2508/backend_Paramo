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

module.exports = { getPreferences, putPreferences };
