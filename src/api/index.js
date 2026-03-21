/**
 * Mound Track API client
 *
 * All external data (MLB Stats, FanGraphs, Baseball Savant) is fetched through
 * the local backend proxy on port 3001. This keeps API keys server-side and
 * avoids CORS issues with FanGraphs / Savant.
 *
 * Vite dev server proxies /api → http://localhost:3001 (see vite.config.js).
 */

import { cacheGet, cacheSet } from './localCache.js';

// In production, point directly at the Railway backend.
// In development, Vite proxies /api → localhost:3001.
const BASE = import.meta.env.DEV
  ? '/api'
  : 'https://boothcast-backend-production.up.railway.app/api';

/** Generic JSON fetch with error handling */
async function get(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body:   JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function del(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function patch(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers,
    body:   JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── API methods ────────────────────────────────────────────────────────────

export const api = {
  /** All 30 MLB teams */
  getTeams: () => get('/teams'),

  /** WBC 2023 national teams */
  getWbcTeams: () => get('/wbc-teams'),

  /** Active 26-man roster for a team */
  getRoster: (teamId, season) => get(`/teams/${teamId}/roster${season ? `?season=${season}` : ''}`),

  /** Player autocomplete search */
  searchPlayers: (q) => get(`/players/search?q=${encodeURIComponent(q)}`),

  /** Basic bio info for one player */
  getPlayer: (playerId) => get(`/players/${playerId}`),

  /** Full batter season stats (MLB + FanGraphs + Statcast) */
  getBatterStats: (playerId, season) =>
    get(`/stats/batter/${playerId}${season ? `?season=${season}` : ''}`),

  /** Full pitcher season stats (MLB + FanGraphs + Statcast) */
  getPitcherStats: (playerId, season) =>
    get(`/stats/pitcher/${playerId}${season ? `?season=${season}` : ''}`),

  /**
   * Batter vs. pitcher matchup (last 3 seasons from Baseball Savant).
   * Returns PA-level aggregates: AVG, OBP, SLG, wOBA, HR, BB, SO, EV.
   */
  getMatchup: (batterId, pitcherId) =>
    get(`/matchup?batterId=${batterId}&pitcherId=${pitcherId}`),

  /**
   * Fetch BvP data for a whole lineup against one pitcher in a single request.
   * batters = [{id, name}, ...]
   */
  getBulkMatchups: (batters, pitcherId) =>
    post('/matchups/bulk', { batters, pitcherId }),

  /** Bullpen availability panel for a team (includes recent usage + fatigue) */
  getBullpen: (teamId, season) => get(`/bullpen/${teamId}${season ? `?season=${season}` : ''}`),

  /** Rolling 7-day pitch workload + fatigue band for a pitcher (for Scorebook) */
  getPitcherFatigue: (pitcherId) => get(`/pitcher-fatigue/${pitcherId}`),

  /** MLB Stats API situational splits for a batter */
  getSituational: (playerId, season) =>
    get(`/situational/${playerId}${season ? `?season=${season}` : ''}`),

  /** Hot/cold streaks: last 7, 15, 30 games + recent 5-game dot results */
  getBatterStreaks: (playerId, season) =>
    get(`/stats/batter/${playerId}/streaks${season ? `?season=${season}` : ''}`),

  /** Pitch arsenal: usage %, velocity, whiff rate per pitch type (Baseball Savant) */
  getPitcherArsenal: (playerId, season) =>
    get(`/stats/pitcher/${playerId}/arsenal${season ? `?season=${season}` : ''}`),

  /** BK-91: Pitch type frequency split by batter handedness (L/R) */
  getPitcherArsenalSplits: (playerId, season) =>
    get(`/stats/pitcher/${playerId}/arsenal-splits${season ? `?season=${season}` : ''}`),

  /**
   * Career milestone check for a player.
   * Returns milestones they are approaching (fewest remaining first).
   */
  getMilestones: (playerId) => get(`/milestones/${playerId}`),

  /**
   * Spray chart data: batted-ball hit coordinates (hc_x, hc_y) + outcome
   * for the current season. Returns [{x, y, o}] where o = hr|triple|double|single|out.
   * Source: Baseball Savant Statcast search.
   */
  getSprayChart: (playerId, season) =>
    get(`/stats/batter/${playerId}/spray${season ? `?season=${season}` : ''}`),

  /**
   * Hot/cold zone map: 3×3 strike-zone BA grid for a batter.
   * Returns [{row, col, ab, hits, ba}] — row 0 = high, col 0 = inside.
   * Source: same Statcast CSV as spray chart (shared cache).
   */
  getZones: (playerId, season) =>
    get(`/stats/batter/${playerId}/zones${season ? `?season=${season}` : ''}`),

  /**
   * Claude AI broadcast insights for a batter-pitcher matchup.
   * Requires ANTHROPIC_API_KEY set in backend/.env.
   * Returns { insights: [{n, category, text}] }
   */
  getInsights: (data) => post('/insights', data),

  /** Health check */
  health: () => get('/health'),

  // ── BK-35: Auth ──────────────────────────────────────────────────────────

  /** List current user's saved games (summary only) */
  getGames: (token) => get('/games', token),

  /** Fetch full game data for one saved game */
  getGame: (id, token) => get(`/games/${id}`, token),

  /** Save a game for the current user */
  saveGame: (gameData, gameState, isComplete, token) =>
    post('/games', { gameData, gameState, isComplete }, token),

  /** Delete a saved game */
  deleteGame: (id, token) => del(`/games/${id}`, token),

  /** Admin: list all users */
  adminGetUsers: (token) => get('/admin/users', token),

  /** Admin: list saved games for a specific user */
  adminGetUserGames: (userId, token) => get(`/admin/users/${userId}/games`, token),

  /** Admin: delete a user */
  adminDeleteUser: (id, token) => del(`/admin/users/${id}`, token),

  /** Admin: approve or reject a user ('approved' | 'rejected' | 'pending') */
  adminUpdateUserStatus: (id, status, token) => patch(`/admin/users/${id}/status`, { status }, token),

  /** BK-85: send password reset email */
  forgotPassword: (email) => post('/auth/forgot-password', { email }),

  /** BK-85: reset password using token from email link */
  resetPassword: (token, password) => post('/auth/reset-password', { token, password }),
};

// ── BK-90: Offline-capable wrappers with localStorage fallback ───────────────

/** Fetch teams list; caches for 7 days; falls back to cache when offline. */
export async function getTeamsCached() {
  try {
    const data = await get('/teams');
    cacheSet('cache:teams', data);
    return { data, fromCache: false };
  } catch {
    const data = await cacheGet('cache:teams');
    if (data) return { data, fromCache: true };
    throw new Error('No internet connection and no cached team list available.');
  }
}

/** Fetch a roster; caches for 24 hrs; falls back to cache when offline. */
export async function getRosterCached(teamId) {
  try {
    const data = await get(`/teams/${teamId}/roster`);
    cacheSet(`cache:roster:${teamId}`, data, 24 * 60 * 60 * 1000);
    return { data, fromCache: false };
  } catch {
    const data = await cacheGet(`cache:roster:${teamId}`);
    if (data) return { data, fromCache: true };
    throw new Error('No internet connection and no cached roster for this team.');
  }
}

const PITCHER_TTL = 24 * 60 * 60 * 1000; // 24 hours

/** Fetch pitcher season stats; caches 24hr; falls back to cache offline. */
export async function getPitcherStatsCached(pitcherId) {
  const key = `cache:pitcher-stats:${pitcherId}`;
  try {
    const data = await get(`/stats/pitcher/${pitcherId}`);
    cacheSet(key, data, PITCHER_TTL);
    return data;
  } catch {
    const cached = await cacheGet(key);
    if (cached) return cached;
    throw new Error('Offline and no cached pitcher stats.');
  }
}

/** Fetch pitcher arsenal; caches 24hr; falls back to cache offline. */
export async function getPitcherArsenalCached(pitcherId) {
  const key = `cache:pitcher-arsenal:${pitcherId}`;
  try {
    const data = await get(`/stats/pitcher/${pitcherId}/arsenal`);
    cacheSet(key, data, PITCHER_TTL);
    return data;
  } catch {
    const cached = await cacheGet(key);
    if (cached) return cached;
    throw new Error('Offline and no cached arsenal.');
  }
}

/** Fetch pitcher arsenal splits; caches 24hr; falls back to cache offline. */
export async function getPitcherArsenalSplitsCached(pitcherId) {
  const key = `cache:pitcher-splits:${pitcherId}`;
  try {
    const data = await get(`/stats/pitcher/${pitcherId}/arsenal-splits`);
    cacheSet(key, data, PITCHER_TTL);
    return data;
  } catch {
    const cached = await cacheGet(key);
    if (cached) return cached;
    throw new Error('Offline and no cached splits.');
  }
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours for everything

/** Fetch bullpen panel data for a team; caches 24hr; falls back to cache offline. */
export async function getBullpenCached(teamId, season) {
  const key = `cache:bullpen:${teamId}:${season ?? 'cur'}`;
  const url = `/bullpen/${teamId}${season ? `?season=${season}` : ''}`;
  try {
    const data = await get(url);
    cacheSet(key, data, CACHE_TTL);
    return data;
  } catch {
    const cached = await cacheGet(key);
    if (cached) return cached;
    throw new Error('Offline and no cached bullpen data.');
  }
}

const BATTER_TTL = CACHE_TTL;

function makeCached(key, fetcher, ttl = CACHE_TTL) {
  return async (...args) => {
    const k = typeof key === 'function' ? key(...args) : key;
    try {
      const data = await fetcher(...args);
      cacheSet(k, data, ttl);
      return data;
    } catch {
      const cached = await cacheGet(k);
      if (cached) return cached;
      throw new Error('Offline and no cached data.');
    }
  };
}

export const getBatterStatsCached     = makeCached(id => `cache:batter-stats:${id}`,   id => get(`/stats/batter/${id}`));
export const getBatterStreaksCached   = makeCached(id => `cache:batter-streaks:${id}`, id => get(`/stats/batter/${id}/streaks`));
export const getSprayChartCached      = makeCached(id => `cache:spray:${id}`,          id => get(`/stats/batter/${id}/spray`));
export const getZonesCached           = makeCached(id => `cache:zones:${id}`,          id => get(`/stats/batter/${id}/zones`));
export const getMilestonesCached      = makeCached(id => `cache:milestones:${id}`,     id => get(`/milestones/${id}`));
export const getSituationalCached     = makeCached(id => `cache:situational:${id}`,    id => get(`/situational/${id}`));
export const getPitcherFatigueCached  = makeCached(id => `cache:fatigue:${id}`,        id => get(`/pitcher-fatigue/${id}`));

/** BvP bulk matchups; key is pitcherId + sorted batter IDs; caches 24hr. */
export async function getBulkMatchupsCached(batters, pitcherId) {
  const ids = batters.map(b => b.id).sort().join(',');
  const key = `cache:bvp:${pitcherId}:${ids}`;
  try {
    const data = await post('/matchups/bulk', { batters, pitcherId });
    cacheSet(key, data, BATTER_TTL);
    return data;
  } catch {
    const cached = await cacheGet(key);
    if (cached) return cached;
    throw new Error('Offline and no cached BvP data.');
  }
}
