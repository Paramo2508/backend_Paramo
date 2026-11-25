const { weightsFromAnswers } = require('./routePreferences');

/*
 * Rule of the recommended route (PBI-9.1, ADR-029): from the current weather and the height of the
 * Sun it chooses the weights of the route and explains why. It is pure: no Express, no Open-Meteo
 * and no clock; the thresholds come in `config` (src/config/recommendationConfig.js).
 *
 * Shade and sun reuse the weights of the old presets of PBI-6 (ADR-023), now those of the answers
 * "Sombra" and "Sol" (ADR-036); wind has no preset and takes `config.windWeight`. Until PBI-21 the
 * rule is the same as in PBI-9.1, with the extra time of the presets (25 %): the provisional button
 * "Según el tiempo" calls it exactly as the old "Recomendada" (ADR-036).
 */

const PRESET_MAX_DETOUR_PERCENTAGE = 25;
const answers = (sunShade) => ({ sunShade, avoidWind: false, preferParks: false });
const PRESETS = {
  fastest: weightsFromAnswers(answers('any')),
  shaded: weightsFromAnswers(answers('shade')),
  sunny: weightsFromAnswers(answers('sun'))
};
const preset = (presetKey) => ({
  weights: PRESETS[presetKey],
  maxDetourPercentage: PRESET_MAX_DETOUR_PERCENTAGE
});

const BASE_PRESET = {
  hot: 'shaded',
  cold: 'sunny',
  mild: 'fastest',
  low_sun: 'fastest',
  weather_unavailable: 'fastest'
};

const round = (value) => Math.round(value);
const roundTenth = (value) => Math.round(value * 10) / 10;

function rule(variable, operator, threshold, value, unit) {
  return { variable, operator, threshold, value, unit };
}

const isNumber = (value) => Number.isFinite(value);

function isCierzo(directionDeg, config) {
  return directionDeg >= config.cierzoFromDeg && directionDeg <= config.cierzoToDeg;
}

// The apparent temperature if the provider gives it; the air temperature otherwise.
function thermalReading(weather) {
  return isNumber(weather.apparentTemperature)
    ? { variable: 'apparentTemperature', value: weather.apparentTemperature, text: 'sensación' }
    : { variable: 'temperature', value: weather.temperature, text: 'temperatura' };
}

function thermalState(reading, config) {
  if (reading.value >= config.hotApparentTemperatureC) {
    return {
      state: 'hot',
      rules: [rule(reading.variable, '>=', config.hotApparentTemperatureC, reading.value, '°C')]
    };
  }
  if (reading.value <= config.coldApparentTemperatureC) {
    return {
      state: 'cold',
      rules: [rule(reading.variable, '<=', config.coldApparentTemperatureC, reading.value, '°C')]
    };
  }
  return {
    state: 'mild',
    rules: [
      rule(reading.variable, '>', config.coldApparentTemperatureC, reading.value, '°C'),
      rule(reading.variable, '<', config.hotApparentTemperatureC, reading.value, '°C')
    ]
  };
}

// Strong wind if the mean speed or the gusts reach their threshold. The rules list what decided it.
function windState(weather, config) {
  const hasGusts = isNumber(weather.windGusts);
  const speedIsStrong = weather.windSpeed >= config.windSpeedKmh;
  const gustsAreStrong = hasGusts && weather.windGusts >= config.windGustsKmh;
  const speedRule = rule(
    'windSpeed',
    speedIsStrong ? '>=' : '<',
    config.windSpeedKmh,
    weather.windSpeed,
    'km/h'
  );
  const gustsRule =
    hasGusts &&
    rule('windGusts', gustsAreStrong ? '>=' : '<', config.windGustsKmh, weather.windGusts, 'km/h');

  if (speedIsStrong || gustsAreStrong) {
    return {
      windy: true,
      rules: [speedIsStrong && speedRule, gustsAreStrong && gustsRule].filter(Boolean)
    };
  }
  return { windy: false, rules: [speedRule, gustsRule].filter(Boolean) };
}

function windText(weather, config) {
  const name = isCierzo(weather.windDirection, config) ? 'cierzo' : 'viento fuerte';
  const gusts = isNumber(weather.windGusts)
    ? ` con rachas de ${round(weather.windGusts)} km/h`
    : '';
  return `sopla ${name} de ${round(weather.windSpeed)} km/h${gusts}`;
}

function windLabel(weather, config) {
  return isCierzo(weather.windDirection, config) ? 'cierzo' : 'viento fuerte';
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function weightsFor(baseState, windy, config) {
  const base = preset(BASE_PRESET[baseState]);
  return {
    weights: { ...base.weights, wind: windy ? config.windWeight : 0 },
    maxDetourPercentage: base.maxDetourPercentage
  };
}

function unavailable() {
  const { weights, maxDetourPercentage } = weightsFor('weather_unavailable', false, {});
  const cause = 'No se ha podido consultar el tiempo actual';
  return {
    criterion: 'weather_unavailable',
    label: 'Sin datos del tiempo',
    weights,
    maxDetourPercentage,
    cause,
    reason: `${cause}: la ruta recomendada es la más rápida.`,
    rules: []
  };
}

const isCompleteWeather = (weather) =>
  Boolean(weather) &&
  isNumber(weather.temperature) &&
  isNumber(weather.windSpeed) &&
  isNumber(weather.windDirection);

// Without the solar position (sunElevationDeg null) it is treated like a low Sun: no shade or sun is
// sought, only wind if it is strong (ADR-029).
function sunState(sunElevationDeg, config) {
  if (sunElevationDeg === null) {
    return {
      label: 'Sol no disponible',
      text: 'No se ha podido calcular la posición del Sol',
      rule: rule('sunElevation', 'unavailable', config.minSunElevationDeg, null, '°')
    };
  }
  const isNight = sunElevationDeg <= 0;
  return {
    label: isNight ? 'Noche' : 'Sol bajo',
    text: isNight
      ? 'Es de noche'
      : `El Sol está bajo (${round(sunElevationDeg)}° sobre el horizonte) y no da sombra útil`,
    rule: rule('sunElevation', '<', config.minSunElevationDeg, roundTenth(sunElevationDeg), '°')
  };
}

function lowSunRecommendation(weather, sunElevationDeg, wind, config) {
  const { label, text: sunText, rule: sunRule } = sunState(sunElevationDeg, config);
  const { weights, maxDetourPercentage } = weightsFor('low_sun', wind.windy, config);
  const detour = `aceptando hasta un ${maxDetourPercentage} % más de tiempo`;
  const cause = wind.windy
    ? `${sunText} y ${windText(weather, config)}`
    : `${sunText} y hay poco viento (${round(weather.windSpeed)} km/h)`;

  return {
    criterion: wind.windy ? 'low_sun_windy' : 'low_sun',
    label: `${label}${wind.windy ? ` y ${windLabel(weather, config)}` : ''}`,
    weights,
    maxDetourPercentage,
    cause,
    reason: wind.windy
      ? `${cause}: se evita el viento de cara ${detour}.`
      : `${cause}: la ruta recomendada es la más rápida.`,
    rules: [sunRule, ...wind.rules]
  };
}

const THERMAL_LABELS = { hot: 'Calor', cold: 'Frío', mild: 'Tiempo templado' };
const THERMAL_GOALS = {
  hot: 'se busca sombra',
  cold: 'se buscan calles al sol'
};

function daylightRecommendation(weather, sunElevationDeg, wind, config) {
  const reading = thermalReading(weather);
  const thermal = thermalState(reading, config);
  const sunRule = rule(
    'sunElevation',
    '>=',
    config.minSunElevationDeg,
    roundTenth(sunElevationDeg),
    '°'
  );
  const rules = [...thermal.rules, ...wind.rules, sunRule];
  const { weights, maxDetourPercentage } = weightsFor(thermal.state, wind.windy, config);
  const detour = `aceptando hasta un ${maxDetourPercentage} % más de tiempo`;
  const feels = `${reading.text} de ${round(reading.value)} °C`;

  if (thermal.state === 'mild') {
    const cause = wind.windy
      ? capitalize(windText(weather, config))
      : `Temperatura agradable (${feels}) y poco viento (${round(weather.windSpeed)} km/h)`;
    return {
      criterion: wind.windy ? 'windy' : 'mild',
      label: wind.windy ? capitalize(windLabel(weather, config)) : THERMAL_LABELS.mild,
      weights,
      maxDetourPercentage,
      cause,
      reason: wind.windy
        ? `${cause}: se evita el viento de cara ${detour}.`
        : `${cause}: la ruta recomendada es la más rápida.`,
      rules
    };
  }

  const thermalText = thermal.state === 'hot' ? 'Hace calor' : 'Hace frío';
  const cause = wind.windy
    ? `${thermalText} (${feels}) y ${windText(weather, config)}`
    : `${thermalText} (${feels})`;
  return {
    criterion: wind.windy ? `${thermal.state}_windy` : thermal.state,
    label: `${THERMAL_LABELS[thermal.state]}${wind.windy ? ` y ${windLabel(weather, config)}` : ''}`,
    weights,
    maxDetourPercentage,
    cause,
    reason: wind.windy
      ? `${cause}: ${THERMAL_GOALS[thermal.state]} y evitar el viento de cara, ${detour}.`
      : `${cause}: ${THERMAL_GOALS[thermal.state]} ${detour}.`,
    rules
  };
}

/**
 * @param {{ weather: object|null, sun: { elevationDeg: number }|null }} input `weather` as returned
 *   by the weather service (null if it failed); `sun` at the instant of the route (null, or a
 *   non-finite elevation, if the solar position could not be calculated).
 * @returns {{ criterion, label, weights, maxDetourPercentage, reason, rules }}
 */
function recommendRoute({ weather, sun }, config) {
  if (!isCompleteWeather(weather)) return unavailable();

  const wind = windState(weather, config);
  const elevationDeg = Number.isFinite(sun?.elevationDeg) ? sun.elevationDeg : null;
  if (elevationDeg === null || elevationDeg < config.minSunElevationDeg) {
    return lowSunRecommendation(weather, elevationDeg, wind, config);
  }
  return daylightRecommendation(weather, elevationDeg, wind, config);
}

module.exports = { recommendRoute };
