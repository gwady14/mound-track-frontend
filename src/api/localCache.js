/**
 * localCache.js — IndexedDB-backed cache with TTL (via localforage).
 * Falls back to localStorage if IndexedDB is unavailable.
 * Used to persist player/team data for offline field use (BK-90).
 */

import localforage from 'localforage';

localforage.config({ name: 'boothcast', storeName: 'cache' });

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function cacheGet(key) {
  try {
    const entry = await localforage.getItem(key);
    if (!entry) return null;
    const { data, expires } = entry;
    if (Date.now() > expires) {
      localforage.removeItem(key).catch(() => {});
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Fire-and-forget — callers do not need to await this. */
export function cacheSet(key, data, ttlMs = DEFAULT_TTL_MS) {
  localforage.setItem(key, { data, expires: Date.now() + ttlMs }).catch(() => {});
}
