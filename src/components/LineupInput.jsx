/**
 * LineupInput.jsx
 *
 * Form for entering both team lineups before loading the game.
 * - Select home/away teams from MLB team list
 * - Search and select each of the 9 batters per team
 * - Select starting pitcher for each team
 * - Hitting order can be drag-reordered (keyboard-accessible)
 *
 * On submit, fires props.onSubmit({ homeTeam, awayTeam, homeLineup, awayLineup, homePitcher, awayPitcher })
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api, getTeamsCached, getRosterCached } from '../api/index.js';

const BATTING_POSITIONS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
const FIELD_POSITIONS   = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'OF', 'P', 'PH'];

export default function LineupInput({ onSubmit }) {
  const [teams,       setTeams]       = useState([]);
  const [homeTeam,    setHomeTeam]    = useState('');
  const [awayTeam,    setAwayTeam]    = useState('');
  const [homeRoster,  setHomeRoster]  = useState([]);
  const [awayRoster,  setAwayRoster]  = useState([]);
  const [homeLineup,     setHomeLineup]     = useState(Array(9).fill(null));
  const [awayLineup,     setAwayLineup]     = useState(Array(9).fill(null));
  const [homePositions,  setHomePositions]  = useState(Array(9).fill(''));
  const [awayPositions,  setAwayPositions]  = useState(Array(9).fill(''));
  const [homePitcher, setHomePitcher] = useState(null);
  const [awayPitcher, setAwayPitcher] = useState(null);
  const [gameDate, setGameDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [gameTime, setGameTime] = useState('19:05');
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState({ home: false, away: false });
  const [positionWarning, setPositionWarning] = useState('');
  const [duplicateError,  setDuplicateError]  = useState(''); // BK-75
  const [usingCache, setUsingCache] = useState(false); // BK-90

  // ── Fetch team list on mount ──────────────────────────────────────────────
  useEffect(() => {
    getTeamsCached()
      .then(({ data, fromCache }) => {
        setTeams(data);
        if (fromCache) setUsingCache(true);
      })
      .catch(console.error)
      .finally(() => setLoadingTeams(false));
  }, []);

  // ── Fetch roster when a team is selected ──────────────────────────────────
  const fetchRoster = useCallback(async (teamId, side) => {
    if (!teamId) return;
    setLoadingRoster(prev => ({ ...prev, [side]: true }));
    try {
      const { data: roster, fromCache } = await getRosterCached(teamId);
      if (fromCache) setUsingCache(true);
      if (side === 'home') {
        setHomeRoster(roster);
        setHomeLineup(Array(9).fill(null));
        setHomePositions(Array(9).fill(''));
        setHomePitcher(null);
      } else {
        setAwayRoster(roster);
        setAwayLineup(Array(9).fill(null));
        setAwayPositions(Array(9).fill(''));
        setAwayPitcher(null);
      }
    } catch (err) {
      console.error('Roster fetch error:', err);
    } finally {
      setLoadingRoster(prev => ({ ...prev, [side]: false }));
    }
  }, []);

  useEffect(() => { fetchRoster(homeTeam, 'home'); }, [homeTeam]);
  useEffect(() => { fetchRoster(awayTeam, 'away'); }, [awayTeam]);

  // ── Select player in lineup slot ──────────────────────────────────────────
  const setLineupSlot = (side, idx, playerId) => {
    const roster = side === 'home' ? homeRoster : awayRoster;
    const player = roster.find(p => String(p.id) === String(playerId)) || null;
    const defaultPos = player?.position?.abbreviation || '';
    if (side === 'home') {
      setHomeLineup(prev => { const next = [...prev]; next[idx] = player; return next; });
      setHomePositions(prev => { const next = [...prev]; next[idx] = defaultPos; return next; });
    } else {
      setAwayLineup(prev => { const next = [...prev]; next[idx] = player; return next; });
      setAwayPositions(prev => { const next = [...prev]; next[idx] = defaultPos; return next; });
    }
  };

  const setPositionSlot = (side, idx, pos) => {
    if (side === 'home') {
      setHomePositions(prev => { const next = [...prev]; next[idx] = pos; return next; });
    } else {
      setAwayPositions(prev => { const next = [...prev]; next[idx] = pos; return next; });
    }
  };

  const setPitcher = (side, playerId) => {
    const roster = side === 'home' ? homeRoster : awayRoster;
    const player = roster.find(p => String(p.id) === String(playerId)) || null;
    if (side === 'home') setHomePitcher(player);
    else setAwayPitcher(player);
  };

  // ── Auto-fill lineup with position players from roster ───────────────────
  const autoFill = (side) => {
    const roster = side === 'home' ? homeRoster : awayRoster;
    const batters = roster
      .filter(p => p.position?.type !== 'Pitcher')
      .slice(0, 9);
    const lineup = Array(9).fill(null).map((_, i) => batters[i] || null);
    // Standard field positions in assignment priority order
    const STANDARD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
    const usedPositions = new Set();
    const positions = lineup.map(p => {
      if (!p) return '';
      const primary = p.position?.abbreviation || '';
      // Use primary if available
      if (primary && !usedPositions.has(primary)) {
        usedPositions.add(primary);
        return primary;
      }
      // Otherwise assign next available standard position
      const fallback = STANDARD_POSITIONS.find(pos => !usedPositions.has(pos));
      if (fallback) { usedPositions.add(fallback); return fallback; }
      return '';
    });
    if (side === 'home') { setHomeLineup(lineup); setHomePositions(positions); }
    else                 { setAwayLineup(lineup); setAwayPositions(positions); }
  };

  const canSubmit = homeTeam && awayTeam &&
    homeLineup.some(Boolean) && awayLineup.some(Boolean) &&
    homePitcher && awayPitcher;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    // BK-75: reject if any player appears more than once in either lineup
    const hasDupes = (lineup) => {
      const ids = lineup.filter(Boolean).map(p => String(p.id));
      return ids.length !== new Set(ids).size;
    };
    if (hasDupes(homeLineup) || hasDupes(awayLineup)) {
      const parts = [];
      if (hasDupes(awayLineup)) parts.push('away');
      if (hasDupes(homeLineup)) parts.push('home');
      setDuplicateError(`Duplicate player in ${parts.join(' and ')} lineup — each player can only appear once.`);
      return;
    }
    setDuplicateError('');

    // Warn if any filled lineup slot is missing a position
    const missingHome = homeLineup.filter((p, i) => p && !homePositions[i]).length;
    const missingAway = awayLineup.filter((p, i) => p && !awayPositions[i]).length;
    if (missingHome > 0 || missingAway > 0) {
      const parts = [];
      if (missingAway > 0) parts.push(`${missingAway} away player${missingAway > 1 ? 's' : ''}`);
      if (missingHome > 0) parts.push(`${missingHome} home player${missingHome > 1 ? 's' : ''}`);
      setPositionWarning(`Missing fielding position for ${parts.join(' and ')}. Assign positions or continue anyway.`);
      return;
    }
    setPositionWarning('');

    const allTeams = [...teams];
    const homeTeamObj = allTeams.find(t => String(t.id) === String(homeTeam));
    const awayTeamObj = allTeams.find(t => String(t.id) === String(awayTeam));
    const mergePos = (lineup, positions) =>
      lineup.map((p, i) => p && positions[i]
        ? { ...p, position: { ...p.position, abbreviation: positions[i] } }
        : p
      ).filter(Boolean);
    onSubmit({
      homeTeam:    homeTeamObj,
      awayTeam:    awayTeamObj,
      homeLineup:  mergePos(homeLineup, homePositions),
      awayLineup:  mergePos(awayLineup, awayPositions),
      homePitcher,
      awayPitcher,
      homeRoster,
      awayRoster,
      gameDate,
      gameTime,
    });
  };

  // ── Force submit (skip position warning) ─────────────────────────────────
  const handleForceSubmit = () => {
    setPositionWarning('');
    const allTeams = [...teams];
    const homeTeamObj = allTeams.find(t => String(t.id) === String(homeTeam));
    const awayTeamObj = allTeams.find(t => String(t.id) === String(awayTeam));
    const mergePos = (lineup, positions) =>
      lineup.map((p, i) => p && positions[i]
        ? { ...p, position: { ...p.position, abbreviation: positions[i] } }
        : p
      ).filter(Boolean);
    onSubmit({
      homeTeam:    homeTeamObj,
      awayTeam:    awayTeamObj,
      homeLineup:  mergePos(homeLineup, homePositions),
      awayLineup:  mergePos(awayLineup, awayPositions),
      homePitcher,
      awayPitcher,
      homeRoster,
      awayRoster,
      gameDate,
      gameTime,
    });
  };

  // ── BK-90: Refresh cached data ───────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    setUsingCache(false);
    setLoadingTeams(true);
    getTeamsCached()
      .then(({ data, fromCache }) => {
        setTeams(data);
        if (fromCache) setUsingCache(true);
      })
      .catch(console.error)
      .finally(() => setLoadingTeams(false));
    if (homeTeam) fetchRoster(homeTeam, 'home');
    if (awayTeam) fetchRoster(awayTeam, 'away');
  }, [homeTeam, awayTeam, fetchRoster]);

  // ── Pitchers from roster ──────────────────────────────────────────────────
  const pitchersFor = (roster) =>
    roster.filter(p => p.position?.type === 'Pitcher' || p.position?.code === '1');

  if (loadingTeams) {
    return <div className="loading-state"><div className="spinner" /> Loading teams…</div>;
  }

  return (
    <form className="lineup-form" onSubmit={handleSubmit}>
      {usingCache && (
        <div className="offline-banner">
          Offline — showing cached data
          <button type="button" onClick={handleRefresh}>Refresh</button>
        </div>
      )}
      <div className="lineup-form-header">
        <h1 className="lineup-title">Load a Game</h1>
        <p className="lineup-sub">
          Select both teams, enter the starting lineups, and pick the starting pitchers.
        </p>
        <div className="lineup-meta-row">
          <label className="lineup-meta-label">
            Game Date
            <input
              type="date"
              value={gameDate}
              onChange={e => setGameDate(e.target.value)}
              className="lineup-meta-input"
            />
          </label>
          <label className="lineup-meta-label">
            First Pitch
            <input
              type="time"
              value={gameTime}
              onChange={e => setGameTime(e.target.value)}
              className="lineup-meta-input"
            />
          </label>
        </div>
      </div>

      <div className="lineup-teams-row">
        {/* ── Away Team ──────────────────────────────────────────────────── */}
        <TeamLineupCard
          label="Away"
          teams={teams}
          otherTeamId={homeTeam}
          selectedTeamId={awayTeam}
          onTeamChange={(id) => setAwayTeam(id)}
          roster={awayRoster}
          lineup={awayLineup}
          positions={awayPositions}
          pitcher={awayPitcher}
          onLineupChange={(i, pid) => setLineupSlot('away', i, pid)}
          onPositionChange={(i, pos) => setPositionSlot('away', i, pos)}
          onPitcherChange={(pid) => setPitcher('away', pid)}
          onAutoFill={() => autoFill('away')}
          loading={loadingRoster.away}
          pitchers={pitchersFor(awayRoster)}
        />

        <div className="vs-divider">VS</div>

        {/* ── Home Team ──────────────────────────────────────────────────── */}
        <TeamLineupCard
          label="Home"
          teams={teams}
          otherTeamId={awayTeam}
          selectedTeamId={homeTeam}
          onTeamChange={(id) => setHomeTeam(id)}
          roster={homeRoster}
          lineup={homeLineup}
          positions={homePositions}
          pitcher={homePitcher}
          onLineupChange={(i, pid) => setLineupSlot('home', i, pid)}
          onPositionChange={(i, pos) => setPositionSlot('home', i, pos)}
          onPitcherChange={(pid) => setPitcher('home', pid)}
          onAutoFill={() => autoFill('home')}
          loading={loadingRoster.home}
          pitchers={pitchersFor(homeRoster)}
        />
      </div>

      <div className="lineup-submit-row">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canSubmit}
          style={{ padding: '10px 32px', fontSize: '15px', fontWeight: 600 }}
        >
          Load Game →
        </button>
        {!canSubmit && (
          <span className="dim" style={{ fontSize: 12 }}>
            Select both teams, fill lineups, and choose starting pitchers
          </span>
        )}
        {duplicateError && (
          <div className="lineup-position-warning" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
            <span>⛔ {duplicateError}</span>
          </div>
        )}
        {positionWarning && (
          <div className="lineup-position-warning">
            <span>⚠️ {positionWarning}</span>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={handleForceSubmit}>
              Continue anyway
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

// ── Sub-component: one team's lineup entry card ───────────────────────────
function TeamLineupCard({
  label, teams, selectedTeamId, onTeamChange,
  otherTeamId = '',
  roster, lineup, positions, pitcher,
  onLineupChange, onPositionChange, onPitcherChange, onAutoFill,
  loading, pitchers,
}) {
  const batters = roster.filter(p =>
    p.position?.type !== 'Pitcher' && p.position?.code !== '1'
  );

  return (
    <div className="team-card">
      {/* Team selector */}
      <div className="team-card-header">
        <span className={`label team-label-${label.toLowerCase()}`}>{label}</span>
        {selectedTeamId && (
          <img
            src={`https://www.mlbstatic.com/team-logos/${selectedTeamId}.svg`}
            alt=""
            className="team-logo-sm"
            onError={e => { e.target.style.display = 'none'; }}
          />
        )}
        <select
          value={selectedTeamId}
          onChange={e => onTeamChange(e.target.value)}
          style={{ fontWeight: 600, fontSize: 14 }}
        >
          <option value="">Select team…</option>
          <optgroup label="MLB">
            {teams.map(t => (
              <option key={t.id} value={t.id} disabled={String(t.id) === String(otherTeamId)}>{t.name}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {loading ? (
        <div className="loading-state" style={{ height: 80 }}>
          <div className="spinner" /> Loading roster…
        </div>
      ) : selectedTeamId && roster.length > 0 ? (
        <>
          {/* Batting lineup */}
          <div className="lineup-grid">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span className="section-title">Batting Order</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onAutoFill}
              >
                Auto-fill
              </button>
            </div>

            {BATTING_POSITIONS.map((pos, i) => {
              const taken = new Set(positions.filter((p, j) => j !== i && p));
              // BK-86: split batters into available vs already slotted elsewhere
              const selectedIds  = new Set(lineup.filter((p, j) => j !== i && p).map(p => String(p.id)));
              const availBatters = batters.filter(p => !selectedIds.has(String(p.id)));
              const usedBatters  = batters.filter(p =>  selectedIds.has(String(p.id)));
              const renderOption = p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.position?.abbreviation ? ` (${p.position.abbreviation})` : ''}
                  {p.batSide ? ` [${p.batSide}]` : ''}
                </option>
              );
              return (
              <div key={i} className="lineup-slot">
                <span className="slot-number">{i + 1}</span>
                {lineup[i] ? (
                  <select
                    className="slot-pos-select"
                    value={positions[i] || ''}
                    onChange={e => onPositionChange(i, e.target.value)}
                    title="Fielding position for this game"
                  >
                    <option value="">—</option>
                    {FIELD_POSITIONS.map(p => (
                      <option key={p} value={p} disabled={taken.has(p)}>{p}</option>
                    ))}
                  </select>
                ) : (
                  <span className="slot-pos-spacer" />
                )}
                <select
                  value={lineup[i]?.id || ''}
                  onChange={e => onLineupChange(i, e.target.value)}
                >
                  <option value="">— select batter —</option>
                  {availBatters.map(renderOption)}
                  {usedBatters.length > 0 && (
                    <optgroup label="Already in lineup">
                      {usedBatters.map(renderOption)}
                    </optgroup>
                  )}
                </select>
              </div>
              );
            })}
          </div>

          {/* Starting pitcher */}
          <div className="pitcher-row">
            <span className="section-title">Starting Pitcher</span>
            <select
              value={pitcher?.id || ''}
              onChange={e => onPitcherChange(e.target.value)}
            >
              <option value="">— select pitcher —</option>
              {pitchers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.position?.abbreviation ? ` · ${p.position.abbreviation}` : ''}
                  {p.throwHand ? ` · ${p.throwHand}HP` : ''}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : selectedTeamId ? (
        <div className="loading-state" style={{ height: 80 }}>No roster data available</div>
      ) : null}
    </div>
  );
}
