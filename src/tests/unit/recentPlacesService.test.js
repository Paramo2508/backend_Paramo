const {
  MAX_RECENT_PLACES,
  createRecentPlacesService
} = require('../../services/routing/recentPlacesService');

const area = { minLng: -1.19, minLat: 41.45, maxLng: -0.68, maxLat: 41.79 };
const places = [
  { lat: 41.6572, lng: -0.88039, label: 'Plaza del Pilar' },
  { lat: 41.65069, lng: -0.88005, label: 'Plaza de España' }
];

const repository = () => ({
  listPlaces: jest.fn().mockResolvedValue([]),
  recordPlaces: jest.fn().mockResolvedValue([{ id: 1 }]),
  clearPlaces: jest.fn().mockResolvedValue(2)
});

describe('recentPlacesService', () => {
  it('keeps and lists at most six places', async () => {
    const repo = repository();
    const service = createRecentPlacesService(repo, area);

    expect(await service.recordPlaces(7, { places })).toEqual([{ id: 1 }]);
    await service.listPlaces(7);

    expect(MAX_RECENT_PLACES).toBe(6);
    expect(repo.recordPlaces).toHaveBeenCalledWith(7, places, MAX_RECENT_PLACES);
    expect(repo.listPlaces).toHaveBeenCalledWith(7, MAX_RECENT_PLACES);
  });

  it('records nothing when a place is outside Zaragoza', async () => {
    const repo = repository();

    await expect(
      createRecentPlacesService(repo, area).recordPlaces(7, {
        places: [places[0], { lat: 40.4, lng: -3.7 }]
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.recordPlaces).not.toHaveBeenCalled();
  });

  it('clears the places of the user', async () => {
    const repo = repository();
    await createRecentPlacesService(repo, area).clearPlaces(7);
    expect(repo.clearPlaces).toHaveBeenCalledWith(7);
  });
});
