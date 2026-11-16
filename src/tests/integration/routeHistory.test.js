const { sequelize } = require('../../config/database');
const repository = require('../../repositories/routeHistoryRepository');
const userRepository = require('../../repositories/userRepository');

const newUser = (email) => userRepository.createUser({ name: 'Ana', email, passwordHash: 'x' });
const point = (lat, label = null) => ({ lat, lng: -0.88, label });
const trip = (n) => ({ origin: point(41.6 + n / 1000, `Origen ${n}`), destination: point(41.65) });

describe('favourite trips (PostgreSQL)', () => {
  beforeEach(async () => {
    await sequelize.query(
      'TRUNCATE users, route_searches, route_favorites RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('keeps the favourites of each user apart', async () => {
    const ana = await newUser('ana@correo.es');
    const luis = await newUser('luis@correo.es');
    const favorite = await repository.createFavorite(ana.id, { ...trip(1), name: 'Casa' });

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

  it('deletes the favourites with the user', async () => {
    const ana = await newUser('ana@correo.es');
    await repository.createFavorite(ana.id, { ...trip(1), name: 'Casa' });

    await sequelize.query('DELETE FROM users WHERE id = :id', { replacements: { id: ana.id } });

    const [[counts]] = await sequelize.query(
      'SELECT (SELECT count(*) FROM route_favorites)::int AS favorites'
    );
    expect(counts).toEqual({ favorites: 0 });
  });
});
