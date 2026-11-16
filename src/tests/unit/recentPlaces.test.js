const { parseRecentPlaces } = require('../../domain/routes/recentPlaces');

const area = { minLng: -1.19, minLat: 41.45, maxLng: -0.68, maxLat: 41.79 };
const pilar = { lat: 41.6572049, lng: -0.8803911, label: '  Plaza del Pilar, Zaragoza ' };
const espana = { lat: 41.65069, lng: -0.88005 };

describe('recentPlaces', () => {
  it('rounds the places to about a metre and trims their names, in the order they came', () => {
    expect(parseRecentPlaces({ places: [pilar, espana] }, area)).toEqual([
      { lat: 41.6572, lng: -0.88039, label: 'Plaza del Pilar, Zaragoza' },
      { lat: 41.65069, lng: -0.88005, label: null }
    ]);
  });

  it('counts the same place twice once, in its last position', () => {
    const near = { ...pilar, lat: 41.657201, label: 'Pilar' };
    expect(parseRecentPlaces({ places: [pilar, near] }, area)).toEqual([
      { lat: 41.6572, lng: -0.88039, label: 'Pilar' }
    ]);
  });

  it('needs one or two places', () => {
    for (const input of [undefined, {}, { places: [] }, { places: [pilar, espana, pilar] }]) {
      expect(() => parseRecentPlaces(input, area)).toThrow(
        expect.objectContaining({ status: 400, fields: { places: 'Entre 1 y 2 lugares.' } })
      );
    }
  });

  it('rejects places that are invalid or outside Zaragoza, naming which one', () => {
    expect(() => parseRecentPlaces({ places: [pilar, { lat: 40.4, lng: -3.7 }] }, area)).toThrow(
      expect.objectContaining({ status: 400, fields: { 'places[1]': 'Fuera de Zaragoza.' } })
    );
    expect(() => parseRecentPlaces({ places: [{ lat: 'x' }] }, area)).toThrow(
      expect.objectContaining({ status: 400, fields: { 'places[0]': 'Coordenadas no válidas.' } })
    );
    expect(() => parseRecentPlaces({ places: [{ ...pilar, label: 3 }] }, area)).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });
});
