const { recommendationConfig } = require('../../config/recommendationConfig');
const { recommendRoute } = require('../../domain/routes/routeRecommendation');
const { suggestPreferences } = require('../../domain/routes/weatherPreferences');

// «Según el tiempo de hoy» (PBI-21, ADR-037): the rule of ADR-029 as answers and a reason.
const DAY = { elevationDeg: 45 };
const NIGHT = { elevationDeg: -20 };
const weather = (overrides = {}) => ({
  temperature: 18,
  apparentTemperature: 18,
  windSpeed: 5,
  windGusts: 10,
  windDirection: 300,
  time: '2026-11-24T12:00',
  ...overrides
});
const suggest = (overrides, sun = DAY) =>
  suggestPreferences(recommendRoute({ weather: weather(overrides), sun }, recommendationConfig));

describe('«Según el tiempo de hoy» (PBI-21, ADR-037)', () => {
  it.each([
    [
      'heat: shade',
      { apparentTemperature: 31 },
      DAY,
      'shade',
      false,
      'Hace calor (sensación de 31 °C): he marcado «Sombra».'
    ],
    [
      'cold: sun',
      { apparentTemperature: 4 },
      DAY,
      'sun',
      false,
      'Hace frío (sensación de 4 °C): he marcado «Sol».'
    ],
    [
      'heat and cierzo: shade and avoid the wind',
      { apparentTemperature: 31, windSpeed: 35, windGusts: 60 },
      DAY,
      'shade',
      true,
      'Hace calor (sensación de 31 °C) y sopla cierzo de 35 km/h con rachas de 60 km/h: he marcado «Sombra» y «Evitar el viento».'
    ],
    [
      'mild with strong wind: only avoid the wind',
      { windSpeed: 40, windDirection: 120 },
      DAY,
      'any',
      true,
      'Sopla viento fuerte de 40 km/h con rachas de 10 km/h: he marcado «Evitar el viento».'
    ],
    [
      'mild and calm: the fastest route',
      {},
      DAY,
      'any',
      false,
      'Temperatura agradable (sensación de 18 °C) y poco viento (5 km/h): no hace falta desviarse, así que te propongo la ruta más rápida.'
    ],
    [
      'night, even with heat: the fastest route',
      { apparentTemperature: 30 },
      NIGHT,
      'any',
      false,
      'Es de noche y hay poco viento (5 km/h): no hace falta desviarse, así que te propongo la ruta más rápida.'
    ],
    [
      'night with cierzo: only avoid the wind',
      { windSpeed: 35 },
      NIGHT,
      'any',
      true,
      'Es de noche y sopla cierzo de 35 km/h con rachas de 10 km/h: he marcado «Evitar el viento».'
    ]
  ])('%s', (_case, overrides, sun, sunShade, avoidWind, message) => {
    expect(suggest(overrides, sun)).toEqual({
      status: 'available',
      criterion: expect.any(String),
      answers: { sunShade, avoidWind },
      message
    });
  });

  it.each([
    ['heat', { apparentTemperature: 31 }],
    ['cold', { apparentTemperature: 4 }],
    ['mild', {}]
  ])('never marks «Por parques» (%s): the answers leave it out', (_case, overrides) => {
    expect(suggest(overrides).answers).not.toHaveProperty('preferParks');
  });

  it('without weather it says so and gives no answers, so nothing is changed', () => {
    expect(
      suggestPreferences(recommendRoute({ weather: null, sun: DAY }, recommendationConfig))
    ).toEqual({
      status: 'unavailable',
      criterion: 'weather_unavailable',
      answers: null,
      message:
        'No se ha podido consultar el tiempo actual: tus preferencias se quedan como estaban.'
    });
  });
});
