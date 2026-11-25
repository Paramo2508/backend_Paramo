const { importConfig } = require('../../config/importConfig');
const { recommendationConfig } = require('../../config/recommendationConfig');
const {
  DEFAULT_SAVED_PREFERENCES,
  parseSavedPreferences
} = require('../../domain/routes/routePreferences');
const { recommendRoute } = require('../../domain/routes/routeRecommendation');
const { suggestPreferences } = require('../../domain/routes/weatherPreferences');
const { calculateSolarPosition } = require('../../domain/solar/solarPosition');
const defaultRepository = require('../../repositories/routePreferencesRepository');
const { getZaragozaWeather } = require('../weather/weatherService');
const { currentWeather, sunNow, weatherUsed } = require('./recommendedRouteService');

// The Sun is calculated at the centre of the municipality: before choosing the points there is no
// origin, and its height barely changes inside Zaragoza.
const { zaragozaBbox } = importConfig;
const ZARAGOZA_CENTRE = {
  lat: (zaragozaBbox.minLat + zaragozaBbox.maxLat) / 2,
  lng: (zaragozaBbox.minLng + zaragozaBbox.maxLng) / 2
};

// PBI-18 (ADR-036): the preferences are kept in the account so they come back on any device.
// PBI-21 (ADR-037): with them, whether «Según el tiempo de hoy» is on, and what it marks now.
function createRoutePreferencesService(repository = defaultRepository) {
  return {
    async getPreferences(userId) {
      return (await repository.findForUser(userId)) ?? { ...DEFAULT_SAVED_PREFERENCES };
    },

    savePreferences: (userId, input) =>
      repository.saveForUser(userId, parseSavedPreferences(input)),

    /**
     * What «Según el tiempo de hoy» marks with the current weather and the Sun now: the rule of the
     * recommended route (ADR-029), without calculating any route. Open-Meteo failing is not an
     * error: the suggestion says so and changes nothing.
     */
    async getWeatherSuggestion({
      weather = getZaragozaWeather,
      now = () => new Date(),
      solarCalculator = calculateSolarPosition,
      config = recommendationConfig
    } = {}) {
      const { moment, elevationDeg } = sunNow(now(), ZARAGOZA_CENTRE, solarCalculator);
      const current = await currentWeather(weather);
      const recommendation = recommendRoute(
        { weather: current.value, sun: { elevationDeg } },
        config
      );
      return {
        ...suggestPreferences(recommendation),
        weather: weatherUsed(current.value),
        calculatedAt: moment
      };
    }
  };
}

module.exports = {
  ZARAGOZA_CENTRE,
  createRoutePreferencesService,
  routePreferencesService: createRoutePreferencesService()
};
