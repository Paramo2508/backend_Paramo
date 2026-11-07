const { sequelize } = require('../config/database');
const { runOpenness } = require('../services/wind/opennessService');
const { logger } = require('../utils/logger');

const round = (value, decimals = 1) =>
  value === null || value === undefined ? '-' : Number(value).toFixed(decimals);

function formatSummary(summary) {
  const lines = [
    `status=${summary.status} segments=${summary.segments}` +
      ` street_segments=${summary.streetSegments}` +
      ` mean_openness=${round(summary.meanOpenness, 2)}` +
      ` seconds=${round(summary.durationMs / 1000)}`,
    'openness    segments  length_%',
    ...summary.distribution.map(
      ({ range, segments, lengthPercentage }) =>
        `${range.padEnd(10)} ${String(segments).padStart(9)} ${round(lengthPercentage).padStart(9)}`
    )
  ];
  return lines.join('\n');
}

// Returns the exit code: 0 only if every street segment got its openness.
async function runComputeOpennessCli({
  run = runOpenness,
  write = (text) => process.stdout.write(text)
} = {}) {
  try {
    const summary = await run();
    write(`${formatSummary(summary)}\n`);
    if (summary.status !== 'success') {
      logger.error(
        `[openness] ${summary.status.toUpperCase()} segments=${summary.segments}` +
          ` street_segments=${summary.streetSegments}`
      );
      return 1;
    }
    return 0;
  } catch (error) {
    logger.error(`Street openness failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  runComputeOpennessCli().then(async (exitCode) => {
    await sequelize.close();
    process.exitCode = exitCode;
  });
}

module.exports = { formatSummary, runComputeOpennessCli };
