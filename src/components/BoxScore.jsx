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

// ── BK-65: W/L/S/H decision computation ─────────────────────────────────────

function computeDecisions(paLog, score) {
  const { away: finalAway, home: finalHome } = score || {};
  if (!finalAway && !finalHome) return {};
  if (finalAway === finalHome) return {}; // tie — no decisions

  const winSide  = finalAway > finalHome ? 'away' : 'home';
  const loseSide = winSide === 'away' ? 'home' : 'away';

  // Cumulative score after each PA
  let aw = 0, hm = 0;
  const cumScore = paLog.map(pa => {
    if (pa.side === 'away') aw += (pa.runs || 0);
    else                    hm += (pa.runs || 0);
    return { aw, hm };
  });

  const lead = (s) => (winSide === 'away' ? s.aw : s.hm) - (winSide === 'away' ? s.hm : s.aw);

  // Find last index where loser was tied or leading
  let lastLoserNotBehind = -1;
  for (let i = 0; i < paLog.length; i++) {
    if (lead(cumScore[i]) <= 0) lastLoserNotBehind = i;
  }

  // First winner-batting PA after that point that scores a run = go-ahead PA
  let goAheadIdx = -1;
  for (let i = lastLoserNotBehind + 1; i < paLog.length; i++) {
    if (paLog[i].side === winSide && (paLog[i].runs || 0) > 0) { goAheadIdx = i; break; }
  }
  if (goAheadIdx === -1) return {};

  const decisions = {};

  // Loss: the losing team's pitcher who allowed the go-ahead run
  const lossPA = paLog[goAheadIdx];
  if (lossPA?.pitcherId) decisions[lossPA.pitcherId] = { name: lossPA.pitcherName, dec: 'L' };

  // Win: first winning-team pitcher PA after the go-ahead run
  // Winning-team pitchers appear where pa.side === loseSide
  let winPA = null;
  for (let i = goAheadIdx + 1; i < paLog.length; i++) {
    if (paLog[i].side === loseSide && paLog[i].pitcherId) { winPA = paLog[i]; break; }
  }
  // Walk-off: no subsequent inning for winning team → use last winning-team pitcher before go-ahead
  if (!winPA) {
    for (let i = goAheadIdx - 1; i >= 0; i--) {
      if (paLog[i].side === loseSide && paLog[i].pitcherId) { winPA = paLog[i]; break; }
    }
  }
  if (winPA?.pitcherId && !decisions[winPA.pitcherId]) {
    decisions[winPA.pitcherId] = { name: winPA.pitcherName, dec: 'W' };
  }

  // Build ordered list of winning-team pitchers with their first PA index
  const seenWP = new Set();
  const winPitchers = [];
  for (let i = 0; i < paLog.length; i++) {
    const pa = paLog[i];
    if (pa.side === loseSide && pa.pitcherId && !seenWP.has(pa.pitcherId)) {
      seenWP.add(pa.pitcherId);
      winPitchers.push({ id: pa.pitcherId, name: pa.pitcherName, firstIdx: i });
    }
  }

  const entryLead = (firstIdx) => {
    const s = firstIdx > 0 ? cumScore[firstIdx - 1] : { aw: 0, hm: 0 };
    return lead(s);
  };

  // Save: last winning-team pitcher, not already W, entered with lead ≤ 3
  const lastWP = winPitchers[winPitchers.length - 1];
  if (lastWP && !decisions[lastWP.id]) {
    const el = entryLead(lastWP.firstIdx);
    if (el > 0 && el <= 3) decisions[lastWP.id] = { name: lastWP.name, dec: 'S' };
  }

  // Hold: non-last winning-team pitchers who entered in a save situation and held the lead
  for (let i = 0; i < winPitchers.length - 1; i++) {
    const p = winPitchers[i];
    if (decisions[p.id]) continue;
    const el = entryLead(p.firstIdx);
    if (el <= 0 || el > 3) continue;
    const nextFirstIdx = winPitchers[i + 1]?.firstIdx ?? paLog.length;
    let blownSave = false;
    for (let j = p.firstIdx; j < nextFirstIdx; j++) {
      if (paLog[j].side === loseSide && lead(cumScore[j]) <= 0) { blownSave = true; break; }
    }
    if (!blownSave) decisions[p.id] = { name: p.name, dec: 'H' };
  }

  return decisions;
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

  // BK-63: all entries for this batting side, needed to find inherited run credits
  const allTeamEntries = Object.values(map).flatMap(p => p.entries);

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
    // BK-63: own runs + inherited runners scored (credited back from other pitchers' PAs)
    const r   = entries.reduce((s, p) => s + (p.runs || 0), 0)
              + allTeamEntries.reduce((s, pa) =>
                  s + (pa.inheritedRunCredits || [])
                    .filter(c => c.pitcherId === pid)
                    .reduce((cs, c) => cs + c.runs, 0), 0);
    const er  = entries.reduce((s, p) => s + (p.earnedRuns ?? p.runs ?? 0), 0)
              + allTeamEntries.reduce((s, pa) =>
                  s + (pa.inheritedRunCredits || [])
                    .filter(c => c.pitcherId === pid)
                    .reduce((cs, c) => cs + c.earnedRuns, 0), 0);
    const bb  = entries.filter(p => p.isBB).length;
    const hbp = entries.filter(p => p.isHBP).length;
    const k   = entries.filter(p => p.isK).length;
    const hr  = entries.filter(p => p.isHR).length;

    // Pitch count: sum pitches[] length from each PA entry for this pitcher
    const pc = entries.reduce((s, pa) => s + (pa.pitches?.length || 0), 0);

    return {
      name, id: pid,
      ip:  `${Math.floor(outs / 3)}.${outs % 3}`,
      h, r, er, bb, hbp, k, hr, pc,
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

function PitchingTable({ lines, teamAbbr, decisions = {} }) {
  return (
    <div className="bs-section">
      <h3 className="bs-section-title">{teamAbbr} Pitching</h3>
      <table className="bs-table bs-pitching">
        <thead>
          <tr>
            <th className="bs-name-col">Pitcher</th>
            <th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>HBP</th><th>K</th><th>HR</th><th>PC</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={10} className="bs-empty">No pitching data yet.</td></tr>
          ) : (
            lines.map((p, i) => {
              const dec = decisions[p.id]?.dec;
              return (
                <tr key={p.id || i}>
                  <td className="bs-name-col">
                    {p.name}
                    <span className="bs-pitcher-role">{i === 0 ? ' (S)' : ' (R)'}</span>
                    {dec && <span className={`bs-decision bs-decision-${dec.toLowerCase()}`}>{dec}</span>}
                  </td>
                  <td>{p.ip}</td>
                  <td>{p.h}</td>
                  <td>{p.r}</td>
                  <td>{p.er}</td>
                  <td>{p.bb || '—'}</td>
                  <td>{p.hbp || '—'}</td>
                  <td>{p.k || '—'}</td>
                  <td>{p.hr || '—'}</td>
                  <td>{p.pc || '—'}</td>
                </tr>
              );
            })
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

  // BK-65: W/L/S/H decisions
  const decisions = computeDecisions(log, score);

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
          <PitchingTable lines={awayPitching} teamAbbr={awayTeam?.abbreviation || 'AWY'} decisions={decisions} />
          <PitchingTable lines={homePitching} teamAbbr={homeTeam?.abbreviation || 'HME'} decisions={decisions} />
        </>
      )}
    </div>
  );
}
