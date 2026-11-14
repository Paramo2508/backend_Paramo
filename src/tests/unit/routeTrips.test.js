const { defaultFavoriteName, parseFavorite, parseTrip } = require('../../domain/routes/routeTrips');

const area = { minLng: -1.19, minLat: 41.45, maxLng: -0.68, maxLat: 41.79 };
const pilar = { lat: 41.6572049, lng: -0.8803911, label: '  Plaza del Pilar, Zaragoza, Spain ' };
const espana = { lat: 41.65069, lng: -0.88005 };

describe('routeTrips', () => {
  it('rounds the points to about a metre and trims the place names', () => {
    expect(parseTrip({ origin: pilar, destination: espana }, area)).toEqual({
      origin: { lat: 41.6572, lng: -0.88039, label: 'Plaza del Pilar, Zaragoza, Spain' },
      destination: { lat: 41.65069, lng: -0.88005, label: null }
    });
  });

  it('rejects points that are missing, invalid or outside Zaragoza', () => {
    expect(() => parseTrip({ origin: pilar }, area)).toThrow(
      expect.objectContaining({ status: 400, fields: { destination: 'Coordenadas no válidas.' } })
    );
    expect(() =>
      parseTrip({ origin: { lat: 40.4, lng: -3.7 }, destination: espana }, area)
    ).toThrow(expect.objectContaining({ status: 400, fields: { origin: 'Fuera de Zaragoza.' } }));
    expect(() => parseTrip({ origin: { ...pilar, label: 3 }, destination: espana }, area)).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('names a favourite after its places when it has no name', () => {
    const trip = parseTrip({ origin: pilar, destination: espana }, area);
    expect(defaultFavoriteName(trip)).toBe('Plaza del Pilar → Destino');
    expect(parseFavorite({ origin: pilar, destination: espana, name: '   ' }, area).name).toBe(
      'Plaza del Pilar → Destino'
    );
    expect(parseFavorite({ origin: pilar, destination: espana, name: ' Casa ' }, area).name).toBe(
      'Casa'
    );
  });

  it('rejects a favourite name that is too long or not text', () => {
    const trip = { origin: pilar, destination: espana };
    expect(() => parseFavorite({ ...trip, name: 'x'.repeat(61) }, area)).toThrow(
      expect.objectContaining({ status: 400, fields: { name: 'Como mucho 60 caracteres.' } })
    );
    expect(() => parseFavorite({ ...trip, name: 7 }, area)).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });
});
