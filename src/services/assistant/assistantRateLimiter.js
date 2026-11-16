const { DateTime } = require('luxon');

const { ZARAGOZA_TIME_ZONE } = require('../../domain/solar/solarPosition');

const MINUTE_MS = 60 * 1000;

/*
 * Requests to the language model per user and in total, per minute (sliding window) and per day
 * (calendar day in Zaragoza), so the free plan of the provider is never reached (ADR-033).
 *
 * The counters live in memory: production runs one backend container, and no table or migration
 * is needed. They restart with the backend, which at most allows one more day of requests; with
 * several instances they would have to move to the database.
 */
function createRateLimiter(limits, { now = () => Date.now() } = {}) {
  const minuteHits = new Map();
  const dayCounts = new Map();
  let day = null;

  const dayOf = (ms) => DateTime.fromMillis(ms, { zone: ZARAGOZA_TIME_ZONE }).toISODate();
  const nextDayMs = (ms) =>
    DateTime.fromMillis(ms, { zone: ZARAGOZA_TIME_ZONE })
      .plus({ days: 1 })
      .startOf('day')
      .toMillis();

  function recentHits(key, ms) {
    const hits = (minuteHits.get(key) || []).filter((time) => time > ms - MINUTE_MS);
    minuteHits.set(key, hits);
    return hits;
  }

  function blocked(key, perMinute, perDay, ms, scope) {
    const hits = recentHits(key, ms);
    if (hits.length >= perMinute) {
      return {
        scope,
        window: 'minute',
        retryAfterSeconds: Math.ceil((hits[0] + MINUTE_MS - ms) / 1000)
      };
    }
    if ((dayCounts.get(key) || 0) >= perDay) {
      return { scope, window: 'day', retryAfterSeconds: Math.ceil((nextDayMs(ms) - ms) / 1000) };
    }
    return null;
  }

  /**
   * Counts one request of the user if no limit is reached. Returns null when allowed, or the limit
   * that stops it ({ scope: 'user' | 'global', window: 'minute' | 'day', retryAfterSeconds }).
   */
  function consume(userId) {
    const ms = now();
    const today = dayOf(ms);
    if (today !== day) {
      day = today;
      dayCounts.clear();
    }
    const userKey = `user:${userId}`;
    const limit =
      blocked(userKey, limits.userPerMinute, limits.userPerDay, ms, 'user') ||
      blocked('global', limits.globalPerMinute, limits.globalPerDay, ms, 'global');
    if (limit) return limit;

    [userKey, 'global'].forEach((key) => {
      recentHits(key, ms).push(ms);
      dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
    });
    return null;
  }

  function reset() {
    minuteHits.clear();
    dayCounts.clear();
    day = null;
  }

  return { consume, reset };
}

module.exports = { createRateLimiter };
