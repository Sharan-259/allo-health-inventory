import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("REDIS_URL not set — distributed locking disabled (not safe for multi-instance deployments)");
    return null;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  client.on("error", (err) => {
    if (process.env.NODE_ENV !== "test") console.error("Redis error:", err);
  });
  return client;
}

export const redis: Redis | null =
  globalForRedis.redis !== undefined
    ? globalForRedis.redis
    : (() => {
        const client = createRedisClient();
        if (process.env.NODE_ENV !== "production") {
          (globalForRedis as unknown as { redis: Redis | null }).redis = client;
        }
        return client;
      })();
