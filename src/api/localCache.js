/**
 * localCache.js — localStorage-backed cache with TTL.
 * Used to persist team list, rosters and player data for offline field use (BK-90).
 */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_PREFIX = 'cache:';

/** Evict all expired cache entries to free space. */
function evictExpired() {
  const now = Date.now();
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(CACHE_PREFIX)) continue;
    try {
      const { expires } = JSON.parse(localStorage.getItem(k));
      if (now > expires) toRemove.push(k);
    } catch { toRemove.push(k); }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  return toRemove.length;
}

/** Evict the N soonest-expiring non-expired entries to free more space. */
function evictOldest(n = 10) {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(CACHE_PREFIX)) continue;
    try {
      const { expires } = JSON.parse(localStorage.getItem(k));
      entries.push({ k, expires });
    } catch {}
  }
  entries.sort((a, b) => a.expires - b.expires);
  entries.slice(0, n).forEach(e => localStorage.removeItem(e.k));
}

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
  const value = JSON.stringify({ data, expires: Date.now() + ttlMs });
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota exceeded — evict expired entries and retry
    try {
      evictExpired();
      localStorage.setItem(key, value);
    } catch {
      // Still full — evict oldest entries and retry once more
      try {
        evictOldest(20);
        localStorage.setItem(key, value);
      } catch {
        // Truly full — silently skip this entry
      }
    }
  }
}
