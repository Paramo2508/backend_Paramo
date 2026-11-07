const request = require('supertest');

const { createApp } = require('../../app');
const { associationConfig } = require('../../config/associationConfig');
const { env } = require('../../config/env');
const { sequelize } = require('../../config/database');
const { signToken } = require('../../services/auth/tokenService');
const { runAssociation } = require('../../services/geo/associationService');

/*
 * Same geometry as the synthetic dataset of association.test.js (EPSG:25830 metres relative to
 * (X0, Y0), stored in 4326), reduced to what these queries need. Expected distances are planar;
 * geography distances differ by less than 0.1 %, hence the tolerance.
 *
 *   S3 (y=62): T_CORNER 8 m (nearest), T_LONLAT 12 m (radius)
 *   S1 (y=0):  T_S1 5 m (nearest); buildings B_POLY 25 m and B_TALL 40 m (radius)
 *   S4 (y=-80): buildings B_LOW 30 m and B_TALL 30 m (nearest)
 */
const X0 = 675000;
const Y0 = 4613000;
const config = { ...associationConfig, minPct: 50 };
const TOLERANCE_M = 0.5;

const WAY_ID = { S1: 8000000001, S2: 8000000002, S3: 8000000003, S4: 8000000004, S5: 8000000005 };
const segments = {
  S1: [
    [0, 0],
    [200, 0]
  ],
  S2: [
    [300, -100],
    [300, 100]
  ],
  S3: [
    [0, 62],
    [295, 62]
  ],
  S4: [
    [0, -80],
    [200, -80]
  ],
  // Far from every element.
  S5: [
    [2000, 2000],
    [2100, 2000]
  ]
};
const trees = {
  T_LONLAT: [290, 50],
  T_S1: [100, 5],
  T_CORNER: [290, 70],
  T_S4: [100, -75]
};
// [minX, minY, maxX, maxY, height_m]
const buildings = {
  B_LOW: [50, -50, 60, -40, 4],
  B_TALL: [120, -50, 130, -40, 40],
  B_POLY: [215, -30, 290, -20, 10]
};

const toWgs84 = (wkt) => `ST_Transform(ST_GeomFromText('${wkt}', 25830), 4326)`;
const point = ([x, y]) => `POINT(${X0 + x} ${Y0 + y})`;
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

const rows = (sql, replacements) =>
  sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

let ids;
let auth;

async function loadDataset() {
  for (const [name, coordinates] of Object.entries(segments)) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(
      `INSERT INTO street_segments (source, source_id, osm_way_id, name, highway, geom, length_m)
       VALUES ('osm', :name, :wayId, :street, 'footway', ${toWgs84(
         `LINESTRING(${coordinates.map(([x, y]) => `${X0 + x} ${Y0 + y}`).join(', ')})`
       )}, 100)`,
      { replacements: { name, wayId: WAY_ID[name], street: `Calle ${name}` } }
    );
  }
  for (const [name, xy] of Object.entries(trees)) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(
      `INSERT INTO trees (source, source_id, species, height_m, crown_diameter_m, geom)
       VALUES ('synthetic', :name, 'Platanus', 9, 4, ${toWgs84(point(xy))})`,
      { replacements: { name } }
    );
  }
  for (const [name, box] of Object.entries(buildings)) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.query(
      `INSERT INTO buildings (source, source_id, height_m, height_source, floors, geom)
       VALUES ('synthetic', :name, :height, 'measured', 3, ${toWgs84(rectangle(box))})`,
      { replacements: { name, height: box[4] } }
    );
  }
  const idRows = await rows(`
    SELECT source_id, id FROM street_segments UNION ALL
    SELECT source_id, id FROM trees UNION ALL
    SELECT source_id, id FROM buildings`);
  ids = Object.fromEntries(idRows.map((row) => [row.source_id, row.id]));
}

// WGS84 position of a point of the synthetic grid.
async function latLngOf(xy) {
  const [row] = await rows(
    `SELECT ST_Y(g) AS lat, ST_X(g) AS lng FROM (SELECT ${toWgs84(point(xy))} AS g) p`
  );
  return row;
}

const get = (path) => request(createApp()).get(path).set(auth);
const summarize = (list) => list.map((e) => [e.sourceId, e.isNearest]);

describe('segment queries and data status API (PostGIS)', () => {
  const originalSecret = env.jwtSecret;

  beforeAll(() => {
    env.jwtSecret = 'test-secret';
    auth = { Authorization: `Bearer ${signToken({ id: 1 })}` };
  });

  beforeEach(async () => {
    await sequelize.query(
      `TRUNCATE buildings, trees, street_segments, association_runs, unassociated_elements,
         import_rejections, import_runs RESTART IDENTITY CASCADE`
    );
    await loadDataset();
    await runAssociation({ config });
  });

  afterAll(async () => {
    env.jwtSecret = originalSecret;
    await sequelize.close();
  });

  describe('GET /api/segments/:id/urban-elements', () => {
    it('returns the trees of a known segment, nearest first, with the data for the shadows', async () => {
      const response = await get(`/api/segments/${ids.S3}/urban-elements?types=trees`);

      expect(response.status).toBe(200);
      expect(response.body.segment).toMatchObject({
        id: ids.S3,
        sourceId: 'S3',
        osmWayId: WAY_ID.S3,
        name: 'Calle S3',
        highway: 'footway',
        geometry: { type: 'LineString' }
      });
      expect(summarize(response.body.trees)).toEqual([
        ['T_CORNER', true],
        ['T_LONLAT', false]
      ]);
      const [corner, lonlat] = response.body.trees;
      expect(corner).toMatchObject({
        id: ids.T_CORNER,
        species: 'Platanus',
        heightM: 9,
        crownDiameterM: 4,
        geometry: { type: 'Point' }
      });
      expect(Math.abs(corner.distanceM - 8)).toBeLessThan(TOLERANCE_M);
      expect(Math.abs(lonlat.distanceM - 12)).toBeLessThan(TOLERANCE_M);
      expect(response.body.buildings).toBeUndefined();
      expect(response.body.summary).toEqual({
        trees: 2,
        nearestTrees: 1,
        associationStale: false
      });
    });

    it('returns the buildings of a known segment with height, floors and radius', async () => {
      const response = await get(`/api/segments/${ids.S1}/urban-elements?types=buildings`);

      expect(response.status).toBe(200);
      expect(summarize(response.body.buildings)).toEqual([
        ['B_POLY', false],
        ['B_TALL', false]
      ]);
      const [poly, tall] = response.body.buildings;
      expect(Math.abs(poly.distanceM - 25)).toBeLessThan(TOLERANCE_M);
      expect(Math.abs(tall.distanceM - 40)).toBeLessThan(TOLERANCE_M);
      expect(tall).toMatchObject({
        id: ids.B_TALL,
        heightM: 40,
        heightSource: 'measured',
        heightSuspicious: false,
        floors: 3,
        associationRadiusM: 60,
        geometry: { type: 'MultiPolygon' }
      });
      expect(poly.associationRadiusM).toBe(30);
      expect(response.body.trees).toBeUndefined();
      expect(response.body.summary).toEqual({
        buildings: 2,
        nearestBuildings: 0,
        associationStale: false
      });
    });

    it('returns both types by default and counts every returned element', async () => {
      const response = await get(`/api/segments/${ids.S4}/urban-elements`);

      expect(response.status).toBe(200);
      expect(summarize(response.body.trees)).toEqual([['T_S4', true]]);
      // Both buildings are 30 m from S4, so their order is not fixed.
      expect(summarize(response.body.buildings).sort()).toEqual([
        ['B_LOW', true],
        ['B_TALL', true]
      ]);
      expect(response.body.summary).toEqual({
        trees: 1,
        nearestTrees: 1,
        buildings: 2,
        nearestBuildings: 2,
        associationStale: false
      });
    });

    it('returns empty lists for a segment without elements', async () => {
      const response = await get(`/api/segments/${ids.S5}/urban-elements?types=buildings,trees`);

      expect(response.status).toBe(200);
      expect(response.body.buildings).toEqual([]);
      expect(response.body.trees).toEqual([]);
      expect(response.body.summary).toEqual({
        trees: 0,
        nearestTrees: 0,
        buildings: 0,
        nearestBuildings: 0,
        associationStale: false
      });
    });

    it('flags stale associations only for the requested types', async () => {
      await sequelize.query(
        "UPDATE association_runs SET status = 'stale' WHERE element_type = 'tree'"
      );

      const treesResponse = await get(`/api/segments/${ids.S3}/urban-elements?types=trees`);
      const buildingsResponse = await get(`/api/segments/${ids.S1}/urban-elements?types=buildings`);
      const both = await get(`/api/segments/${ids.S1}/urban-elements`);

      expect(treesResponse.body.summary.associationStale).toBe(true);
      expect(buildingsResponse.body.summary.associationStale).toBe(false);
      expect(both.body.summary.associationStale).toBe(true);
    });

    it('returns 404 for a segment that does not exist', async () => {
      const response = await get('/api/segments/999999/urban-elements');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { message: 'No existe el tramo indicado.' } });
    });

    it.each(['abc', '0', '-3', '1.5', '99999999999'])('returns 400 for the id %s', async (id) => {
      const response = await get(`/api/segments/${id}/urban-elements`);

      expect(response.status).toBe(400);
      expect(response.body.error.fields).toHaveProperty('id');
    });

    it.each(['cars', 'trees,cars', ''])('returns 400 for types=%s', async (types) => {
      const response = await get(`/api/segments/${ids.S1}/urban-elements?types=${types}`);

      expect(response.status).toBe(400);
      expect(response.body.error.fields).toHaveProperty('types');
    });
  });

  describe('GET /api/segments/nearest', () => {
    it('returns the nearest segment and its distance', async () => {
      const { lat, lng } = await latLngOf([100, 5]);

      const response = await get(`/api/segments/nearest?lat=${lat}&lng=${lng}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: ids.S1, sourceId: 'S1', osmWayId: WAY_ID.S1 });
      expect(Math.abs(response.body.distanceM - 5)).toBeLessThan(TOLERANCE_M);
    });

    it('returns 404 when the closest segment is beyond ASSOC_MAX_NEAREST_M', async () => {
      const { lat, lng } = await latLngOf([100, 1000]);

      const response = await get(`/api/segments/nearest?lat=${lat}&lng=${lng}`);

      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe(
        `No hay ningún tramo a menos de ${associationConfig.maxNearestM} m del punto indicado.`
      );
    });

    it.each([
      ['missing parameters', ''],
      ['not numeric', '?lat=abc&lng=-0.88'],
      ['empty', '?lat=&lng='],
      ['out of range', '?lat=95&lng=-0.88'],
      ['outside Zaragoza', '?lat=40.4&lng=-3.7']
    ])('returns 400 for %s', async (_name, query) => {
      const response = await get(`/api/segments/nearest${query}`);

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBeDefined();
    });
  });

  describe('GET /api/segments/by-source/:sourceId', () => {
    it('returns the segment with that OSM source id', async () => {
      const response = await get('/api/segments/by-source/S4');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: ids.S4, sourceId: 'S4', osmWayId: WAY_ID.S4 });
      expect(response.body.distanceM).toBeUndefined();
    });

    it('returns 404 for an unknown source id and 400 for a blank one', async () => {
      expect((await get('/api/segments/by-source/nope:1')).status).toBe(404);
      expect((await get('/api/segments/by-source/%20')).status).toBe(400);
    });
  });

  describe('GET /api/segments/:id/wind-exposure', () => {
    // S1 runs west-east and S2 south-north; the grid north of EPSG:25830 is ~1° off true north.
    it('scores an aligned segment near 100 and a perpendicular one near 0', async () => {
      // Narrow streets (PBI-8.3): only the wind along them counts, as in PBI-8.1.
      await sequelize.query(
        `INSERT INTO segment_openness (segment_id, samples, width_m, height_m, hw_ratio, openness)
         VALUES (:s1, 5, 10, 20, 2, 0), (:s2, 5, 10, 20, 2, 0)`,
        { replacements: { s1: ids.S1, s2: ids.S2 } }
      );
      const wind = '?windSpeed=50&windDirection=90';
      const aligned = await get(`/api/segments/${ids.S1}/wind-exposure${wind}`);
      const perpendicular = await get(`/api/segments/${ids.S2}/wind-exposure${wind}`);

      expect(aligned.status).toBe(200);
      expect(aligned.body).toMatchObject({
        segmentId: ids.S1,
        segmentSourceId: 'S1',
        name: 'Calle S1',
        wind: { speedKmh: 50, directionDeg: 90, source: 'request', time: null },
        status: 'available',
        intensity: 1
      });
      expect(Math.abs(aligned.body.orientationDeg - 90)).toBeLessThan(2);
      expect(aligned.body.windExposure).toBeGreaterThan(99);
      expect(Math.abs(perpendicular.body.orientationDeg % 180)).toBeLessThan(2);
      expect(perpendicular.body.windExposure).toBeLessThan(3);
      expect(perpendicular.body).toMatchObject({
        openness: 0,
        street: { widthM: 10, heightM: 20, hwRatio: 2, samples: 5 }
      });
    });

    it('treats a segment without computed openness as open (PBI-8.3)', async () => {
      const response = await get(
        `/api/segments/${ids.S2}/wind-exposure?windSpeed=50&windDirection=90`
      );

      expect(response.body).toMatchObject({ openness: 1, street: null });
      expect(Math.abs(response.body.windExposure - 50)).toBeLessThan(3);
    });

    it('returns 404 for a segment that does not exist', async () => {
      const response = await get('/api/segments/999999/wind-exposure?windSpeed=30&windDirection=0');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/data/status', () => {
    it('returns the latest import per dataset and the latest association per type', async () => {
      await sequelize.query(
        `INSERT INTO import_runs
           (dataset, source_url, started_at, finished_at, status, source_count, imported_count,
            rejected_count)
         VALUES
           ('trees', 'https://secret.example/old', '2026-10-01', '2026-10-01', 'failed', 10, 0, 0),
           ('trees', 'https://secret.example/new', '2026-10-02', '2026-10-02', 'success', 10, 9, 1)`
      );

      const response = await get('/api/data/status');

      expect(response.status).toBe(200);
      expect(response.body.imports).toHaveLength(1);
      expect(response.body.imports[0]).toMatchObject({
        dataset: 'trees',
        status: 'success',
        sourceCount: 10,
        importedCount: 9,
        rejectedCount: 1
      });
      expect(JSON.stringify(response.body)).not.toContain('secret.example');
      expect(
        response.body.associations.map(({ type, status, total, nearestOk, stale }) => ({
          type,
          status,
          total,
          nearestOk,
          stale
        }))
      ).toEqual([
        { type: 'building', status: 'success', total: 3, nearestOk: 3, stale: false },
        { type: 'tree', status: 'success', total: 4, nearestOk: 4, stale: false }
      ]);
      expect(response.body.associations[0].pctAssociated).toBe(100);
    });

    it('reports stale associations', async () => {
      await sequelize.query(
        "UPDATE association_runs SET status = 'stale' WHERE element_type = 'tree'"
      );

      const response = await get('/api/data/status');

      const byType = Object.fromEntries(response.body.associations.map((run) => [run.type, run]));
      expect(byType.tree).toMatchObject({ status: 'stale', stale: true });
      expect(byType.building).toMatchObject({ status: 'success', stale: false });
    });
  });

  describe('authentication', () => {
    it.each([
      `/api/segments/1/urban-elements`,
      '/api/segments/1/wind-exposure',
      '/api/segments/nearest?lat=41.65&lng=-0.88',
      '/api/segments/by-source/S1',
      '/api/data/status'
    ])('returns 401 without a token for %s', async (path) => {
      const response = await request(createApp()).get(path);

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBeDefined();
    });
  });
});
