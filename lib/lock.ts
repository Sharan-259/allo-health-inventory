import { redis } from "./redis";

const LOCK_TTL_MS = 5000; // 5 seconds max lock hold

/**
 * Acquire a Redis distributed lock for the given key.
 * Returns a release function if acquired, or null if not.
 *
 * When Redis is unavailable we fall back to a no-op (single-instance
 * concurrency is still handled by the Postgres advisory lock).
 */
export async function acquireLock(
  key: string,
  ttlMs = LOCK_TTL_MS
): Promise<(() => Promise<void>) | null> {
  if (!redis) {
    // No Redis — return a no-op lock. Concurrency safety falls back to
    // the Postgres row-level locking in the reservation transaction.
    return async () => {};
  }

  const lockKey = `lock:${key}`;
  const token = `${Date.now()}-${Math.random()}`;

  const result = await redis.set(lockKey, token, "PX", ttlMs, "NX");

  if (result !== "OK") {
    return null; // Lock not acquired
  }

  return async () => {
    // Only release if we still own the lock (prevent releasing someone else's lock)
    const current = await redis!.get(lockKey);
    if (current === token) {
      await redis!.del(lockKey);
    }
  };
}

/**
 * Retry acquiring a lock up to maxAttempts times with backoff.
 */
export async function acquireLockWithRetry(
  key: string,
  options: { maxAttempts?: number; delayMs?: number; ttlMs?: number } = {}
): Promise<(() => Promise<void>) | null> {
  const { maxAttempts = 5, delayMs = 100, ttlMs = LOCK_TTL_MS } = options;

  for (let i = 0; i < maxAttempts; i++) {
    const release = await acquireLock(key, ttlMs);
    if (release) return release;
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  return null;
}
