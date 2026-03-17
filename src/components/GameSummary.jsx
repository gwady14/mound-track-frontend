/**
 * GameSummary.jsx
 *
 * On-screen game summary shown when the user clicks "End Game".
 * Displays the full box score in the app's dark theme.
 * The "Print PDF" button triggers window.print() which renders
 * the BoxScorePrint component via @media print CSS.
 */

import React from 'react';

// ── Shared data helpers (same logic as BoxScorePrint) ─────────────────────

function buildBatterLines(paLog, side) {
  const sidePAs = paLog.filter(p => p.side === side);
  const order = [];
  const seen  = new Set();
  for (const pa of sidePAs) {
    if (!seen.has(pa.batterId)) {
      order.push({ id: pa.batterId, name: pa.batterName });
      seen.add(pa.batterId);
    }
  }
  return order.map(({ id, name }) => {
    const pas = sidePAs.filter(p => p.batterId === id);
    return {
      name,
      ab:  pas.filter(p => p.isAB).length,
      h:   pas.filter(p => p.isHit).length,
      hr:  pas.filter(p => p.isHR).length,
      rbi: pas.reduce((s, p) => s + (p.rbi || 0), 0),
      bb:  pas.filter(p => p.isBB).length,
      k:   pas.filter(p => p.isK).length,
    };
  });
}

function buildPitcherLines(paLog, pitchingTeamSide) {
  const battingSide = pitchingTeamSide === 'home' ? 'away' : 'home';
  const pas = paLog.filter(p => p.side === battingSide);
  const order = [];
  const map   = {};
  for (const pa of pas) {
    const pid = pa.pitcherId ?? '__unknown__';
    if (!map[pid]) {
      map[pid] = { id: pid, name: pa.pitcherName || '—', entries: [] };
      order.push(pid);
    }
    map[pid].entries.push(pa);
  }
  return order.map(pid => {
    const { name, entries } = map[pid];
    const outs = entries.reduce((s, pa) => {
      if (['out', 'k', 'kl', 'sacbunt', 'sacfly', 'fc'].includes(pa.outcome)) return s + 1;
      if (pa.outcome === 'dp') return s + 2;
      return s;
    }, 0);
    return {
      name,
      ip:  `${Math.floor(outs / 3)}.${outs % 3}`,
      h:   entries.filter(p => p.isHit).length,
      r:   entries.reduce((s, p) => s + (p.runs || 0), 0),
      bb:  entries.filter(p => p.isBB || p.isHBP).length,
      k:   entries.filter(p => p.isK).length,
      hr:  entries.filter(p => p.isHR).length,
    };
  });
}

// ── Sub-components ────────────────────────────────────────────────────────

function SummaryBatterTable({ batters }) {
  if (batters.length === 0) {
    return <p className="gs-empty">No plate appearances recorded.</p>;
  }
  const tot = batters.reduce(
    (t, b) => ({ ab: t.ab+b.ab, h: t.h+b.h, hr: t.hr+b.hr, rbi: t.rbi+b.rbi, bb: t.bb+b.bb, k: t.k+b.k }),
    { ab:0, h:0, hr:0, rbi:0, bb:0, k:0 }
  );
  return (
    <table className="gs-table">
      <thead>
        <tr>
          <th className="gs-name-col">Player</th>
          <th>AB</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>K</th>
        </tr>
      </thead>
      <tbody>
        {batters.map((b, i) => (
          <tr key={i} className={b.h >= 2 ? 'gs-row-highlight' : ''}>
            <td className="gs-name-col">{b.name}</td>
            <td>{b.ab}</td>
            <td className={b.h > 0 ? 'gs-hits' : ''}>{b.h}</td>
            <td className={b.hr > 0 ? 'gs-hr' : 'gs-dim'}>{b.hr || '—'}</td>
            <td className={b.rbi > 0 ? 'gs-rbi' : 'gs-dim'}>{b.rbi || '—'}</td>
            <td className="gs-dim">{b.bb || '—'}</td>
            <td className="gs-dim">{b.k  || '—'}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="gs-totals">
          <td className="gs-name-col">Totals</td>
          <td>{tot.ab}</td>
          <td>{tot.h}</td>
          <td>{tot.hr  || '—'}</td>
          <td>{tot.rbi || '—'}</td>
          <td>{tot.bb  || '—'}</td>
          <td>{tot.k   || '—'}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function SummaryPitcherTable({ pitchers }) {
  if (pitchers.length === 0) {
    return <p className="gs-empty">No pitching data recorded.</p>;
  }
  return (
    <table className="gs-table">
      <thead>
        <tr>
          <th className="gs-name-col">Pitcher</th>
          <th>IP</th><th>H</th><th>R</th><th>BB</th><th>K</th><th>HR</th>
        </tr>
      </thead>
      <tbody>
        {pitchers.map((p, i) => (
          <tr key={i}>
            <td className="gs-name-col">
              {p.name}
              <span className="gs-role">{i === 0 ? ' SP' : ' RP'}</span>
            </td>
            <td>{p.ip}</td>
            <td>{p.h}</td>
            <td className={p.r > 0 ? 'gs-runs-allowed' : ''}>{p.r}</td>
            <td className="gs-dim">{p.bb || '—'}</td>
            <td>{p.k  || '—'}</td>
            <td className={p.hr > 0 ? 'gs-hr' : 'gs-dim'}>{p.hr || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function GameSummary({ gameData, gameState, onBack, onNewGame }) {
  const {
    homeTeam, awayTeam,
    homeLineup, awayLineup,
    milestonesById,
    streaksById,
  } = gameData;
  const { score, inningScores = [], paLog = [] } = gameState;

  const log = paLog || [];

  // Line score tallies
  const totalInnings = Math.max(9, inningScores.length);
  const awayH = log.filter(p => p.side === 'away' && p.isHit).length;
  const homeH = log.filter(p => p.side === 'home' && p.isHit).length;
  const awayE = log.filter(p => p.side === 'home' && p.outcome === 'error').length;
  const homeE = log.filter(p => p.side === 'away' && p.outcome === 'error').length;

  // Runs per inning derived from paLog — used as fallback when inningScores[i]
  // is null (e.g. game ended mid-inning or before Scorebook captured the total).
  const awayRunsByInning = {};
  const homeRunsByInning = {};
  for (const pa of log) {
    const idx = (pa.inning ?? 1) - 1;
    if (pa.side === 'away') awayRunsByInning[idx] = (awayRunsByInning[idx] || 0) + (pa.runs || 0);
    if (pa.side === 'home') homeRunsByInning[idx] = (homeRunsByInning[idx] || 0) + (pa.runs || 0);
  }
  // Which innings each team had at least one PA (0-based) — used to decide blank vs 0.
  const awayInnsBatted = new Set(Object.keys(awayRunsByInning).map(Number));
  const homeInnsBatted = new Set(Object.keys(homeRunsByInning).map(Number));

  const awayBatters      = buildBatterLines(log, 'away');
  const homeBatters      = buildBatterLines(log, 'home');
  const homePitcherLines = buildPitcherLines(log, 'home');
  const awayPitcherLines = buildPitcherLines(log, 'away');

  const allPlayers = [...(awayLineup || []), ...(homeLineup || [])].filter(Boolean);

  // Streaks continued — players with active streaks worth noting
  const STREAK_CFG = [
    { key: 'hr',     label: n => `${n}G HR streak`,     min: 2 },
    { key: 'hits',   label: n => `${n}G hit streak`,    min: 3 },
    { key: 'onBase', label: n => `${n}G on-base streak`,min: 5 },
    { key: 'rbi',    label: n => `${n}G RBI streak`,    min: 3 },
  ];
  const streakPlayers = allPlayers.flatMap(p => {
    const s = (streaksById || {})[p.id];
    if (!s?.activeStreaks) return [];
    const badge = STREAK_CFG.find(c => s.activeStreaks[c.key] >= c.min);
    if (!badge) return [];
    return [{ id: p.id, name: p.name, label: badge.label(s.activeStreaks[badge.key]) }];
  });

  // Milestones approaching
  const milestonePlayers = allPlayers.filter(p => {
    const m = (milestonesById || {})[p.id];
    return m && m.length > 0 && m[0].remaining <= 10;
  });

  const hasNotables = streakPlayers.length > 0 || milestonePlayers.length > 0;

  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="game-summary">

      {/* ── Top action bar ── */}
      <div className="gs-topbar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Back to Game
        </button>
        <span className="gs-topbar-title">Game Summary</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
            🖨 Print PDF
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onNewGame}>
            New Game
          </button>
        </div>
      </div>

      <div className="gs-body">

        {/* ── Score banner ── */}
        <div className="gs-score-banner">
          <div className="gs-score-team">
            {awayTeam?.id && (
              <img
                src={`https://www.mlbstatic.com/team-logos/${awayTeam.id}.svg`}
                alt={awayTeam.abbreviation}
                className="gs-team-logo"
              />
            )}
            <span className="gs-team-abbr">{awayTeam?.abbreviation}</span>
            <span className="gs-team-name">{awayTeam?.name}</span>
          </div>

          <div className="gs-score-center">
            <div className="gs-final-score">
              <span className={score.away > score.home ? 'gs-score-win' : 'gs-score-loss'}>{score.away}</span>
              <span className="gs-score-dash">–</span>
              <span className={score.home > score.away ? 'gs-score-win' : 'gs-score-loss'}>{score.home}</span>
            </div>
            <div className="gs-final-label">FINAL · {date}</div>
          </div>

          <div className="gs-score-team gs-score-team--right">
            <span className="gs-team-name">{homeTeam?.name}</span>
            <span className="gs-team-abbr">{homeTeam?.abbreviation}</span>
            {homeTeam?.id && (
              <img
                src={`https://www.mlbstatic.com/team-logos/${homeTeam.id}.svg`}
                alt={homeTeam.abbreviation}
                className="gs-team-logo"
              />
            )}
          </div>
        </div>

        {/* ── Line score ── */}
        <div className="card gs-section">
          <div className="gs-section-title">LINE SCORE</div>
          <div className="table-scroll">
            <table className="stat-table gs-linescore">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', minWidth: 44 }}> </th>
                  {Array.from({ length: totalInnings }, (_, i) => (
                    <th key={i} style={{ minWidth: 28 }}>{i + 1}</th>
                  ))}
                  <th className="gs-rhe-sep">R</th>
                  <th>H</th>
                  <th>E</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 700, textAlign: 'left' }}>{awayTeam?.abbreviation}</td>
                  {Array.from({ length: totalInnings }, (_, i) => (
                    <td key={i}>
                      {inningScores[i]?.away != null
                        ? inningScores[i].away
                        : awayInnsBatted.has(i) ? (awayRunsByInning[i] ?? 0) : ''}
                    </td>
                  ))}
                  <td className="gs-rhe-sep" style={{ fontWeight: 700 }}>{score.away}</td>
                  <td>{awayH}</td>
                  <td style={{ color: awayE > 0 ? 'var(--poor)' : undefined }}>{awayE}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, textAlign: 'left' }}>{homeTeam?.abbreviation}</td>
                  {Array.from({ length: totalInnings }, (_, i) => (
                    <td key={i}>
                      {inningScores[i]?.home != null
                        ? inningScores[i].home
                        : homeInnsBatted.has(i) ? (homeRunsByInning[i] ?? 0) : ''}
                    </td>
                  ))}
                  <td className="gs-rhe-sep" style={{ fontWeight: 700 }}>{score.home}</td>
                  <td>{homeH}</td>
                  <td style={{ color: homeE > 0 ? 'var(--poor)' : undefined }}>{homeE}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Batting ── */}
        <div className="gs-two-col">
          <div className="card gs-section">
            <div className="gs-section-title">BATTING — {awayTeam?.abbreviation}</div>
            <SummaryBatterTable batters={awayBatters} />
          </div>
          <div className="card gs-section">
            <div className="gs-section-title">BATTING — {homeTeam?.abbreviation}</div>
            <SummaryBatterTable batters={homeBatters} />
          </div>
        </div>

        {/* ── Pitching ── */}
        <div className="gs-two-col">
          <div className="card gs-section">
            <div className="gs-section-title">PITCHING — {awayTeam?.abbreviation}</div>
            <SummaryPitcherTable pitchers={awayPitcherLines} />
          </div>
          <div className="card gs-section">
            <div className="gs-section-title">PITCHING — {homeTeam?.abbreviation}</div>
            <SummaryPitcherTable pitchers={homePitcherLines} />
          </div>
        </div>

        {/* ── Notables ── */}
        {hasNotables && (
          <div className="card gs-section">
            <div className="gs-section-title">NOTABLES</div>
            {streakPlayers.length > 0 && (
              <div className="gs-notable-row">
                <span className="gs-notable-label">Streaks</span>
                <span className="gs-notable-items">
                  {streakPlayers.map((p, i) => (
                    <span key={i} className="gs-notable-chip gs-chip-streak">
                      {p.name}
                      <span className="gs-chip-meta">{p.label}</span>
                    </span>
                  ))}
                </span>
              </div>
            )}
            {milestonePlayers.map(p => {
              const ms = (milestonesById || {})[p.id];
              if (!ms || ms.length === 0) return null;
              return (
                <div key={p.id} className="gs-notable-row">
                  <span className="gs-notable-label">Milestone</span>
                  <span className="gs-notable-items">
                    <span className="gs-notable-chip gs-chip-milestone">
                      {p.name}
                      <span className="gs-chip-meta">
                        {ms[0].remaining} away from {ms[0].milestone.toLocaleString()} career {ms[0].stat}
                      </span>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Bottom print button ── */}
        <div className="gs-bottom-bar">
          <button className="btn btn-primary" onClick={() => window.print()}>
            🖨 Print / Save PDF
          </button>
          <button className="btn btn-ghost" onClick={onNewGame}>
            Start New Game
          </button>
        </div>

      </div>
    </div>
  );
}
