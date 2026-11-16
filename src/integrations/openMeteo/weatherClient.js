const { env } = require('../../config/env');

const REQUEST_TIMEOUT_MS = 8000;
const ZARAGOZA = { latitude: 41.6488, longitude: -0.8891 };

async function getCurrentWeather() {
  const url = new URL(`${env.openMeteoBaseUrl.replace(/\/$/, '')}/forecast`);
  url.searchParams.set('latitude', String(ZARAGOZA.latitude));
  url.searchParams.set('longitude', String(ZARAGOZA.longitude));
  // Apparent temperature and gusts are optional: the recommended route (PBI-9.1, ADR-029) uses them
  // when present.
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code'
  );
  url.searchParams.set('timezone', 'Europe/Madrid');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw Object.assign(new Error('Weather provider is unavailable.'), {
        status: response.status === 429 ? 429 : 502
      });
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted)
      throw Object.assign(new Error('Weather provider timed out.'), { status: 504 });
    if (error.status) throw error;
    throw Object.assign(new Error('Weather provider is unavailable.'), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getCurrentWeather };
