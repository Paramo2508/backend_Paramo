const {
  MAX_FAVORITES_PER_USER,
  MAX_SEARCHES_PER_USER,
  createRouteHistoryService
} = require('../../services/routing/routeHistoryService');

const area = { minLng: -1.19, minLat: 41.45, maxLng: -0.68, maxLat: 41.79 };
const trip = {
  origin: { lat: 41.6572, lng: -0.88039, label: 'Plaza del Pilar' },
  destination: { lat: 41.65069, lng: -0.88005, label: 'Plaza de España' }
};

const repository = () => ({
  listSearches: jest.fn().mockResolvedValue([]),
  recordSearch: jest.fn().mockResolvedValue({ id: 1 }),
  clearSearches: jest.fn().mockResolvedValue(3),
  listFavorites: jest.fn().mockResolvedValue([]),
  countFavorites: jest.fn().mockResolvedValue(0),
  createFavorite: jest.fn().mockResolvedValue({ id: 2 }),
  deleteFavorite: jest.fn().mockResolvedValue(true)
});

describe('routeHistoryService', () => {
  it('records a validated search keeping only the last ten', async () => {
    const repo = repository();
    await createRouteHistoryService(repo, area).recordSearch(7, trip);

    expect(repo.recordSearch).toHaveBeenCalledWith(7, trip, MAX_SEARCHES_PER_USER);
    expect(MAX_SEARCHES_PER_USER).toBe(10);
  });

  it('does not record a search outside Zaragoza', async () => {
    const repo = repository();
    const outside = { ...trip, destination: { lat: 40.4, lng: -3.7 } };

    await expect(
      createRouteHistoryService(repo, area).recordSearch(7, outside)
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.recordSearch).not.toHaveBeenCalled();
  });

  it('adds a favourite with its default name and refuses more than the maximum', async () => {
    const repo = repository();
    const service = createRouteHistoryService(repo, area);

    await service.addFavorite(7, trip);
    expect(repo.createFavorite).toHaveBeenCalledWith(7, {
      ...trip,
      name: 'Plaza del Pilar → Plaza de España'
    });

    repo.countFavorites.mockResolvedValue(MAX_FAVORITES_PER_USER);
    await expect(service.addFavorite(7, trip)).rejects.toMatchObject({ status: 409 });
  });

  it('removes only an existing favourite of the user', async () => {
    const repo = repository();
    const service = createRouteHistoryService(repo, area);

    await service.removeFavorite(7, '2');
    expect(repo.deleteFavorite).toHaveBeenCalledWith(7, 2);

    repo.deleteFavorite.mockResolvedValue(false);
    await expect(service.removeFavorite(7, '2')).rejects.toMatchObject({ status: 404 });
    await expect(service.removeFavorite(7, 'abc')).rejects.toMatchObject({ status: 404 });
  });

  it('lists and clears through the repository with the user id', async () => {
    const repo = repository();
    const service = createRouteHistoryService(repo, area);

    await service.listSearches(7);
    await service.clearSearches(7);
    await service.listFavorites(7);

    expect(repo.listSearches).toHaveBeenCalledWith(7);
    expect(repo.clearSearches).toHaveBeenCalledWith(7);
    expect(repo.listFavorites).toHaveBeenCalledWith(7);
  });
});
