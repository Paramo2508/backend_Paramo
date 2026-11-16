const { sequelize, RecentPlace } = require('./models');

// #180 (changes PBI-12): the places used recently as origin or destination by each user.

const toPlace = (row) => ({
  id: row.id,
  lat: row.lat,
  lng: row.lng,
  label: row.label,
  usedAt: new Date(row.usedAt).toISOString()
});

async function listPlaces(userId, limit, transaction) {
  const rows = await RecentPlace.findAll({
    where: { userId },
    attributes: ['id', 'lat', 'lng', 'label', 'usedAt'],
    order: [
      ['usedAt', 'DESC'],
      ['id', 'DESC']
    ],
    limit,
    raw: true,
    transaction
  });
  return rows.map(toPlace);
}

/*
 * The places in the order they were used (the last one is the newest). A place used again moves to
 * the top with its latest name instead of repeating (unique index on the rounded point);
 * clock_timestamp() changes within the transaction, so the order of the request is kept. Then only
 * the newest `keep` places stay, so the table never holds more personal locations than the list
 * shows. Returns the list as it is now.
 */
async function recordPlaces(userId, places, keep) {
  return sequelize.transaction(async (transaction) => {
    for (const { lat, lng, label } of places) {
      // eslint-disable-next-line no-await-in-loop
      await sequelize.query(
        `INSERT INTO recent_places (user_id, lat, lng, label, used_at)
         VALUES (:userId, :lat, :lng, :label, clock_timestamp())
         ON CONFLICT (user_id, lat, lng)
         DO UPDATE SET used_at = EXCLUDED.used_at, label = EXCLUDED.label`,
        { replacements: { userId, lat, lng, label }, transaction }
      );
    }
    await sequelize.query(
      `DELETE FROM recent_places WHERE user_id = :userId AND id NOT IN (
         SELECT id FROM recent_places WHERE user_id = :userId
         ORDER BY used_at DESC, id DESC LIMIT :keep)`,
      { replacements: { userId, keep }, transaction }
    );
    return listPlaces(userId, keep, transaction);
  });
}

function clearPlaces(userId) {
  return RecentPlace.destroy({ where: { userId } });
}

module.exports = { clearPlaces, listPlaces, recordPlaces };
