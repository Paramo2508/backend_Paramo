const { sequelize } = require('../../config/database');
const opennessRepository = require('../../repositories/opennessRepository');
const { runOpenness } = require('../../services/wind/opennessService');

/*
 * Synthetic street network in EPSG:25830 metres relative to (X0, Y0), stored in 4326 like the real
 * data. Every street runs west-east and is 100 m long, so its samples look north and south.
 *
 *   CANYON (y=0):    20 m buildings 5 m to each side  → W 10, H 20, H/W 2    → openness 0
 *   AVENUE (y=500):  20 m buildings 25 m to each side → W 50, H 20, H/W 0.4  → openness 0.71
 *   ONE_SIDE (y=1000): 20 m building 10 m to the north only → W 50, H 10, H/W 0.2 → 1
 *   PARK (y=1500):   no buildings within 40 m         → W 80, H 0            → openness 1
 */
const X0 = 675000;
const Y0 = 4614000;
const STREETS = { CANYON: 0, AVENUE: 500, ONE_SIDE: 1000, PARK: 1500 };
// [minX, minY, maxX, maxY, height_m], blocks as long as the streets.
const BUILDINGS = {
  CANYON_N: [0, 5, 100, 25, 20],
  CANYON_S: [0, -25, 100, -5, 20],
  AVENUE_N: [0, 525, 100, 545, 20],
  AVENUE_S: [0, 455, 100, 475, 20],
  ONE_SIDE_N: [0, 1010, 100, 1030, 20],
  // Beyond the 40 m search distance of the park.
  FAR: [0, 1545, 100, 1560, 30]
};
const config = { sampleSpacingM: 20, maxDistanceM: 40, batchSize: 2, batchTimeoutMs: 60000 };

const toWgs84 = (wkt) => `ST_Transform(ST_GeomFromText('${wkt}', 25830), 4326)`;
const rectangle = ([minX, minY, maxX, maxY]) =>
  `MULTIPOLYGON(((${[
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY]
  ]
    .map(([x, y]) => `${X0 + x} ${Y0 + y}`)
    .join(', ')})))`;

let ids;

async function loadDataset() {
  for (const [name, y] of Object.entries(STREETS)) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(
      `INSERT INTO street_segments (source, source_id, osm_way_id, name, highway, geom, length_m)
       VALUES ('osm', :name, 1, :name, 'residential',
         ${toWgs84(`LINESTRING(${X0} ${Y0 + y}, ${X0 + 100} ${Y0 + y})`)}, 100)`,
      { replacements: { name } }
    );
  }
  for (const [name, box] of Object.entries(BUILDINGS)) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(
      `INSERT INTO buildings (source, source_id, height_m, height_source, floors, geom)
       VALUES ('synthetic', :name, :height, 'measured', 6, ${toWgs84(rectangle(box))})`,
      { replacements: { name, height: box[4] } }
    );
  }
  const rows = await sequelize.query('SELECT source_id, id FROM street_segments', {
    type: sequelize.QueryTypes.SELECT
  });
  ids = Object.fromEntries(rows.map((row) => [row.source_id, row.id]));
}

async function lngLat(x, y) {
  const [row] = await sequelize.query(
    `SELECT ST_X(g) AS lng, ST_Y(g) AS lat FROM (SELECT ${toWgs84(`POINT(${X0 + x} ${Y0 + y})`)} AS g) p`,
    { type: sequelize.QueryTypes.SELECT }
  );
  return [row.lng, row.lat];
}

describe('street openness (PostGIS)', () => {
  beforeEach(async () => {
    await sequelize.query(
      'TRUNCATE buildings, street_segments, segment_openness RESTART IDENTITY CASCADE'
    );
    await loadDataset();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('measures width, height and openness of each segment', async () => {
    const summary = await runOpenness({ config });
    const canyon = await opennessRepository.getSegmentOpenness(ids.CANYON);
    const avenue = await opennessRepository.getSegmentOpenness(ids.AVENUE);
    const oneSide = await opennessRepository.getSegmentOpenness(ids.ONE_SIDE);
    const park = await opennessRepository.getSegmentOpenness(ids.PARK);

    expect(summary).toMatchObject({ status: 'success', segments: 4, streetSegments: 4 });
    // 100 m every 20 m: 5 samples.
    expect(canyon).toMatchObject({ samples: 5, openness: 0 });
    expect(canyon.widthM).toBeCloseTo(10, 0);
    expect(canyon.heightM).toBeCloseTo(20);
    expect(avenue.widthM).toBeCloseTo(50, 0);
    expect(avenue.hwRatio).toBeCloseTo(0.4, 1);
    expect(avenue.openness).toBeCloseTo(0.71, 1);
    expect(oneSide.widthM).toBeCloseTo(50, 0);
    expect(oneSide.openness).toBe(1);
    expect(park).toMatchObject({ openness: 1, heightM: 0 });
    expect(park.widthM).toBeCloseTo(80);
  });

  it('replaces the previous openness on every run', async () => {
    await runOpenness({ config });
    await sequelize.query('DELETE FROM buildings');

    await runOpenness({ config });

    expect((await opennessRepository.getSegmentOpenness(ids.CANYON)).openness).toBe(1);
  });

  it('finds the openness of the street nearest to each point', async () => {
    await runOpenness({ config });
    const points = [await lngLat(50, 2), await lngLat(50, 1502), await lngLat(50, 250)];

    // On the canyon, on the park and far from every street.
    await expect(opennessRepository.findOpennessNearPoints(points, 10)).resolves.toEqual([
      0,
      1,
      null
    ]);
    await expect(opennessRepository.findOpennessNearPoints([], 10)).resolves.toEqual([]);
  });

  it('returns null for a segment without computed openness', async () => {
    await expect(opennessRepository.getSegmentOpenness(ids.CANYON)).resolves.toBeNull();
  });
});
