/**
 * MatchupsPanel.jsx
 *
 * The primary broadcast reference panel. Shows two tables side-by-side:
 *   1. Away lineup vs. home starting pitcher (BvP + season stats)
 *   2. Home lineup vs. away starting pitcher (BvP + season stats)
 *
 * Stat columns are sortable. Values are color-coded against league-average
 * thresholds so the announcer can spot standout performances at a glance.
 *
 * BvP data = last 3 seasons from Baseball Savant (pulled at game load).
 * Season stats = current year MLB + FanGraphs + Statcast (pulled at game load).
 */

import React, { useState } from 'react';
import SprayChart from './SprayChart.jsx';
import ZoneMap    from './ZoneMap.jsx';
import { api }   from '../api/index.js';

// ── Stat coloring thresholds ──────────────────────────────────────────────
// Returns a CSS class name based on the stat value and direction (higher = better or lower = better)
function colorClass(stat, value) {
  if (value == null || value === '' || value === 'N/A') return '';
  const v = parseFloat(value);
  if (isNaN(v)) return '';

  const THRESHOLDS = {
    avg:     { dir: 'high', elite: .320, great: .290, avg: .260, below: .230 },
    obp:     { dir: 'high', elite: .400, great: .370, avg: .330, below: .300 },
    slg:     { dir: 'high', elite: .550, great: .480, avg: .420, below: .370 },
    ops:     { dir: 'high', elite: .950, great: .850, avg: .750, below: .680 },
    woba:    { dir: 'high', elite: .390, great: .360, avg: .320, below: .300 },
    xwoba:   { dir: 'high', elite: .390, great: .360, avg: .320, below: .300 },
    xwobaP:  { dir: 'low',  elite: .280, great: .310, avg: .330, below: .360 }, // pitcher-side: lower is better
    wrcPlus: { dir: 'high', elite: 145,  great: 120,  avg: 100,  below: 85  },
    kPct:    { dir: 'low',  elite: 13,   great: 17,   avg: 23,   below: 28  },
    bbPct:   { dir: 'high', elite: 12,   great: 9,    avg: 7,    below: 5   },
    hardHit: { dir: 'high', elite: 48,   great: 40,   avg: 35,   below: 30  },
    barrelPct:{ dir: 'high', elite: 14,  great: 9,    avg: 6,    below: 3   },
    exitVelo:{ dir: 'high', elite: 92,   great: 90,   avg: 88,   below: 85  },
    era:     { dir: 'low',  elite: 2.50, great: 3.25, avg: 4.25, below: 5.00 },
    fip:     { dir: 'low',  elite: 2.75, great: 3.25, avg: 4.00, below: 5.00 },
    xfip:    { dir: 'low',  elite: 2.75, great: 3.25, avg: 4.00, below: 5.00 },
    whip:    { dir: 'low',  elite: 0.95, great: 1.10, avg: 1.30, below: 1.50 },
  };

  const t = THRESHOLDS[stat];
  if (!t) return '';

  if (t.dir === 'high') {
    if (v >= t.elite)  return 'stat-elite';
    if (v >= t.great)  return 'stat-great';
    if (v >= t.avg)    return 'stat-avg';
    if (v >= t.below)  return 'stat-below';
    return 'stat-poor';
  } else {
    if (v <= t.elite)  return 'stat-elite';
    if (v <= t.great)  return 'stat-great';
    if (v <= t.avg)    return 'stat-avg';
    if (v <= t.below)  return 'stat-below';
    return 'stat-poor';
  }
}

// ── Format a stat value for display ──────────────────────────────────────
function fmt(v, decimals = 3) {
  if (v == null || v === '') return <span className="dim">—</span>;
  const n = parseFloat(v);
  if (isNaN(n)) return <span className="dim">—</span>;
  // For averages / rates shown as 0.xxx, omit leading zero
  if (decimals === 3 && n < 1) return n.toFixed(3).replace(/^0/, '');
  if (decimals === 1) return n.toFixed(1);
  if (decimals === 0) return Math.round(n).toString();
  return n.toFixed(decimals);
}

function StatCell({ stat, value, decimals = 3 }) {
  const cls = colorClass(stat, value);
  return (
    <td className={cls}>
      {fmt(value, decimals)}
    </td>
  );
}

// ── Sortable column header ─────────────────────────────────────────────────
function SortTh({ col, label, sortCol, sortDir, onSort, title }) {
  return (
    <th
      onClick={() => onSort(col)}
      className={sortCol === col ? (sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc') : ''}
      title={title}
    >
      {label}
    </th>
  );
}

// ── Today's game line for one batter ─────────────────────────────────────
// Returns a broadcast-ready string like "2-3, HR, 3 RBI" or null if no PAs yet.
function getTodayLine(paLog, playerId) {
  const pas = (paLog || []).filter(p => p.batterId === playerId);
  if (pas.length === 0) return null;

  const abs  = pas.filter(p => p.isAB).length;
  const hits = pas.filter(p => p.isHit).length;
  const hr   = pas.filter(p => p.isHR).length;
  const rbi  = pas.reduce((s, p) => s + (p.rbi || 0), 0);
  const bb   = pas.filter(p => p.isBB).length;
  const k    = pas.filter(p => p.isK).length;
  const hbp  = pas.filter(p => p.isHBP).length;

  const parts = [`${hits}-${abs}`];
  if (hr  > 0) parts.push(hr  > 1 ? `${hr} HR`  : 'HR');
  if (rbi > 0) parts.push(`${rbi} RBI`);
  if (bb  > 0) parts.push(bb  > 1 ? `${bb} BB`  : 'BB');
  if (k   > 0) parts.push(k   > 1 ? `${k}K`     : 'K');
  if (hbp > 0) parts.push('HBP');

  return parts.join(', ');
}

// ── Last-5-game symbol strip ──────────────────────────────────────────────
// Shape conveys meaning so color is not load-bearing:
//   ◆ multi-hit  ● 1 hit  ○ 0-fer  · no AB
function StreakDots({ recentGames }) {
  if (!recentGames || recentGames.length === 0) return <span className="dim">—</span>;
  return (
    <span className="streak-dots" title="Last 5 games (newest → oldest)">
      {recentGames.map((g, i) => {
        let symbol = '·';        // no AB
        let cls    = 'dot-no-ab';
        if (g.ab > 0) {
          if (g.h >= 2)     { symbol = '◆'; cls = 'dot-multi'; }
          else if (g.h > 0) { symbol = '●'; cls = 'dot-hit';   }
          else              { symbol = '○'; cls = 'dot-out';    }
        }
        const tip = g.ab > 0
          ? `${g.date}: ${g.h}-${g.ab}${g.hr > 0 ? ` (${g.hr}HR)` : ''}`
          : `${g.date}: no AB`;
        return <span key={i} className={`dot-sym ${cls}`} title={tip}>{symbol}</span>;
      })}
    </span>
  );
}

// ── Milestone badge strip ─────────────────────────────────────────────────
// Shows gold pills for any career milestones a player is approaching.
// Only the top 2 most-urgent are shown to keep the cell tidy.
function MilestoneBadges({ milestones }) {
  if (!milestones || milestones.length === 0) return null;
  const visible = milestones.slice(0, 2); // top 2 most urgent
  return (
    <div className="milestone-badges">
      {visible.map((m, i) => (
        <span
          key={i}
          className="milestone-badge"
          title="Milestone"
        >
          {m.remaining === 1 ? '1' : m.remaining} from {m.milestone.toLocaleString()} {m.stat}
        </span>
      ))}
    </div>
  );
}

// ── Active streak badges ──────────────────────────────────────────────────
// Shows the single most notable active consecutive-game streak.
// Priority: HR ≥ 2 > hit streak ≥ 3 > OB streak ≥ 5 > RBI streak ≥ 3
const STREAK_CFG = [
  { key: 'hr',     label: n => `${n}G HR`,  cls: 'streak-hr',  tip: n => `${n}-game home run streak` },
  { key: 'hits',   label: n => `${n}G HIT`, cls: 'streak-hit', tip: n => `${n}-game hit streak`      },
  { key: 'onBase', label: n => `${n}G OB`,  cls: 'streak-ob',  tip: n => `${n}-game on-base streak`  },
  { key: 'rbi',    label: n => `${n}G RBI`, cls: 'streak-rbi', tip: n => `${n}-game RBI streak`      },
];
function StreakBadges({ activeStreaks }) {
  if (!activeStreaks) return null;
  const badge = STREAK_CFG.find(c => activeStreaks[c.key] >= 1);
  if (!badge) return null;
  const n = activeStreaks[badge.key];
  return (
    <span className={`streak-badge ${badge.cls}`} title="Streak">
      {badge.label(n)}
    </span>
  );
}

// ── BK-30: Player Highlights — Statcast extremes ─────────────────────────
// Surfaces 2–3 extreme performance metrics (top 10% or bottom 10%) as
// compact color-coded badges. Uses the same THRESHOLDS already defined above.
// League-average benchmarks (2024 MLB) used for "vs LgAvg" display
const LEAGUE_AVG = {
  ops: .728, wrcPlus: 100, xwoba: .310, barrelPct: 7.2, hardHit: 37.5,
  exitVelo: 88.3, avg: .248, slg: .397, obp: .312, bbPct: 8.2, kPct: 22.7,
};

// BK-23: Pitcher league averages & highlight metrics
const PITCHER_LEAGUE_AVG = {
  era: 4.25, fip: 4.00, xfip: 4.00, whip: 1.30, xwobaP: .310,
  kPer9: 8.5, bbPer9: 3.2,
};

const PITCHER_HIGHLIGHT_METRICS = [
  { key: 'era',    label: 'ERA',   get: (m, f, s) => m.era,    dec: 2 },
  { key: 'fip',    label: 'FIP',   get: (m, f, s) => f.fip,    dec: 2 },
  { key: 'xfip',   label: 'xFIP',  get: (m, f, s) => f.xfip,   dec: 2 },
  { key: 'whip',   label: 'WHIP',  get: (m, f, s) => m.whip,   dec: 2 },
  { key: 'xwobaP', label: 'xwOBA', get: (m, f, s) => s.xwoba,  dec: 3 },
];

function getPitcherHighlights(mlb, fg, sc) {
  const results = [];
  for (const metric of PITCHER_HIGHLIGHT_METRICS) {
    const raw = metric.get(mlb || {}, fg || {}, sc || {});
    if (raw == null || raw === '') continue;
    const v = parseFloat(raw);
    if (isNaN(v)) continue;
    const cls = colorClass(metric.key, v);
    if (cls === 'stat-elite' || cls === 'stat-poor') {
      results.push({ ...metric, val: v, cls });
    }
  }
  return [
    ...results.filter(r => r.cls === 'stat-elite'),
    ...results.filter(r => r.cls === 'stat-poor'),
  ];
}

const HIGHLIGHT_METRICS = [
  { key: 'ops',      label: 'OPS',       get: (m, f, s) => m.ops,              dec: 3 },
  { key: 'wrcPlus',  label: 'wRC+',      get: (m, f, s) => f.wrcPlus,         dec: 0 },
  { key: 'xwoba',    label: 'xwOBA',     get: (m, f, s) => s.xwoba,           dec: 3 },
  { key: 'barrelPct',label: 'Barrel%',   get: (m, f, s) => s.barrelPct,       dec: 1 },
  { key: 'hardHit',  label: 'Hard Hit%', get: (m, f, s) => s.hardHit,         dec: 1 },
  { key: 'exitVelo', label: 'Exit Velo', get: (m, f, s) => s.exitVelo,        dec: 1 },
  { key: 'avg',      label: 'AVG',       get: (m, f, s) => m.avg,             dec: 3 },
  { key: 'slg',      label: 'SLG',       get: (m, f, s) => m.slg,             dec: 3 },
  { key: 'obp',      label: 'OBP',       get: (m, f, s) => m.obp,             dec: 3 },
  { key: 'bbPct',    label: 'BB%',       get: (m, f, s) => f.bbPct ?? m.bbPct,dec: 1 },
  { key: 'kPct',     label: 'K%',        get: (m, f, s) => f.kPct ?? m.kPct,  dec: 1 },
];

function getPlayerHighlights(mlb, fg, sc) {
  const results = [];
  for (const metric of HIGHLIGHT_METRICS) {
    const raw = metric.get(mlb || {}, fg || {}, sc || {});
    if (raw == null || raw === '') continue;
    const v = parseFloat(raw);
    if (isNaN(v)) continue;
    const cls = colorClass(metric.key, v);
    if (cls === 'stat-elite' || cls === 'stat-poor') {
      results.push({ ...metric, val: v, cls });
    }
  }
  // Sort: elite first, then poor
  return [
    ...results.filter(r => r.cls === 'stat-elite'),
    ...results.filter(r => r.cls === 'stat-poor'),
  ];
}

function fmtHL(val, dec) {
  if (dec === 0) return Math.round(val).toString();
  if (dec === 1) return val.toFixed(1);
  return val < 1 ? val.toFixed(3).replace(/^0/, '') : val.toFixed(3);
}

function PlayerHighlightsPanel({ mlb, fg, sc }) {
  const highlights = getPlayerHighlights(mlb, fg, sc);

  if (highlights.length === 0) {
    return (
      <div className="hl-panel">
        <div className="hl-empty">No extreme stats — all metrics near league average.</div>
      </div>
    );
  }

  return (
    <div className="hl-panel">
      <div className="hl-section">
        {highlights.map((h, i) => {
          const isElite = h.cls === 'stat-elite';
          const lgAvg = LEAGUE_AVG[h.key];
          const diff = h.val - lgAvg;
          const sign = diff > 0 ? '+' : '';
          return (
            <div key={i} className={`hl-row hl-row-${isElite ? 'elite' : 'poor'}`}>
              <span className={`hl-indicator ${isElite ? 'hl-up' : 'hl-down'}`}>{isElite ? '▲' : '▼'}</span>
              <span className="hl-metric-name">{h.label}</span>
              <span className={`hl-metric-val ${h.cls}`}>{fmtHL(h.val, h.dec)}</span>
              {lgAvg != null && (
                <span className="hl-vs-avg">
                  vs <span className="hl-avg-val">{fmtHL(lgAvg, h.dec)}</span> LgAvg
                  <span className={`hl-diff ${isElite ? 'hl-diff-good' : 'hl-diff-bad'}`}>
                    ({sign}{fmtHL(Math.abs(diff), h.dec)})
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Returns { up, down, total } counts for the toggle button label
function highlightCounts(mlb, fg, sc) {
  const hl = getPlayerHighlights(mlb, fg, sc);
  const up = hl.filter(h => h.cls === 'stat-elite').length;
  const down = hl.filter(h => h.cls === 'stat-poor').length;
  return { up, down, total: up + down };
}

export default function MatchupsPanel({ gameData, paLog, streaksById, arsenalById, arsenalSplitsById, milestonesById, zonesById, onPitcherChange, onPinchHit, subsLog, awayBatterIdx, homeBatterIdx, isTop }) {
  const [sortAway, setSortAway] = useState({ col: null, dir: 'desc' });
  const [sortHome, setSortHome] = useState({ col: null, dir: 'desc' });

  const {
    homeTeam, awayTeam, homeLineup, awayLineup, homePitcher, awayPitcher,
    statsById, bvpById,
    homeRoster, awayRoster,
    currentHomePitcher, currentAwayPitcher,
    sprayById,
  } = gameData;

  // zonesById may come from the prop or from gameData — prop takes precedence
  const resolvedZonesById = zonesById || gameData.zonesById || {};

  const curHome = currentHomePitcher || homePitcher;
  const curAway = currentAwayPitcher || awayPitcher;

  // Merge stats for a player: season stats + BvP
  const mergeStats = (player, opposingPitcherId) => {
    const s   = statsById[player.id]   || {};
    const bvp = bvpById[`${player.id}_${opposingPitcherId}`] || {};
    return {
      player,
      mlb:        s.mlb        || {},
      fg:         s.fangraphs  || {},
      sc:         s.statcast   || {},
      bvp,
    };
  };

  // Away batters face the HOME pitcher; home batters face the AWAY pitcher
  // slot = original batting order index, preserved through sorting so AT BAT / ON DECK follows the player
  const awayRows = awayLineup.map((b, slot) => ({ ...mergeStats(b, curHome?.id), slot }));
  const homeRows = homeLineup.map((b, slot) => ({ ...mergeStats(b, curAway?.id), slot }));

  const sortRows = (rows, { col, dir }) => {
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      const valA = getVal(a, col);
      const valB = getVal(b, col);
      const diff = (parseFloat(valA) || 0) - (parseFloat(valB) || 0);
      return dir === 'asc' ? diff : -diff;
    });
  };

  const getVal = (row, col) => {
    const { mlb, fg, sc, bvp, player } = row;
    const streak = (streaksById || {})[player?.id] || {};
    const map = {
      avg: mlb.avg, obp: mlb.obp, slg: mlb.slg, ops: mlb.ops,
      kPct: fg.kPct ?? mlb.kPct, bbPct: fg.bbPct ?? mlb.bbPct,
      woba: fg.woba, wrcPlus: fg.wrcPlus,
      xwoba: sc.xwoba,
      bvpAvg: bvp.avg, bvpPa: bvp.pa, bvpWoba: bvp.woba,
      bvpHr: bvp.hr, bvpBb: bvp.bb, bvpSo: bvp.so,
      l7avg:  streak.l7?.avg,
      l30avg: streak.l30?.avg,
    };
    return map[col] ?? 0;
  };

  const handleSort = (setSort) => (col) => {
    setSort(prev => ({
      col,
      dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  return (
    <div className="matchups-layout">
      {/* ── Color key ────────────────────────────────────────────────────── */}
      <div className="color-key">
        <span className="color-key-label">COLOR KEY:</span>
        <span className="stat-elite">■ Elite</span>
        <span className="stat-great">■ Above avg</span>
        <span className="stat-avg">■ Average</span>
        <span className="color-key-below">■ Below avg</span>
        <span className="stat-poor">■ Poor</span>
        <span className="color-key-divider">|</span>
        <span className="color-key-label">FORM:</span>
        <span className="dot-key dot-multi-key">◆ Multi-hit</span>
        <span className="dot-key dot-hit-key">● Hit</span>
        <span className="dot-key dot-out-key">○ 0-fer</span>
        <span className="dot-key dot-noab-key">· No AB</span>
      </div>

      {/* ── Starting Pitcher Capsules ────────────────────────────────────── */}
      <div className="pitcher-capsules">
        <PitcherCapsule
          team={awayTeam}
          label="Away SP"
          pitcher={awayPitcher}
          stats={statsById[awayPitcher?.id]}
          arsenal={(arsenalById || {})[awayPitcher?.id]}
          arsenalSplits={(arsenalSplitsById || {})[awayPitcher?.id]}
        />
        <PitcherCapsule
          team={homeTeam}
          label="Home SP"
          pitcher={homePitcher}
          stats={statsById[homePitcher?.id]}
          arsenal={(arsenalById || {})[homePitcher?.id]}
          arsenalSplits={(arsenalSplitsById || {})[homePitcher?.id]}
          flip
        />
      </div>

      {/* ── Two lineup matchup tables ────────────────────────────────────── */}
      <div className="matchup-tables">
        <LineupMatchupTable
          label={`${awayTeam?.abbreviation} Lineup`}
          team={awayTeam}
          rows={sortRows(awayRows, sortAway)}
          sortState={sortAway}
          onSort={handleSort(setSortAway)}
          currentPitcher={curHome}
          pitcherOptions={(homeRoster || []).filter(p => p.position?.type === 'Pitcher' || p.position?.code === '1')}
          onPitcherChange={onPitcherChange ? (p) => onPitcherChange('home', p) : null}
          paLog={paLog}
          streaksById={streaksById}
          arsenalById={arsenalById || {}}
          milestonesById={milestonesById || {}}
          sprayById={sprayById || {}}
          zonesById={resolvedZonesById}
          batterIdx={awayBatterIdx ?? 0}
          lineupLength={awayLineup.length}
          pinchHitRoster={(awayRoster || []).filter(p => !awayLineup.some(b => b?.id === p.id))}
          onPinchHit={onPinchHit ? (slot, p) => onPinchHit('away', slot, p) : null}
          alreadyPlayed={(subsLog || []).filter(s => s.side === 'away').map(s => s.outPlayer).filter(Boolean)}
        />
        <LineupMatchupTable
          label={`${homeTeam?.abbreviation} Lineup`}
          team={homeTeam}
          rows={sortRows(homeRows, sortHome)}
          sortState={sortHome}
          onSort={handleSort(setSortHome)}
          currentPitcher={curAway}
          pitcherOptions={(awayRoster || []).filter(p => p.position?.type === 'Pitcher' || p.position?.code === '1')}
          onPitcherChange={onPitcherChange ? (p) => onPitcherChange('away', p) : null}
          paLog={paLog}
          streaksById={streaksById}
          arsenalById={arsenalById || {}}
          milestonesById={milestonesById || {}}
          sprayById={sprayById || {}}
          zonesById={resolvedZonesById}
          batterIdx={homeBatterIdx ?? 0}
          lineupLength={homeLineup.length}
          pinchHitRoster={(homeRoster || []).filter(p => !homeLineup.some(b => b?.id === p.id))}
          onPinchHit={onPinchHit ? (slot, p) => onPinchHit('home', slot, p) : null}
          alreadyPlayed={(subsLog || []).filter(s => s.side === 'home').map(s => s.outPlayer).filter(Boolean)}
        />
      </div>

      {/* ── Substitutions log ────────────────────────────────────────────── */}
      {subsLog && subsLog.length > 0 && (
        <SubstitutionsLog subsLog={subsLog} />
      )}
    </div>
  );
}

// ── Substitutions log ─────────────────────────────────────────────────────
// Appears below the lineup tables whenever at least one sub has been made.
function SubstitutionsLog({ subsLog }) {
  return (
    <div className="subs-log">
      <div className="subs-log-header">
        <span className="label">SUBSTITUTIONS</span>
        <span className="subs-log-count">{subsLog.length}</span>
      </div>
      <div className="subs-log-entries">
        {subsLog.map((sub, i) => (
          <div key={i} className="subs-log-entry">
            <span className="subs-inning">{sub.isTop ? '▲' : '▼'}{sub.inning}</span>
            <span className="subs-batting-order">#{sub.slotIdx + 1}</span>
            <span className="subs-out">{sub.outPlayer?.name}</span>
            <span className="subs-arrow">→</span>
            <span className="subs-in">{sub.inPlayer?.name}</span>
            {sub.inPlayer?.position?.abbreviation && (
              <span className="subs-position">{sub.inPlayer.position.abbreviation}</span>
            )}
            <span className={`subs-side-badge subs-side-${sub.side}`}>{sub.side}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── BK-91: Pitch splits table (RHB vs LHB) ───────────────────────────────
function ArsenalSplitsTable({ splits, arsenal }) {
  // Build union of pitch types across both hands, ordered by overall usage
  const typeOrder = (arsenal || []).map(p => p.type);
  const allTypes = [
    ...typeOrder,
    ...[...(splits.L || []), ...(splits.R || [])].map(p => p.type).filter(t => !typeOrder.includes(t)),
  ];
  const lMap = Object.fromEntries((splits.L || []).map(p => [p.type, p]));
  const rMap = Object.fromEntries((splits.R || []).map(p => [p.type, p]));
  const rows = allTypes.filter(t => lMap[t] || rMap[t]);
  if (rows.length === 0) return null;

  return (
    <div className="arsenal-splits">
      <div className="arsenal-splits-header">
        <span className="arsenal-label">SPLITS</span>
        <span className="arsenal-splits-col-label">vs LHB</span>
        <span className="arsenal-splits-col-label">vs RHB</span>
      </div>
      {rows.map(type => {
        const l = lMap[type];
        const r = rMap[type];
        const name = (l || r)?.name || type;
        return (
          <div key={type} className="arsenal-splits-row">
            <span className="arsenal-splits-type">{name}</span>
            <span className="arsenal-splits-val">
              {l ? `${Math.round(l.pct)}%${l.whiffPct != null ? ` · ${Math.round(l.whiffPct)}%K` : ''}` : '—'}
            </span>
            <span className="arsenal-splits-val">
              {r ? `${Math.round(r.pct)}%${r.whiffPct != null ? ` · ${Math.round(r.whiffPct)}%K` : ''}` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Pitcher stat capsule ──────────────────────────────────────────────────
function PitcherCapsule({ team, label, pitcher, stats, arsenal, arsenalSplits, flip = false }) {
  const [hlOpen,      setHlOpen]      = React.useState(false);
  const [pitchOpen,   setPitchOpen]   = React.useState(true);

  if (!pitcher) return <div className="pitcher-capsule empty"><span className="dim">No pitcher selected</span></div>;

  const mlb = stats?.mlb   || {};
  const fg  = stats?.fangraphs || {};
  const sc  = stats?.statcast  || {};

  const statItems = [
    { label: 'ERA',   val: mlb.era,    stat: 'era',   dec: 2 },
    { label: 'WHIP',  val: mlb.whip,   stat: 'whip',  dec: 2 },
    { label: 'FIP',   val: fg.fip,     stat: 'fip',   dec: 2 },
    { label: 'xFIP',  val: fg.xfip,    stat: 'xfip',  dec: 2 },
    { label: 'K/9',   val: mlb.kPer9,  stat: null,    dec: 1 },
    { label: 'BB/9',  val: mlb.bbPer9, stat: null,    dec: 1 },
    { label: 'IP',    val: mlb.ip,     stat: null,    dec: 1 },
    { label: 'xwOBA', val: sc.xwoba,   stat: 'xwobaP', dec: 3 },
  ];

  return (
    <div className={`pitcher-capsule ${flip ? 'flip' : ''}`}>
      {/* Watermark logo — large, faded, anchored to corner */}
      {team?.id && (
        <img
          src={`https://www.mlbstatic.com/team-logos/${team.id}.svg`}
          alt=""
          className="pitcher-capsule-watermark"
          aria-hidden="true"
        />
      )}
      <div className="pitcher-capsule-header">
        <span className="label">{label} — {team?.abbreviation}</span>
        <div className="pitcher-name-row">
          <img
            className="player-headshot player-headshot--pitcher"
            src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${pitcher.id}/headshot/67/current`}
            alt={pitcher.name}
            loading="lazy"
          />
          <span className="pitcher-full-name">{pitcher.name}</span>
          {pitcher.throwHand && (
            <span className="hand-badge">{pitcher.throwHand}HP</span>
          )}
          {mlb.wins != null && (
            <span className="record">
              {mlb.wins}–{mlb.losses}
            </span>
          )}
        </div>
      </div>
      <div className="pitcher-stat-grid">
        {statItems.map(item => (
          <div key={item.label} className="pitcher-stat-item">
            <span className="label">{item.label}</span>
            <span className={`pitcher-stat-val ${item.stat ? colorClass(item.stat, item.val) : ''}`}>
              {item.val != null ? parseFloat(item.val).toFixed(item.dec) : '—'}
            </span>
          </div>
        ))}
      </div>

      {/* ── Pitch arsenal + splits (collapsible) ───────────────────────── */}
      {arsenal != null && (
        <div className="pitcher-arsenal">
          <button
            className="arsenal-label arsenal-toggle-btn"
            onClick={() => setPitchOpen(v => !v)}
            title={pitchOpen ? 'Collapse pitch types' : 'Expand pitch types'}
          >
            ARSENAL {pitchOpen ? '▾' : '▸'}
          </button>
          {pitchOpen && (
            <>
              {arsenal.length > 0 ? (
                <div className="arsenal-pitches">
                  {arsenal.map(p => (
                    <div key={p.type} className="arsenal-pitch">
                      <span className="arsenal-type">{p.name}</span>
                      <span className="arsenal-pct">{Math.round(p.pct)}%</span>
                      {p.velocity && <span className="arsenal-velo">{p.velocity}mph</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="dim" style={{ fontSize: 11 }}>No Statcast data</span>
              )}
              {arsenalSplits && (arsenalSplits.L?.length > 0 || arsenalSplits.R?.length > 0) && (
                <ArsenalSplitsTable splits={arsenalSplits} arsenal={arsenal} />
              )}
            </>
          )}
        </div>
      )}

      {/* ── BK-23: Pitcher highlights / lowlights ──────────────────────── */}
      {(() => {
        const hl = getPitcherHighlights(mlb, fg, sc);
        if (hl.length === 0) return null;
        const up = hl.filter(h => h.cls === 'stat-elite').length;
        const down = hl.filter(h => h.cls === 'stat-poor').length;
        return (
          <div className="pitcher-highlights">
            <button
              className={`hl-toggle-btn pitcher-hl-toggle${hlOpen ? ' active' : ''}`}
              onClick={() => setHlOpen(v => !v)}
              title="Strengths & weaknesses"
            >
              {up > 0 && <span className="hl-count-up">▲{up}</span>}
              {down > 0 && <span className="hl-count-down">▼{down}</span>}
            </button>
            {hlOpen && (
              <div className="hl-section" style={{ marginTop: 6 }}>
                {hl.map((h, i) => {
                  const isElite = h.cls === 'stat-elite';
                  const lgAvg = PITCHER_LEAGUE_AVG[h.key];
                  const diff = h.val - lgAvg;
                  const sign = diff > 0 ? '+' : '';
                  return (
                    <div key={i} className={`hl-row hl-row-${isElite ? 'elite' : 'poor'}`}>
                      <span className={`hl-indicator ${isElite ? 'hl-up' : 'hl-down'}`}>{isElite ? '▲' : '▼'}</span>
                      <span className="hl-metric-name">{h.label}</span>
                      <span className={`hl-metric-val ${h.cls}`}>{fmtHL(h.val, h.dec)}</span>
                      {lgAvg != null && (
                        <span className="hl-vs-avg">
                          vs <span className="hl-avg-val">{fmtHL(lgAvg, h.dec)}</span> LgAvg
                          <span className={`hl-diff ${isElite ? 'hl-diff-good' : 'hl-diff-bad'}`}>
                            ({sign}{fmtHL(Math.abs(diff), h.dec)})
                          </span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── One lineup's matchup table ─────────────────────────────────────────────
function LineupMatchupTable({ label, team, rows, sortState, onSort, currentPitcher, pitcherOptions, onPitcherChange, paLog, streaksById, arsenalById, milestonesById, sprayById, zonesById, batterIdx, lineupLength, pinchHitRoster, onPinchHit, alreadyPlayed }) {
  const [activePHSlot,        setActivePHSlot]        = useState(null);
  const [activeSpraySlot,     setActiveSpraySlot]     = useState(null);
  const [activeZoneSlot,      setActiveZoneSlot]      = useState(null);
  const [activeInsightSlot,   setActiveInsightSlot]   = useState(null);
  const [activeHighlightSlot, setActiveHighlightSlot] = useState(null);
  const [insightsCache,     setInsightsCache]     = useState({});  // {[playerId]: insight[] | {error}}
  const [loadingInsight,    setLoadingInsight]    = useState(null); // playerId currently loading

  const fetchInsights = async (player, mlb, fg, sc, bvp) => {
    if (loadingInsight === player.id) return;
    if (insightsCache[player.id]) return; // already cached
    setLoadingInsight(player.id);
    try {
      const result = await api.getInsights({
        batter:     { name: player.name, batSide: player.batSide },
        pitcher:    currentPitcher ? { name: currentPitcher.name, throwHand: currentPitcher.throwHand } : null,
        season:     { avg: mlb.avg, obp: mlb.obp, slg: mlb.slg, ops: mlb.ops, woba: fg.woba, wrcPlus: fg.wrcPlus, xwoba: sc.xwoba, kPct: fg.kPct ?? mlb.kPct, bbPct: fg.bbPct ?? mlb.bbPct },
        bvp:        bvp?.pa > 0 ? bvp : null,
        streaks:    (streaksById || {})[player.id] || null,
        arsenal:    (arsenalById || {})[currentPitcher?.id] || null,
        milestones: (milestonesById || {})[player.id] || null,
        todayLine:  getTodayLine(paLog, player.id) || null,
      });
      setInsightsCache(prev => ({ ...prev, [player.id]: result.insights || [] }));
    } catch (err) {
      setInsightsCache(prev => ({ ...prev, [player.id]: { error: err.message } }));
    } finally {
      setLoadingInsight(null);
    }
  };

  const S = (col, lbl, title) => (
    <SortTh
      col={col} label={lbl} title={title}
      sortCol={sortState.col} sortDir={sortState.dir}
      onSort={onSort}
    />
  );

  // ── BvP lineup totals (counting stats summed, rates computed from totals) ─
  const totals = (() => {
    let pa = 0, ab = 0, h = 0, hr = 0, bb = 0, so = 0, wWoba = 0;
    for (const { bvp } of rows) {
      if (!bvp || !bvp.pa) continue;
      pa   += parseFloat(bvp.pa)   || 0;
      ab   += parseFloat(bvp.ab)   || 0;
      h    += parseFloat(bvp.hits) || 0;
      hr   += parseFloat(bvp.hr)   || 0;
      bb   += parseFloat(bvp.bb)   || 0;
      so   += parseFloat(bvp.so)   || 0;
      wWoba += (parseFloat(bvp.woba) || 0) * (parseFloat(bvp.pa) || 0);
    }
    if (pa === 0) return null;
    const avg  = ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '—';
    const woba = pa > 0 ? (wWoba / pa).toFixed(3).replace(/^0/, '') : '—';
    return { pa, ab, h, avg, woba, hr, bb, so };
  })();

  return (
    <div className="matchup-table-wrap">
      <div className="section-header">
        {team?.id && (
          <img
            src={`https://www.mlbstatic.com/team-logos/${team.id}.svg`}
            alt={team.abbreviation}
            className="team-logo-md"
          />
        )}
        <span className="section-title">{label}</span>
        {currentPitcher?.throwHand && (
          <span className="hand-badge">{currentPitcher.throwHand}HP</span>
        )}
      </div>

      <div className="table-scroll">
        <table className="stat-table matchup-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>POS</th>
              <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>Batter</th>
              <th>B</th>
              {/* Hot/cold streak columns */}
              <th
                title="Last 5 games: gold=multi-hit, green=hit, red=0-fer"
                style={{ borderLeft: '2px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                FORM
              </th>
              {S('l7avg',  'L7',  'Batting average — last 7 games')}
              {S('l30avg', 'L30', 'Batting average — last 30 games')}
              {/* Season stats */}
              <th style={{ borderLeft: '2px solid var(--border)' }} />
              {S('avg',     'AVG',    'Season Batting Average')}
              {S('obp',     'OBP',    'Season On-Base %')}
              {S('slg',     'SLG',    'Season Slugging %')}
              {S('ops',     'OPS',    'Season OPS')}
              {S('woba',    'wOBA',   'Weighted On-Base Average')}
              {S('wrcPlus', 'wRC+',   'Weighted Runs Created+')}
              {S('xwoba',   'xwOBA',  'Expected wOBA (Statcast)')}
              {S('kPct',    'K%',     'Strikeout %')}
              {S('bbPct',   'BB%',    'Walk %')}
              {/* BvP */}
              <th className="bvp-divider" colSpan={8} style={{ textAlign: 'center', borderLeft: '2px solid var(--accent-dim)' }}>
                vs. {currentPitcher?.name?.split(' ').slice(1).join(' ') || currentPitcher?.name || 'Current P'} (Career)
              </th>
            </tr>
            <tr className="bvp-subhead">
              {/* spacer cols: #(1) pos(2) name(3) bats(4) form(5) l7(6) l30(7) sep(8) + 9 season stats = 17 */}
              <th colSpan={17} />
              <th style={{ borderLeft: '2px solid var(--accent-dim)' }}>PA</th>
              <th>AB</th>
              <th>H</th>
              {S('bvpAvg',  'AVG',  'Career BA vs. this pitcher')}
              {S('bvpWoba', 'wOBA', 'Career wOBA vs. this pitcher')}
              {S('bvpHr',   'HR',   'Home runs vs. this pitcher')}
              {S('bvpBb',   'BB',   'Walks vs. this pitcher')}
              {S('bvpSo',   'SO',   'Strikeouts vs. this pitcher')}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, mlb, fg, sc, bvp, slot }, i) => {
              const streak = (streaksById || {})[player.id] || {};
              const seasonAvg = parseFloat(mlb.avg) || null;

              // ── AT BAT / ON DECK position ──────────────────────────────
              const currentSlot = (batterIdx ?? 0) % (lineupLength || 9);
              const isAtBat     = slot === currentSlot;

              // Color L7/L30 relative to season average: hot = green, cold = red
              const streakColor = (val) => {
                if (val == null || seasonAvg == null) return '';
                const diff = val - seasonAvg;
                if (diff >=  0.030) return 'stat-great';
                if (diff <= -0.030) return 'stat-poor';
                return '';
              };

              return (
                <React.Fragment key={player.id}>
                <tr
                  className={isAtBat ? 'row-at-bat' : ''}
                >
                  <td className="pos-cell order-cell">
                    <div className="order-cell-inner">
                      {isAtBat
                        ? <span className="at-bat-badge">▶</span>
                        : <span className="order-num">{i + 1}</span>
                      }
                      {onPinchHit && !isAtBat && (
                        <button
                          className={`ph-btn${activePHSlot === slot ? ' ph-btn--active' : ''}`}
                          onClick={(e) => { e.stopPropagation(); setActivePHSlot(prev => prev === slot ? null : slot); }}
                          title={`Sub ${player.name}`}
                        >⇄</button>
                      )}
                    </div>
                  </td>
                  <td className="pos-cell">{player.position?.abbreviation || '—'}</td>
                  <td className="name-cell">
                    <div className="player-name-cell">
                      {/* MLB headshot CDN — d_ param provides generic silhouette fallback */}
                      <img
                        className="player-headshot"
                        src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${player.id}/headshot/67/current`}
                        alt={player.name}
                        loading="lazy"
                      />
                      <div className="player-name-info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ whiteSpace: 'nowrap' }}>{player.name}</span>
                          {player.jerseyNumber && (
                            <span className="jersey-number">#{player.jerseyNumber}</span>
                          )}
                          {/* Spray chart toggle */}
                          <button
                            className={`spray-toggle-btn${activeSpraySlot === slot ? ' active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveSpraySlot(prev => prev === slot ? null : slot);
                            }}
                            title="Toggle spray chart"
                          >⬡</button>
                          {/* Hot/cold zone map toggle */}
                          <button
                            className={`zone-toggle-btn${activeZoneSlot === slot ? ' active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveZoneSlot(prev => prev === slot ? null : slot);
                            }}
                            title="Toggle hot/cold zone map"
                          >▦</button>
                          {/* BK-30: Highlights toggle */}
                          {(() => {
                            const hl = highlightCounts(mlb, fg, sc);
                            if (hl.total === 0) return null;
                            return (
                              <button
                                className={`hl-toggle-btn${activeHighlightSlot === slot ? ' active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveHighlightSlot(prev => prev === slot ? null : slot);
                                }}
                                title="Strengths & weaknesses"
                              >
                                {hl.up > 0 && <span className="hl-count-up">▲{hl.up}</span>}
                                {hl.down > 0 && <span className="hl-count-down">▼{hl.down}</span>}
                              </button>
                            );
                          })()}
                          {/* AI broadcast insights toggle */}
                          <button
                            className={`ai-insight-btn${activeInsightSlot === slot ? ' active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              const opening = activeInsightSlot !== slot;
                              setActiveInsightSlot(prev => prev === slot ? null : slot);
                              if (opening) fetchInsights(player, mlb, fg, sc, bvp);
                            }}
                            title="AI broadcast insights"
                          >✦ AI</button>
                        </div>
                        <MilestoneBadges milestones={(milestonesById || {})[player.id]} />
                        <StreakBadges activeStreaks={streak.activeStreaks} />
                      </div>
                    </div>
                  </td>
                  <td className="pos-cell">{player.batSide || '?'}</td>

                  {/* FORM — last 5 games dot strip */}
                  <td style={{ borderLeft: '2px solid var(--border)', textAlign: 'center' }}>
                    <StreakDots recentGames={streak.recentGames} />
                  </td>

                  {/* L7 AVG */}
                  <td className={streakColor(streak.l7?.avg)}>
                    {streak.l7?.avg != null
                      ? streak.l7.avg.toFixed(3).replace(/^0/, '')
                      : <span className="dim">—</span>}
                  </td>

                  {/* L30 AVG */}
                  <td className={streakColor(streak.l30?.avg)}>
                    {streak.l30?.avg != null
                      ? streak.l30.avg.toFixed(3).replace(/^0/, '')
                      : <span className="dim">—</span>}
                  </td>

                  {/* Season separator */}
                  <td style={{ borderLeft: '2px solid var(--border)', padding: 0, width: 0 }} />

                  {/* Season */}
                  <StatCell stat="avg"     value={mlb.avg} />
                  <StatCell stat="obp"     value={mlb.obp} />
                  <StatCell stat="slg"     value={mlb.slg} />
                  <StatCell stat="ops"     value={mlb.ops} />
                  <StatCell stat="woba"    value={fg.woba} />
                  <StatCell stat="wrcPlus" value={fg.wrcPlus} decimals={0} />
                  <StatCell stat="xwoba"   value={sc.xwoba} />
                  <StatCell stat="kPct"    value={fg.kPct ?? mlb.kPct} decimals={1} />
                  <StatCell stat="bbPct"   value={fg.bbPct ?? mlb.bbPct} decimals={1} />

                  {/* BvP */}
                  <td style={{ borderLeft: '2px solid var(--accent-dim)', color: bvp.pa >= 5 ? 'var(--text-primary)' : 'var(--text-dim)' }}>
                    {bvp.pa ?? 0}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{bvp.pa > 0 ? (bvp.ab ?? 0) : <span className="dim">—</span>}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{bvp.pa > 0 ? (bvp.hits ?? 0) : <span className="dim">—</span>}</td>
                  <StatCell stat="avg"     value={bvp.pa >= 3 ? bvp.avg   : null} />
                  <StatCell stat="woba"    value={bvp.pa >= 3 ? bvp.woba  : null} />
                  <td>{bvp.hr ?? (bvp.pa > 0 ? 0 : <span className="dim">—</span>)}</td>
                  <td>{bvp.bb ?? (bvp.pa > 0 ? 0 : <span className="dim">—</span>)}</td>
                  <td>{bvp.so ?? (bvp.pa > 0 ? 0 : <span className="dim">—</span>)}</td>
                </tr>

                {/* ── Inline pinch-hit picker ───────────────────────────── */}
                {activePHSlot === slot && (
                  <tr className="ph-picker-row">
                    <td colSpan={99} className="ph-picker-cell">
                      <div className="ph-picker">
                        <span className="ph-picker-label">
                          ↳ Replace <strong>{player.name}</strong>:
                        </span>
                        {(() => {
                          const roster      = pinchHitRoster || [];
                          const isPitcher   = p => p.position?.type === 'Pitcher' || p.position?.code === '1' || p.position?.abbreviation === 'P';
                          // Dedupe already-played by ID (outPlayers from subsLog)
                          const played      = [...new Map((alreadyPlayed || []).filter(Boolean).map(p => [p.id, p])).values()];
                          const playedIds   = new Set(played.map(p => p.id));
                          const fielders    = roster.filter(p => !isPitcher(p) && !playedIds.has(p.id));
                          const pitchers    = roster.filter(p =>  isPitcher(p) && !playedIds.has(p.id));
                          const optionFmt   = p => `${p.jerseyNumber ? `#${p.jerseyNumber} ` : ''}${p.name} · ${p.position?.abbreviation || '?'}${p.batSide ? ` · ${p.batSide}` : ''}`;
                          return (
                            <select
                              autoFocus
                              className="ph-picker-select"
                              defaultValue=""
                              onChange={(e) => {
                                const newP = roster.find(r => String(r.id) === e.target.value);
                                if (newP) { onPinchHit(slot, newP); setActivePHSlot(null); }
                              }}
                            >
                              <option value="" disabled>Select substitute…</option>
                              {fielders.length > 0 && (
                                <optgroup label="Position Players">
                                  {fielders.map(p => (
                                    <option key={p.id} value={p.id}>{optionFmt(p)}</option>
                                  ))}
                                </optgroup>
                              )}
                              {pitchers.length > 0 && (
                                <optgroup label="Pitchers">
                                  {pitchers.map(p => (
                                    <option key={p.id} value={p.id}>{optionFmt(p)}</option>
                                  ))}
                                </optgroup>
                              )}
                              {played.length > 0 && (
                                <optgroup label="Already played — cannot return">
                                  {played.map(p => (
                                    <option key={p.id} value={p.id} style={{ color: '#6b7280' }}>{optionFmt(p)}</option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          );
                        })()}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setActivePHSlot(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {/* ── Spray chart expandable row ────────────────────────── */}
                {activeSpraySlot === slot && (
                  <tr className="spray-row">
                    <td colSpan={99} className="spray-row-cell">
                      <SprayChart
                        dots={(sprayById || {})[player.id] || []}
                        loading={!(player.id in (sprayById || {}))}
                        playerName={player.name}
                      />
                    </td>
                  </tr>
                )}

                {/* ── Hot/cold zone map expandable row ─────────────────── */}
                {activeZoneSlot === slot && (
                  <tr className="zone-row">
                    <td colSpan={99} className="zone-row-cell">
                      <ZoneMap
                        zones={(zonesById || {})[player.id] || []}
                        loading={!(player.id in (zonesById || {}))}
                        batSide={player.batSide === 'L' ? 'L' : 'R'}
                      />
                    </td>
                  </tr>
                )}

                {/* ── AI broadcast insights expandable row ──────────────── */}
                {activeInsightSlot === slot && (
                  <tr className="insights-row">
                    <td colSpan={99} className="insights-row-cell">
                      <InsightsPanel
                        insights={insightsCache[player.id]}
                        loading={loadingInsight === player.id}
                        batter={player}
                        pitcher={currentPitcher}
                      />
                    </td>
                  </tr>
                )}

                {/* ── BK-30: Player highlights expandable row ──────────── */}
                {activeHighlightSlot === slot && (
                  <tr className="highlights-row">
                    <td colSpan={99} className="highlights-row-cell">
                      <PlayerHighlightsPanel mlb={mlb} fg={fg} sc={sc} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="lineup-totals-row">
                <td colSpan={17} className="totals-label">LINEUP vs. PITCHER</td>
                {/* BvP totals */}
                <td className="totals-stat">{totals.pa}</td>
                <td className="totals-stat">{totals.ab}</td>
                <td className="totals-stat">{totals.h}</td>
                <td className="totals-stat">{totals.avg}</td>
                <td className="totals-stat">{totals.woba}</td>
                <td className="totals-stat">{totals.hr}</td>
                <td className="totals-stat">{totals.bb}</td>
                <td className="totals-stat">{totals.so}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="table-footnote">
        Season stats: {new Date().getFullYear() - 1} regular season. L7/L30 colored vs. season AVG. BvP: last 3 seasons (min 3 PA shown).
      </p>
    </div>
  );
}

// ── AI Broadcast Insights Panel ───────────────────────────────────────────
const CATEGORY_META = {
  bvp:       { label: 'BvP',       cls: 'bvp'       },
  streak:    { label: 'Form',      cls: 'streak'     },
  platoon:   { label: 'Platoon',   cls: 'platoon'    },
  arsenal:   { label: 'Arsenal',   cls: 'arsenal'    },
  milestone: { label: 'Milestone', cls: 'milestone'  },
  today:     { label: 'Today',     cls: 'today'      },
};

function InsightsPanel({ insights, loading, batter, pitcher }) {
  if (loading) {
    return (
      <div className="insights-panel">
        <div className="insights-loading">
          <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          <span>Generating insights for {batter?.name} vs {pitcher?.name}…</span>
        </div>
      </div>
    );
  }

  if (!insights) return null;

  if (insights.error) {
    return (
      <div className="insights-panel">
        <div className="insights-error">
          {insights.error.includes('not configured')
            ? '⚠ AI insights require an Anthropic API key — add ANTHROPIC_API_KEY to backend/.env'
            : `⚠ ${insights.error}`
          }
        </div>
      </div>
    );
  }

  if (!insights.length) {
    return (
      <div className="insights-panel">
        <div className="insights-error">Nothing notable found for this matchup.</div>
      </div>
    );
  }

  return (
    <div className="insights-panel">
      {insights.map(({ n, category, text }) => {
        const meta = CATEGORY_META[category] || { label: category, cls: 'bvp' };
        return (
          <div key={n} className="insight-item">
            <span className="insight-num">{n}.</span>
            <span className={`insight-badge insight-badge-${meta.cls}`}>{meta.label}</span>
            <span className="insight-text">{text}</span>
          </div>
        );
      })}
      <div className="insights-attribution">
        <span>✦ Generated by Claude · Based only on provided statistics</span>
      </div>
    </div>
  );
}
