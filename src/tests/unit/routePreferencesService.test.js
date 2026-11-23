const { createRoutePreferencesService } = require('../../services/routing/routePreferencesService');
const {
  preferencesFromRoute
} = require('../../repositories/migrations/20261123000001-create-route-preferences');

const saved = {
  sunShade: 'sun',
  avoidWind: false,
  preferParks: true,
  extraMinutes: 2
};

describe('route preferences service (PBI-18, ADR-036)', () => {
  const repository = { findForUser: jest.fn(), saveForUser: jest.fn() };
  const service = createRoutePreferencesService(repository);

  beforeEach(() => jest.clearAllMocks());

  it('gives the saved preferences of the user', async () => {
    repository.findForUser.mockResolvedValue(saved);
    await expect(service.getPreferences(3)).resolves.toEqual(saved);
    expect(repository.findForUser).toHaveBeenCalledWith(3);
  });

  it('gives the defaults to a user who never saved any', async () => {
    repository.findForUser.mockResolvedValue(null);
    await expect(service.getPreferences(3)).resolves.toEqual({
      sunShade: 'any',
      avoidWind: false,
      preferParks: false,
      extraMinutes: 5
    });
  });

  it('validates before saving', async () => {
    repository.saveForUser.mockResolvedValue(saved);
    await expect(service.savePreferences(3, { ...saved, extra: 1 })).resolves.toEqual(saved);
    expect(repository.saveForUser).toHaveBeenCalledWith(3, saved);

    expect(() => service.savePreferences(3, { ...saved, sunShade: 'both' })).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(repository.saveForUser).toHaveBeenCalledTimes(1);
  });
});

describe('migration create-route-preferences: a saved route as preferences', () => {
  const route = (shadeWeight, sunWeight, windWeight, vegetationWeight, maxDetourPercentage) => ({
    shadeWeight,
    sunWeight,
    windWeight,
    vegetationWeight,
    maxDetourPercentage
  });

  it.each([
    // The routes of the local database on 2026-11-23 (user 3).
    ['Soleada edited to shade 60', route(60, 0, 0, 0, 40), 'shade', false, false, 15],
    ['verde', route(0, 0, 0, 100, 40), 'any', false, true, 15],
    ['Asistente', route(0, 75, 25, 0, 25), 'sun', true, false, 5],
    ['Rápida', route(0, 0, 0, 0, 25), 'any', false, false, 5],
    ['light weights stay indifferent', route(24, 0, 24, 24, 12), 'any', false, false, 2],
    ['no extra time', route(50, 0, 0, 0, 0), 'shade', false, false, 0],
    ['30 % is 10 minutes', route(0, 50, 0, 0, 30), 'sun', false, false, 10]
  ])('%s', (_name, savedRoute, sunShade, avoidWind, preferParks, extraMinutes) => {
    expect(preferencesFromRoute(savedRoute)).toEqual({
      sunShade,
      avoidWind,
      preferParks,
      extraMinutes
    });
  });
});
