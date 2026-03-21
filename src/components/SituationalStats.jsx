/**
 * SituationalStats.jsx
 *
 * Dynamically surfaces the current batter's situational statistics based
 * on live game state. The relevant situations update in real time as the
 * announcer advances the scorebook.
 *
 * Situations shown depend on game state:
 *   - Always: vs L / vs R, overall season line
 *   - Runners on: RISP stats, runners on base
 *   - Bases loaded: Bases-loaded AVG/OPS
 *   - 2 outs: 2-out RBI, 2-out batting line
 *   - Close & late: late & close (inning 7+, within 2 runs)
 *   - Count splits: ahead / behind / even / full
 *
 * Data source: MLB Stats API /people/{id}/stats?stats=statSplits
 * (fetched per batter, cached 10 min)
 */

import React, { useState, useEffect, useRef } from 'react';
import { api, getSituationalCached } from '../api/index.js';

// Situation code → human-readable label
// These match the MLB Stats API statSplits codes
const SIT_LABELS = {
  // Runners on / RISP
  'RISP':        'RISP (2B or 3B)',
  'risp':        'RISP',
  'Bases Loaded':'Bases Loaded',
  'basesLoaded': 'Bases Loaded',
  'runnersOn':   'Runners On',
  'Runners On':  'Runners On',
  'noOuts':      '0 Outs',
  'oneOut':      '1 Out',
  'twoOut':      '2 Outs',
  'twoOutRBI':   '2-Out RBI Situations',
  // Close & late
  'closeAndLate':'Close & Late',
  'Close & Late':'Close & Late',
  'lateInning':  'Late & Close',
  // Count splits
  'aheadInCount':'Ahead in Count',
  'behindInCount':'Behind in Count',
  'evenCount':   'Even Count',
  'fullCount':   'Full Count',
  // Platoon
  'vsLeft':      'vs. LHP',
  'vsRight':     'vs. RHP',
  'vs Left':     'vs. LHP',
  'vs Right':    'vs. RHP',
  // Month / day
  'day':         'Day Games',
  'night':       'Night Games',
  'home':        'Home',
  'away':        'Away',
};

// Which situations to highlight based on game state
function getActiveSituations(gameState) {
  const { outs, bases, isTop, inning, score } = gameState;
  const [b1, b2, b3] = bases;
  const sits = [];

  // Always show platoon splits
  sits.push('vs_platoon');

  // RISP
  if (b2 || b3) sits.push('RISP');

  // Bases loaded
  if (b1 && b2 && b3) sits.push('Bases Loaded');

  // 2 outs
  if (outs === 2) sits.push('2 Outs');
  if (outs === 2 && (b1 || b2 || b3)) sits.push('2-Out RISP');

  // Runners on (any runner)
  if (b1 || b2 || b3) sits.push('Runners On');

  // Close & late: innings 7+ and within 2 runs
  if (inning >= 7) {
    const diff = Math.abs(score.home - score.away);
    if (diff <= 2) sits.push('Close & Late');
  }

  // Count splits are always relevant
  sits.push('Count Splits');

  return sits;
}

// ── Pick the most relevant splits for the exact current situation ──────────
function getSpotlightItems(gameState, splits) {
  if (!splits) return [];
  const { balls, strikes, outs, bases, inning, score } = gameState;
  const [b1, b2, b3] = bases;
  const items = [];

  // Count — most immediate pressure
  if (balls === 3 && strikes === 2) {
    const d = findSplit(splits, ['fc']);
    if (d) items.push({ label: 'Full Count (3-2)', data: d });
  } else if (strikes === 2) {
    const d = findSplit(splits, ['2s', 'bc']);
    if (d) items.push({ label: `2 Strikes (${balls}-2)`, data: d });
  } else if (balls === 3) {
    const d = findSplit(splits, ['ac']);
    if (d) items.push({ label: '3-Ball Count', data: d });
  } else if (balls > strikes) {
    const d = findSplit(splits, ['ac']);
    if (d) items.push({ label: `Ahead in Count (${balls}-${strikes})`, data: d });
  } else if (strikes > balls && strikes < 2) {
    const d = findSplit(splits, ['bc']);
    if (d) items.push({ label: `Behind in Count (${balls}-${strikes})`, data: d });
  } else if (balls === 0 && strikes === 0) {
    const d = findSplit(splits, ['fp']);
    if (d) items.push({ label: 'First Pitch', data: d });
  } else {
    const d = findSplit(splits, ['ec']);
    if (d) items.push({ label: `Even Count (${balls}-${strikes})`, data: d });
  }

  // Runners / outs — most specific situation
  if (b1 && b2 && b3) {
    const d = findSplit(splits, ['r123']);
    if (d) items.push({ label: 'Bases Loaded', data: d });
  } else if ((b2 || b3) && outs === 2) {
    const d = findSplit(splits, ['risp2']);
    if (d) items.push({ label: 'RISP — 2 Outs', data: d });
  } else if (b2 || b3) {
    const d = findSplit(splits, ['risp']);
    if (d) items.push({ label: 'Scoring Position', data: d });
  } else if (b1 || b2 || b3) {
    const d = findSplit(splits, ['ron']);
    if (d) items.push({ label: 'Runners On Base', data: d });
  } else if (outs === 2) {
    const d = findSplit(splits, ['o2']);
    if (d) items.push({ label: '2 Outs, Bases Empty', data: d });
  }

  // Close & late
  if (inning >= 7 && Math.abs(score.home - score.away) <= 2) {
    const d = findSplit(splits, ['lc']);
    if (d) items.push({ label: 'Late & Close', data: d });
  }

  return items.slice(0, 3);
}

export default function SituationalStats({ batter, gameState, statsById }) {
  const [splits,  setSplits]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const lastFetchedId = useRef(null);

  useEffect(() => {
    if (!batter?.id || batter.id === lastFetchedId.current) return;
    lastFetchedId.current = batter.id;
    setLoading(true);
    setError(null);

    getSituationalCached(batter.id)
      .then(setSplits)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [batter?.id]);

  const activeSituations = getActiveSituations(gameState);
  const seasonStats      = statsById?.[batter?.id];
  const spotlightItems   = splits ? getSpotlightItems(gameState, splits) : [];
  const splitsSeason     = splits?._season;

  return (
    <div className="situational-layout">
      {/* ── Color key ────────────────────────────────────────────────────── */}
      <div className="color-key">
        <span className="color-key-label">COLOR KEY:</span>
        <span className="stat-elite">■ Elite</span>
        <span className="stat-great">■ Above avg</span>
        <span className="stat-avg">■ Average</span>
        <span className="color-key-below">■ Below avg</span>
        <span className="stat-poor">■ Poor</span>
      </div>

      {/* ── Batter header ────────────────────────────────────────────────── */}
      <div className="card sit-header-card">
        {batter ? (
          <div className="sit-batter-info">
            <div className="sit-batter-name">{batter.name}</div>
            <div className="sit-batter-meta">
              {batter.batSide && (
                <span className="badge" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                  Bats {batter.batSide}
                </span>
              )}
              {splitsSeason && (
                <span className="badge" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                  {splitsSeason} Stats
                </span>
              )}
            </div>

            {/* Season stat line */}
            {seasonStats?.mlb && (
              <div className="season-line">
              {seasonStats._season && seasonStats._season < new Date().getFullYear() && (
                <span style={{ fontSize: 10, color: 'var(--text-dim)', alignSelf: 'center', marginRight: 4 }}>
                  {seasonStats._season}
                </span>
              )}
                <StatPill label="AVG"  value={seasonStats.mlb.avg}     fmt={(v) => v ? v.toString().replace(/^0/, '') : '—'} />
                <StatPill label="OBP"  value={seasonStats.mlb.obp}     fmt={(v) => v ? v.toString().replace(/^0/, '') : '—'} />
                <StatPill label="SLG"  value={seasonStats.mlb.slg}     fmt={(v) => v ? v.toString().replace(/^0/, '') : '—'} />
                <StatPill label="OPS"  value={seasonStats.mlb.ops}     fmt={(v) => v ? parseFloat(v).toFixed(3) : '—'} />
                <StatPill label="wRC+" value={seasonStats.fangraphs?.wrcPlus} fmt={(v) => v ? Math.round(v) : '—'} />
                <StatPill label="HR"   value={seasonStats.mlb.hr}      fmt={(v) => v ?? '—'} />
                <StatPill label="RBI"  value={seasonStats.mlb.rbi}     fmt={(v) => v ?? '—'} />
                <StatPill label="K%"   value={seasonStats.fangraphs?.kPct ?? seasonStats.mlb.kPct} fmt={(v) => v ? `${parseFloat(v).toFixed(1)}%` : '—'} />
                <StatPill label="BB%"  value={seasonStats.fangraphs?.bbPct ?? seasonStats.mlb.bbPct} fmt={(v) => v ? `${parseFloat(v).toFixed(1)}%` : '—'} />
              </div>
            )}
          </div>
        ) : (
          <div className="dim">No batter active. Use the Scorebook tab to track at-bats.</div>
        )}
      </div>

      {/* ── Situation Spotlight ──────────────────────────────────────────── */}
      {batter && splits && <SpotlightSection items={spotlightItems} />}

      {/* ── Active game state banner ─────────────────────────────────────── */}
      <div className="active-situations">
        <span className="label">Active Situations:</span>
        {activeSituations.map(s => (
          <span key={s} className="badge" style={{ background: 'var(--accent-glow)', color: 'var(--accent)', margin: '0 4px' }}>
            {s}
          </span>
        ))}
      </div>

      {/* ── Split tables ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="loading-state"><div className="spinner" /> Loading splits…</div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : splits ? (
        <div className="splits-grid">
          {/* Platoon splits */}
          <SplitCard
            title="Platoon Splits"
            highlighted={activeSituations.includes('vs_platoon')}
            rows={[
              { label: 'vs. LHP', data: findSplit(splits, ['vl', 'vsLeft', 'vs Left', 'vs_lhp', 'L']) },
              { label: 'vs. RHP', data: findSplit(splits, ['vr', 'vsRight', 'vs Right', 'vs_rhp', 'R']) },
            ]}
          />

          {/* RISP */}
          {(activeSituations.includes('RISP') || true) && (
            <SplitCard
              title="RISP"
              highlighted={activeSituations.includes('RISP')}
              rows={[
                { label: 'RISP', data: findSplit(splits, ['risp', 'RISP', 'Runners In Scoring Position']) },
                { label: 'Bases Loaded', data: findSplit(splits, ['r123', 'Bases Loaded', 'basesLoaded', 'bases_loaded']) },
                { label: 'Runners On', data: findSplit(splits, ['ron', 'Runners On', 'runnersOn', 'runners_on']) },
              ]}
            />
          )}

          {/* 2-Out situations */}
          <SplitCard
            title="2-Out Situations"
            highlighted={activeSituations.includes('2 Outs')}
            rows={[
              { label: '2 Outs', data: findSplit(splits, ['o2', 'twoOut', 'Two Outs', 'two_outs']) },
              { label: '2-Out RISP', data: findSplit(splits, ['risp2', 'twoOutRBI', '2-Out RISP', 'two_out_risp']) },
              { label: '0 Outs', data: findSplit(splits, ['o0', 'noOuts', 'No Outs', 'zero_outs']) },
              { label: '1 Out',  data: findSplit(splits, ['o1', 'oneOut', 'One Out', 'one_out']) },
            ]}
          />

          {/* Close & Late */}
          <SplitCard
            title="Close & Late"
            highlighted={activeSituations.includes('Close & Late')}
            rows={[
              { label: 'Late / Close', data: findSplit(splits, ['lc', 'closeAndLate', 'Close & Late', 'lateAndClose', 'lateInning']) },
            ]}
          />

          {/* Count splits */}
          <SplitCard
            title="Count Splits"
            highlighted
            rows={[
              { label: 'Ahead',      data: findSplit(splits, ['ac', 'aheadInCount', 'Ahead In Count']) },
              { label: 'Behind',     data: findSplit(splits, ['bc', 'behindInCount', 'Behind In Count']) },
              { label: 'Even',       data: findSplit(splits, ['ec', 'evenCount', 'Even Count']) },
              { label: 'Full Count', data: findSplit(splits, ['fc', 'fullCount', 'Full Count']) },
              { label: 'First Pitch',data: findSplit(splits, ['fp', 'firstPitchStrike', 'First Pitch Strike', 'First Pitch']) },
            ]}
          />

          {/* Home/Away */}
          <SplitCard
            title="Home / Away"
            highlighted={false}
            rows={[
              { label: 'Home', data: findSplit(splits, ['h', 'home', 'Home']) },
              { label: 'Away', data: findSplit(splits, ['a', 'away', 'Away', 'Road']) },
            ]}
          />

          {/* All splits — raw dump for reference */}
          <AllSplitsCard splits={splits} />
        </div>
      ) : batter ? (
        <div className="loading-state">Select a batter in the Scorebook to see situational stats.</div>
      ) : null}
    </div>
  );
}

// ── Spotlight section — prominent display of exact-situation splits ────────
function SpotlightSection({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="spotlight-section">
      <div className="spotlight-header">
        <span className="spotlight-label">Now Batting</span>
        <div className="spotlight-tags">
          {items.map(item => (
            <span key={item.label} className="spotlight-tag">{item.label}</span>
          ))}
        </div>
      </div>
      <div className="spotlight-cards">
        {items.map(({ label, data }) => (
          <div key={label} className="spotlight-card">
            <div className="spotlight-card-title">{label}</div>
            <div className="spotlight-stats">
              {[
                { key: 'avg', val: data.avg,  fmt: fmtRate },
                { key: 'obp', val: data.obp,  fmt: fmtRate },
                { key: 'slg', val: data.slg,  fmt: fmtRate },
                { key: 'ops', val: data.ops,  fmt: fmtOps  },
              ].map(({ key, val, fmt }) => (
                <div key={key} className="spotlight-stat">
                  <span className="spotlight-stat-label">{key.toUpperCase()}</span>
                  <span className={`spotlight-stat-val ${colorClass(key, val)}`}>{fmt(val)}</span>
                </div>
              ))}
              <div className="spotlight-stat">
                <span className="spotlight-stat-label">PA</span>
                <span className="spotlight-stat-val" style={{ color: 'var(--text-secondary)' }}>
                  {data.plateAppearances ?? data.atBats ?? '—'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat color thresholds (mirrors MatchupsPanel) ─────────────────────────
const THRESHOLDS = {
  avg: { dir: 'high', elite: .320, great: .290, avg: .260, below: .230 },
  obp: { dir: 'high', elite: .400, great: .370, avg: .330, below: .300 },
  slg: { dir: 'high', elite: .550, great: .480, avg: .420, below: .370 },
  ops: { dir: 'high', elite: .950, great: .850, avg: .750, below: .680 },
};

function colorClass(stat, value) {
  if (value == null || value === '') return '';
  const v = parseFloat(value);
  if (isNaN(v)) return '';
  const t = THRESHOLDS[stat];
  if (!t) return '';
  if (t.dir === 'high') {
    if (v >= t.elite) return 'stat-elite';
    if (v >= t.great) return 'stat-great';
    if (v >= t.avg)   return 'stat-avg';
    if (v >= t.below) return 'stat-below';
    return 'stat-poor';
  }
}

// ── Find a split from the returned map by trying multiple possible codes ──
function findSplit(splits, codes) {
  for (const code of codes) {
    if (splits[code]) return splits[code].stat;
  }
  // Try case-insensitive match
  const lower = codes.map(c => c.toLowerCase());
  for (const [key, val] of Object.entries(splits)) {
    if (lower.includes(key.toLowerCase())) return val.stat;
    if (val.description && lower.includes(val.description.toLowerCase())) return val.stat;
  }
  return null;
}

// ── Stat pill for the season line ─────────────────────────────────────────
function StatPill({ label, value, fmt: fmtFn }) {
  const displayed = fmtFn ? fmtFn(value) : (value ?? '—');
  return (
    <div className="stat-pill">
      <span className="stat-pill-label">{label}</span>
      <span className="stat-pill-val">{displayed}</span>
    </div>
  );
}

// ── One situational split card ─────────────────────────────────────────────
function SplitCard({ title, highlighted, rows }) {
  const validRows = rows.filter(r => r.data);
  if (validRows.length === 0) return null;

  return (
    <div className={`card split-card ${highlighted ? 'highlighted' : ''}`}>
      <div className="section-title" style={{ marginBottom: 8 }}>{title}</div>
      <table className="stat-table split-stat-table" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Situation</th>
            <th style={{ textAlign: 'right' }}>PA</th>
            <th style={{ textAlign: 'right' }}>AVG</th>
            <th style={{ textAlign: 'right' }}>OBP</th>
            <th style={{ textAlign: 'right' }}>SLG</th>
          </tr>
        </thead>
        <tbody>
          {validRows.map(({ label, data }) => {
            if (!data) return null;
            return (
              <tr key={label}>
                <td className="name-cell" style={{ fontFamily: 'var(--font-sans)' }}>{label}</td>
                <td style={{ textAlign: 'right' }}>{data.plateAppearances ?? data.atBats ?? '—'}</td>
                <td className={colorClass('avg', data.avg)} style={{ textAlign: 'right' }}>{fmtRate(data.avg)}</td>
                <td className={colorClass('obp', data.obp)} style={{ textAlign: 'right' }}>{fmtRate(data.obp)}</td>
                <td className={colorClass('slg', data.slg)} style={{ textAlign: 'right' }}>{fmtRate(data.slg)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── All Splits raw reference card ─────────────────────────────────────────
function AllSplitsCard({ splits }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(splits);
  if (entries.length === 0) return null;

  return (
    <div className="card split-card" style={{ gridColumn: '1 / -1' }}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setExpanded(v => !v)}
        style={{ marginBottom: 8 }}
      >
        {expanded ? 'Hide' : 'Show'} All Splits ({entries.length})
      </button>
      {expanded && (
        <div className="table-scroll">
          <table className="stat-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>Situation</th>
                <th>PA</th>
                <th>AVG</th>
                <th>OBP</th>
                <th>SLG</th>
                <th>OPS</th>
                <th>HR</th>
                <th>RBI</th>
                <th>SO</th>
                <th>BB</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([code, { description, stat }]) => {
                if (!stat) return null;
                return (
                  <tr key={code}>
                    <td className="name-cell" style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}>
                      {description || code}
                    </td>
                    <td>{stat.plateAppearances ?? stat.atBats ?? '—'}</td>
                    <td className={colorClass('avg', stat.avg)}>{fmtRate(stat.avg)}</td>
                    <td className={colorClass('obp', stat.obp)}>{fmtRate(stat.obp)}</td>
                    <td className={colorClass('slg', stat.slg)}>{fmtRate(stat.slg)}</td>
                    <td className={colorClass('ops', stat.ops)}>{fmtOps(stat.ops)}</td>
                    <td>{stat.homeRuns ?? '—'}</td>
                    <td>{stat.rbi ?? '—'}</td>
                    <td>{stat.strikeOuts ?? '—'}</td>
                    <td>{stat.baseOnBalls ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Formatting helpers ─────────────────────────────────────────────────────
function fmtRate(v) {
  if (v == null) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toFixed(3).replace(/^0/, '');
}

function fmtOps(v) {
  if (v == null) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n >= 1 ? n.toFixed(3) : n.toFixed(3).replace(/^0/, '');
}
