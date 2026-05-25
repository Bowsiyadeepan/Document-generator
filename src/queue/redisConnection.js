import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const USE_MOCK = process.env.REDIS_MOCK === 'true' || process.env.NODE_ENV === 'test';

let RedisMock = null;

// Try to load ioredis-mock if available (dev/test only)
if (USE_MOCK || process.env.NODE_ENV !== 'production') {
  try {
    const mockModule = await import('ioredis-mock').catch(() => null);
    if (mockModule) {
      RedisMock = mockModule.default;
      console.log('[redis] ioredis-mock loaded (available for dev use)');
    }
  } catch {
    // ioredis-mock not installed -- that is fine
  }
}

/**
 * Creates a Redis connection for BullMQ.
 * Uses ioredis-mock when REDIS_MOCK=true or when real Redis is unavailable in dev.
 *
 * @returns {Redis} Redis connection instance
 */
export function createRedisConnection() {
  if (USE_MOCK && RedisMock) {
    console.log('[redis] Using ioredis-mock (in-memory, dev only -- data is NOT persisted)');
    return new RedisMock({ maxRetriesPerRequest: null });
  }

  const connection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 3) {
        console.error('[redis] Could not connect after 3 retries.');
        console.error('[redis] Options:');
        console.error('[redis]   1. Start Redis: docker run -d -p 6379:6379 redis:alpine');
        console.error('[redis]   2. Use mock:    REDIS_MOCK=true npm start');
        return null;
      }
      return Math.min(times * 500, 2000);
    },
  });

  connection.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      console.error(`[redis] Connection refused -- Redis is not running on ${REDIS_URL}`);
    } else {
      console.error('[redis] Connection error:', err.message);
    }
  });

  connection.on('connect', () => {
    console.log('[redis] Connected to', REDIS_URL);
  });

  connection.on('reconnecting', () => {
    console.log('[redis] Reconnecting...');
  });

  return connection;
}
