const { numberFromEnv } = require('./importConfig');

// Openness of the street segments; every value is explained in ADR-028 (workspace
// docs/DECISIONS.md).
const opennessConfig = {
  // One sample every this many metres along a segment (at least one, in its middle).
  sampleSpacingM: numberFromEnv('OPENNESS_SAMPLE_SPACING_M', 20),
  // How far the facades are searched on each side of a sample; a side without buildings within
  // it counts as open at this distance.
  maxDistanceM: numberFromEnv('OPENNESS_MAX_DISTANCE_M', 40),
  // Segments per INSERT ... SELECT, by id range, inside the transaction of the run.
  batchSize: numberFromEnv('OPENNESS_BATCH_SIZE', 2000),
  // PostgreSQL statement_timeout of each batch, so one batch cannot keep the database busy.
  batchTimeoutMs: numberFromEnv('OPENNESS_BATCH_TIMEOUT_MS', 120000)
};

module.exports = { opennessConfig };
