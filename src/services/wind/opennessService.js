const { opennessConfig } = require('../../config/opennessConfig');
const { CANYON_HW_RATIO, OPEN_HW_RATIO } = require('../../domain/wind/streetOpenness');
const defaultRepository = require('../../repositories/opennessRepository');
const { logger } = require('../../utils/logger');

// Openness ranges of the buckets returned by countResults.
const BUCKET_RANGES = ['0-0.25', '0.25-0.5', '0.5-0.75', '0.75-1'];

function validateOpennessConfig({ sampleSpacingM, maxDistanceM, batchSize, batchTimeoutMs }) {
  const positive = { sampleSpacingM, maxDistanceM, batchSize, batchTimeoutMs };
  Object.entries(positive).forEach(([name, value]) => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive number`);
    }
  });
  if (!Number.isInteger(batchSize) || !Number.isInteger(batchTimeoutMs)) {
    throw new TypeError('batchSize and batchTimeoutMs must be integers');
  }
}

/*
 * "npm run compute:openness": recalculates the openness of every street segment inside one
 * transaction, by id range, with a statement_timeout per batch (ADR-028). Like the vegetation
 * index, it has to be run again after importing streets or buildings.
 */
async function runOpenness({ config = opennessConfig, repository = defaultRepository } = {}) {
  validateOpennessConfig(config);
  const thresholds = { openRatio: OPEN_HW_RATIO, canyonRatio: CANYON_HW_RATIO };
  const startedAt = Date.now();

  const { distribution, ...counts } = await repository.runInTransaction(
    config.batchTimeoutMs,
    async (transaction) => {
      await repository.clear(transaction);
      const { minId, maxId } = await repository.segmentIdRange(transaction);
      if (minId !== null && minId !== undefined) {
        for (let fromId = minId; fromId <= maxId; fromId += config.batchSize) {
          const range = { fromId, toId: fromId + config.batchSize - 1 };
          // Batches run one after another inside the same transaction.
          // eslint-disable-next-line no-await-in-loop
          await repository.computeBatch(range, config, thresholds, transaction);
          logger.info(`[openness] segments ${range.fromId}-${Math.min(range.toId, maxId)}`);
        }
      }
      return repository.countResults(transaction);
    }
  );

  const totalLengthM = distribution.reduce((sum, bucket) => sum + bucket.lengthM, 0);
  return {
    status: counts.segments === counts.streetSegments ? 'success' : 'mismatch',
    ...counts,
    distribution: distribution.map(({ bucket, segments, lengthM }) => ({
      range: BUCKET_RANGES[bucket],
      segments,
      lengthPercentage: totalLengthM > 0 ? (100 * lengthM) / totalLengthM : 0
    })),
    durationMs: Date.now() - startedAt
  };
}

module.exports = { runOpenness, validateOpennessConfig };
