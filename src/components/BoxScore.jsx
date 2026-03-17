/**
 * BoxScore.jsx
 *
 * BK-42: Real-Time Box Score Page
 *
 * Live-updating box score derived entirely from paLog, runnerEvents, and gameState.
 * Sections:
 *   1. Line score — inning-by-inning runs, plus R/H/E totals
 *   2. Batting tables — per-team: AB, R, H, 2B, 3B, HR, RBI, BB, HBP, K, SF, SH, SB, CS, AVG
 *   3. Pitching tables — per-pitcher: IP, H, R, ER, BB, K, HR, PC (pitch count)
 *   4. Team totals row at bottom of each batting table
 */

import React from 'react';

// ── Batting stat derivation ─────────────────────────────────────────────────

function buildBattingLines(paLog, runnerEvents, side, lineup) {
  // Build ordered list from lineup (preserves batting order), then add any
  // pinch hitters / subs who appear in paLog but aren't in current lineup.
  const order = [];
  const seen  = new Set();

  // Start with lineup order
  for (const p of (lineup || [])) {
    if (p && !seen.has(p.id)) {
      order.push({ id: p.id, name: p.name });
      seen.add(p.id);
    }
  }

  // Add any batter from paLog not in lineup (substitutions)
  const sidePAs = paLog.filter(p => p.side === side);
  for (const pa of sidePAs) {
    if (!seen.has(pa.batterId)) {
      order.push({ id: pa.batterId, name: pa.batterName });
      seen.add(pa.batterId);
    }
  }

  // Runner events for this side (SB, CS, etc.)
  const sideRunnerEvents = runnerEvents.filter(e => e.side === side);

  return order.map(({ id, name }) => {
    const pas = sidePAs.filter(p => p.batterId === id);
    if (pas.length === 0) {
      // Batter in lineup but hasn't batted yet
      return { id, name, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, hbp: 0, k: 0, sf: 0, sh: 0, sb: 0, cs: 0, hasPAs: false };
    }

    const ab  = pas.filter(p => p.isAB).length;
    const h   = pas.filter(p => p.isHit).length;
    const d   = pas.filter(p => p.outcome === 'double').length;
    const t   = pas.filter(p => p.outcome === 'triple').length;
    const hr  = pas.filter(p => p.isHR).length;
    const rbi = pas.reduce((s, p) => s + (p.rbi || 0), 0);
    const bb  = pas.filter(p => p.isBB).length;
    const hbp = pas.filter(p => p.isHBP).length;
    const k   = pas.filter(p => p.isK).length;
    const sf  = pas.filter(p => p.outcome === 'sacfly').length;
    const sh  = pas.filter(p => p.outcome === 'sacbunt').length;

    // Runs scored: count runner events where this player scored (toBase === 3 = Home)
    // Plus HR/IHR (batter scores themselves)
    const runsFromRunnerEvents = sideRunnerEvents.filter(
      e => e.runnerId === id && e.toBase === 3 && !['cs','po','out-play','rundown','out-other'].includes(e.type)
    ).length;
    const runsFromHR = pas.filter(p => p.isHR).length;
    // Also count runs scored via PA outcomes (runner scoring on plays)
    // The paLog tracks runs scored on the play but not who scored.
    // We approximate: a batter's runs = HR + runner-event scores to home
    const r = runsFromHR + runsFromRunnerEvents;

    // SB / CS from runner events
    const sb = sideRunnerEvents.filter(e => e.runnerId === id && e.type === 'sb').length;
    const cs = sideRunnerEvents.filter(e => e.runnerId === id && e.type === 'cs').length;

    return {
      id, name, ab, r, h, d, t, hr, rbi, bb, hbp, k, sf, sh, sb, cs,
      hasPAs: true,
    };
  }).filter(b => b.hasPAs || (lineup || []).some(p => p?.id === b.id));
}

function computeBattingTotals(lines) {
  return lines.reduce((tot, b) => ({
    ab:  tot.ab  + b.ab,
    r:   tot.r   + b.r,
    h:   tot.h   + b.h,
    d:   tot.d   + b.d,
    t:   tot.t   + b.t,
    hr:  tot.hr  + b.hr,
    rbi: tot.rbi + b.rbi,
    bb:  tot.bb  + b.bb,
    hbp: tot.hbp + b.hbp,
    k:   tot.k   + b.k,
    sf:  tot.sf  + b.sf,
    sh:  tot.sh  + b.sh,
    sb:  tot.sb  + b.sb,
    cs:  tot.cs  + b.cs,
  }), { ab:0, r:0, h:0, d:0, t:0, hr:0, rbi:0, bb:0, hbp:0, k:0, sf:0, sh:0, sb:0, cs:0 });
}

// ── Pitching stat derivation ────────────────────────────────────────────────

// Runner-out event types that credit an out to the active pitcher
const PITCHER_RUNNER_OUT_TYPES = new Set(['cs', 'po', 'out-play', 'rundown', 'out-other']);

function buildPitchingLines(paLog, pitchingTeamSide, pitchCounts, runnerEvents = []) {
  // Pitchers face the opposite side's batters
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

  // Attribute base-path runner outs to the pitcher who was active at that seq.
  // Uses the most recent PA entry with seq ≤ runner-out seq; falls back to the
  // first PA after the event if nothing precedes it (e.g. pickoff before any PA).
  const extraOuts = {};
  const runnerOuts = runnerEvents.filter(
    e => e.side === battingSide && PITCHER_RUNNER_OUT_TYPES.has(e.type)
  );
  for (const ro of runnerOuts) {
    let best = null;
    for (const pa of pas) {
      if ((pa.seq ?? 0) <= (ro.seq ?? 0)) best = pa;
    }
    if (!best) best = pas.find(pa => (pa.seq ?? 0) > (ro.seq ?? 0));
    const pid = best?.pitcherId ?? '__unknown__';
    extraOuts[pid] = (extraOuts[pid] || 0) + 1;
    // Ensure the pitcher exists in map even if they had no PA (rare edge case)
    if (!map[pid] && best) {
      map[pid] = { id: pid, name: best.pitcherName || '—', entries: [] };
      order.push(pid);
    }
  }

  return order.map(pid => {
    const { name, entries } = map[pid];

    // Outs recorded from plate appearances
    const paOuts = entries.reduce((s, pa) => {
      if (['out','k','kl','sacbunt','sacfly','fc','bi','other-out'].includes(pa.outcome)) return s + 1;
      if (pa.outcome === 'dp') return s + 2;
      return s;
    }, 0);

    // Add runner outs (CS, PO, rundown, etc.) to pitcher's total
    const outs = paOuts + (extraOuts[pid] || 0);

    const h   = entries.filter(p => p.isHit).length;
    const r   = entries.reduce((s, p) => s + (p.runs || 0), 0);
    const bb  = entries.filter(p => p.isBB).length;
    const hbp = entries.filter(p => p.isHBP).length;
    const k   = entries.filter(p => p.isK).length;
    const hr  = entries.filter(p => p.isHR).length;

    // Pitch count: sum pitches[] length from each PA entry for this pitcher
    const pc = entries.reduce((s, pa) => s + (pa.pitches?.length || 0), 0);

    return {
      name, id: pid,
      ip:  `${Math.floor(outs / 3)}.${outs % 3}`,
      h, r, bb, hbp, k, hr, pc,
      outs, // raw outs for totals
    };
  });
}

// ── Sub-components ──────────────────────────────────────────────────────────

function LineScore({ awayTeam, homeTeam, inningScores, score, paLog }) {
  const totalInnings = Math.max(9, inningScores.length);

  // Compute runs per inning from paLog as fallback
  const awayRunsByInning = {};
  const homeRunsByInning = {};
  for (const pa of paLog) {
    const idx = (pa.inning ?? 1) - 1;
    if (pa.side === 'away') awayRunsByInning[idx] = (awayRunsByInning[idx] || 0) + (pa.runs || 0);
    if (pa.side === 'home') homeRunsByInning[idx] = (homeRunsByInning[idx] || 0) + (pa.runs || 0);
  }
  const awayInnsBatted = new Set(Object.keys(awayRunsByInning).map(Number));
  const homeInnsBatted = new Set(Object.keys(homeRunsByInning).map(Number));

  const awayH = paLog.filter(p => p.side === 'away' && p.isHit).length;
  const homeH = paLog.filter(p => p.side === 'home' && p.isHit).length;
  const awayE = paLog.filter(p => p.side === 'home' && p.outcome === 'error').length;
  const homeE = paLog.filter(p => p.side === 'away' && p.outcome === 'error').length;

  return (
    <div className="bs-section">
      <table className="bs-table bs-linescore">
        <thead>
          <tr>
            <th className="bs-team-col"></th>
            {Array.from({ length: totalInnings }, (_, i) => (
              <th key={i} className="bs-inn-col">{i + 1}</th>
            ))}
            <th className="bs-rhe-col">R</th>
            <th className="bs-rhe-col">H</th>
            <th className="bs-rhe-col">E</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="bs-team-col">{awayTeam?.abbreviation}</td>
            {Array.from({ length: totalInnings }, (_, i) => (
              <td key={i} className="bs-inn-col">
                {inningScores[i]?.away != null
                  ? inningScores[i].away
                  : awayInnsBatted.has(i) ? (awayRunsByInning[i] ?? 0) : ''}
              </td>
            ))}
            <td className="bs-rhe-col bs-rhe-bold">{score.away}</td>
            <td className="bs-rhe-col">{awayH}</td>
            <td className="bs-rhe-col">{awayE}</td>
          </tr>
          <tr>
            <td className="bs-team-col">{homeTeam?.abbreviation}</td>
            {Array.from({ length: totalInnings }, (_, i) => (
              <td key={i} className="bs-inn-col">
                {inningScores[i]?.home != null
                  ? inningScores[i].home
                  : homeInnsBatted.has(i) ? (homeRunsByInning[i] ?? 0) : ''}
              </td>
            ))}
            <td className="bs-rhe-col bs-rhe-bold">{score.home}</td>
            <td className="bs-rhe-col">{homeH}</td>
            <td className="bs-rhe-col">{homeE}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BattingTable({ lines, teamAbbr }) {
  const totals = computeBattingTotals(lines);
  const teamAvg = totals.ab > 0 ? (totals.h / totals.ab).toFixed(3).replace(/^0/, '') : '.000';

  return (
    <div className="bs-section">
      <h3 className="bs-section-title">{teamAbbr} Batting</h3>
      <table className="bs-table bs-batting">
        <thead>
          <tr>
            <th className="bs-name-col">Player</th>
            <th>AB</th><th>R</th><th>H</th><th>2B</th><th>3B</th><th>HR</th>
            <th>RBI</th><th>BB</th><th>HBP</th><th>K</th><th>SF</th><th>SH</th>
            <th>SB</th><th>CS</th><th>AVG</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((b, i) => {
            const avg = b.ab > 0 ? (b.h / b.ab).toFixed(3).replace(/^0/, '') : '—';
            return (
              <tr key={b.id || i} className={!b.hasPAs ? 'bs-row-dim' : ''}>
                <td className="bs-name-col">{b.name}</td>
                <td>{b.ab || '—'}</td>
                <td>{b.r || '—'}</td>
                <td>{b.h || '—'}</td>
                <td>{b.d || '—'}</td>
                <td>{b.t || '—'}</td>
                <td>{b.hr || '—'}</td>
                <td>{b.rbi || '—'}</td>
                <td>{b.bb || '—'}</td>
                <td>{b.hbp || '—'}</td>
                <td>{b.k || '—'}</td>
                <td>{b.sf || '—'}</td>
                <td>{b.sh || '—'}</td>
                <td>{b.sb || '—'}</td>
                <td>{b.cs || '—'}</td>
                <td>{avg}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bs-totals-row">
            <td className="bs-name-col">Totals</td>
            <td>{totals.ab}</td>
            <td>{totals.r}</td>
            <td>{totals.h}</td>
            <td>{totals.d}</td>
            <td>{totals.t}</td>
            <td>{totals.hr}</td>
            <td>{totals.rbi}</td>
            <td>{totals.bb}</td>
            <td>{totals.hbp}</td>
            <td>{totals.k}</td>
            <td>{totals.sf}</td>
            <td>{totals.sh}</td>
            <td>{totals.sb}</td>
            <td>{totals.cs}</td>
            <td>{teamAvg}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PitchingTable({ lines, teamAbbr }) {
  return (
    <div className="bs-section">
      <h3 className="bs-section-title">{teamAbbr} Pitching</h3>
      <table className="bs-table bs-pitching">
        <thead>
          <tr>
            <th className="bs-name-col">Pitcher</th>
            <th>IP</th><th>H</th><th>R</th><th>BB</th><th>HBP</th><th>K</th><th>HR</th><th>PC</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={9} className="bs-empty">No pitching data yet.</td></tr>
          ) : (
            lines.map((p, i) => (
              <tr key={p.id || i}>
                <td className="bs-name-col">
                  {p.name}
                  <span className="bs-pitcher-role">{i === 0 ? ' (S)' : ' (R)'}</span>
                </td>
                <td>{p.ip}</td>
                <td>{p.h}</td>
                <td>{p.r}</td>
                <td>{p.bb || '—'}</td>
                <td>{p.hbp || '—'}</td>
                <td>{p.k || '—'}</td>
                <td>{p.hr || '—'}</td>
                <td>{p.pc || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function BoxScore({ gameData, gameState }) {
  if (!gameData) return null;

  const {
    homeTeam, awayTeam,
    homeLineup, awayLineup,
  } = gameData;
  const {
    score, inningScores = [], paLog = [], runnerEvents = [],
    homePitchCount, awayPitchCount,
  } = gameState;

  const log = paLog || [];
  const runners = runnerEvents || [];

  // Batting lines
  const awayBatting = buildBattingLines(log, runners, 'away', awayLineup);
  const homeBatting = buildBattingLines(log, runners, 'home', homeLineup);

  // Pitching lines
  const awayPitching = buildPitchingLines(log, 'away', { awayPitchCount }, runners);
  const homePitching = buildPitchingLines(log, 'home', { homePitchCount }, runners);

  const hasData = log.length > 0;

  return (
    <div className="box-score">
      <LineScore
        awayTeam={awayTeam}
        homeTeam={homeTeam}
        inningScores={inningScores}
        score={score}
        paLog={log}
      />

      {!hasData ? (
        <div className="bs-empty-msg">No plays recorded yet — start scoring to see the box score.</div>
      ) : (
        <>
          <BattingTable lines={awayBatting} teamAbbr={awayTeam?.abbreviation || 'AWY'} />
          <BattingTable lines={homeBatting} teamAbbr={homeTeam?.abbreviation || 'HME'} />
          <PitchingTable lines={awayPitching} teamAbbr={awayTeam?.abbreviation || 'AWY'} />
          <PitchingTable lines={homePitching} teamAbbr={homeTeam?.abbreviation || 'HME'} />
        </>
      )}
    </div>
  );
}
