const { createRateLimiter } = require('../../services/assistant/assistantRateLimiter');

const LIMITS = { userPerMinute: 3, userPerDay: 5, globalPerMinute: 4, globalPerDay: 8 };

function limiterAt(isoInstant) {
  let ms = Date.parse(isoInstant);
  const limiter = createRateLimiter(LIMITS, { now: () => ms });
  return {
    limiter,
    advance: (seconds) => {
      ms += seconds * 1000;
    }
  };
}

describe('createRateLimiter', () => {
  it('lets a user make up to the limit per minute and says how long to wait', () => {
    const { limiter, advance } = limiterAt('2026-11-15T10:00:00Z');
    expect(limiter.consume(1)).toBeNull();
    advance(10);
    expect(limiter.consume(1)).toBeNull();
    expect(limiter.consume(1)).toBeNull();

    expect(limiter.consume(1)).toEqual({ scope: 'user', window: 'minute', retryAfterSeconds: 50 });

    advance(50);
    expect(limiter.consume(1)).toBeNull();
  });

  it('limits each user per day, until midnight in Zaragoza', () => {
    // 22:00 UTC is 23:00 in Zaragoza in November: one hour left of the day.
    const { limiter, advance } = limiterAt('2026-11-15T22:00:00Z');
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.consume(1)).toBeNull();
      advance(61);
    }

    expect(limiter.consume(1)).toMatchObject({ scope: 'user', window: 'day' });
    expect(limiter.consume(1).retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect(limiter.consume(2)).toBeNull();

    advance(3600);
    expect(limiter.consume(1)).toBeNull();
  });

  it('limits all users together', () => {
    const { limiter } = limiterAt('2026-11-15T10:00:00Z');
    [1, 2, 3, 4].forEach((user) => expect(limiter.consume(user)).toBeNull());

    expect(limiter.consume(5)).toMatchObject({ scope: 'global', window: 'minute' });
  });

  it('limits all users together per day', () => {
    const { limiter, advance } = limiterAt('2026-11-15T10:00:00Z');
    for (let i = 0; i < 8; i += 1) {
      expect(limiter.consume(i % 4)).toBeNull();
      advance(61);
    }

    expect(limiter.consume(9)).toMatchObject({ scope: 'global', window: 'day' });
  });

  it('a request that is refused does not count', () => {
    const { limiter } = limiterAt('2026-11-15T10:00:00Z');
    [1, 1, 1].forEach((user) => limiter.consume(user));
    limiter.consume(1);
    limiter.consume(1);

    // Only the three accepted ones count for the global minute (4).
    expect(limiter.consume(2)).toBeNull();
    expect(limiter.consume(3)).toMatchObject({ scope: 'global' });
  });

  it('reset empties every counter', () => {
    const { limiter } = limiterAt('2026-11-15T10:00:00Z');
    [1, 1, 1].forEach((user) => limiter.consume(user));
    limiter.reset();
    expect(limiter.consume(1)).toBeNull();
  });
});
