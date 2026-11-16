const { sequelize } = require('../../config/database');
const createRecentPlaces = require('../../repositories/migrations/20261116000001-create-recent-places');
const repository = require('../../repositories/recentPlacesRepository');
const userRepository = require('../../repositories/userRepository');
const { logger } = require('../../utils/logger');

const newUser = (email) => userRepository.createUser({ name: 'Ana', email, passwordHash: 'x' });
// Rounded like the domain does before the repository.
const place = (n, label = `Lugar ${n}`) => ({
  lat: Number((41.6 + n / 1000).toFixed(5)),
  lng: -0.88,
  label
});
const labels = (places) => places.map((item) => item.label);

describe('recent places (PostgreSQL)', () => {
  beforeEach(async () => {
    await sequelize.query(
      'TRUNCATE users, recent_places, route_searches, route_favorites RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('keeps only the last places, newest first, without repeating a place', async () => {
    const ana = await newUser('ana@correo.es');
    // A route records its origin and then its destination: the destination is the newest.
    await repository.recordPlaces(ana.id, [place(1), place(2)], 3);
    await repository.recordPlaces(ana.id, [place(3), place(4)], 3);
    // An older place again, with a newer name: it moves to the top instead of repeating.
    const updated = await repository.recordPlaces(ana.id, [place(2, 'Casa')], 3);

    expect(labels(updated)).toEqual(['Casa', 'Lugar 4', 'Lugar 3']);
    expect(labels(await repository.listPlaces(ana.id, 3))).toEqual(['Casa', 'Lugar 4', 'Lugar 3']);
    expect(updated[0]).toEqual({
      id: expect.any(Number),
      lat: 41.602,
      lng: -0.88,
      label: 'Casa',
      usedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    });
    const [[{ count }]] = await sequelize.query('SELECT count(*)::int AS count FROM recent_places');
    expect(count).toBe(3);
  });

  it('keeps the places of each user apart and clears only those of the user', async () => {
    const ana = await newUser('ana@correo.es');
    const luis = await newUser('luis@correo.es');
    await repository.recordPlaces(ana.id, [place(1), place(2)], 6);
    await repository.recordPlaces(luis.id, [place(1)], 6);

    expect(await repository.clearPlaces(ana.id)).toBe(2);
    expect(await repository.listPlaces(ana.id, 6)).toEqual([]);
    expect(labels(await repository.listPlaces(luis.id, 6))).toEqual(['Lugar 1']);
  });

  it('deletes the places with the user', async () => {
    const ana = await newUser('ana@correo.es');
    await repository.recordPlaces(ana.id, [place(1)], 6);

    await sequelize.query('DELETE FROM users WHERE id = :id', { replacements: { id: ana.id } });

    const [[{ count }]] = await sequelize.query('SELECT count(*)::int AS count FROM recent_places');
    expect(count).toBe(0);
  });

  describe('migration create-recent-places', () => {
    const queryInterface = () => sequelize.getQueryInterface();

    async function search(userId, origin, destination, minutesAgo) {
      await sequelize.query(
        `INSERT INTO route_searches (user_id, origin_lat, origin_lng, origin_label,
           destination_lat, destination_lng, destination_label, searched_at)
         VALUES (:userId, :oLat, -0.88, :oLabel, :dLat, -0.88, :dLabel,
           now() - make_interval(mins => :minutesAgo))`,
        {
          replacements: {
            userId,
            oLat: origin.lat,
            oLabel: origin.label,
            dLat: destination.lat,
            dLabel: destination.label,
            minutesAgo
          }
        }
      );
    }

    afterEach(async () => {
      // Back to the schema of the other tests.
      await sequelize.query('DROP TABLE IF EXISTS recent_places');
      await createRecentPlaces.up(queryInterface());
    });

    it('copies the places of the trip history, logs how many, and leaves the trips untouched', async () => {
      const info = jest.spyOn(logger, 'info').mockImplementation(() => {});
      const ana = await newUser('ana@correo.es');
      const luis = await newUser('luis@correo.es');
      await newUser('eva@correo.es');
      await search(ana.id, place(1), place(2), 50);
      // The device location is not copied: its coordinates were only valid then.
      await search(ana.id, place(9, 'Ubicación actual'), place(3), 40);
      // Lugar 1 again, later, with another name: one place, with its latest name and use.
      await search(ana.id, place(1, 'Casa'), place(4), 30);
      await search(ana.id, place(5), place(6), 20);
      await search(ana.id, place(7), place(8, null), 10);
      await search(luis.id, place(1), place(2), 5);
      await createRecentPlaces.down(queryInterface());

      const counts = await createRecentPlaces.up(queryInterface());

      // Ana: 8 distinct places without the device location, at most 6; Luis: 2; Eva: none.
      expect(counts).toEqual({ places: 8, users: 2 });
      expect(info).toHaveBeenCalledWith(
        'create-recent-places: 8 place(s) copied from route_searches for 2 user(s); ' +
          'route_searches is left unused'
      );
      expect(labels(await repository.listPlaces(ana.id, 6))).toEqual([
        null,
        'Lugar 7',
        'Lugar 6',
        'Lugar 5',
        'Lugar 4',
        'Casa'
      ]);
      expect(labels(await repository.listPlaces(luis.id, 6))).toEqual(['Lugar 2', 'Lugar 1']);
      const [[{ trips }]] = await sequelize.query(
        'SELECT count(*)::int AS trips FROM route_searches'
      );
      expect(trips).toBe(6);
      info.mockRestore();
    });

    it('down() drops recent_places and keeps route_searches', async () => {
      const ana = await newUser('ana@correo.es');
      await search(ana.id, place(1), place(2), 5);

      await createRecentPlaces.down(queryInterface());

      const [[tables]] = await sequelize.query(
        `SELECT to_regclass('recent_places') IS NULL AS "placesDropped",
                (SELECT count(*)::int FROM route_searches) AS trips`
      );
      expect(tables).toEqual({ placesDropped: true, trips: 1 });
    });
  });
});
