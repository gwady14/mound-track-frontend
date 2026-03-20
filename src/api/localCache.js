/**
 * localCache.js — localStorage-backed cache with TTL.
 * Used to persist team list and rosters for offline field use (BK-90).
 */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

export function cacheSet(key, data, ttlMs = DEFAULT_TTL_MS) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + ttlMs }));
  } catch {} // quota exceeded — silently ignore
}
