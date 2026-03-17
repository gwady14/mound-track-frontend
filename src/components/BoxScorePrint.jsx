/**
 * BoxScorePrint.jsx
 *
 * Print-only game summary. Always in the DOM but hidden (display:none).
 * Under @media print, the app UI hides and this component is revealed.
 * Triggered by the "End Game" button in the header via window.print().
 *
 * Sections:
 *   1. Header — team names, final score, date
 *   2. Line score — inning-by-inning R/H/E
 *   3. Batting lines — AB/H/HR/RBI/BB/K per batter, per team (side-by-side)
 *   4. Pitching lines — IP/H/R/BB/K/HR per pitcher, per team (side-by-side)
 *      Pitchers grouped by first appearance in paLog (SP first, then RPs)
 *   5. Notables — home runs, multi-hit games, approaching milestones
 *
 * No extra API calls. All data comes from gameData + gameState already in memory.
 */

import React from 'react';

// ── Data helpers ──────────────────────────────────────────────────────────

// Build batter stat lines for one side from paLog.
// Returns [{name, ab, h, hr, rbi, bb, k}] ordered by first PA appearance.
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

// Build pitcher stat lines for one pitching team from paLog.
// pitchingTeamSide = 'home' | 'away' (the team on the mound)
// Returns [{name, ip, h, r, bb, k, hr}] ordered by first appearance (SP first).
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

function BatterTable({ batters }) {
  if (batters.length === 0) {
    return <p className="pbs-empty">No plate appearances recorded.</p>;
  }
  const tot = batters.reduce(
    (t, b) => ({ ab: t.ab+b.ab, h: t.h+b.h, hr: t.hr+b.hr, rbi: t.rbi+b.rbi, bb: t.bb+b.bb, k: t.k+b.k }),
    { ab:0, h:0, hr:0, rbi:0, bb:0, k:0 }
  );
  return (
    <table className="pbs-table">
      <thead>
        <tr>
          <th className="pbs-name-col">Player</th>
          <th>AB</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>K</th>
        </tr>
      </thead>
      <tbody>
        {batters.map((b, i) => (
          <tr key={i}>
            <td className="pbs-name-col">{b.name}</td>
            <td>{b.ab}</td>
            <td>{b.h}</td>
            <td>{b.hr  || '—'}</td>
            <td>{b.rbi || '—'}</td>
            <td>{b.bb  || '—'}</td>
            <td>{b.k   || '—'}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="pbs-totals">
          <td className="pbs-name-col">Totals</td>
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

function PitcherTable({ pitchers }) {
  if (pitchers.length === 0) {
    return <p className="pbs-empty">No pitching data recorded.</p>;
  }
  return (
    <table className="pbs-table">
      <thead>
        <tr>
          <th className="pbs-name-col">Pitcher</th>
          <th>IP</th><th>H</th><th>R</th><th>BB</th><th>K</th><th>HR</th>
        </tr>
      </thead>
      <tbody>
        {pitchers.map((p, i) => (
          <tr key={i}>
            <td className="pbs-name-col">
              {p.name}
              <span className="pbs-pitcher-role">{i === 0 ? ' SP' : ' RP'}</span>
            </td>
            <td>{p.ip}</td>
            <td>{p.h}</td>
            <td>{p.r}</td>
            <td>{p.bb || '—'}</td>
            <td>{p.k  || '—'}</td>
            <td>{p.hr || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function BoxScorePrint({ gameData, gameState }) {
  if (!gameData) return null;

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

  // Runs per inning from paLog — fallback when inningScores slot is null
  const awayRunsByInning = {};
  const homeRunsByInning = {};
  for (const pa of log) {
    const idx = (pa.inning ?? 1) - 1;
    if (pa.side === 'away') awayRunsByInning[idx] = (awayRunsByInning[idx] || 0) + (pa.runs || 0);
    if (pa.side === 'home') homeRunsByInning[idx] = (homeRunsByInning[idx] || 0) + (pa.runs || 0);
  }
  const awayInnsBatted = new Set(Object.keys(awayRunsByInning).map(Number));
  const homeInnsBatted = new Set(Object.keys(homeRunsByInning).map(Number));
  const awayH = log.filter(p => p.side === 'away' && p.isHit).length;
  const homeH = log.filter(p => p.side === 'home' && p.isHit).length;
  const awayE = log.filter(p => p.side === 'home' && p.outcome === 'error').length;
  const homeE = log.filter(p => p.side === 'away' && p.outcome === 'error').length;

  // Batting & pitching
  const awayBatters       = buildBatterLines(log, 'away');
  const homeBatters       = buildBatterLines(log, 'home');
  const homePitcherLines  = buildPitcherLines(log, 'home'); // home pitching = away batting
  const awayPitcherLines  = buildPitcherLines(log, 'away'); // away pitching = home batting

  // Notables — streaks continued & milestones approaching
  const allPlayers = [...(awayLineup || []), ...(homeLineup || [])].filter(Boolean);

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

  const milestonePlayers = allPlayers.filter(p => {
    const m = (milestonesById || {})[p.id];
    return m && m.length > 0 && m[0].remaining <= 10;
  });

  const hasNotables = streakPlayers.length > 0 || milestonePlayers.length > 0;

  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="print-box-score">

      {/* ── Header ── */}
      <div className="pbs-header">
        <div className="pbs-brand">MOUND TRACK — GAME SUMMARY</div>
        <div className="pbs-date">{date}</div>
      </div>

      {/* ── Final score banner ── */}
      <div className="pbs-score-banner">
        <span className="pbs-team-abbr">{awayTeam?.abbreviation}</span>
        <span className="pbs-team-name-full">{awayTeam?.name || awayTeam?.abbreviation}</span>
        <span className="pbs-final-score">{score.away} — {score.home}</span>
        <span className="pbs-team-name-full">{homeTeam?.name || homeTeam?.abbreviation}</span>
        <span className="pbs-team-abbr">{homeTeam?.abbreviation}</span>
        <span className="pbs-final-label">FINAL</span>
      </div>

      {/* ── Line score ── */}
      <section className="pbs-section">
        <h3 className="pbs-section-title">LINE SCORE</h3>
        <table className="pbs-table pbs-linescore">
          <thead>
            <tr>
              <th className="pbs-team-col"> </th>
              {Array.from({ length: totalInnings }, (_, i) => (
                <th key={i}>{i + 1}</th>
              ))}
              <th className="pbs-rhe-sep">R</th>
              <th>H</th>
              <th>E</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pbs-team-col">{awayTeam?.abbreviation}</td>
              {Array.from({ length: totalInnings }, (_, i) => (
                <td key={i}>
                  {inningScores[i]?.away != null
                    ? inningScores[i].away
                    : awayInnsBatted.has(i) ? (awayRunsByInning[i] ?? 0) : ''}
                </td>
              ))}
              <td className="pbs-rhe-sep pbs-runs">{score.away}</td>
              <td>{awayH}</td>
              <td>{awayE}</td>
            </tr>
            <tr>
              <td className="pbs-team-col">{homeTeam?.abbreviation}</td>
              {Array.from({ length: totalInnings }, (_, i) => (
                <td key={i}>
                  {inningScores[i]?.home != null
                    ? inningScores[i].home
                    : homeInnsBatted.has(i) ? (homeRunsByInning[i] ?? 0) : ''}
                </td>
              ))}
              <td className="pbs-rhe-sep pbs-runs">{score.home}</td>
              <td>{homeH}</td>
              <td>{homeE}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── Batting lines ── */}
      <div className="pbs-two-col">
        <section className="pbs-section">
          <h3 className="pbs-section-title">BATTING — {awayTeam?.abbreviation}</h3>
          <BatterTable batters={awayBatters} />
        </section>
        <section className="pbs-section">
          <h3 className="pbs-section-title">BATTING — {homeTeam?.abbreviation}</h3>
          <BatterTable batters={homeBatters} />
        </section>
      </div>

      {/* ── Pitching lines ── */}
      <div className="pbs-two-col">
        <section className="pbs-section">
          <h3 className="pbs-section-title">PITCHING — {awayTeam?.abbreviation}</h3>
          <PitcherTable pitchers={awayPitcherLines} />
        </section>
        <section className="pbs-section">
          <h3 className="pbs-section-title">PITCHING — {homeTeam?.abbreviation}</h3>
          <PitcherTable pitchers={homePitcherLines} />
        </section>
      </div>

      {/* ── Notables ── */}
      {hasNotables && (
        <section className="pbs-section pbs-notables-section">
          <h3 className="pbs-section-title">NOTABLES</h3>
          {streakPlayers.length > 0 && (
            <div className="pbs-notable-row">
              <span className="pbs-notable-label">Streaks</span>
              {streakPlayers.map((p, i) => (
                <span key={i} className="pbs-notable-item">
                  {p.name}
                  <span className="pbs-notable-meta">({p.label})</span>
                </span>
              ))}
            </div>
          )}
          {milestonePlayers.map(p => {
            const ms = (milestonesById || {})[p.id];
            if (!ms || ms.length === 0) return null;
            return (
              <div key={p.id} className="pbs-notable-row">
                <span className="pbs-notable-label">Milestone Watch</span>
                <span className="pbs-notable-item">
                  {p.name}
                  <span className="pbs-notable-meta">
                    — {ms[0].remaining} away from {ms[0].milestone.toLocaleString()} career {ms[0].stat}
                  </span>
                </span>
              </div>
            );
          })}
        </section>
      )}

      <div className="pbs-footer">Generated by Mound Track · {date}</div>
    </div>
  );
}
