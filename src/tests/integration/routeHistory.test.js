const { sequelize } = require('../../config/database');
const repository = require('../../repositories/routeHistoryRepository');
const userRepository = require('../../repositories/userRepository');

const newUser = (email) => userRepository.createUser({ name: 'Ana', email, passwordHash: 'x' });
const point = (lat, label = null) => ({ lat, lng: -0.88, label });
const trip = (n) => ({ origin: point(41.6 + n / 1000, `Origen ${n}`), destination: point(41.65) });

describe('route history and favourites (PostgreSQL)', () => {
  beforeEach(async () => {
    await sequelize.query(
      'TRUNCATE users, route_searches, route_favorites RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('keeps only the last searches, newest first, without repeating a trip', async () => {
    const ana = await newUser('ana@correo.es');
    await repository.recordSearch(ana.id, trip(1), 3);
    await repository.recordSearch(ana.id, trip(2), 3);
    await repository.recordSearch(ana.id, trip(3), 3);
    await repository.recordSearch(ana.id, trip(4), 3);
    // An older trip again, with a newer name: it moves to the top instead of repeating.
    await repository.recordSearch(
      ana.id,
      { ...trip(2), origin: { ...trip(2).origin, label: 'Casa' } },
      3
    );

    const searches = await repository.listSearches(ana.id);
    expect(searches.map((search) => search.origin.label)).toEqual(['Casa', 'Origen 4', 'Origen 3']);
    expect(searches[0].destination).toEqual({ lat: 41.65, lng: -0.88, label: null });
  });

  it('keeps the history and the favourites of each user apart', async () => {
    const ana = await newUser('ana@correo.es');
    const luis = await newUser('luis@correo.es');
    await repository.recordSearch(ana.id, trip(1), 10);
    await repository.recordSearch(luis.id, trip(1), 10);
    const favorite = await repository.createFavorite(ana.id, { ...trip(1), name: 'Casa' });

    expect(await repository.clearSearches(ana.id)).toBe(1);
    expect(await repository.listSearches(ana.id)).toEqual([]);
    expect(await repository.listSearches(luis.id)).toHaveLength(1);
    expect(await repository.listFavorites(luis.id)).toEqual([]);
    expect(await repository.deleteFavorite(luis.id, favorite.id)).toBe(false);
    expect(await repository.listFavorites(ana.id)).toHaveLength(1);
    expect(await repository.deleteFavorite(ana.id, favorite.id)).toBe(true);
  });

  it('refuses the same favourite trip twice and counts the favourites', async () => {
    const ana = await newUser('ana@correo.es');
    await repository.createFavorite(ana.id, { ...trip(1), name: 'Casa' });

    await expect(
      repository.createFavorite(ana.id, { ...trip(1), name: 'Otra' })
    ).rejects.toMatchObject({ status: 409 });
    expect(await repository.countFavorites(ana.id)).toBe(1);
  });

  it('deletes the history and the favourites with the user', async () => {
    const ana = await newUser('ana@correo.es');
    await repository.recordSearch(ana.id, trip(1), 10);
    await repository.createFavorite(ana.id, { ...trip(1), name: 'Casa' });

    await sequelize.query('DELETE FROM users WHERE id = :id', { replacements: { id: ana.id } });

    const [[counts]] = await sequelize.query(
      `SELECT (SELECT count(*) FROM route_searches)::int AS searches,
              (SELECT count(*) FROM route_favorites)::int AS favorites`
    );
    expect(counts).toEqual({ searches: 0, favorites: 0 });
  });
});
