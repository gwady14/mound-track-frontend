/**
 * BullpenPanel.jsx
 *
 * Shows both teams' bullpens with:
 *   - Availability status (available / limited / unavailable) based on
 *     pitches thrown in the last 3 calendar days
 *   - Season stats: ERA, FIP, xFIP, WHIP, K/9, BB/9, IP, SV, HLD
 *   - Days since last appearance
 *   - Platoon splits indicator (LHP / RHP)
 *
 * Data is fetched fresh on mount (short cache TTL in backend).
 */

import React, { useState, useEffect } from 'react';
import { api } from '../api/index.js';

// ── Reuse colorClass from MatchupsPanel inline ────────────────────────────
function colorClass(stat, value) {
  if (value == null) return '';
  const v = parseFloat(value);
  if (isNaN(v)) return '';
  const T = {
    era:  { dir: 'low',  elite: 2.50, great: 3.25, avg: 4.25, below: 5.00 },
    fip:  { dir: 'low',  elite: 2.75, great: 3.25, avg: 4.00, below: 5.00 },
    xfip: { dir: 'low',  elite: 2.75, great: 3.25, avg: 4.00, below: 5.00 },
    whip: { dir: 'low',  elite: 0.95, great: 1.10, avg: 1.30, below: 1.50 },
    kPer9:{ dir: 'high', elite: 12,   great: 10,   avg: 8.5,  below: 7    },
    bbPer9:{ dir: 'low', elite: 2.0,  great: 2.8,  avg: 3.5,  below: 4.5  },
  };
  const t = T[stat];
  if (!t) return '';
  if (t.dir === 'high') {
    if (v >= t.elite) return 'stat-elite';
    if (v >= t.great) return 'stat-great';
    if (v >= t.avg)   return 'stat-avg';
    if (v >= t.below) return 'stat-below';
    return 'stat-poor';
  } else {
    if (v <= t.elite) return 'stat-elite';
    if (v <= t.great) return 'stat-great';
    if (v <= t.avg)   return 'stat-avg';
    if (v <= t.below) return 'stat-below';
    return 'stat-poor';
  }
}

function fmt(v, dec = 2) {
  if (v == null) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toFixed(dec);
}

function StatTd({ stat, value, decimals = 2 }) {
  return <td className={colorClass(stat, value)}>{fmt(value, decimals)}</td>;
}

// ── Pitcher highlights / lowlights ──────────────────────────────────────────
const PITCHER_LEAGUE_AVG = {
  era: 4.25, fip: 4.00, xfip: 4.00, whip: 1.30, kPer9: 8.5, bbPer9: 3.2,
};

const BP_HIGHLIGHT_METRICS = [
  { key: 'era',    label: 'ERA',  dec: 2 },
  { key: 'fip',    label: 'FIP',  dec: 2 },
  { key: 'xfip',   label: 'xFIP', dec: 2 },
  { key: 'whip',   label: 'WHIP', dec: 2 },
  { key: 'kPer9',  label: 'K/9',  dec: 1 },
  { key: 'bbPer9', label: 'BB/9', dec: 1 },
];

function getBPHighlights(p) {
  const results = [];
  for (const metric of BP_HIGHLIGHT_METRICS) {
    const raw = p[metric.key];
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

function fmtHL(val, dec) {
  if (dec === 0) return Math.round(val).toString();
  if (dec === 1) return val.toFixed(1);
  return val < 1 ? val.toFixed(3).replace(/^0/, '') : val.toFixed(3);
}

// ── Role inference ────────────────────────────────────────────────────────
const ROLE_ORDER = ['Starter', 'Long Reliever', 'Middle Reliever', 'Setup Man', 'Closer', 'Unknown'];

const ROLE_META = {
  'Starter':         { badge: 'Starting Pitcher',       color: '#60a5fa' },
  'Closer':          { badge: '9th Inn · High Leverage', color: '#f87171' },
  'Setup Man':       { badge: '7th–8th · High Leverage', color: '#fb923c' },
  'Long Reliever':   { badge: 'Multi-Inning Relief',     color: '#a78bfa' },
  'Middle Reliever': { badge: '5th–7th Inning',          color: '#94a3b8' },
  'Unknown':         { badge: 'Role Unknown',            color: '#4b5563' },
};

function inferRole(p) {
  const saves   = parseFloat(p.saves)        || 0;
  const holds   = parseFloat(p.holds)        || 0;
  const ip      = parseFloat(p.ip)           || 0;
  const gp      = parseFloat(p.gamesPitched) || 0;
  const gs      = parseFloat(p.gamesStarted) || 0;

  // Starter: position = SP, or has starts, or high IP with no saves/holds
  if (p.position === 'SP' || gs >= 3 || (ip >= 40 && saves === 0 && holds === 0)) return 'Starter';

  // Closer: 5+ saves
  if (saves >= 5) return 'Closer';

  // Setup Man: 5+ holds (high-leverage late innings)
  if (holds >= 5) return 'Setup Man';

  // Long Reliever: averages 1.5+ IP per appearance, or 1-2 starts mixed in
  const ipPerApp = gp > 0 ? ip / gp : 0;
  if (ipPerApp >= 1.5 || (gs >= 1 && gs < 3)) return 'Long Reliever';

  // Closers/setup with fewer saves/holds still lean that direction
  if (saves >= 1) return 'Closer';
  if (holds >= 1) return 'Setup Man';

  return 'Middle Reliever';
}

export default function BullpenPanel({ homeTeam, awayTeam }) {
  const [homeData, setHomeData] = useState(null);
  const [awayData, setAwayData] = useState(null);
  const [loading,  setLoading]  = useState({ home: true, away: true });
  const [errors,   setErrors]   = useState({ home: null, away: null });

  useEffect(() => {
    if (!awayTeam?.id) return;
    const season = awayTeam.sportId === 51 ? 2026 : undefined;
    api.getBullpen(awayTeam.id, season)
      .then(d => setAwayData(d))
      .catch(e => setErrors(prev => ({ ...prev, away: e.message })))
      .finally(() => setLoading(prev => ({ ...prev, away: false })));
  }, [awayTeam?.id]);

  useEffect(() => {
    if (!homeTeam?.id) return;
    const season = homeTeam.sportId === 51 ? 2026 : undefined;
    api.getBullpen(homeTeam.id, season)
      .then(d => setHomeData(d))
      .catch(e => setErrors(prev => ({ ...prev, home: e.message })))
      .finally(() => setLoading(prev => ({ ...prev, home: false })));
  }, [homeTeam?.id]);

  return (
    <div className="bullpen-layout">
      <BullpenTeamTable
        label="Away Bullpen"
        team={awayTeam}
        data={awayData}
        loading={loading.away}
        error={errors.away}
      />
      <BullpenTeamTable
        label="Home Bullpen"
        team={homeTeam}
        data={homeData}
        loading={loading.home}
        error={errors.home}
      />
    </div>
  );
}

// ── One team's bullpen table ──────────────────────────────────────────────
function BullpenTeamTable({ label, team, data, loading, error }) {
  const [sort, setSort] = useState({ col: 'availability', dir: 'asc' });
  const [hlPitcher, setHlPitcher] = useState(null); // id of pitcher with expanded highlights

  const handleSort = (col) => {
    setSort(prev => ({
      col,
      dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortFn = (a, b) => {
    const availOrder = { available: 0, limited: 1, unavailable: 2 };
    if (sort.col === 'availability') {
      const diff = availOrder[a.availability] - availOrder[b.availability];
      return sort.dir === 'asc' ? diff : -diff;
    }
    const va = parseFloat(a[sort.col]) || (sort.dir === 'asc' ? Infinity : -Infinity);
    const vb = parseFloat(b[sort.col]) || (sort.dir === 'asc' ? Infinity : -Infinity);
    return sort.dir === 'asc' ? va - vb : vb - va;
  };

  // Group by inferred role, sort within each group
  const grouped = {};
  (data || []).forEach(p => {
    const role = inferRole(p);
    if (!grouped[role]) grouped[role] = [];
    grouped[role].push(p);
  });
  ROLE_ORDER.forEach(role => { if (grouped[role]) grouped[role].sort(sortFn); });
  const totalCount = (data || []).length;

  const Th = ({ col, label: lbl, title }) => (
    <th
      onClick={() => handleSort(col)}
      className={sort.col === col ? (sort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc') : ''}
      title={title}
      style={{ cursor: 'pointer' }}
    >
      {lbl}
    </th>
  );

  // Summary counts
  const counts = (data || []).reduce((acc, p) => {
    acc[p.availability] = (acc[p.availability] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="bullpen-team-section">
      <div className="section-header">
        <span className="section-title">
          {label} — {team?.name}
        </span>
        <div className="availability-summary">
          <span className="badge badge-available">✓ {counts.available || 0}</span>
          <span className="badge badge-limited">~ {counts.limited || 0}</span>
          <span className="badge badge-unavailable">✗ {counts.unavailable || 0}</span>
        </div>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /> Loading bullpen…</div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : (
        <div className="table-scroll">
          <table className="stat-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                <th style={{ minWidth: 150, textAlign: 'left' }}>Name</th>
                <th>T</th>
                <Th col="availability"    label="Avail"    title="Availability based on recent usage" />
                <Th col="fatigueBand"     label="Fatigue"  title="Rolling 7-day workload fatigue band" />
                <Th col="rolling7dPitches" label="Ptch7d"  title="Pitches thrown in last 7 days" />
                <th title="Days since last appearance">Last</th>
                <Th col="era"    label="ERA"   title="Earned Run Average" />
                <Th col="fip"    label="FIP"   title="Fielding Independent Pitching" />
                <Th col="xfip"   label="xFIP"  title="Expected FIP" />
                <Th col="whip"   label="WHIP"  title="Walks + Hits per Inning Pitched" />
                <Th col="kPer9"  label="K/9"   title="Strikeouts per 9 innings" />
                <Th col="bbPer9" label="BB/9"  title="Walks per 9 innings" />
                <Th col="ip"     label="IP"    title="Innings Pitched" />
                <Th col="saves"  label="SV"    title="Saves" />
                <Th col="holds"  label="HLD"   title="Holds" />
              </tr>
            </thead>
            <tbody>
              {ROLE_ORDER.filter(role => grouped[role]?.length).flatMap(role => [
                /* Role section header */
                <tr key={`hdr-${role}`} className="role-header-row">
                  <td colSpan={16}>
                    <span className="role-label">
                      {ROLE_META[role]?.badge || role}
                    </span>
                  </td>
                </tr>,
                /* Pitcher rows in this group */
                ...grouped[role].flatMap(p => {
                  const hl = getBPHighlights(p);
                  const upCount = hl.filter(h => h.cls === 'stat-elite').length;
                  const downCount = hl.filter(h => h.cls === 'stat-poor').length;
                  const hlOpen = hlPitcher === p.id;
                  return [
                  <tr key={p.id} className={`row-${p.availability}`}>
                    <td className="pos-cell">{p.jerseyNumber || '—'}</td>
                    <td className="name-cell">
                      <span className="bp-name-row">
                        {p.name}
                        {hl.length > 0 && (
                          <button
                            className={`hl-toggle-btn bp-hl-toggle${hlOpen ? ' active' : ''}`}
                            onClick={() => setHlPitcher(hlOpen ? null : p.id)}
                            title="Strengths & weaknesses"
                          >
                            {upCount > 0 && <span className="hl-count-up">▲{upCount}</span>}
                            {downCount > 0 && <span className="hl-count-down">▼{downCount}</span>}
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="pos-cell throw-arm" data-arm={p.throwHand?.toUpperCase()}>
                      {p.throwHand ? p.throwHand.toUpperCase().charAt(0) : '—'}
                    </td>

                    {/* Availability badge */}
                    <td>
                      <span className={`badge badge-${p.availability}`}>
                        {p.availability === 'available'   ? 'OK'  :
                         p.availability === 'limited'     ? 'LTD' : 'OUT'}
                      </span>
                    </td>

                    {/* Fatigue band */}
                    <td>
                      {p.fatigueBand ? (() => {
                        const LABEL = { fresh: '🟢 Fresh', normal: '🟡 Normal', elevated: '🟠 Elevated', high: '🔴 High' };
                        const COLOR = { fresh: 'var(--great)', normal: 'var(--below)', elevated: 'var(--poor)', high: '#f87171' };
                        return (
                          <span style={{ color: COLOR[p.fatigueBand], fontWeight: 700, fontSize: 11 }}>
                            {LABEL[p.fatigueBand]}
                          </span>
                        );
                      })() : '—'}
                    </td>

                    {/* 7-day pitches */}
                    <td style={{
                      color: (p.rolling7dPitches || 0) > 90 ? 'var(--poor)' :
                             (p.rolling7dPitches || 0) > 60 ? 'var(--below)' : 'var(--text-primary)',
                      fontWeight: (p.rolling7dPitches || 0) > 0 ? 600 : 400,
                    }}>
                      {p.rolling7dPitches || 0}
                    </td>

                    {/* Days since last outing */}
                    <td className="dim">
                      {p.daysSinceAppearance != null
                        ? `${p.daysSinceAppearance}d`
                        : p.lastAppDate
                          ? new Date(p.lastAppDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
                          : '—'}
                    </td>

                    <StatTd stat="era"    value={p.era}    decimals={2} />
                    <StatTd stat="fip"    value={p.fip}    decimals={2} />
                    <StatTd stat="xfip"   value={p.xfip}   decimals={2} />
                    <StatTd stat="whip"   value={p.whip}   decimals={2} />
                    <StatTd stat="kPer9"  value={p.kPer9}  decimals={1} />
                    <StatTd stat="bbPer9" value={p.bbPer9} decimals={1} />
                    <td>{p.ip || '—'}</td>
                    <td>{p.saves ?? '—'}</td>
                    <td>{p.holds ?? '—'}</td>
                  </tr>,
                  hlOpen && (
                    <tr key={`hl-${p.id}`} className="bp-hl-row">
                      <td colSpan={16}>
                        <div className="bp-hl-panel">
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
                      </td>
                    </tr>
                  ),
                  ];
                }),
              ])}
              {totalCount === 0 && (
                <tr>
                  <td colSpan={16} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 20 }}>
                    No bullpen data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="table-footnote">
        Avail: <b>OK</b> = &lt;20 pitches in 3d · <b>LTD</b> = 20–44 · <b>OUT</b> = 45+. &nbsp;
        Fatigue: 🟢 Fresh ≤30 ptch/7d · 🟡 Normal 31–60 · 🟠 Elevated 61–90 · 🔴 High 90+.
        FIP/xFIP from FanGraphs when available.
      </p>
    </div>
  );
}
