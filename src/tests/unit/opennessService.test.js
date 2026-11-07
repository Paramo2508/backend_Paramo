const { formatSummary, runComputeOpennessCli } = require('../../cli/computeOpenness');
const { runOpenness, validateOpennessConfig } = require('../../services/wind/opennessService');

jest.mock('../../utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));

const config = { sampleSpacingM: 20, maxDistanceM: 40, batchSize: 100, batchTimeoutMs: 1000 };

function fakeRepository({ minId = 1, maxId = 250, segments = 250, streetSegments = 250 } = {}) {
  return {
    runInTransaction: jest.fn((timeoutMs, callback) => callback('tx')),
    clear: jest.fn(),
    segmentIdRange: jest.fn().mockResolvedValue({ minId, maxId }),
    computeBatch: jest.fn(),
    countResults: jest.fn().mockResolvedValue({
      segments,
      streetSegments,
      meanOpenness: 0.62,
      distribution: [
        { bucket: 0, segments: 50, lengthM: 1000 },
        { bucket: 3, segments: 200, lengthM: 3000 }
      ]
    })
  };
}

describe('openness service', () => {
  it('recalculates every segment by id range inside one transaction', async () => {
    const repository = fakeRepository();

    const summary = await runOpenness({ config, repository });

    expect(repository.runInTransaction).toHaveBeenCalledWith(1000, expect.any(Function));
    expect(repository.clear).toHaveBeenCalledWith('tx');
    expect(repository.computeBatch.mock.calls.map(([range]) => range)).toEqual([
      { fromId: 1, toId: 100 },
      { fromId: 101, toId: 200 },
      { fromId: 201, toId: 300 }
    ]);
    expect(repository.computeBatch).toHaveBeenCalledWith(
      expect.any(Object),
      config,
      { openRatio: 0.3, canyonRatio: 0.65 },
      'tx'
    );
    expect(summary).toMatchObject({
      status: 'success',
      segments: 250,
      meanOpenness: 0.62,
      distribution: [
        { range: '0-0.25', segments: 50, lengthPercentage: 25 },
        { range: '0.75-1', segments: 200, lengthPercentage: 75 }
      ]
    });
  });

  it('does nothing but count without street segments', async () => {
    const repository = fakeRepository({ minId: null, maxId: null, segments: 0, streetSegments: 0 });

    await runOpenness({ config, repository });

    expect(repository.computeBatch).not.toHaveBeenCalled();
  });

  it('reports a mismatch if some segment got no openness', async () => {
    const summary = await runOpenness({
      config,
      repository: fakeRepository({ segments: 249 })
    });

    expect(summary.status).toBe('mismatch');
  });

  it.each([
    { sampleSpacingM: 0 },
    { maxDistanceM: -1 },
    { batchSize: 1.5 },
    { batchTimeoutMs: Number.NaN }
  ])('rejects the configuration %j', (change) => {
    expect(() => validateOpennessConfig({ ...config, ...change })).toThrow(TypeError);
  });
});

describe('compute:openness CLI', () => {
  const summary = {
    status: 'success',
    segments: 250,
    streetSegments: 250,
    meanOpenness: 0.62,
    distribution: [{ range: '0.75-1', segments: 200, lengthPercentage: 75 }],
    durationMs: 1500
  };

  it('prints the summary and exits with 0 when every segment has its openness', async () => {
    const write = jest.fn();

    await expect(runComputeOpennessCli({ run: async () => summary, write })).resolves.toBe(0);
    expect(write.mock.calls[0][0]).toContain('status=success segments=250');
    expect(formatSummary(summary)).toContain('mean_openness=0.62');
  });

  it('exits with 1 on a mismatch or an error', async () => {
    const write = jest.fn();

    await expect(
      runComputeOpennessCli({ run: async () => ({ ...summary, status: 'mismatch' }), write })
    ).resolves.toBe(1);
    await expect(
      runComputeOpennessCli({
        run: async () => {
          throw new Error('boom');
        },
        write
      })
    ).resolves.toBe(1);
  });
});
