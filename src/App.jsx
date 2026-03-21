/**
 * App.jsx — Root component
 *
 * Manages top-level state:
 *   - Team / lineup / pitcher selection
 *   - Loaded matchup data (BvP + season stats)
 *   - Live game state (for Scorebook + Situational tabs)
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import LineupInput     from './components/LineupInput.jsx';
import MatchupsPanel   from './components/MatchupsPanel.jsx';
import BullpenPanel    from './components/BullpenPanel.jsx';
import Scorebook       from './components/Scorebook.jsx';
import SituationalStats from './components/SituationalStats.jsx';
import BoxScore        from './components/BoxScore.jsx';
import BoxScorePrint   from './components/BoxScorePrint.jsx';
import GameSummary      from './components/GameSummary.jsx';
import AuthPage        from './components/AuthPage.jsx';
import GameHistory     from './components/GameHistory.jsx';
import AdminPanel      from './components/AdminPanel.jsx';
import { useAuth }     from './context/AuthContext.jsx';
import {
  api,
  getTeamsCached, getRosterCached,
  getPitcherStatsCached, getPitcherArsenalCached, getPitcherArsenalSplitsCached,
  getBullpenCached,
  getBatterStatsCached, getBatterStreaksCached, getSprayChartCached, getZonesCached,
  getMilestonesCached, getSituationalCached, getPitcherFatigueCached, getBulkMatchupsCached,
} from './api/index.js';
import './App.css';

// ── localStorage persistence ────────────────────────────────────────────────
const STORAGE_KEY = 'gametrack_game_v1';

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Initial game state ──────────────────────────────────────────────────────
const EMPTY_GAME = {
  inning:          1,
  isTop:           true,      // true = top half (away team bats)
  outs:            0,
  balls:           0,
  strikes:         0,
  bases:           [null, null, null],     // [1B, 2B, 3B] — null | {id,name,jerseyNumber}
  score:           { home: 0, away: 0 },
  // 9 innings, each slot stores { home: null|number, away: null|number }
  inningScores:    Array.from({ length: 9 }, () => ({ home: null, away: null })),
  awayBatterIdx:   0,  // current position in the batting order (0-based)
  homeBatterIdx:   0,
  paLog:           [], // all plate appearances this game: [{batterId, outcome, isAB, isHit, isHR, isK, isBB, rbi, inning}]
  homePitchCount:      0,   // pitches thrown by the home pitcher this game
  awayPitchCount:      0,   // pitches thrown by the away pitcher this game
  homePitcherStartPA:  0,   // paLog index when current home pitcher entered
  awayPitcherStartPA:  0,   // paLog index when current away pitcher entered
  currentPAPitches:    [],  // BK-24: pitch-by-pitch log for the active PA [{type, result}]
  runnerEvents:        [],  // non-PA baserunner events: [{type,runnerId,runnerName,fromBase,toBase,inning,side}]
  gameEventSeq:        0,   // monotonically increasing counter stamped on every PA and runner event
};

export default function App() {
  // ── Auth ───────────────────────────────────────────────────────────────
  const { user, token, loading: authLoading, signOut } = useAuth();
  const [showUserMenu,   setShowUserMenu]   = useState(false);
  const [showHistory,    setShowHistory]    = useState(false);
  const [showAdmin,      setShowAdmin]      = useState(false);
  const [savingGame,     setSavingGame]     = useState(false);
  const [saveMsg,        setSaveMsg]        = useState(''); // success/error flash
  const userMenuRef = useRef(null);

  // Close user menu on outside click
  useEffect(() => {
    function handler(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Restore from localStorage on first load
  const [saved]           = useState(loadSavedGame);
  const [tab,             setTab]             = useState(saved?.tab       ?? 'matchups');
  const [gameData,        setGameData]        = useState(saved?.gameData  ?? null);
  const [loadingGame,     setLoadingGame]     = useState(false);
  const [loadError,       setLoadError]       = useState(null);
  const [gameState,       setGameState]       = useState(saved?.gameState ?? EMPTY_GAME);
  const [showSummary,     setShowSummary]     = useState(false);
  const [offlineReady,    setOfflineReady]    = useState(false);
  const [fetchError,      setFetchError]      = useState(null); // BK-79: background fetch failure toast
  const fetchErrorTimerRef = useRef(null);

  // Persist game state to localStorage whenever it changes
  useEffect(() => {
    if (gameData) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameData, gameState, tab }));
      } catch {
        // Storage quota exceeded — silently skip
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [gameData, gameState, tab]);

  // BK-90: Pre-cache all roster pitchers whenever a game is loaded (fresh or restored).
  // Using team IDs as deps so this only re-runs when the game changes, not on every state update.
  useEffect(() => {
    if (!gameData) return;
    setOfflineReady(false);
    const isPitcher = p => p?.position?.type === 'Pitcher' || p?.position?.code === '1';
    const homeRosterPitchers = (gameData.homeRoster || []).filter(isPitcher);
    const awayRosterPitchers = (gameData.awayRoster || []).filter(isPitcher);
    const allRosterPitchers  = [...homeRosterPitchers, ...awayRosterPitchers]
      .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);
    const allLineupBatters = [
      ...(gameData.homeLineup || []),
      ...(gameData.awayLineup || []),
    ].filter(Boolean).filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);

    // All roster position players (subs) — pre-cache lightweight batter data
    const allRosterBatters = [
      ...(gameData.homeRoster || []),
      ...(gameData.awayRoster || []),
    ].filter(p => p && !isPitcher(p))
     .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i)
     .filter(p => !allLineupBatters.find(b => b.id === p.id)); // skip already-in-lineup
    const homeTeamSeason = gameData.homeTeam?.sportId === 51 ? 2026 : undefined;
    const awayTeamSeason = gameData.awayTeam?.sportId === 51 ? 2026 : undefined;
    const homeLineup = (gameData.homeLineup || []).filter(Boolean);
    const awayLineup = (gameData.awayLineup || []).filter(Boolean);

    Promise.allSettled([
      // Bullpen panels
      getBullpenCached(gameData.homeTeam.id, homeTeamSeason),
      getBullpenCached(gameData.awayTeam.id, awayTeamSeason),
      // All roster pitcher data (stats, arsenal, splits, fatigue)
      ...allRosterPitchers.flatMap(p => [
        getPitcherStatsCached(p.id),
        getPitcherArsenalCached(p.id),
        getPitcherArsenalSplitsCached(p.id),
        getPitcherFatigueCached(p.id),
      ]),
      // All lineup batter data (full set)
      ...allLineupBatters.flatMap(b => [
        getBatterStatsCached(b.id),
        getBatterStreaksCached(b.id),
        getSprayChartCached(b.id),
        getZonesCached(b.id),
        getMilestonesCached(b.id),
        getSituationalCached(b.id),
      ]),
      // All roster position players (potential subs) — cache their situational splits too
      ...allRosterBatters.flatMap(b => [
        getBatterStatsCached(b.id),
        getBatterStreaksCached(b.id),
        getMilestonesCached(b.id),
        getSituationalCached(b.id),
      ]),
      // BvP: each lineup vs every opposing roster pitcher
      ...homeRosterPitchers.map(p => getBulkMatchupsCached(awayLineup, p.id)),
      ...awayRosterPitchers.map(p => getBulkMatchupsCached(homeLineup, p.id)),
    ]).then(() => setOfflineReady(true));
  }, [gameData?.homeTeam?.id, gameData?.awayTeam?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // BK-79: show a dismissible toast when any background data fetch fails
  const showFetchError = useCallback(() => {
    setFetchError('Some player data failed to load — stats panels may be incomplete.');
    if (fetchErrorTimerRef.current) clearTimeout(fetchErrorTimerRef.current);
    fetchErrorTimerRef.current = setTimeout(() => setFetchError(null), 6000);
  }, []);

  // ── Handle lineup form submission ─────────────────────────────────────────
  const handleLineupSubmit = useCallback(async (formData) => {
    setLoadingGame(true);
    setLoadError(null);

    try {
      const {
        homeTeam, awayTeam,
        homeLineup, awayLineup,
        homePitcher, awayPitcher,
        homeRoster, awayRoster,
      } = formData;

      // ── Fetch both lineup's season stats in parallel ─────────────────────
      const allBatters  = [...awayLineup, ...homeLineup].filter(Boolean);
      const allPitchers = [awayPitcher, homePitcher].filter(Boolean);

      const [batterStats, pitcherStats] = await Promise.all([
        Promise.allSettled(allBatters.map(b => getBatterStatsCached(b.id).then(s => ({ id: b.id, ...s })))),
        Promise.allSettled(allPitchers.map(p => getPitcherStatsCached(p.id).then(s => ({ id: p.id, ...s })))),
      ]);

      // ── Fetch BvP matchups: away batters vs HOME pitcher, home batters vs AWAY pitcher ─
      const [awayBvPResult, homeBvPResult] = await Promise.allSettled([
        homePitcher ? getBulkMatchupsCached(awayLineup.filter(Boolean), homePitcher.id) : Promise.resolve([]),
        awayPitcher ? getBulkMatchupsCached(homeLineup.filter(Boolean), awayPitcher.id) : Promise.resolve([]),
      ]);
      const awayBvP = awayBvPResult.status === 'fulfilled' ? awayBvPResult.value : [];
      const homeBvP = homeBvPResult.status === 'fulfilled' ? homeBvPResult.value : [];

      // ── Index results by player ID ───────────────────────────────────────
      const statsById = {};
      for (const r of batterStats) {
        if (r.status === 'fulfilled') statsById[r.value.id] = r.value;
      }
      for (const r of pitcherStats) {
        if (r.status === 'fulfilled') statsById[r.value.id] = r.value;
      }

      const bvpById = {};
      for (const r of awayBvP)  if (r.batterId) bvpById[`${r.batterId}_${homePitcher?.id}`]  = r;
      for (const r of homeBvP)  if (r.batterId) bvpById[`${r.batterId}_${awayPitcher?.id}`]  = r;

      // ── Render immediately with core stats, then fill in streaks ─────────
      // Streaks require one API call per batter (18 total) — loading them
      // before rendering would add ~3-5s of blank screen. Instead, render
      // the matchup table right away and patch streaksById in once ready.
      setGameData({
        homeTeam, awayTeam,
        homeLineup: homeLineup.filter(Boolean),
        awayLineup: awayLineup.filter(Boolean),
        homePitcher, awayPitcher,
        homeRoster: homeRoster || [],
        awayRoster: awayRoster || [],
        currentHomePitcher: homePitcher,
        currentAwayPitcher: awayPitcher,
        statsById,
        bvpById,
        streaksById:    {},
        arsenalById:        {},
        arsenalSplitsById:  {},
        milestonesById: {},
        sprayById:      {},       // {[playerId]: [{x, y, o}]} — batted ball spray data
        zonesById:      {},       // {[playerId]: [{row, col, ab, hits, ba}]} — hot/cold zone grid
        subsLog:        [],       // [{side, slotIdx, outPlayer, inPlayer, inning, isTop}]
      });

      // Reset game state when a new game is loaded
      setGameState(EMPTY_GAME);
      setShowSummary(false);
      setOfflineReady(false);
      setTab('matchups');

      // ── Background: fetch streaks and patch into gameData ─────────────
      Promise.allSettled(
        allBatters.map(b => getBatterStreaksCached(b.id).then(s => ({ id: b.id, ...s })))
      ).then(results => {
        const streaksById = {};
        for (const r of results) {
          if (r.status === 'fulfilled') streaksById[r.value.id] = r.value;
        }
        setGameData(prev => prev ? { ...prev, streaksById } : prev);
      });

      // ── Background: fetch pitch arsenal + splits for both starters ───
      Promise.allSettled(
        allPitchers.map(p => getPitcherArsenalCached(p.id).then(a => ({ id: p.id, pitches: a?.pitches ?? a })))
      ).then(results => {
        const arsenalById = {};
        for (const r of results) {
          if (r.status === 'fulfilled') arsenalById[r.value.id] = r.value.pitches;
        }
        setGameData(prev => prev ? { ...prev, arsenalById } : prev);
      });

      Promise.allSettled(
        allPitchers.map(p => getPitcherArsenalSplitsCached(p.id).then(s => ({ id: p.id, splits: s })))
      ).then(results => {
        const arsenalSplitsById = {};
        for (const r of results) {
          if (r.status === 'fulfilled') arsenalSplitsById[r.value.id] = r.value.splits;
        }
        setGameData(prev => prev ? { ...prev, arsenalSplitsById } : prev);
      });

      // ── Background: fetch spray chart data for every batter ───────────
      // Update incrementally as each player's Statcast request completes
      allBatters.forEach(b => {
        getSprayChartCached(b.id)
          .then(data => {
            const entry = { dots: data?.dots ?? data, _season: data?._season };
            setGameData(prev => prev ? { ...prev, sprayById: { ...prev.sprayById, [b.id]: entry } } : prev);
          })
          .catch(() => {
            setGameData(prev => prev ? { ...prev, sprayById: { ...prev.sprayById, [b.id]: { dots: [], _season: null } } } : prev);
          });
      });

      // ── Background: fetch hot/cold zone grid for every batter ───────────
      // Reuses the same Statcast CSV cache as spray — no extra network cost
      // once spray has been fetched; zones are computed server-side.
      // Update incrementally as each player's data completes
      allBatters.forEach(b => {
        getZonesCached(b.id)
          .then(data => {
            const entry = { zones: data?.zones ?? data, _season: data?._season };
            setGameData(prev => prev ? { ...prev, zonesById: { ...prev.zonesById, [b.id]: entry } } : prev);
          })
          .catch(() => {
            setGameData(prev => prev ? { ...prev, zonesById: { ...prev.zonesById, [b.id]: { zones: [], _season: null } } } : prev);
          });
      });

      // ── Background: fetch career milestones for every batter ──────────
      // Batters only — pitchers in the lineup are a rare DH-off edge case
      // the milestone endpoint checks both career splits internally anyway.
      Promise.allSettled(
        allBatters.map(b => getMilestonesCached(b.id).then(m => ({ id: b.id, milestones: m })))
      ).then(results => {
        const milestonesById = {};
        for (const r of results) {
          if (r.status === 'fulfilled') milestonesById[r.value.id] = r.value.milestones;
        }
        setGameData(prev => prev ? { ...prev, milestonesById } : prev);
      });

    } catch (err) {
      console.error('Lineup load error:', err);
      setLoadError(err.message);
    } finally {
      setLoadingGame(false);
    }
  }, []);

  // ── Handle in-game pitcher change (reliever substitution) ────────────────
  // side = 'home' | 'away' — refers to the pitching team, not the batting team
  const handlePitcherChange = useCallback(async (side, pitcher) => {
    // Reset the incoming pitcher's pitch count to 0 and record their PA entry point
    setGameState(prev => ({
      ...prev,
      [side === 'home' ? 'homePitchCount'     : 'awayPitchCount']:     0,
      [side === 'home' ? 'homePitcherStartPA' : 'awayPitcherStartPA']: (prev.paLog || []).length,
    }));

    setGameData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        currentHomePitcher: side === 'home' ? pitcher : prev.currentHomePitcher,
        currentAwayPitcher: side === 'away' ? pitcher : prev.currentAwayPitcher,
      };
    });

    // Fetch BvP for the batting lineup vs the new pitcher
    // Away pitcher change → home batters face new away pitcher
    // Home pitcher change → away batters face new home pitcher
    setGameData(prev => {
      if (!prev) return prev;
      const battingLineup = side === 'home' ? prev.awayLineup : prev.homeLineup;
      getBulkMatchupsCached(battingLineup.filter(Boolean), pitcher.id)
        .then(results => {
          const newEntries = {};
          for (const r of results) {
            if (r.batterId) newEntries[`${r.batterId}_${pitcher.id}`] = r;
          }
          setGameData(p => p ? { ...p, bvpById: { ...p.bvpById, ...newEntries } } : p);
        })
        .catch(err => console.error(err));
      return prev;
    });

    // Background: fetch new pitcher's stats + arsenal (cached — works offline)
    getPitcherStatsCached(pitcher.id)
      .then(s => setGameData(prev =>
        prev ? { ...prev, statsById: { ...prev.statsById, [pitcher.id]: s } } : prev))
      .catch(console.error);

    getPitcherArsenalCached(pitcher.id)
      .then(a => setGameData(prev =>
        prev ? { ...prev, arsenalById: { ...prev.arsenalById, [pitcher.id]: a?.pitches ?? a } } : prev))
      .catch(console.error);

    getPitcherArsenalSplitsCached(pitcher.id)
      .then(s => setGameData(prev =>
        prev ? { ...prev, arsenalSplitsById: { ...prev.arsenalSplitsById, [pitcher.id]: s } } : prev))
      .catch(console.error);
  }, []);

  // ── BK-27: Handle lineup reorder via drag-and-drop ───────────────────────
  // BK-59: oldLineup is the pre-reorder array so we can keep the at-bat pointer
  //        on the same player even if their slot index changed.
  const handleLineupReorder = useCallback((side, newLineup, oldLineup) => {
    setGameData(prev => {
      if (!prev) return prev;
      return { ...prev, [side === 'away' ? 'awayLineup' : 'homeLineup']: newLineup };
    });
    if (oldLineup) {
      setGameState(prev => {
        if (!prev) return prev;
        const idxKey = side === 'away' ? 'awayBatterIdx' : 'homeBatterIdx';
        const currentBatter = oldLineup[prev[idxKey] % Math.max(oldLineup.length, 1)];
        if (!currentBatter) return prev;
        const newIdx = newLineup.findIndex(p => p && p.id === currentBatter.id);
        return newIdx === -1 ? prev : { ...prev, [idxKey]: newIdx };
      });
    }
  }, []);

  // ── Handle pinch hit / position player substitution ──────────────────────
  // side     = 'home' | 'away' — the BATTING team
  // slotIdx  = 0-based batting order position
  // newPlayer = roster player object {id, name, position, jerseyNumber, batSide, …}
  const handlePinchHit = useCallback((side, slotIdx, newPlayer) => {
    // Swap the player in the lineup and append a subs-log entry
    setGameData(prev => {
      if (!prev) return prev;
      const key       = side === 'home' ? 'homeLineup' : 'awayLineup';
      const newLineup = [...prev[key]];
      const outPlayer = newLineup[slotIdx];
      newLineup[slotIdx] = newPlayer;
      return {
        ...prev,
        [key]: newLineup,
        subsLog: [
          ...(prev.subsLog || []),
          { side, slotIdx, outPlayer, inPlayer: newPlayer,
            inning: gameState.inning, isTop: gameState.isTop },
        ],
      };
    });

    // Background: fetch new player's season stats, streaks, milestones
    getBatterStatsCached(newPlayer.id)
      .then(s => setGameData(prev =>
        prev ? { ...prev, statsById: { ...prev.statsById, [newPlayer.id]: s } } : prev))
      .catch(console.error);

    getBatterStreaksCached(newPlayer.id)
      .then(s => setGameData(prev =>
        prev ? { ...prev, streaksById: { ...prev.streaksById, [newPlayer.id]: s } } : prev))
      .catch(console.error);

    getMilestonesCached(newPlayer.id)
      .then(m => setGameData(prev =>
        prev ? { ...prev, milestonesById: { ...prev.milestonesById, [newPlayer.id]: m } } : prev))
      .catch(console.error);

    getZonesCached(newPlayer.id)
      .then(data => setGameData(prev =>
        prev ? { ...prev, zonesById: { ...prev.zonesById, [newPlayer.id]: { zones: data?.zones ?? data, _season: data?._season } } } : prev))
      .catch(console.error);

    // Background: fetch BvP vs the current opposing pitcher
    setGameData(prev => {
      if (!prev) return prev;
      const pitcherId = side === 'home'
        ? prev.currentAwayPitcher?.id
        : prev.currentHomePitcher?.id;
      if (pitcherId) {
        getBulkMatchupsCached([newPlayer], pitcherId)
          .then(results => {
            const entries = {};
            for (const r of results) if (r.batterId) entries[`${r.batterId}_${pitcherId}`] = r;
            setGameData(p => p ? { ...p, bvpById: { ...p.bvpById, ...entries } } : p);
          })
          .catch(err => console.error(err));
      }
      return prev;
    });
  }, [gameState]);

  // ── BK-35: Save game to backend ──────────────────────────────────────────
  const handleSaveGame = useCallback(async (isComplete = false) => {
    if (!gameData || !token) return;
    setSavingGame(true);
    setSaveMsg('');
    try {
      await api.saveGame(gameData, gameState, isComplete, token);
      setSaveMsg('Saved!');
    } catch (e) {
      setSaveMsg('Save failed');
    } finally {
      setSavingGame(false);
      setTimeout(() => setSaveMsg(''), 2500);
    }
  }, [gameData, gameState, token]);

  // ── BK-35: Load a previously saved game ──────────────────────────────────
  const handleLoadGame = useCallback((loadedGameData, loadedGameState) => {
    setGameData(loadedGameData);
    setGameState(loadedGameState ?? EMPTY_GAME);
    setShowSummary(false);
    setTab('matchups');
  }, []);

  // ── Derive who is currently batting ──────────────────────────────────────
  const currentLineup   = gameData
    ? (gameState.isTop ? gameData.awayLineup : gameData.homeLineup)
    : [];
  const currentBatterIdx = gameState.isTop
    ? gameState.awayBatterIdx
    : gameState.homeBatterIdx;
  const currentBatter   = currentLineup.length > 0 ? currentLineup[currentBatterIdx % currentLineup.length] : null;

  // ── Auth gate: show spinner while validating token ────────────────────────
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  // ── Show auth page if not signed in ──────────────────────────────────────
  if (!user) {
    return <AuthPage />;
  }

  return (
  <>
    <div className="app-root">
      {/* ── Top Header Bar ──────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-brand">
          <img src="/logo.svg" alt="Mound Track" className="brand-logo-img" />
        </div>

        {gameData && (
          <div className="header-game-state">
            {/* Score / teams */}
            <div className="scorebug">
              {gameData.awayTeam?.id && (
                <img
                  src={`https://www.mlbstatic.com/team-logos/${gameData.awayTeam.id}.svg`}
                  alt={gameData.awayTeam.abbreviation}
                  className="scorebug-logo"
                />
              )}
              <span className="scorebug-team away">
                {gameData.awayTeam?.abbreviation}
              </span>
              <span className="scorebug-runs">{gameState.score.away}</span>
              <span className="scorebug-divider">–</span>
              <span className="scorebug-runs">{gameState.score.home}</span>
              <span className="scorebug-team home">
                {gameData.homeTeam?.abbreviation}
              </span>
              {gameData.homeTeam?.id && (
                <img
                  src={`https://www.mlbstatic.com/team-logos/${gameData.homeTeam.id}.svg`}
                  alt={gameData.homeTeam.abbreviation}
                  className="scorebug-logo"
                />
              )}
            </div>

            {/* Inning / count / bases */}
            <div className="game-meta">
              <span className="inning-indicator">
                {gameState.isTop ? '▲' : '▼'} {gameState.inning}
              </span>
              <span className="count-indicator">
                {gameState.balls}-{gameState.strikes} · {gameState.outs} out{gameState.outs !== 1 ? 's' : ''}
              </span>
              <BaseDiamond bases={gameState.bases} size="sm" />
            </div>

            {/* Current batter */}
            {currentBatter && (
              <div className="current-batter">
                <span className="label">AT BAT</span>
                <span className="batter-name">{currentBatter.name}</span>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {gameData && (
            <>
              {offlineReady && (
                <span className="offline-ready-badge" title="All pitcher data cached — app works without internet">
                  ✓ Offline Ready
                </span>
              )}
              {saveMsg && (
                <span className={`save-flash ${saveMsg === 'Saved!' ? 'save-flash-ok' : 'save-flash-err'}`}>
                  {saveMsg}
                </span>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => handleSaveGame(false)}
                disabled={savingGame}
              >
                {savingGame ? 'Saving…' : 'Save Game'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowSummary(true)}
              >
                End Game
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { localStorage.removeItem(STORAGE_KEY); setGameData(null); setGameState(EMPTY_GAME); setTab('matchups'); }}
              >
                New Game
              </button>
            </>
          )}

          {/* User menu */}
          <div className="user-menu-wrap" ref={userMenuRef}>
            <button
              className="user-avatar-btn"
              onClick={() => setShowUserMenu(v => !v)}
              title={user.name}
            >
              {user.name.charAt(0).toUpperCase()}
            </button>
            {showUserMenu && (
              <div className="user-menu-dropdown">
                <div className="user-menu-info">
                  <span className="user-menu-name">{user.name}</span>
                  <span className="user-menu-email">{user.email}</span>
                  {user.role === 'admin' && <span className="user-menu-role">Admin</span>}
                </div>
                <div className="user-menu-divider" />
                <button
                  className="user-menu-item"
                  onClick={() => { setShowHistory(true); setShowUserMenu(false); }}
                >
                  Saved Games
                </button>
                {user.role === 'admin' && (
                  <button
                    className="user-menu-item"
                    onClick={() => { setShowAdmin(true); setShowUserMenu(false); }}
                  >
                    Admin — Users
                  </button>
                )}
                <div className="user-menu-divider" />
                <button
                  className="user-menu-item user-menu-signout"
                  onClick={() => { signOut(); setShowUserMenu(false); }}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Game history panel */}
      {showHistory && (
        <GameHistory
          onClose={() => setShowHistory(false)}
          onLoad={handleLoadGame}
        />
      )}

      {/* Admin panel */}
      {showAdmin && user?.role === 'admin' && (
        <AdminPanel onClose={() => setShowAdmin(false)} onLoad={handleLoadGame} />
      )}

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <main className="app-main">
        {showSummary && gameData ? (
          /* ── Game Summary ─────────────────────────────────────────────── */
          <GameSummary
            gameData={gameData}
            gameState={gameState}
            onBack={() => setShowSummary(false)}
            onNewGame={() => { localStorage.removeItem(STORAGE_KEY); setShowSummary(false); setGameData(null); setGameState(EMPTY_GAME); setTab('matchups'); }}
          />
        ) : !gameData ? (
          /* ── Lineup Input ─────────────────────────────────────────────── */
          <div className="lineup-wrapper">
            {loadingGame && (
              <div className="loading-overlay">
                <div className="spinner" />
                <span>Loading game data…</span>
              </div>
            )}
            {!loadingGame && (
              <>
                {loadError && (
                  <div className="error-banner">
                    Failed to load game data: {loadError}
                  </div>
                )}
                <LineupInput onSubmit={handleLineupSubmit} />
              </>
            )}
          </div>
        ) : (
          /* ── Tabbed Game View ─────────────────────────────────────────── */
          <div className="game-layout">
            <nav className="tab-bar">
              {[
                { id: 'matchups',    label: 'Matchups' },
                { id: 'bullpen',     label: 'Bullpen' },
                { id: 'situational', label: 'Situational' },
                { id: 'scorebook',   label: 'Scorebook' },
                { id: 'boxscore',    label: 'Box Score' },
              ].map(t => (
                <button
                  key={t.id}
                  className={`tab-btn ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="tab-content">
              {tab === 'matchups' && (
                <MatchupsPanel
                  gameData={gameData}
                  paLog={gameState.paLog}
                  streaksById={gameData.streaksById || {}}
                  arsenalById={gameData.arsenalById || {}}
                  arsenalSplitsById={gameData.arsenalSplitsById || {}}
                  milestonesById={gameData.milestonesById || {}}
                  zonesById={gameData.zonesById || {}}
                  onPitcherChange={handlePitcherChange}
                  onPinchHit={handlePinchHit}
                  subsLog={gameData.subsLog || []}
                  awayBatterIdx={gameState.awayBatterIdx}
                  homeBatterIdx={gameState.homeBatterIdx}
                  isTop={gameState.isTop}
                />
              )}
              {tab === 'bullpen' && (
                <BullpenPanel
                  homeTeam={gameData.homeTeam}
                  awayTeam={gameData.awayTeam}
                />
              )}
              {tab === 'scorebook' && (
                <Scorebook
                  gameData={gameData}
                  gameState={gameState}
                  setGameState={setGameState}
                  onPinchHit={handlePinchHit}
                  onPitcherChange={handlePitcherChange}
                  onLineupReorder={handleLineupReorder}
                />
              )}
              {tab === 'boxscore' && (
                <BoxScore
                  gameData={gameData}
                  gameState={gameState}
                />
              )}
              {tab === 'situational' && (
                <SituationalStats
                  batter={currentBatter}
                  gameState={gameState}
                  statsById={gameData.statsById}
                />
              )}
            </div>
          </div>
        )}
      </main>

    </div>

    {/* BK-79: background fetch failure toast */}
    {fetchError && (
      <div className="fetch-error-toast">
        <span>⚠ {fetchError}</span>
        <button onClick={() => setFetchError(null)} aria-label="Dismiss">×</button>
      </div>
    )}

    {/* ── Print-only box score — rendered OUTSIDE .app-root so @media print can show it
         while hiding .app-root. A child of a display:none parent can't be shown even
         with display:block !important, so this must be a sibling of .app-root. ── */}
    <BoxScorePrint
      gameData={gameData}
      gameState={gameState}
    />
  </>
  );
}

// ── Small base diamond indicator for the header ───────────────────────────
function BaseDiamond({ bases, size = 'md' }) {
  const [b1, b2, b3] = bases;
  const sz = size === 'sm' ? 8 : 12;
  const gap = size === 'sm' ? 3 : 5;

  const baseStyle = (on) => ({
    width:  sz, height: sz,
    background:  on ? '#f59e0b' : 'transparent',
    border: `1.5px solid ${on ? '#f59e0b' : '#4a7190'}`,
    transform: 'rotate(45deg)',
    display: 'inline-block',
    margin: `0 ${gap / 2}px`,
  });

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}>
      <span style={baseStyle(b3)} title="3B" />
      <span style={baseStyle(b2)} title="2B" />
      <span style={baseStyle(b1)} title="1B" />
    </span>
  );
}
