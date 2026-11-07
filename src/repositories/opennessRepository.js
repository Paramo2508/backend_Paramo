const { QueryTypes } = require('sequelize');

const { sequelize } = require('../config/database');
const { withStatementTimeout } = require('./statementTimeout');

function select(sql, replacements, transaction) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
}

// Starts the recalculation: the previous openness is discarded.
async function clear(transaction) {
  await sequelize.query('DELETE FROM segment_openness', { transaction });
}

async function segmentIdRange(transaction) {
  const [row] = await select(
    'SELECT min(id) AS "minId", max(id) AS "maxId" FROM street_segments',
    {},
    transaction
  );
  return { minId: row.minId, maxId: row.maxId };
}

/*
 * Openness of the segments with fromId <= id <= toId, in EPSG:25830 (ADR-028). Each segment gets
 * one sample every sampleSpacingM; from each sample a line goes maxDistanceM to each side,
 * perpendicular to the segment there, and the first building it crosses gives the distance to the
 * facade and its height. A side without buildings counts as open at maxDistanceM with height 0.
 * The H/W ratio of each sample becomes an openness with the thresholds of Oke (1988), and the
 * segment keeps the mean of its samples.
 */
async function computeBatch(range, config, thresholds, transaction) {
  await sequelize.query(
    `WITH sides AS (
       SELECT s.id AS segment_id, i,
         COALESCE(hit.distance_m, :maxDistanceM) AS distance_m,
         CASE WHEN hit.distance_m IS NULL THEN 0 ELSE hit.height_m END AS height_m
       FROM street_segments s
       CROSS JOIN LATERAL (SELECT ST_Transform(s.geom, 25830) AS geom_m) g
       CROSS JOIN LATERAL (
         SELECT GREATEST(1, ceil(ST_Length(g.geom_m) / :sampleSpacingM))::int AS n
       ) c
       CROSS JOIN LATERAL generate_series(1, c.n) AS i
       CROSS JOIN LATERAL (SELECT (i - 0.5) / c.n AS f, 0.5 / c.n AS delta) fr
       CROSS JOIN LATERAL (
         SELECT ST_LineInterpolatePoint(g.geom_m, fr.f) AS p,
           ST_Azimuth(
             ST_LineInterpolatePoint(g.geom_m, GREATEST(0, fr.f - fr.delta)),
             ST_LineInterpolatePoint(g.geom_m, LEAST(1, fr.f + fr.delta))
           ) AS azimuth
       ) sample
       CROSS JOIN LATERAL (
         SELECT ST_MakeLine(sample.p, ST_Translate(sample.p,
           :maxDistanceM * sin(sample.azimuth + side * pi() / 2),
           :maxDistanceM * cos(sample.azimuth + side * pi() / 2))) AS ray
         FROM (VALUES (-1), (1)) AS directions(side)
       ) r
       LEFT JOIN LATERAL (
         SELECT ST_Distance(sample.p, ST_Intersection(r.ray, ST_Transform(b.geom, 25830)))
             AS distance_m,
           b.height_m
         FROM buildings b
         WHERE ST_Intersects(b.geom, ST_Transform(r.ray, 4326))
         ORDER BY 1 NULLS LAST
         LIMIT 1
       ) hit ON true
       WHERE s.id BETWEEN :fromId AND :toId
     ), samples AS (
       SELECT segment_id, sum(distance_m) AS width_m, avg(height_m) AS height_m
       FROM sides
       GROUP BY segment_id, i
     ), ratios AS (
       SELECT segment_id, width_m, height_m, height_m / GREATEST(width_m, 1) AS hw_ratio
       FROM samples
     )
     INSERT INTO segment_openness (segment_id, samples, width_m, height_m, hw_ratio, openness)
     SELECT segment_id, count(*), avg(width_m), avg(height_m), avg(hw_ratio),
       avg(LEAST(1, GREATEST(0, (:canyonRatio - hw_ratio) / (:canyonRatio - :openRatio))))
     FROM ratios
     GROUP BY segment_id`,
    {
      replacements: {
        fromId: range.fromId,
        toId: range.toId,
        sampleSpacingM: config.sampleSpacingM,
        maxDistanceM: config.maxDistanceM,
        openRatio: thresholds.openRatio,
        canyonRatio: thresholds.canyonRatio
      },
      transaction
    }
  );
}

// Counts used to check the run and the length-weighted distribution of the openness.
async function countResults(transaction) {
  const [row] = await select(
    `SELECT
       (SELECT count(*) FROM segment_openness)::int AS segments,
       (SELECT count(*) FROM street_segments)::int AS "streetSegments",
       (SELECT sum(s.length_m * o.openness) / NULLIF(sum(s.length_m), 0)
        FROM segment_openness o JOIN street_segments s ON s.id = o.segment_id)::float8
         AS "meanOpenness"`,
    {},
    transaction
  );
  // Bucket 0: canyon (< 0.25); 1: 0.25-0.5; 2: 0.5-0.75; 3: open (>= 0.75).
  const distribution = await select(
    `SELECT LEAST(3, floor(o.openness * 4)::int) AS bucket, count(*)::int AS segments,
       sum(s.length_m)::float8 AS "lengthM"
     FROM segment_openness o JOIN street_segments s ON s.id = o.segment_id
     GROUP BY 1 ORDER BY 1`,
    {},
    transaction
  );
  return { ...row, distribution };
}

function runInTransaction(timeoutMs, callback) {
  return withStatementTimeout(timeoutMs, callback);
}

async function getSegmentOpenness(segmentId) {
  const [row] = await select(
    `SELECT openness, samples, width_m AS "widthM", height_m AS "heightM", hw_ratio AS "hwRatio"
     FROM segment_openness WHERE segment_id = :segmentId`,
    { segmentId }
  );
  return row ?? null;
}

/*
 * Openness of the street segment nearest to each point ([lng, lat]) within maxDistanceM, in the
 * same order; null where there is no segment or its openness has not been computed.
 */
async function findOpennessNearPoints(points, maxDistanceM) {
  if (!points.length) return [];
  const rows = await select(
    `SELECT p.ord, o.openness
     FROM jsonb_array_elements(CAST(:points AS jsonb)) WITH ORDINALITY AS p(item, ord)
     CROSS JOIN LATERAL (
       SELECT ST_SetSRID(ST_MakePoint((p.item ->> 0)::float8, (p.item ->> 1)::float8), 4326)
         AS geom
     ) pt
     LEFT JOIN LATERAL (
       SELECT s.id FROM street_segments s
       WHERE ST_DWithin(s.geom::geography, pt.geom::geography, :maxDistanceM)
       ORDER BY s.geom <-> pt.geom
       LIMIT 1
     ) near ON true
     LEFT JOIN segment_openness o ON o.segment_id = near.id
     ORDER BY p.ord`,
    { points: JSON.stringify(points), maxDistanceM }
  );
  return rows.map(({ openness }) => (openness === null ? null : Number(openness)));
}

module.exports = {
  clear,
  computeBatch,
  countResults,
  findOpennessNearPoints,
  getSegmentOpenness,
  runInTransaction,
  segmentIdRange
};
