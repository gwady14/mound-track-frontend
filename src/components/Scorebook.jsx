/**
 * Scorebook.jsx
 *
 * Full live scorekeeper interface. Tracks:
 *   - Balls / Strikes / Outs count
 *   - Runners on base (visual diamond)
 *   - Inning-by-inning run totals (line score)
 *   - Current batter (auto-advances through lineup)
 *   - Hits / Errors per team
 *
 * Controls:
 *   Ball / Strike / Foul buttons for pitch-by-pitch tracking
 *   Outcome buttons: Out, Single, Double, Triple, HR, BB, HBP, FC, E
 *   Runner advancement: toggle each base manually
 *   End half-inning: clears bases, resets count, advances inning
 *
 * On each at-bat result, the component advances game state (batter index,
 * inning, score) which the App passes down to SituationalStats.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import PlayByPlayLog from './PlayByPlayLog.jsx';
import { api } from '../api/index.js';

// Mirror of backend getFatigueBand — used to recompute live as pitches are thrown
function getFatigueBand(rolling7dPitches, daysRest) {
  if (daysRest === null || daysRest === undefined) return 'fresh';
  if (rolling7dPitches > 90 || daysRest === 0) return 'high';
  if (rolling7dPitches > 60 || (daysRest === 1 && rolling7dPitches > 20)) return 'elevated';
  if (rolling7dPitches > 30 || daysRest === 1) return 'normal';
  return 'fresh';
}

// ── BIP contact-type → available outcome buttons ─────────────────────────
const BIP_OUTCOMES = {
  // out (GO/BO) always sits at index 5 (visual slot 6, shortcut 6) for consistency
  gb: [
    { key: 'single', label: '1B',   cls: 'hit-btn'     }, // 1
    { key: 'double', label: '2B',   cls: 'hit-btn'     }, // 2
    { key: 'triple', label: '3B',   cls: 'hit-btn'     }, // 3
    { key: 'ihr',    label: 'IHR',  cls: 'hit-btn'     }, // 4
    { key: 'fc',     label: 'FC',   cls: 'neutral-btn' }, // 5
    { key: 'out',    label: 'GO',   cls: 'out-btn'     }, // 6
    { key: 'error',  label: 'E',    cls: 'neutral-btn' }, // 7
    { key: 'foul',   label: 'Foul', cls: 'neutral-btn' }, // 8
    { key: 'bi',     label: 'BI',   cls: 'out-btn'     }, // 9
  ],
  fb: [
    { key: 'single', label: '1B',   cls: 'hit-btn'     },
    { key: 'double', label: '2B',   cls: 'hit-btn'     },
    { key: 'triple', label: '3B',   cls: 'hit-btn'     },
    { key: 'hr',     label: 'HR',   cls: 'hit-btn'     },
    { key: 'ihr',    label: 'IHR',  cls: 'hit-btn'     },
    { key: 'out',    label: 'BO',   cls: 'out-btn'     },
    { key: 'fc',     label: 'FC',   cls: 'neutral-btn' },
    { key: 'error',  label: 'E',    cls: 'neutral-btn' },
    { key: 'foul',   label: 'Foul', cls: 'neutral-btn' },
    { key: 'fe',     label: 'F+E',  cls: 'neutral-btn' },
    { key: 'bi',     label: 'BI',   cls: 'out-btn'     },
  ],
  ld: [
    { key: 'single', label: '1B',   cls: 'hit-btn'     },
    { key: 'double', label: '2B',   cls: 'hit-btn'     },
    { key: 'triple', label: '3B',   cls: 'hit-btn'     },
    { key: 'hr',     label: 'HR',   cls: 'hit-btn'     },
    { key: 'ihr',    label: 'IHR',  cls: 'hit-btn'     },
    { key: 'out',    label: 'BO',   cls: 'out-btn'     },
    { key: 'fc',     label: 'FC',   cls: 'neutral-btn' },
    { key: 'error',  label: 'E',    cls: 'neutral-btn' },
    { key: 'foul',   label: 'Foul', cls: 'neutral-btn' },
    { key: 'fe',     label: 'F+E',  cls: 'neutral-btn' },
    { key: 'bi',     label: 'BI',   cls: 'out-btn'     },
  ],
  bu: [
    { key: 'single', label: '1B',   cls: 'hit-btn'     },
    { key: 'double', label: '2B',   cls: 'hit-btn'     },
    { key: 'triple', label: '3B',   cls: 'hit-btn'     },
    { key: 'foul',   label: 'Foul', cls: 'neutral-btn' },
    { key: 'error',  label: 'E',    cls: 'neutral-btn' },
    { key: 'out',    label: 'BO',   cls: 'out-btn'     },
    { key: 'bi',     label: 'BI',   cls: 'out-btn'     },
    { key: 'pfe',    label: 'PFE',  cls: 'neutral-btn' },
  ],
  pf: [
    { key: 'single', label: '1B',   cls: 'hit-btn'     },
    { key: 'double', label: '2B',   cls: 'hit-btn'     },
    { key: 'triple', label: '3B',   cls: 'hit-btn'     },
    { key: 'hr',     label: 'HR',   cls: 'hit-btn'     },
    { key: 'ihr',    label: 'IHR',  cls: 'hit-btn'     },
    { key: 'out',    label: 'BO',   cls: 'out-btn'     },
    { key: 'fc',     label: 'FC',   cls: 'neutral-btn' },
    { key: 'error',  label: 'E',    cls: 'neutral-btn' },
    { key: 'foul',   label: 'Foul', cls: 'neutral-btn' },
    { key: 'fe',     label: 'F+E',  cls: 'neutral-btn' },
    { key: 'bi',     label: 'BI',   cls: 'out-btn'     },
  ],
};

const BIP_CONTACTS = [
  { key: 'gb', label: 'Ground Ball', abbr: 'GB' },
  { key: 'fb', label: 'Fly Ball',    abbr: 'FB' },
  { key: 'ld', label: 'Line Drive',  abbr: 'LD' },
  { key: 'bu', label: 'Bunt',        abbr: 'BU' },
  { key: 'pf', label: 'Pop Fly',     abbr: 'PF' },
];

// Keyboard shortcut digit for each BIP outcome (null = no digit shortcut)
// Shortcuts are positional: digit = array-index + 1 (index 9 → key "0").
// No static map needed — badge and handler both use the outcome's index in BIP_OUTCOMES.

// Full name shown in tooltip on hover
const OUTCOME_FULL_NAME = {
  out:    'Batted Out',
  single: 'Single',
  double: 'Double',
  triple: 'Triple',
  hr:     'Home Run',
  ihr:    'Inside-the-Park HR',
  fc:     "Fielder's Choice",
  error:  'Error',
  foul:   'Foul Ball',
  fe:     'Foul + Error',
  bi:     'Batter Interference',
  pfe:    'Pop Fly + Error',
};

// BK-24: Fallback pitch-type options when pitcher has no Statcast arsenal data
const FALLBACK_ARSENAL = [
  { type: 'FF', name: '4-Seam Fastball' },
  { type: 'SI', name: 'Sinker / 2-Seam' },
  { type: 'SL', name: 'Slider' },
  { type: 'CU', name: 'Curveball' },
  { type: 'CH', name: 'Changeup' },
  { type: 'FC', name: 'Cutter' },
];

// ── AI insight helpers ────────────────────────────────────────────────────

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

const CATEGORY_META = {
  bvp:       { label: 'BvP',       cls: 'bvp'       },
  streak:    { label: 'Form',      cls: 'streak'     },
  platoon:   { label: 'Platoon',   cls: 'platoon'    },
  arsenal:   { label: 'Arsenal',   cls: 'arsenal'    },
  milestone: { label: 'Milestone', cls: 'milestone'  },
  today:     { label: 'Today',     cls: 'today'      },
};

// ── Format a base runner for SVG diamond label — jersey number preferred.
function runnerLabel(runner) {
  if (!runner) return '';
  if (runner.id === null) return '?';
  if (runner.jerseyNumber != null) return `#${runner.jerseyNumber}`;
  const parts = (runner.name || '').split(' ');
  return (parts[parts.length - 1] || runner.name || '?').slice(0, 7);
}

// ── Illegal Pitch sub-menu inside Pitch modal ────────────────────────────
function PitchModalILP({ onSelect, focused }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button className={`pitch-modal-item${focused ? ' kbd-focused' : ''}`} onClick={() => setOpen(v => !v)}>
        <span className="pitch-modal-badge">ILP</span>
        <span className="pitch-modal-item-label">Illegal Pitch</span>
        <span className="pitch-modal-arrow">{open ? '▾' : '›'}</span>
      </button>
      {open && (
        <div className="pitch-modal-ilp-sub">
          <button className="pitch-modal-ilp-opt" onClick={() => onSelect(true)}>Advance Runner</button>
          <button className="pitch-modal-ilp-opt" onClick={() => onSelect(false)}>Don't Advance</button>
        </div>
      )}
    </>
  );
}


export default function Scorebook({ gameData, gameState, setGameState, onPinchHit, onPitcherChange, onLineupReorder }) {
  const { homeTeam, awayTeam, homeLineup, awayLineup, homeRoster, awayRoster } = gameData;
  const [activePHSlot,    setActivePHSlot]    = useState(null);
  const [showPitcherSub,  setShowPitcherSub]  = useState(false);
  const [insightsCache,   setInsightsCache]   = useState({});
  const [loadingInsight,  setLoadingInsight]  = useState(null);
  const [activeInsightId, setActiveInsightId] = useState(null);
  const [fatigueData,     setFatigueData]     = useState({});  // {[pitcherId]: fatigueObj}
  const fetchedFatigueIds = useRef(new Set());
  const shortcutRef       = useRef({});
  const historyRef        = useRef([]);
  const gameStateRef      = useRef(gameState);
  gameStateRef.current    = gameState;
  const [canUndo, setCanUndo] = useState(false);
  // BK-34: new pitch input flow state
  const [pitchMenuOpen, setPitchMenuOpen] = useState(false);  // Pitch ··· modal
  const [bipStep,       setBipStep]       = useState(null);   // null | 'contact' | 'outcome' | 'flag' | 'notation'
  const [bipContact,    setBipContact]    = useState(null);   // null | 'gb'|'fb'|'ld'|'bu'|'pf'
  const [menuFocusIdx,  setMenuFocusIdx]  = useState(0);      // arrow-key focus index in active menu
  const [bipFlagKey,    setBipFlagKey]    = useState(null);   // 'out' pending SF/DP flag step
  const [bipNotation,   setBipNotation]   = useState([]);     // BK-33: fielder position sequence e.g. [6,4,3]
  const [bipPendingOutcome, setBipPendingOutcome] = useState(null); // outcome key waiting for notation
  const [selectedPitchType, setSelectedPitchType] = useState(null); // BK-24: pitch type selected before outcome
  const [showPitchSeq,      setShowPitchSeq]      = useState(true);  // BK-39: show/hide PA pitch sequences
  const [bipFCRetiredBase, setBipFCRetiredBase] = useState(null); // 0|1|2 — which base runner was retired on FC
  const [bipFCIsDP,        setBipFCIsDP]        = useState(false); // true = FC was a double play
  const [tagUpActive,      setTagUpActive]      = useState(false); // BK-68: tag-up prompt after fly/LD outs
  const [tagUpRunners,     setTagUpRunners]     = useState([]);    // [{runner, fromBase, dest}]
  const [lineScoreOpen,     setLineScoreOpen]     = useState(true);  // collapsible line score
  const [scoreOverrideOpen, setScoreOverrideOpen] = useState(false); // collapsed by default
  const [moundExpanded, setMoundExpanded] = useState(true); // collapsible pitcher box
  const [scoreOverrideWarn, setScoreOverrideWarn] = useState(false); // show warning on first expand
  const [baseActionMenu, setBaseActionMenu] = useState(null); // { baseIdx: 0|1|2 } | null
  const { inning, isTop, outs, balls, strikes, bases, score, inningScores,
          awayBatterIdx, homeBatterIdx,
          homePitchCount, awayPitchCount,
          homePitcherStartPA, awayPitcherStartPA,
          paLog } = gameState;

  const currentLineup   = isTop ? awayLineup : homeLineup;
  const currentBatterIdx = isTop ? awayBatterIdx : homeBatterIdx;
  const currentBatter   = currentLineup[currentBatterIdx % Math.max(currentLineup.length, 1)];

  // ── BK-28: Highlighted batter for PBP filter (separate from at-bat pointer) ─
  const [highlightedBatterIdx, setHighlightedBatterIdx] = useState(null); // null = follow at-bat
  const effectiveHLIdx   = highlightedBatterIdx ?? (currentBatterIdx % Math.max(currentLineup.length, 1));
  const highlightedBatter = currentLineup[effectiveHLIdx] || null;

  // ── BK-27: Lineup drag-and-drop reorder ──────────────────────────────────
  const [dragIdx,     setDragIdx]     = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const handleLineupDragStart = (e, i) => {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleLineupDragOver = (e, i) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== i) setDragOverIdx(i);
  };
  const handleLineupDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };
  const handleLineupDrop = (e, dropIdx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    const curLineup = isTop ? awayLineup : homeLineup;
    const side      = isTop ? 'away' : 'home';
    const newLineup = [...curLineup];
    const [moved]   = newLineup.splice(dragIdx, 1);
    newLineup.splice(dropIdx, 0, moved);
    // BK-59: pass old lineup so App can recalculate batter index after reorder
    if (onLineupReorder) onLineupReorder(side, newLineup, curLineup);
    setDragIdx(null); setDragOverIdx(null);
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const update = useCallback((patch) => {
    setGameState(prev => ({ ...prev, ...patch }));
  }, [setGameState]);

  // ── Undo ─────────────────────────────────────────────────────────────────
  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current, gameStateRef.current];
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop();
    setGameState(prev);
    setCanUndo(historyRef.current.length > 0);
  }, [setGameState]);

  // ── AI insights ──────────────────────────────────────────────────────────

  const fetchBatterInsights = useCallback(async (batter, pitcher) => {
    if (loadingInsight === batter.id || insightsCache[batter.id]) return;
    setLoadingInsight(batter.id);
    try {
      const stats = (gameData.statsById || {})[batter.id] || {};
      const mlb = stats.mlb || {};
      const fg  = stats.fangraphs || {};
      const sc  = stats.statcast || {};
      const bvp = (gameData.bvpById || {})[`${batter.id}_${pitcher?.id}`];
      const result = await api.getInsights({
        batter:     { name: batter.name, batSide: batter.batSide },
        pitcher:    pitcher ? { name: pitcher.name, throwHand: pitcher.throwHand } : null,
        season:     { avg: mlb.avg, obp: mlb.obp, slg: mlb.slg, ops: mlb.ops, woba: fg.woba, wrcPlus: fg.wrcPlus, xwoba: sc.xwoba, kPct: fg.kPct ?? mlb.kPct, bbPct: fg.bbPct ?? mlb.bbPct },
        bvp:        bvp?.pa > 0 ? bvp : null,
        streaks:    (gameData.streaksById || {})[batter.id] || null,
        arsenal:    (gameData.arsenalById || {})[pitcher?.id] || null,
        milestones: (gameData.milestonesById || {})[batter.id] || null,
        todayLine:  getTodayLine(paLog, batter.id) || null,
      });
      setInsightsCache(prev => ({ ...prev, [batter.id]: result.insights || [] }));
    } catch (err) {
      setInsightsCache(prev => ({ ...prev, [batter.id]: { error: err.message } }));
    } finally {
      setLoadingInsight(null);
    }
  }, [loadingInsight, insightsCache, gameData, paLog]);

  const fetchPitcherInsights = useCallback(async (pitcher, todayStr) => {
    if (loadingInsight === pitcher.id || insightsCache[pitcher.id]) return;
    setLoadingInsight(pitcher.id);
    try {
      const stats = (gameData.statsById || {})[pitcher.id] || {};
      const pMlb = stats.mlb || {};
      const pFg  = stats.fangraphs || {};
      const result = await api.getInsights({
        batter:        currentBatter ? { name: currentBatter.name, batSide: currentBatter.batSide } : null,
        pitcher:       { name: pitcher.name, throwHand: pitcher.throwHand },
        pitcherSeason: { era: pMlb.era, whip: pMlb.whip, kPer9: pMlb.kPer9, fip: pFg.fip, wins: pMlb.wins, losses: pMlb.losses },
        arsenal:       (gameData.arsenalById || {})[pitcher.id] || null,
        todayLine:     todayStr,
      });
      setInsightsCache(prev => ({ ...prev, [pitcher.id]: result.insights || [] }));
    } catch (err) {
      setInsightsCache(prev => ({ ...prev, [pitcher.id]: { error: err.message } }));
    } finally {
      setLoadingInsight(null);
    }
  }, [loadingInsight, insightsCache, gameData, currentBatter]);

  // Advance to next batter in lineup
  const nextBatter = useCallback((gs = gameState) => {
    const lineup = gs.isTop ? awayLineup : homeLineup;
    const idx    = gs.isTop ? gs.awayBatterIdx : gs.homeBatterIdx;
    const next   = (idx + 1) % Math.max(lineup.length, 1);
    return gs.isTop
      ? { awayBatterIdx: next, balls: 0, strikes: 0 }
      : { homeBatterIdx: next, balls: 0, strikes: 0 };
  }, [gameState, awayLineup, homeLineup]);

  // ── Pitch controls ────────────────────────────────────────────────────────
  // Each pitch button always increments the opposing pitcher's pitch count.
  const countPitch = () => setGameState(prev => {
    const k = prev.isTop ? 'homePitchCount' : 'awayPitchCount';
    return { ...prev, [k]: (prev[k] || 0) + 1 };
  });

  // BK-24: append one pitch record to the current PA's pitch log
  const appendPitch = useCallback((type, result) => setGameState(prev => ({
    ...prev,
    currentPAPitches: [...(prev.currentPAPitches || []), { type, result }],
  })), []);

  const addBall = () => {
    const pt = selectedPitchType;
    setSelectedPitchType(null);
    pushHistory();
    countPitch();
    appendPitch(pt, 'B');
    if (balls >= 3) {
      // 4th ball = walk
      applyOutcome('bb');
    } else {
      update({ balls: balls + 1 });
    }
  };

  const addCalledStrike = () => {
    const pt = selectedPitchType;
    setSelectedPitchType(null);
    pushHistory();
    countPitch();
    appendPitch(pt, 'C');
    if (strikes >= 2) {
      applyOutcome('kl'); // 3rd called strike = Ꝁ looking
    } else {
      update({ strikes: strikes + 1 });
    }
  };

  const addSwingMiss = () => {
    const pt = selectedPitchType;
    setSelectedPitchType(null);
    pushHistory();
    countPitch();
    appendPitch(pt, 'S');
    if (strikes >= 2) {
      applyOutcome('k'); // 3rd swing & miss = K swinging
    } else {
      update({ strikes: strikes + 1 });
    }
  };

  const addFoul = () => {
    const pt = selectedPitchType;
    setSelectedPitchType(null);
    pushHistory();
    countPitch();
    appendPitch(pt, 'F');
    // Foul can't increase strikes past 2
    if (strikes < 2) update({ strikes: strikes + 1 });
  };

  // ── Balk / Illegal Pitch ──────────────────────────────────────────────────
  const applyBalk = useCallback(() => {
    pushHistory();
    setGameState(prev => {
      const newBases  = [...prev.bases];
      let newScore    = { ...prev.score };
      const newInningScores = prev.inningScores.map(r => ({ ...r }));
      const side = prev.isTop ? 'away' : 'home';
      // Runner on 3B scores
      if (newBases[2]) {
        if (side === 'away') newScore.away++;
        else newScore.home++;
        const idx = Math.min(prev.inning - 1, 8);
        if (side === 'away') newInningScores[idx].away = (newInningScores[idx].away || 0) + 1;
        else newInningScores[idx].home = (newInningScores[idx].home || 0) + 1;
      }
      newBases[2] = newBases[1];
      newBases[1] = newBases[0];
      newBases[0] = null;
      return { ...prev, bases: newBases, score: newScore, inningScores: newInningScores };
    });
  }, [pushHistory, setGameState]);

  const applyIllegalPitch = useCallback((advance) => {
    if (advance) {
      applyBalk();
      // Small delay so balk state settles before ball count changes
      setTimeout(() => addBall(), 0);
    } else {
      addBall();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyBalk, addBall]);

  // ── Plate appearance outcome ──────────────────────────────────────────────
  // countPitch = true when called directly from an outcome button (not via
  // addBall/addCalledStrike/addSwingMiss, which already counted the pitch themselves).
  const applyOutcome = useCallback((key, countPitch = false, detail = {}) => {
    historyRef.current = [...historyRef.current, gameStateRef.current];
    setCanUndo(true);
    setGameState(prev => {
      let {
        outs, bases, score, inningScores, inning, isTop,
        awayBatterIdx, homeBatterIdx,
      } = prev;

      let newOuts   = outs;
      let newBases  = [...bases]; // [1B, 2B, 3B]
      let newScore  = { ...score };
      let newInning = inning;
      let newIsTop  = isTop;
      let newInningScores = inningScores.map(r => ({ ...r }));

      const side = isTop ? 'away' : 'home';

      // BK-63: snapshot pitcher before runner creation so inherited-runner attribution works
      const currentPitcher = isTop
        ? (gameData.currentHomePitcher || gameData.homePitcher)
        : (gameData.currentAwayPitcher || gameData.awayPitcher);

      // Identify the current batter so they can be placed on base as a runner.
      const lineup        = isTop ? awayLineup : homeLineup;
      const idx           = isTop ? awayBatterIdx : homeBatterIdx;
      const currentBatter = lineup[idx % Math.max(lineup.length, 1)];
      // BK-63: tag each runner with the pitcher who allowed them on base
      const runner        = currentBatter
        ? { id: currentBatter.id, name: currentBatter.name, jerseyNumber: currentBatter.jerseyNumber, earned: true,
            allowedByPitcherId: currentPitcher?.id ?? null, allowedByPitcherName: currentPitcher?.name ?? null }
        : { id: null, name: '?', earned: true,
            allowedByPitcherId: currentPitcher?.id ?? null, allowedByPitcherName: currentPitcher?.name ?? null };
      // Unearned runner — reaches via error
      const unearnedRunner = { ...runner, earned: false };

      // Count runs that score on this play.
      // runsScored = total (used for score updates and batter RBI).
      // ownRunsScored = runs charged to currentPitcher (own runners scored).
      // inheritedRunMap = runs that score off inherited runners, keyed by original pitcher.
      let runsScored    = 0;
      let ownRunsScored = 0;
      let ownEarnedRuns = 0;
      const inheritedRunMap = {}; // { [pitcherId]: { pitcherName, runs, earnedRuns } }

      const scoreRun = (side, isEarned = true, runnerObj = null) => {
        runsScored++;
        if (side === 'away') newScore.away++;
        else newScore.home++;
        const scoreIdx = Math.min(newInning - 1, 8);
        if (side === 'away') newInningScores[scoreIdx].away = (newInningScores[scoreIdx].away || 0) + 1;
        else                 newInningScores[scoreIdx].home = (newInningScores[scoreIdx].home || 0) + 1;
        // BK-63: attribute run to the pitcher who put the runner on base
        const allowedBy = runnerObj?.allowedByPitcherId;
        const isOwn = !allowedBy || allowedBy === (currentPitcher?.id ?? null);
        if (isOwn) {
          ownRunsScored++;
          if (isEarned) ownEarnedRuns++;
        } else {
          if (!inheritedRunMap[allowedBy]) {
            inheritedRunMap[allowedBy] = { pitcherName: runnerObj.allowedByPitcherName || '?', runs: 0, earnedRuns: 0 };
          }
          inheritedRunMap[allowedBy].runs++;
          if (isEarned) inheritedRunMap[allowedBy].earnedRuns++;
        }
      };

      switch (key) {
          case 'out':
          case 'k':
          case 'kl':   // strikeout looking — same mechanics as swinging K
          case 'sacbunt':
            newOuts++;
            break;

          case 'fc': { // fielder's choice
            const retiredBase = detail.retiredBase;
            const isDP = detail.isDP || false;
            newOuts = Math.min(newOuts + (isDP ? 2 : 1), 3);
            // Remove the retired runner
            if (retiredBase != null && retiredBase >= 0 && retiredBase <= 2) {
              newBases[retiredBase] = null;
            } else {
              // Fallback: retire the lead runner (highest base)
              for (let i = 2; i >= 0; i--) {
                if (newBases[i]) { newBases[i] = null; break; }
              }
            }
            // Batter reaches 1B unless it's a DP
            if (!isDP) newBases[0] = runner;
            break;
          }

          case 'error': // batter reaches on error — batter and run are unearned
            newBases = [unearnedRunner, newBases[0], newBases[1]];
            if (newBases[2] && newBases[0]) scoreRun(side, newBases[2].earned !== false, newBases[2]); // simplistic
            break;

          case 'single':
            // Default: 3B scores, 2B → 3B, 1B → 2B, batter → 1B
            if (newBases[2]) scoreRun(side, newBases[2].earned !== false, newBases[2]);
            newBases = [runner, newBases[0], newBases[1]];
            break;

          case 'double':
            if (newBases[2]) scoreRun(side, newBases[2].earned !== false, newBases[2]); // 3B scores
            if (newBases[1]) scoreRun(side, newBases[1].earned !== false, newBases[1]); // 2B scores
            newBases = [null, runner, newBases[0]]; // 1B → 3B, batter → 2B
            break;

          case 'triple':
            if (newBases[2]) scoreRun(side, newBases[2].earned !== false, newBases[2]);
            if (newBases[1]) scoreRun(side, newBases[1].earned !== false, newBases[1]);
            if (newBases[0]) scoreRun(side, newBases[0].earned !== false, newBases[0]);
            newBases = [null, null, runner]; // batter → 3B
            break;

          case 'hr':
          case 'ihr': // in-the-park HR — same scoring as regular HR
            if (newBases[2]) scoreRun(side, newBases[2].earned !== false, newBases[2]);
            if (newBases[1]) scoreRun(side, newBases[1].earned !== false, newBases[1]);
            if (newBases[0]) scoreRun(side, newBases[0].earned !== false, newBases[0]);
            scoreRun(side, true, runner); // batter on HR is always earned
            newBases = [null, null, null];
            break;

          case 'bb':
          case 'hbp':
          case 'ibb': // intentional walk — force advances same as BB
          case 'ci':  // catcher's interference — batter to 1B, force advance
            // Force advances — push each occupied runner forward
            if (newBases[0] && newBases[1] && newBases[2]) scoreRun(side, newBases[2].earned !== false, newBases[2]);
            if (newBases[0] && newBases[1]) newBases[2] = newBases[1]; // 2B → 3B
            if (newBases[0]) newBases[1] = newBases[0];                // 1B → 2B
            newBases[0] = runner;                                       // batter → 1B
            break;

          case 'sacfly':
            newOuts++;
            if (newBases[2]) { scoreRun(side, newBases[2].earned !== false, newBases[2]); newBases[2] = null; }
            break;

          case 'dp':
            newOuts = Math.min(newOuts + 2, 3);
            // Remove lead runner
            if (newBases[0]) newBases[0] = null;
            break;

          case 'bi':       // batter interference = out, no base advancement
          case 'other-out':
            newOuts++;
            break;

          case 'pfe': // pop foul error — batter reaches 1B on error, unearned
          case 'fe':  // foul + error — same
            newBases[0] = unearnedRunner;
            break;

          default: break;
        }

      // ── Log this plate appearance ──────────────────────────────────────────
      // Errors and fielder's choice don't earn RBI; everything else credits
      // runs scored on the play as RBI.
      // (lineup / idx / currentBatter already computed above for runner tracking)

      // Snapshot the pitcher on the mound for this PA so the play-by-play
      // log can show "off [pitcher last name]" even after pitching changes.
      // (currentPitcher already defined above for inherited-runner tracking — BK-63)

      // BK-63: build inherited run credits so BoxScore can attribute them to the original pitcher
      const inheritedRunCredits = Object.entries(inheritedRunMap).map(([pitcherId, data]) => ({
        pitcherId,
        pitcherName: data.pitcherName,
        runs:        data.runs,
        earnedRuns:  data.earnedRuns,
      }));

      const paEntry = currentBatter ? {
        batterId:    currentBatter.id,
        batterName:  currentBatter.name,
        pitcherId:   currentPitcher?.id   ?? null,
        pitcherName: currentPitcher?.name ?? null,
        side:        isTop ? 'away' : 'home',
        inning:      prev.inning,
        outcome:     key,
        seq:         Math.max(prev.gameEventSeq || 0, (prev.paLog?.length || 0) + (prev.runnerEvents?.length || 0)),
        isAB:        !['bb','hbp','sacfly','sacbunt','ibb','ci','pfe','fe'].includes(key),
        isHit:       ['single','double','triple','hr','ihr'].includes(key),
        isHR:        key === 'hr' || key === 'ihr',
        isK:         key === 'k' || key === 'kl',
        isBB:        key === 'bb' || key === 'ibb',
        isHBP:       key === 'hbp' || key === 'ci',
        rbi:              ['error','fc','bi','other-out'].includes(key) ? 0 : runsScored,
        runs:             ownRunsScored,
        earnedRuns:       ownEarnedRuns,
        inheritedRunCredits: inheritedRunCredits.length > 0 ? inheritedRunCredits : undefined,
        fieldingNotation: detail.fieldingNotation ?? null,
        battedBallType:   detail.battedBallType   ?? null,
        pitches:          prev.currentPAPitches   || [],  // BK-24
      } : null;

      // Advance batter index
      const nextIdx = (idx + 1) % Math.max(lineup.length, 1);
      const newAwayBatterIdx = isTop  ? nextIdx : awayBatterIdx;
      const newHomeBatterIdx = !isTop ? nextIdx : homeBatterIdx;

      // ── 3 outs: flip inning ─────────────────────────────────────────────
      if (newOuts >= 3) {
        newOuts  = 0;
        newBases = [null, null, null];

        if (isTop) {
          // End of top half
          newIsTop = false;
          // Ensure inning slot exists
          while (newInningScores.length < newInning) {
            newInningScores.push({ home: null, away: null });
          }
          if (newInningScores[newInning - 1].away == null) {
            newInningScores[newInning - 1].away = newScore.away - inningScores.slice(0, newInning - 1).reduce((s, r) => s + (r.away || 0), 0);
          }
        } else {
          // End of bottom half — capture home inning run total before advancing
          if (newInningScores[newInning - 1].home == null) {
            const prevHomeRuns = inningScores
              .slice(0, newInning - 1)
              .reduce((s, r) => s + (r.home ?? 0), 0);
            newInningScores[newInning - 1].home = newScore.home - prevHomeRuns;
          }
          newIsTop  = true;
          newInning = newInning + 1;
          if (newInning > 9) {
            // Extra innings — extend the array
            while (newInningScores.length < newInning) {
              newInningScores.push({ home: null, away: null });
            }
          }
        }
      }

      return {
        ...prev,
        outs:           newOuts,
        bases:          newBases,
        score:          newScore,
        inningScores:   newInningScores,
        inning:         newInning,
        isTop:          newIsTop,
        balls:          0,
        strikes:        0,
        awayBatterIdx:  newAwayBatterIdx,
        homeBatterIdx:  newHomeBatterIdx,
        paLog:          paEntry ? [...(prev.paLog || []), paEntry] : (prev.paLog || []),
        gameEventSeq:   paEntry
          ? Math.max(prev.gameEventSeq || 0, (prev.paLog?.length || 0) + (prev.runnerEvents?.length || 0)) + 1
          : Math.max(prev.gameEventSeq || 0, (prev.paLog?.length || 0) + (prev.runnerEvents?.length || 0)),
        currentPAPitches: [],  // BK-24: reset for next PA
        // If this outcome was triggered directly (not via Ball/Strike button),
        // count the final pitch now.
        ...(countPitch ? {
          [isTop ? 'homePitchCount' : 'awayPitchCount']:
            ((isTop ? prev.homePitchCount : prev.awayPitchCount) || 0) + 1,
        } : {}),
      };
    });
  }, [setGameState, awayLineup, homeLineup]);

  // ── BIP flow helpers (defined after applyOutcome to avoid TDZ) ───────────
  const cancelBIP = useCallback(() => {
    setBipStep(null);
    setBipContact(null);
    setBipFlagKey(null);
    setBipNotation([]);
    setBipPendingOutcome(null);
    setBipFCRetiredBase(null);
    setBipFCIsDP(false);
    setBipAdjustRunners([]);
    setBipPendingNotationStr(null);
  }, []);

  const selectBIPContact = useCallback((type) => {
    setBipContact(type);
    setBipStep('outcome');
  }, []);

  // BK-33: transition to notation step before applying
  const goToNotation = useCallback((key) => {
    setBipPendingOutcome(key);
    setBipNotation([]);
    setBipStep('notation');
  }, []);

  const selectBIPOutcome = useCallback((key) => {
    if (key === 'foul') { cancelBIP(); addFoul(); return; }

    if (bipContact === 'bu' && key === 'out') {
      goToNotation('sacbunt'); return;
    }

    if (['fb','ld','pf'].includes(bipContact) && key === 'out' && bases[2]) {
      setBipFlagKey('out'); setBipStep('flag'); return;
    }
    if (bipContact === 'gb' && key === 'out' && bases[0]) {
      setBipFlagKey('out'); setBipStep('flag'); return;
    }

    if (key === 'fc') {
      const hasRunners = bases.some(Boolean);
      if (hasRunners) {
        setBipFCRetiredBase(null);
        setBipFCIsDP(false);
        setBipStep('fc-runner');
        setMenuFocusIdx(0);
      } else {
        goToNotation('fc');
      }
      return;
    }

    goToNotation(key);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bipContact, bases, cancelBIP, addFoul, goToNotation]);

  const confirmBIPFlag = useCallback((finalKey) => {
    goToNotation(finalKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToNotation]);

  const selectFCRunner = useCallback((baseIdx) => {
    setBipFCRetiredBase(baseIdx);
    setBipStep('fc-dp');
    setMenuFocusIdx(0);
  }, []);

  const confirmFCDP = useCallback((isDP) => {
    setBipFCIsDP(isDP);
    goToNotation('fc');
  }, [goToNotation]);

  // BK-33: confirm notation and apply outcome
  const confirmNotation = useCallback(() => {
    const notation = bipNotation.length > 0 ? bipNotation.join('-') : null;
    appendPitch(selectedPitchType, 'P'); setSelectedPitchType(null);
    pushHistory(); countPitch();
    applyOutcome(bipPendingOutcome, false, {
      battedBallType:   bipContact?.toUpperCase(),
      fieldingNotation: notation,
      ...(bipPendingOutcome === 'fc' ? { retiredBase: bipFCRetiredBase, isDP: bipFCIsDP } : {}),
    });
    cancelBIP();
    // BK-68: after fly/LD outs with runners on base, prompt for tag-up advancement
    if (bipPendingOutcome === 'out' && ['fb', 'ld'].includes(bipContact) && bases.some(Boolean)) {
      const runners = bases
        .map((runner, fromBase) => runner ? { runner, fromBase, dest: fromBase } : null)
        .filter(Boolean);
      setTagUpRunners(runners);
      setTagUpActive(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bipNotation, bipPendingOutcome, bipContact, bipFCRetiredBase, bipFCIsDP, cancelBIP, applyOutcome, appendPitch, selectedPitchType, bases]);

  // BK-68: commit tag-up runner advancements
  const confirmTagUp = useCallback(() => {
    const movers = tagUpRunners.filter(({ fromBase, dest }) => dest !== fromBase);
    if (movers.length > 0) {
      setGameState(prev => {
        const newBases        = [...prev.bases];
        const newRunnerEvents = [...(prev.runnerEvents || [])];
        let newScore          = { ...prev.score };
        const newInningScores = prev.inningScores.map(r => ({ ...r }));
        const side            = prev.isTop ? 'away' : 'home';
        let seq = Math.max(prev.gameEventSeq || 0, (prev.paLog?.length || 0) + (prev.runnerEvents?.length || 0));

        // Process highest base first to avoid collisions
        for (const { runner, fromBase, dest } of [...movers].sort((a, b) => b.fromBase - a.fromBase)) {
          newBases[fromBase] = null;
          if (dest === 'score') {
            if (side === 'away') newScore.away++; else newScore.home++;
            const idx = Math.min(prev.inning - 1, 8);
            if (side === 'away') newInningScores[idx].away = (newInningScores[idx].away || 0) + 1;
            else                 newInningScores[idx].home = (newInningScores[idx].home || 0) + 1;
          } else {
            newBases[dest] = runner;
          }
          newRunnerEvents.push({
            type:       'tagup',
            runnerId:   runner?.id   || null,
            runnerName: runner?.name || '?',
            fromBase,
            toBase:     dest === 'score' ? 3 : dest,
            inning:     prev.inning,
            side,
            seq:        seq++,
          });
        }
        return { ...prev, bases: newBases, score: newScore, inningScores: newInningScores, runnerEvents: newRunnerEvents, gameEventSeq: seq };
      });
    }
    setTagUpActive(false);
    setTagUpRunners([]);
  }, [tagUpRunners, setGameState]);

  // ── BK-31: Delete a play-by-play entry ─────────────────────────────────────
  // Removes the PA from paLog, subtracts its runs from score/inningScores,
  // and removes the pitches thrown during that PA from the pitcher's count.
  const deletePA = useCallback((paIndex) => {
    pushHistory();
    setGameState(prev => {
      const log = [...(prev.paLog || [])];
      const entry = log[paIndex];
      if (!entry) return prev;

      // Remove the entry
      log.splice(paIndex, 1);

      // Subtract runs from score and inning scores
      const runs = entry.runs || 0;
      let newScore = { ...prev.score };
      const newInningScores = prev.inningScores.map(r => ({ ...r }));
      if (runs > 0) {
        const side = entry.side;
        if (side === 'away') newScore.away = Math.max(0, newScore.away - runs);
        else                 newScore.home = Math.max(0, newScore.home - runs);
        const innIdx = Math.min((entry.inning ?? 1) - 1, newInningScores.length - 1);
        if (innIdx >= 0 && newInningScores[innIdx]) {
          if (side === 'away' && newInningScores[innIdx].away != null) {
            newInningScores[innIdx].away = Math.max(0, newInningScores[innIdx].away - runs);
          } else if (side === 'home' && newInningScores[innIdx].home != null) {
            newInningScores[innIdx].home = Math.max(0, newInningScores[innIdx].home - runs);
          }
        }
      }

      // Subtract pitch count for the pitches thrown during this PA
      const pitchCount = entry.pitches?.length || 0;
      const pitchKey = entry.side === 'away' ? 'homePitchCount' : 'awayPitchCount';
      const newPitchCount = Math.max(0, (prev[pitchKey] || 0) - pitchCount);

      return {
        ...prev,
        paLog: log,
        score: newScore,
        inningScores: newInningScores,
        [pitchKey]: newPitchCount,
      };
    });
  }, [pushHistory, setGameState]);

  // Delete a runner event — subtract score if the runner scored (toBase === 3 = Home
  // and not an out-type event).
  const deleteRunnerEvent = useCallback((reIndex) => {
    pushHistory();
    setGameState(prev => {
      const events = [...(prev.runnerEvents || [])];
      const entry = events[reIndex];
      if (!entry) return prev;

      events.splice(reIndex, 1);

      // If the runner scored (advanced to home and wasn't out), subtract from score
      const RUNNER_OUT_TYPES = new Set(['cs', 'po', 'out-play', 'rundown', 'out-other']);
      const scored = entry.toBase === 3 && !RUNNER_OUT_TYPES.has(entry.type);

      let newScore = { ...prev.score };
      const newInningScores = prev.inningScores.map(r => ({ ...r }));
      if (scored) {
        const side = entry.side;
        if (side === 'away') newScore.away = Math.max(0, newScore.away - 1);
        else                 newScore.home = Math.max(0, newScore.home - 1);
        const innIdx = Math.min((entry.inning ?? 1) - 1, newInningScores.length - 1);
        if (innIdx >= 0 && newInningScores[innIdx]) {
          if (side === 'away' && newInningScores[innIdx].away != null) {
            newInningScores[innIdx].away = Math.max(0, newInningScores[innIdx].away - 1);
          } else if (side === 'home' && newInningScores[innIdx].home != null) {
            newInningScores[innIdx].home = Math.max(0, newInningScores[innIdx].home - 1);
          }
        }
      }

      return { ...prev, runnerEvents: events, score: newScore, inningScores: newInningScores };
    });
  }, [pushHistory, setGameState]);

  // Click a base → show action menu (advance / score / out / cancel).
  const handleBaseClick = (baseIdx) => {
    if (!bases[baseIdx]) return;
    setBaseActionMenu({ baseIdx, step: 'main' });
  };

  const ADVANCE_REASONS = [
    { key: 'sb',       label: 'Stolen Base'  },
    { key: 'wp',       label: 'Wild Pitch'   },
    { key: 'pb',       label: 'Passed Ball'  },
    { key: 'on-play',  label: 'On Last Play' },
    { key: 'other',    label: 'Other'        },
  ];

  const OUT_REASONS = [
    { key: 'cs',        label: 'Caught Stealing' },
    { key: 'po',        label: 'Picked Off'       },
    { key: 'out-play',  label: 'On Last Play'     },
    { key: 'rundown',   label: 'Run Down'         },
    { key: 'out-other', label: 'Other'            },
  ];

  const handleBaseAction = (action, reason = null) => {
    if (!baseActionMenu) return;
    const { baseIdx } = baseActionMenu;

    if (action === 'cancel')  { setBaseActionMenu(null); return; }
    if (action === 'advance') { setBaseActionMenu({ baseIdx, step: 'advance-reason' }); return; }
    if (action === 'out')     { setBaseActionMenu({ baseIdx, step: 'out-reason' }); return; }
    if (action === 'back')    { setBaseActionMenu({ baseIdx, step: 'main' }); return; }

    // 'do-advance' (with reason), 'do-out' (with reason), 'score'
    setBaseActionMenu(null);
    pushHistory();
    setGameState(prev => {
      const newBases = [...prev.bases];
      const runner   = newBases[baseIdx];
      newBases[baseIdx] = null;
      let newOuts   = prev.outs;
      let newIsTop  = prev.isTop;
      let newInning = prev.inning;
      let newScore  = { ...prev.score };
      const newInningScores = prev.inningScores.map(r => ({ ...r }));
      const newRunnerEvents = [...(prev.runnerEvents || [])];
      const side = prev.isTop ? 'away' : 'home';
      let newGameEventSeq = Math.max(prev.gameEventSeq || 0, (prev.paLog?.length || 0) + (prev.runnerEvents?.length || 0));

      const scoreRunner = () => {
        if (side === 'away') newScore.away++;
        else newScore.home++;
        const idx = Math.min(prev.inning - 1, 8);
        if (side === 'away') newInningScores[idx].away = (newInningScores[idx].away || 0) + 1;
        else newInningScores[idx].home = (newInningScores[idx].home || 0) + 1;
      };

      if (action === 'do-advance') {
        if (reason === 'wp' || reason === 'pb') {
          // BK-69: advance ALL occupied bases by one simultaneously (high→low to avoid collisions)
          for (let b = 2; b >= 0; b--) {
            const r = newBases[b];
            if (!r) continue;
            newBases[b] = null;
            if (b === 2) {
              scoreRunner();
            } else {
              newBases[b + 1] = r;
            }
            newRunnerEvents.push({
              type:       reason,
              runnerId:   r?.id   || null,
              runnerName: r?.name || '?',
              fromBase:   b,
              toBase:     Math.min(b + 1, 3),
              inning:     prev.inning,
              side,
              seq:        newGameEventSeq++,
            });
          }
        } else {
          const nextBase = baseIdx + 1;
          if (nextBase <= 2) {
            newBases[nextBase] = runner;
          } else {
            scoreRunner(); // advancing from 3B scores
          }
          newRunnerEvents.push({
            type:       reason,
            runnerId:   runner?.id   || null,
            runnerName: runner?.name || '?',
            fromBase:   baseIdx,
            toBase:     Math.min(baseIdx + 1, 3),
            inning:     prev.inning,
            side,
            seq:        newGameEventSeq++,
          });
        }
      } else if (action === 'do-out') {
        newOuts = prev.outs + 1;
        const fieldingPitcher = prev.isTop
          ? (gameData.currentHomePitcher || gameData.homePitcher)
          : (gameData.currentAwayPitcher || gameData.awayPitcher);
        newRunnerEvents.push({
          type:       reason,
          runnerId:   runner?.id   || null,
          runnerName: runner?.name || '?',
          fromBase:   baseIdx,
          toBase:     null,
          inning:     prev.inning,
          side,
          pitcherId:  fieldingPitcher?.id ?? null,
          seq:        newGameEventSeq++,
        });

        // ── 3 outs: flip inning (mirrors applyOutcome logic) ──────────────
        if (newOuts >= 3) {
          newOuts  = 0;
          newBases[0] = null; newBases[1] = null; newBases[2] = null;
          if (prev.isTop) {
            newIsTop = false;
            while (newInningScores.length < newInning) newInningScores.push({ home: null, away: null });
            if (newInningScores[newInning - 1].away == null) {
              newInningScores[newInning - 1].away = newScore.away - prev.inningScores.slice(0, newInning - 1).reduce((s, r) => s + (r.away || 0), 0);
            }
          } else {
            if (newInningScores[newInning - 1].home == null) {
              newInningScores[newInning - 1].home = newScore.home - prev.inningScores.slice(0, newInning - 1).reduce((s, r) => s + (r.home || 0), 0);
            }
            newIsTop  = true;
            newInning = newInning + 1;
            while (newInningScores.length < newInning) newInningScores.push({ home: null, away: null });
          }
        }
      } else if (action === 'score') {
        scoreRunner();
      }

      return { ...prev, bases: newBases, outs: newOuts, isTop: newIsTop, inning: newInning, score: newScore, inningScores: newInningScores, runnerEvents: newRunnerEvents, gameEventSeq: newGameEventSeq, balls: newOuts === 0 ? 0 : prev.balls, strikes: newOuts === 0 ? 0 : prev.strikes };
    });
  };

  const endHalfInning = () => {
    pushHistory();
    const newBases = [null, null, null];
    const newIsTop = !isTop;
    const newInning = !isTop ? inning + 1 : inning;
    const newInningScores = inningScores.map(r => ({ ...r }));
    while (newInningScores.length < newInning) {
      newInningScores.push({ home: null, away: null });
    }
    // Capture the inning run total for the half that just ended
    if (isTop && newInningScores[inning - 1].away == null) {
      const prevAway = inningScores.slice(0, inning - 1).reduce((s, r) => s + (r.away ?? 0), 0);
      newInningScores[inning - 1].away = score.away - prevAway;
    } else if (!isTop && newInningScores[inning - 1].home == null) {
      const prevHome = inningScores.slice(0, inning - 1).reduce((s, r) => s + (r.home ?? 0), 0);
      newInningScores[inning - 1].home = score.home - prevHome;
    }
    update({
      outs: 0, balls: 0, strikes: 0,
      bases: newBases, isTop: newIsTop,
      inning: newInning, inningScores: newInningScores,
    });
  };

  const totalInnings = Math.max(9, inningScores.length);

  // BK-24: pitcher arsenal for pitch-type selector
  const currentPitcherForArsenal = isTop
    ? (gameData.currentHomePitcher || gameData.homePitcher)
    : (gameData.currentAwayPitcher || gameData.awayPitcher);
  const rawArsenal = currentPitcherForArsenal
    ? ((gameData.arsenalById || {})[currentPitcherForArsenal.id] || [])
    : [];
  const displayArsenal = rawArsenal.length > 0
    ? [...rawArsenal].sort((a, b) => (b.pct || 0) - (a.pct || 0)).slice(0, 5)
    : FALLBACK_ARSENAL;

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Store latest handlers in a ref so the event listener never goes stale.
  shortcutRef.current = {
    addBall, addCalledStrike, addSwingMiss, addFoul,
    cancelBIP, setPitchMenuOpen, setBipStep, undo,
    bipStep, bipContact, pitchMenuOpen,
    menuFocusIdx, setMenuFocusIdx,
    selectBIPContact, selectBIPOutcome, confirmBIPFlag,
    selectFCRunner, confirmFCDP, bipFCRetiredBase, bipFCIsDP,
    selectedPitchType, setSelectedPitchType,
    displayArsenal,
    bipNotation, setBipNotation, confirmNotation,
    bases,
    tagUpActive, confirmTagUp, setTagUpActive, setTagUpRunners,
  };
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.altKey) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        shortcutRef.current.undo?.();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      const r = shortcutRef.current;
      // Backspace: context-aware "go back" through BIP layers / close modal
      if (e.key === 'Backspace') {
        const { bipStep, pitchMenuOpen } = r;
        if (pitchMenuOpen) { e.preventDefault(); r.setPitchMenuOpen(false); return; }
        if (bipStep === 'notation') {
          e.preventDefault();
          if (r.bipNotation.length > 0) { r.setBipNotation(n => n.slice(0, -1)); }
          else { r.setBipStep('outcome'); }
          return;
        }
        if (bipStep === 'flag')    { e.preventDefault(); r.setBipStep('outcome'); return; }
        if (bipStep === 'fc-dp')     { e.preventDefault(); r.setBipStep('fc-runner'); return; }
        if (bipStep === 'fc-runner') { e.preventDefault(); r.setBipStep('outcome');   return; }
        if (bipStep === 'outcome') { e.preventDefault(); r.setBipStep('contact'); return; }
        if (bipStep === 'contact') { e.preventDefault(); r.cancelBIP(); return; }
        return; // no active flow — let browser handle normally
      }
      // Escape: full cancel (close everything)
      if (e.key === 'Escape') {
        e.preventDefault();
        r.setPitchMenuOpen(false);
        r.cancelBIP();
        if (r.tagUpActive) { r.setTagUpActive(false); r.setTagUpRunners([]); }
        return;
      }
      // Tag-up overlay: Enter to confirm, Escape handled above
      if (r.tagUpActive && e.key === 'Enter') {
        e.preventDefault(); r.confirmTagUp(); return;
      }
      // Enter in notation step: confirm
      if (e.key === 'Enter' && r.bipStep === 'notation') {
        e.preventDefault(); r.confirmNotation(); return;
      }
      // Arrow + Enter: navigate items in active menus
      const menuActive = r.pitchMenuOpen || (r.bipStep !== null && r.bipStep !== 'notation');
      if (menuActive && ['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter'].includes(e.key)) {
        e.preventDefault();
        let count = 0;
        if (r.pitchMenuOpen) {
          count = document.querySelectorAll('.pitch-modal-sheet .pitch-modal-item').length;
        } else if (r.bipStep === 'contact') {
          count = BIP_CONTACTS.length;
        } else if (r.bipStep === 'outcome') {
          count = (BIP_OUTCOMES[r.bipContact] || []).length;
        } else if (r.bipStep === 'flag') {
          count = 2;
        } else if (r.bipStep === 'fc-runner') {
          count = r.bases.filter(Boolean).length + 1; // occupied bases + "Unspecified"
        } else if (r.bipStep === 'fc-dp') {
          count = 2;
        }
        if (count === 0) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          r.setMenuFocusIdx(i => (i + 1) % count);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          r.setMenuFocusIdx(i => (i - 1 + count) % count);
        } else if (e.key === 'Enter') {
          const idx = r.menuFocusIdx;
          if (r.pitchMenuOpen) {
            document.querySelectorAll('.pitch-modal-sheet .pitch-modal-item')[idx]?.click();
          } else if (r.bipStep === 'contact') {
            r.selectBIPContact(BIP_CONTACTS[idx].key);
          } else if (r.bipStep === 'outcome') {
            const outcomes = BIP_OUTCOMES[r.bipContact] || [];
            if (outcomes[idx]) r.selectBIPOutcome(outcomes[idx].key);
          } else if (r.bipStep === 'flag') {
            if (idx === 0) {
              r.confirmBIPFlag('out');
            } else {
              r.confirmBIPFlag(['fb','ld','pf'].includes(r.bipContact) ? 'sacfly' : 'dp');
            }
          } else if (r.bipStep === 'fc-runner') {
            const occupiedBases = [0,1,2].filter(i => r.bases[i]);
            if (idx < occupiedBases.length) r.selectFCRunner(occupiedBases[idx]);
            else r.selectFCRunner(null);
          } else if (r.bipStep === 'fc-dp') {
            if (idx === 0) r.confirmFCDP(false);
            else r.confirmFCDP(true);
          }
        }
        return;
      }
      // Digit keys: context-sensitive — contact layer, outcome layer, notation, or pitch pad
      const digit = e.key === '0' ? 0 : parseInt(e.key, 10);
      if (!isNaN(digit) && (digit === 0 || digit >= 1)) {
        // 1–9: add fielder position in notation step
        if (r.bipStep === 'notation' && digit >= 1 && digit <= 9) {
          e.preventDefault(); r.setBipNotation(n => [...n, digit]); return;
        }
        // 1–5: select BIP contact type
        if (digit >= 1 && digit <= 5 && r.bipStep === 'contact') {
          e.preventDefault();
          const contact = BIP_CONTACTS[digit - 1];
          if (contact) r.selectBIPContact(contact.key);
          return;
        }
        // 0–9: select BIP outcome by position (1 = first, 0 = tenth)
        if (r.bipStep === 'outcome') {
          const outcomes = BIP_OUTCOMES[r.bipContact] || [];
          const idx = digit === 0 ? 9 : digit - 1;
          const match = outcomes[idx];
          if (match) { e.preventDefault(); r.selectBIPOutcome(match.key); return; }
          return;
        }
        // 1–9: select pitch type by arsenal rank (idle state)
        if (digit >= 1 && !r.pitchMenuOpen && r.bipStep === null) {
          const pitch = r.displayArsenal[digit - 1];
          if (pitch) {
            e.preventDefault();
            r.setSelectedPitchType(prev => prev === pitch.type ? null : pitch.type);
          }
          return;
        }
      }
      switch (e.key.toLowerCase()) {
        case 'b': e.preventDefault(); r.addBall();             break;
        case 'c': e.preventDefault(); r.addCalledStrike();     break;
        case 's': e.preventDefault(); r.addSwingMiss();           break;
        case 'f': e.preventDefault(); r.addFoul();               break;
        case 'p': e.preventDefault(); r.setBipStep('contact');   break;
        case 'o': e.preventDefault(); r.setPitchMenuOpen(true);  break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // empty deps — always reads latest handlers from ref

  // Reset menu focus index whenever the active menu changes
  useEffect(() => { setMenuFocusIdx(0); }, [bipStep, pitchMenuOpen]);

  // ── Line score H / E tallies derived from paLog ──────────────────────────
  // H = hits by that team (side === team's batting side, isHit === true)
  // E = errors committed by that team's FIELDING — i.e. opponent is batting
  //     and outcome === 'error' (the fielding team let the batter reach)
  // ── Fetch fatigue data for pitchers as they appear ─────────────────────
  const homePitcherId = (gameData?.currentHomePitcher || gameData?.homePitcher)?.id;
  const awayPitcherId = (gameData?.currentAwayPitcher || gameData?.awayPitcher)?.id;
  useEffect(() => {
    [homePitcherId, awayPitcherId].forEach(pid => {
      if (!pid || fetchedFatigueIds.current.has(pid)) return;
      fetchedFatigueIds.current.add(pid);
      api.getPitcherFatigue(pid)
        .then(d => setFatigueData(prev => ({ ...prev, [pid]: d })))
        .catch(() => {});
    });
  }, [homePitcherId, awayPitcherId]);

  const log = paLog || [];
  const awayH = log.filter(p => p.side === 'away' && p.isHit).length;
  const homeH = log.filter(p => p.side === 'home' && p.isHit).length;
  // away fielding errors = home team is batting and reached on error
  const awayE = log.filter(p => p.side === 'home' && p.outcome === 'error').length;
  const homeE = log.filter(p => p.side === 'away' && p.outcome === 'error').length;

  return (
    <div className="scorebook">
      {/* ── Line Score ──────────────────────────────────────────────────── */}
      <div className="card line-score-card">
        <div className="section-title" style={{ marginBottom: lineScoreOpen ? 10 : 0, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setLineScoreOpen(v => !v)}>
          <span style={{ fontSize: 10, opacity: 0.5, transition: 'transform .15s', transform: lineScoreOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
          Line Score
        </div>
        {lineScoreOpen && (
          <div className="table-scroll">
          <table className="stat-table line-score-tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 80, textAlign: 'left' }}>Team</th>
                {Array.from({ length: totalInnings }, (_, i) => (
                  <th key={i} style={{
                    background: i + 1 === inning ? 'var(--accent-glow)' : undefined,
                    color: i + 1 === inning ? 'var(--accent)' : undefined,
                  }}>
                    {i + 1}
                  </th>
                ))}
                <th style={{ borderLeft: '2px solid var(--border)', fontWeight: 700 }}>R</th>
                <th>H</th>
                <th>E</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="name-cell">{awayTeam?.abbreviation}</td>
                {Array.from({ length: totalInnings }, (_, i) => (
                  <td key={i} style={{
                    background: i + 1 === inning && isTop ? 'var(--accent-glow)' : undefined,
                  }}>
                    {inningScores[i]?.away != null ? inningScores[i].away : ''}
                  </td>
                ))}
                <td style={{ borderLeft: '2px solid var(--border)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {score.away}
                </td>
                <td style={{ color: awayH > 0 ? 'var(--text-primary)' : 'var(--text-dim)' }}>{awayH}</td>
                <td style={{ color: awayE > 0 ? '#f87171' : 'var(--text-dim)' }}>{awayE}</td>
              </tr>
              <tr>
                <td className="name-cell">{homeTeam?.abbreviation}</td>
                {Array.from({ length: totalInnings }, (_, i) => (
                  <td key={i} style={{
                    background: i + 1 === inning && !isTop ? 'var(--accent-glow)' : undefined,
                  }}>
                    {inningScores[i]?.home != null ? inningScores[i].home : ''}
                  </td>
                ))}
                <td style={{ borderLeft: '2px solid var(--border)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {score.home}
                </td>
                <td style={{ color: homeH > 0 ? 'var(--text-primary)' : 'var(--text-dim)' }}>{homeH}</td>
                <td style={{ color: homeE > 0 ? '#f87171' : 'var(--text-dim)' }}>{homeE}</td>
              </tr>
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* ── Live Game State ──────────────────────────────────────────────── */}
      <div className="scorebook-controls-row">

        {/* Diamond + Count */}
        <div className="card diamond-card">
          <div className="inning-display">
            <span className="inning-half">{isTop ? '▲' : '▼'}</span>
            <span className="inning-num">{inning}</span>
            <span className="inning-label">INNING</span>
          </div>

          {/* Diamond SVG — viewBox expanded to leave room for runner labels */}
          <div className="diamond-wrap" style={{ position: 'relative' }}>
            <svg viewBox="-32 -20 164 132" width="164" height="132">
              {/* Base paths */}
              <polygon points="50,10 90,50 50,90 10,50" fill="none" stroke="var(--border)" strokeWidth="1.5" />

              {/* 2B (top) */}
              <rect
                x="42" y="2" width="16" height="16"
                fill={bases[1] ? '#f59e0b' : 'var(--bg-card)'}
                stroke={bases[1] ? '#f59e0b' : 'var(--text-dim)'}
                strokeWidth="1.5" rx="2"
                onClick={() => handleBaseClick(1)}
                style={{ cursor: 'pointer', transform: 'rotate(45deg)', transformOrigin: '50px 10px' }}
              />
              {bases[1] && (
                <text x="50" y="-7" textAnchor="middle" fontSize="9" fontWeight="700"
                  fontFamily="monospace" fill="#f59e0b">
                  {runnerLabel(bases[1])}
                </text>
              )}

              {/* 3B (left) */}
              <rect
                x="2" y="42" width="16" height="16"
                fill={bases[2] ? '#f59e0b' : 'var(--bg-card)'}
                stroke={bases[2] ? '#f59e0b' : 'var(--text-dim)'}
                strokeWidth="1.5" rx="2"
                onClick={() => handleBaseClick(2)}
                style={{ cursor: 'pointer', transform: 'rotate(45deg)', transformOrigin: '10px 50px' }}
              />
              {bases[2] && (
                <text x="-5" y="54" textAnchor="end" fontSize="9" fontWeight="700"
                  fontFamily="monospace" fill="#f59e0b">
                  {runnerLabel(bases[2])}
                </text>
              )}

              {/* 1B (right) */}
              <rect
                x="82" y="42" width="16" height="16"
                fill={bases[0] ? '#f59e0b' : 'var(--bg-card)'}
                stroke={bases[0] ? '#f59e0b' : 'var(--text-dim)'}
                strokeWidth="1.5" rx="2"
                onClick={() => handleBaseClick(0)}
                style={{ cursor: 'pointer', transform: 'rotate(45deg)', transformOrigin: '90px 50px' }}
              />
              {bases[0] && (
                <text x="99" y="54" textAnchor="start" fontSize="9" fontWeight="700"
                  fontFamily="monospace" fill="#f59e0b">
                  {runnerLabel(bases[0])}
                </text>
              )}

              {/* Home */}
              <rect x="42" y="82" width="16" height="16" fill="var(--bg-panel)" stroke="var(--text-dim)" strokeWidth="1.5" rx="2"
                style={{ transform: 'rotate(45deg)', transformOrigin: '50px 90px' }} />
            </svg>
            {/* Base action menu — advance / score / out */}
            {baseActionMenu !== null && (() => {
              const { baseIdx, step } = baseActionMenu;
              const menuPositions = [
                { top: '44%', left: '76%' },  // 1B — right
                { top: '0%',  left: '38%' },  // 2B — top
                { top: '44%', left: '-2%' },  // 3B — left
              ];
              const pos = menuPositions[baseIdx];

              if (step === 'advance-reason') {
                return (
                  <div className="base-action-menu" style={{ top: pos.top, left: pos.left }}>
                    <span className="base-action-label">Why?</span>
                    {ADVANCE_REASONS.map(r => (
                      <button
                        key={r.key}
                        className={`base-action-btn${r.key === 'sb' ? ' base-action-sb' : ''}`}
                        onClick={() => handleBaseAction('do-advance', r.key)}
                      >
                        {r.label}
                      </button>
                    ))}
                    <button className="base-action-btn base-action-cancel" onClick={() => handleBaseAction('back')}>
                      ← Back
                    </button>
                  </div>
                );
              }

              if (step === 'out-reason') {
                return (
                  <div className="base-action-menu" style={{ top: pos.top, left: pos.left }}>
                    <span className="base-action-label">How out?</span>
                    {OUT_REASONS.map(r => (
                      <button
                        key={r.key}
                        className="base-action-btn base-action-out"
                        onClick={() => handleBaseAction('do-out', r.key)}
                      >
                        {r.label}
                      </button>
                    ))}
                    <button className="base-action-btn base-action-cancel" onClick={() => handleBaseAction('back')}>
                      ← Back
                    </button>
                  </div>
                );
              }

              return (
                <div
                  className="base-action-menu"
                  style={{ top: pos.top, left: pos.left }}
                >
                  {baseIdx < 2 && (
                    <button className="base-action-btn" onClick={() => handleBaseAction('advance')}>
                      Advance
                    </button>
                  )}
                  <button className="base-action-btn base-action-score" onClick={() => handleBaseAction('score')}>
                    Score
                  </button>
                  <button className="base-action-btn base-action-out" onClick={() => handleBaseAction('out')}>
                    Out
                  </button>
                  <button className="base-action-btn base-action-cancel" onClick={() => handleBaseAction('cancel')}>
                    ✕
                  </button>
                </div>
              );
            })()}
          </div>

          {/* Count display */}
          <div className="count-display">
            <div className="count-row">
              <span className="count-label">B</span>
              {[0,1,2].map(i => (
                <div key={i} className={`count-dot ${i < balls ? 'ball' : ''}`} />
              ))}
            </div>
            <div className="count-row">
              <span className="count-label">S</span>
              {[0,1].map(i => (
                <div key={i} className={`count-dot ${i < strikes ? 'strike' : ''}`} />
              ))}
            </div>
            <div className="count-row">
              <span className="count-label">O</span>
              {[0,1].map(i => (
                <div key={i} className={`count-dot ${i < outs ? 'out' : ''}`} />
              ))}
            </div>
          </div>
        </div>

        {/* Pitch Controls — BK-34 redesign */}
        <div className="card pitch-controls-card">

          {/* ── BK-24: Pitch type selector ──────────────────────────────── */}
          {bipStep === null && !tagUpActive && (
            <div className="pitch-type-row">
              {displayArsenal.map((p, i) => (
                <button
                  key={p.type}
                  className={`pitch-type-btn${selectedPitchType === p.type ? ' active' : ''}`}
                  onClick={() => setSelectedPitchType(selectedPitchType === p.type ? null : p.type)}
                  title={p.name}
                >
                  {p.type}
                  {i < 9 && <kbd className="pitch-type-kbd">{i + 1}</kbd>}
                </button>
              ))}
            </div>
          )}

          {/* ── BK-68: Tag-up prompt after fly/LD outs ────────────────────── */}
          {tagUpActive && (
            <div className="bip-layer">
              <div className="bip-label">Tag-Up Advancement</div>
              <div className="tagup-grid">
                {tagUpRunners.map(({ runner, fromBase, dest }, i) => {
                  const baseLabels = ['1B', '2B', '3B'];
                  const destOptions = [
                    ['Stay', fromBase],
                    ...[0, 1, 2].filter(b => b > fromBase).map(b => [baseLabels[b], b]),
                    ['Score', 'score'],
                  ];
                  return (
                    <div key={i} className="tagup-row">
                      <span className="tagup-name">
                        {runner.name || '?'}
                        <span className="tagup-from"> ({baseLabels[fromBase]})</span>
                      </span>
                      <div className="tagup-btns">
                        {destOptions.map(([label, destVal]) => (
                          <button
                            key={label}
                            type="button"
                            className={`runner-dest-btn${dest === destVal ? ' active' : ''}`}
                            onClick={() => setTagUpRunners(prev =>
                              prev.map((r, j) => j === i ? { ...r, dest: destVal } : r)
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, alignSelf: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setTagUpActive(false); setTagUpRunners([]); }}
                >
                  Skip
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={confirmTagUp}
                >
                  Confirm ✓ <kbd className="pitch-pad-kbd">↵</kbd>
                </button>
              </div>
            </div>
          )}

          {/* ── Layer 1: 6 pitch pad buttons (default view) ───────────────── */}
          {bipStep === null && !tagUpActive && (
            <div className="pitch-pad">
              <button className="pitch-pad-btn ball-btn"   onClick={addBall}         title="Ball [B]">
                <span className="pitch-pad-badge">B</span>
                <span className="pitch-pad-label">Ball</span>
                <kbd className="pitch-pad-kbd">B</kbd>
              </button>
              <button className="pitch-pad-btn called-btn" onClick={addCalledStrike} title="Called Strike [C]">
                <span className="pitch-pad-badge">
                  <span style={{ display:'inline-block', transform:'scaleX(-1)' }}>K</span>
                </span>
                <span className="pitch-pad-label">Called<br/>Strike</span>
                <kbd className="pitch-pad-kbd">C</kbd>
              </button>
              <button className="pitch-pad-btn swing-btn"  onClick={addSwingMiss}    title="Swing & Miss [S]">
                <span className="pitch-pad-badge">K</span>
                <span className="pitch-pad-label">Swing<br/>&amp; Miss</span>
                <kbd className="pitch-pad-kbd">S</kbd>
              </button>
              <button className="pitch-pad-btn foul-btn"   onClick={addFoul}         title="Foul Ball [F]">
                <span className="pitch-pad-badge">F</span>
                <span className="pitch-pad-label">Foul<br/>Ball</span>
                <kbd className="pitch-pad-kbd">F</kbd>
              </button>
              <button className="pitch-pad-btn bip-btn"    onClick={() => setBipStep('contact')} title="Ball In Play [P]">
                <span className="pitch-pad-badge">⚾</span>
                <span className="pitch-pad-label">Ball<br/>In Play</span>
                <kbd className="pitch-pad-kbd">P</kbd>
              </button>
              <button className="pitch-pad-btn more-btn"   onClick={() => setPitchMenuOpen(true)} title="Pitch menu [O]">
                <span className="pitch-pad-badge">···</span>
                <span className="pitch-pad-label">Pitch</span>
                <kbd className="pitch-pad-kbd">O</kbd>
              </button>
            </div>
          )}

          {/* ── Layer 2: BIP contact type selection ───────────────────────── */}
          {bipStep === 'contact' && (
            <div className="bip-layer">
              <button className="bip-back-btn" onClick={cancelBIP}>← Back <kbd className="pitch-pad-kbd">⌫</kbd></button>
              <div className="bip-label">Contact Type</div>
              <div className="bip-contact-grid">
                {BIP_CONTACTS.map((c, i) => (
                  <button key={c.key} className={`bip-contact-btn${menuFocusIdx === i ? ' kbd-focused' : ''}`} onClick={() => selectBIPContact(c.key)}>
                    <span className="bip-kbd-hint">{i + 1}</span>
                    <span className="bip-contact-abbr">{c.abbr}</span>
                    <span className="bip-contact-name">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Layer 3: BIP outcome selection ────────────────────────────── */}
          {bipStep === 'outcome' && bipContact && (
            <div className="bip-layer">
              <button className="bip-back-btn" onClick={() => setBipStep('contact')}>
                ← {BIP_CONTACTS.find(c => c.key === bipContact)?.label} <kbd className="pitch-pad-kbd">⌫</kbd>
              </button>
              <div className="bip-label">Outcome</div>
              <div className="bip-outcome-grid">
                {(BIP_OUTCOMES[bipContact] || []).map((o, i) => (
                  <button
                    key={o.key}
                    className={`bip-outcome-btn ${o.cls}${menuFocusIdx === i ? ' kbd-focused' : ''}`}
                    onClick={() => selectBIPOutcome(o.key)}
                    title={OUTCOME_FULL_NAME[o.key] || o.label}
                  >
                    {i < 10 && (
                      <span className="bip-kbd-hint">{(i + 1) % 10}</span>
                    )}
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Layer 4: SF / DP flag step ────────────────────────────────── */}
          {bipStep === 'flag' && (
            <div className="bip-layer">
              <button className="bip-back-btn" onClick={() => setBipStep('outcome')}>← Back <kbd className="pitch-pad-kbd">⌫</kbd></button>
              <div className="bip-label">
                {['fb','ld','pf'].includes(bipContact) ? 'Sacrifice Fly?' : 'Double Play?'}
              </div>
              <div className="bip-flag-row">
                <button className={`bip-outcome-btn out-btn${menuFocusIdx === 0 ? ' kbd-focused' : ''}`} onClick={() => confirmBIPFlag('out')}>
                  Regular Out
                </button>
                {['fb','ld','pf'].includes(bipContact) ? (
                  <button className={`bip-outcome-btn neutral-btn${menuFocusIdx === 1 ? ' kbd-focused' : ''}`} onClick={() => confirmBIPFlag('sacfly')}>
                    Sacrifice Fly ✓
                  </button>
                ) : (
                  <button className={`bip-outcome-btn out-btn${menuFocusIdx === 1 ? ' kbd-focused' : ''}`} onClick={() => confirmBIPFlag('dp')}>
                    Double Play
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── FC: which runner was retired ─────────────────────────── */}
          {bipStep === 'fc-runner' && (() => {
            const occupiedBases = [0,1,2].filter(i => bases[i]);
            const BASE_LABELS = ['1st', '2nd', '3rd'];
            return (
              <div className="bip-layer">
                <button className="bip-back-btn" onClick={() => setBipStep('outcome')}>← Back <kbd className="pitch-pad-kbd">⌫</kbd></button>
                <div className="bip-label">Which runner was put out?</div>
                <div className="bip-fc-grid">
                  {occupiedBases.map((baseIdx, btnIdx) => {
                    const r = bases[baseIdx];
                    const label = r?.jerseyNumber ? `#${r.jerseyNumber}` : r?.name?.split(' ').pop() || '?';
                    return (
                      <button
                        key={baseIdx}
                        className={`bip-flag-btn${menuFocusIdx === btnIdx ? ' kbd-focused' : ''}`}
                        onClick={() => selectFCRunner(baseIdx)}
                      >
                        <span className="bip-fc-base">{BASE_LABELS[baseIdx]}</span>
                        <span className="bip-fc-name">{label}</span>
                      </button>
                    );
                  })}
                  <button
                    className={`bip-flag-btn neutral${menuFocusIdx === occupiedBases.length ? ' kbd-focused' : ''}`}
                    onClick={() => selectFCRunner(null)}
                  >
                    Unspecified
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── FC: double play? ──────────────────────────────────────── */}
          {bipStep === 'fc-dp' && (() => {
            const BASE_LABELS = ['1st', '2nd', '3rd'];
            const retiredLabel = bipFCRetiredBase != null ? BASE_LABELS[bipFCRetiredBase] : null;
            return (
              <div className="bip-layer">
                <button className="bip-back-btn" onClick={() => setBipStep('fc-runner')}>← Back <kbd className="pitch-pad-kbd">⌫</kbd></button>
                <div className="bip-label">{retiredLabel ? `${retiredLabel} runner out — Double Play?` : 'Double Play?'}</div>
                <div className="bip-flag-grid">
                  <button
                    className={`bip-flag-btn${menuFocusIdx === 0 ? ' kbd-focused' : ''}`}
                    onClick={() => confirmFCDP(false)}
                  >
                    No — 1 Out
                  </button>
                  <button
                    className={`bip-flag-btn out-btn${menuFocusIdx === 1 ? ' kbd-focused' : ''}`}
                    onClick={() => confirmFCDP(true)}
                  >
                    Yes — DP (2 Outs)
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── Layer 5: BK-33 Fielding notation ──────────────────────── */}
          {bipStep === 'notation' && (
            <div className="bip-layer">
              <button className="bip-back-btn" onClick={() => {
                setBipNotation([]);
                setBipPendingOutcome(null);
                setBipStep('outcome');
              }}>← Back <kbd className="pitch-pad-kbd">⌫</kbd></button>
              <div className="bip-label">Fielding</div>
              <div className="notation-display">
                {bipNotation.length > 0 ? bipNotation.join('-') : '—'}
              </div>
              <svg className="field-diagram" viewBox="0 0 200 180" xmlns="http://www.w3.org/2000/svg">
                {/* Field shape hint */}
                <path d="M100,170 L15,85 L100,5 L185,85 Z" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                <line x1="100" y1="170" x2="100" y2="5" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                {/* Fielder positions */}
                {[
                  { n: 1, x: 100, y: 130, label: 'P'  },
                  { n: 2, x: 100, y: 165, label: 'C'  },
                  { n: 3, x: 160, y: 100, label: '1B' },
                  { n: 4, x: 125, y: 72,  label: '2B' },
                  { n: 5, x: 40,  y: 100, label: '3B' },
                  { n: 6, x: 75,  y: 72,  label: 'SS' },
                  { n: 7, x: 30,  y: 30,  label: 'LF' },
                  { n: 8, x: 100, y: 15,  label: 'CF' },
                  { n: 9, x: 170, y: 30,  label: 'RF' },
                ].map(pos => (
                  <g key={pos.n} className="field-pos-group" onClick={() => setBipNotation(n => [...n, pos.n])}>
                    <circle cx={pos.x} cy={pos.y} r="16"
                      className={`field-pos-circle${bipNotation.includes(pos.n) ? ' field-pos-active' : ''}`} />
                    <text x={pos.x} y={pos.y - 3} textAnchor="middle" className="field-pos-number">{pos.n}</text>
                    <text x={pos.x} y={pos.y + 10} textAnchor="middle" className="field-pos-label">{pos.label}</text>
                  </g>
                ))}
              </svg>
              <div className="notation-actions">
                <button className="notation-undo-btn" disabled={bipNotation.length === 0}
                  onClick={() => setBipNotation(n => n.slice(0, -1))}>
                  ⌫ Undo
                </button>
                <button className="notation-clear-btn" disabled={bipNotation.length === 0}
                  onClick={() => setBipNotation([])}>
                  Clear
                </button>
                <button className="notation-confirm-btn" onClick={confirmNotation}>
                  Confirm ↵
                </button>
              </div>
            </div>
          )}

          {/* Undo + End Half-Inning */}
          <div className="pitch-undo-row" style={{ marginTop: 10 }}>
            <button className="undo-btn" onClick={endHalfInning} title="End half-inning (3 outs)">
              End Half-Inning
            </button>
            <button className="undo-btn" onClick={undo} disabled={!canUndo} title="Undo last action — ⌘Z">
              ↩ Undo <kbd>⌘Z</kbd>
            </button>
          </div>
        </div>

        {/* ── Pitch ··· Modal ──────────────────────────────────────────────── */}
        {pitchMenuOpen && (
          <div className="pitch-modal-backdrop" onClick={() => setPitchMenuOpen(false)}>
            <div className="pitch-modal-sheet" onClick={e => e.stopPropagation()}>
              <div className="pitch-modal-header">
                <span className="pitch-modal-title">Pitch</span>
                <button className="pitch-modal-undo" onClick={() => { undo(); setPitchMenuOpen(false); }}
                  disabled={!canUndo}>Undo</button>
              </div>

              {/* Foul Ball */}
              <button className={`pitch-modal-item${menuFocusIdx === 0 ? ' kbd-focused' : ''}`} onClick={() => { addFoul(); setPitchMenuOpen(false); }}>
                <span className="pitch-modal-badge">F</span>
                <span className="pitch-modal-item-label">Foul Ball</span>
              </button>

              {/* Ball In Play */}
              <button className={`pitch-modal-item${menuFocusIdx === 1 ? ' kbd-focused' : ''}`} onClick={() => { setPitchMenuOpen(false); setBipStep('contact'); }}>
                <span className="pitch-modal-badge bip-badge">⚾</span>
                <span className="pitch-modal-item-label">Ball In Play</span>
                <span className="pitch-modal-arrow">›</span>
              </button>

              <div className="pitch-modal-divider" />

              {/* Hit By Pitch */}
              <button className={`pitch-modal-item${menuFocusIdx === 2 ? ' kbd-focused' : ''}`} onClick={() => { appendPitch(selectedPitchType, 'P'); setSelectedPitchType(null); pushHistory(); applyOutcome('hbp', true); setPitchMenuOpen(false); }}>
                <span className="pitch-modal-badge">HP</span>
                <span className="pitch-modal-item-label">Hit By Pitch</span>
              </button>

              {/* Intentional Ball */}
              <button className={`pitch-modal-item${menuFocusIdx === 3 ? ' kbd-focused' : ''}`} onClick={() => { addBall(); setPitchMenuOpen(false); }}>
                <span className="pitch-modal-badge">IB</span>
                <span className="pitch-modal-item-label">Intentional Ball</span>
              </button>

              {/* Intentional Walk */}
              <button className={`pitch-modal-item${menuFocusIdx === 4 ? ' kbd-focused' : ''}`} onClick={() => { pushHistory(); applyOutcome('ibb', false); setPitchMenuOpen(false); }}>
                <span className="pitch-modal-badge">IBB</span>
                <span className="pitch-modal-item-label">Intentional Walk</span>
              </button>

              {/* Catcher's Interference */}
              <button className={`pitch-modal-item${menuFocusIdx === 5 ? ' kbd-focused' : ''}`} onClick={() => { appendPitch(selectedPitchType, 'P'); setSelectedPitchType(null); pushHistory(); applyOutcome('ci', false); setPitchMenuOpen(false); }}>
                <span className="pitch-modal-badge">CI</span>
                <span className="pitch-modal-item-label">C. Interference</span>
              </button>

              {/* Balk */}
              <button className={`pitch-modal-item${menuFocusIdx === 6 ? ' kbd-focused' : ''}`} onClick={() => { applyBalk(); setPitchMenuOpen(false); }}>
                <span className="pitch-modal-badge">BK</span>
                <span className="pitch-modal-item-label">Balk</span>
              </button>

              {/* Illegal Pitch — with inline sub-options */}
              <PitchModalILP onSelect={(advance) => { applyIllegalPitch(advance); setPitchMenuOpen(false); }} focused={menuFocusIdx === 7} />

              <div className="pitch-modal-divider" />

              {/* Batter Out: Other */}
              <button className={`pitch-modal-item danger${menuFocusIdx === 8 ? ' kbd-focused' : ''}`} onClick={() => { appendPitch(selectedPitchType, 'P'); setSelectedPitchType(null); pushHistory(); applyOutcome('other-out', false); setPitchMenuOpen(false); }}>
                <span className="pitch-modal-item-label">Batter Out: Other</span>
              </button>
            </div>
          </div>
        )}

        {/* Current Batter + Lineup */}
        <div className="card batter-card">
          {/* ── Opposing pitcher strip ───────────────────────────────────── */}
          {(() => {
            const pitchingSide = isTop ? 'home' : 'away';
            const oppPitcher   = isTop
              ? (gameData.currentHomePitcher || gameData.homePitcher)
              : (gameData.currentAwayPitcher || gameData.awayPitcher);
            const oppTeam      = isTop ? homeTeam : awayTeam;
            const oppPitchCount = isTop ? (homePitchCount || 0) : (awayPitchCount || 0);
            const pStats   = oppPitcher ? (gameData.statsById?.[oppPitcher.id] || {}) : {};
            const pArsenal = oppPitcher ? ((gameData.arsenalById || {})[oppPitcher.id] || []) : [];
            if (!oppPitcher) return null;
            const pMlb = pStats.mlb       || {};
            const pFg  = pStats.fangraphs || {};
            const seasonStatItems = [
              { l: 'ERA',  v: pMlb.era,    d: 2 },
              { l: 'WHIP', v: pMlb.whip,   d: 2 },
              { l: 'K/9',  v: pMlb.kPer9,  d: 1 },
              { l: 'FIP',  v: pFg.fip,     d: 2 },
            ];

            // ── Compute current pitcher's in-game line from paLog ───────────
            // Batting side PAs since this pitcher entered
            const pitcherPASide  = isTop ? 'away' : 'home';
            const pitcherStartPA = isTop
              ? (homePitcherStartPA || 0)
              : (awayPitcherStartPA || 0);
            const pitcherPAs = (paLog || []).filter(
              (pa, i) => pa.side === pitcherPASide && i >= pitcherStartPA
            );
            // Outs recorded: PA outcomes + base-path outs (CS/PO/rundown) credited to this pitcher
            const RUNNER_OUT_TYPES = new Set(['cs', 'po', 'out-play', 'rundown', 'out-other']);
            const pitcherRunnerOuts = (gameState.runnerEvents || []).filter(
              re => RUNNER_OUT_TYPES.has(re.type) && re.pitcherId === oppPitcher.id
            ).length;
            const pitcherOuts = pitcherPAs.reduce((s, pa) => {
              if (['out','k','kl','sacbunt','sacfly','fc','bi','other-out'].includes(pa.outcome)) return s + 1;
              if (pa.outcome === 'dp') return s + 2;
              return s;
            }, 0) + pitcherRunnerOuts;
            const gIP  = `${Math.floor(pitcherOuts / 3)}.${pitcherOuts % 3}`;
            const gH   = pitcherPAs.filter(pa => pa.isHit).length;
            const gR   = pitcherPAs.reduce((s, pa) => s + (pa.runs || 0), 0);
            const gER  = pitcherPAs.filter(pa => pa.outcome !== 'error').reduce((s, pa) => s + (pa.runs || 0), 0);
            const gBB  = pitcherPAs.filter(pa => pa.isBB || pa.isHBP).length;
            const gK   = pitcherPAs.filter(pa => pa.isK).length;
            const gHR  = pitcherPAs.filter(pa => pa.isHR).length;
            const gameStatItems = [
              { l: 'IP', v: gIP  },
              { l: 'H',  v: gH   },
              { l: 'ER', v: gER  },
              { l: 'R',  v: gR   },
              { l: 'BB', v: gBB  },
              { l: 'K',  v: gK   },
              ...(gHR > 0 ? [{ l: 'HR', v: gHR }] : []),
            ];

            // Pitchers available for substitution — pitching team's roster, pitchers only,
            // excluding whoever is currently on the mound.
            const isPitcherPos = p =>
              p.position?.type === 'Pitcher' ||
              p.position?.code === '1' ||
              p.position?.abbreviation === 'P';
            const pitchingRoster   = (isTop ? homeRoster : awayRoster) || [];
            const availablePitchers = pitchingRoster.filter(
              p => isPitcherPos(p) && p.id !== oppPitcher.id
            );
            const pitcherOptFmt = p =>
              `${p.jerseyNumber ? `#${p.jerseyNumber} ` : ''}${p.name}${p.position?.abbreviation ? ` · ${p.position.abbreviation}` : ''}${p.throwHand ? ` · ${p.throwHand}HP` : ''}`;

            // Compute fatigue data used in both expanded and compact views
            const fData = fatigueData[oppPitcher.id];
            const livePitches  = fData ? (fData.rolling7dPitches || 0) + oppPitchCount : 0;
            const liveBand     = fData ? getFatigueBand(livePitches, fData.daysSinceAppearance) : null;
            const BAND_LABEL   = { fresh: 'Fresh', normal: 'Normal', elevated: 'Elevated', high: 'High' };
            const BAND_DOT     = { fresh: '🟢', normal: '🟡', elevated: '🟠', high: '🔴' };
            const avg          = fData?.avgPitchesPerApp;
            const remaining    = avg != null ? Math.max(0, avg - oppPitchCount) : null;
            const pctUsed      = avg != null ? Math.min(1, oppPitchCount / avg) : null;

            return (
              <div className="sb-pitcher-strip">
                <div className="sb-pitcher-header">
                  <span className="label" style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setMoundExpanded(v => !v)}>
                    <span style={{ fontSize: 10, opacity: 0.5, transition: 'transform .15s', transform: moundExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
                    ON THE MOUND
                  </span>
                  <img
                    src={`https://www.mlbstatic.com/team-logos/${oppTeam?.id}.svg`}
                    alt=""
                    className="sb-team-logo-sm"
                  />
                  <span className="sb-pitcher-team-badge">{oppTeam?.abbreviation}</span>
                  {onPitcherChange && (
                    <button
                      className={`btn btn-ghost btn-sm sb-change-pitcher-btn${showPitcherSub ? ' active' : ''}`}
                      onClick={() => setShowPitcherSub(v => !v)}
                      title="Make a pitching change"
                    >
                      {showPitcherSub ? 'Cancel' : '⇄ Change'}
                    </button>
                  )}
                </div>

                {/* ── Compact (collapsed) view ── */}
                {!moundExpanded && (
                  <div className="sb-mound-compact">
                    <img
                      className="sb-compact-headshot"
                      src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${oppPitcher.id}/headshot/67/current`}
                      alt={oppPitcher.name}
                      loading="lazy"
                    />
                    <span className="sb-compact-name">{oppPitcher.name}</span>
                    {oppPitcher.throwHand && <span className="hand-badge">{oppPitcher.throwHand}HP</span>}
                    <span className="sb-compact-sep" />
                    <span className="sb-compact-pc">{oppPitchCount} PC</span>
                    {liveBand && <span className="sb-compact-fatigue">{BAND_DOT[liveBand]}</span>}
                    {remaining != null && <span className="sb-compact-remaining">~{remaining} left</span>}
                    {pArsenal.length > 0 && (
                      <span className="sb-compact-arsenal">
                        {pArsenal.slice(0, 4).map((p, i) => (
                          <span key={p.type} className="sb-compact-pitch">
                            <kbd className="sb-compact-kbd">{i + 1}</kbd>{p.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )}

                {/* ── Expanded (full) view ── */}
                {moundExpanded && (
                  <>
                <div className="sb-pitcher-body">
                  <img
                    className="player-headshot"
                    src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${oppPitcher.id}/headshot/67/current`}
                    alt={oppPitcher.name}
                    loading="lazy"
                  />
                  <div className="sb-pitcher-info">
                    <span className="sb-pitcher-name">{oppPitcher.name}</span>
                    <div className="sb-pitcher-meta">
                      {oppPitcher.throwHand && <span className="hand-badge">{oppPitcher.throwHand}HP</span>}
                      {pMlb.wins != null && <span className="record">{pMlb.wins}–{pMlb.losses}</span>}
                    </div>
                    {/* Season stats — de-emphasized */}
                    <div className="sb-season-stats-row">
                      {seasonStatItems.map(s => s.v != null && (
                        <span key={s.l} className="sb-season-stat">
                          <span className="sb-season-stat-lbl">{s.l}</span>
                          <span className="sb-season-stat-val">{parseFloat(s.v).toFixed(s.d)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Pitch count — prominent badge for broadcast */}
                  <div className="sb-pitch-count">
                    <span className="sb-pitch-count-num">{oppPitchCount}</span>
                    <span className="sb-pitch-count-lbl">PC</span>
                  </div>

                  {/* Fatigue badge — live rolling 7-day workload (prior + today's pitches) */}
                  {fData && liveBand && (
                      <div className="fatigue-tooltip-wrap">
                        <div className={`fatigue-badge fatigue-${liveBand}`}>
                          <span className="fatigue-badge-label">Fatigue</span>
                          <span className="fatigue-badge-val">{BAND_DOT[liveBand]} {BAND_LABEL[liveBand]}</span>
                        </div>
                        {avg != null && (
                          <div className="fatigue-pitch-est">
                            <div className="fatigue-pitch-est-bar">
                              <div
                                className={`fatigue-pitch-est-fill fatigue-fill-${liveBand}`}
                                style={{ width: `${Math.round(pctUsed * 100)}%` }}
                              />
                            </div>
                            <span className="fatigue-pitch-est-label">
                              {remaining > 0
                                ? <><strong>~{remaining}</strong> pitches left</>
                                : <strong>At/past typical limit</strong>}
                              <span className="fatigue-pitch-est-sub">&nbsp;(avg ~{avg}/app)</span>
                            </span>
                          </div>
                        )}
                        <div className="fatigue-tooltip">
                          <div className="fatigue-tooltip-row"><span>Prior 7-day PC</span><strong>{fData.rolling7dPitches}</strong></div>
                          <div className="fatigue-tooltip-row"><span>Today (this game)</span><strong>{oppPitchCount}</strong></div>
                          <div className="fatigue-tooltip-row"><span>7-day total</span><strong>{livePitches}</strong></div>
                          <div className="fatigue-tooltip-row"><span>Avg pitches/app</span><strong>{avg != null ? `~${avg}` : '—'}</strong></div>
                          <div className="fatigue-tooltip-row"><span>Last outing</span><strong>{fData.lastAppDate ? new Date(fData.lastAppDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '—'}</strong></div>
                          <div className="fatigue-tooltip-row"><span>Last outing PC</span><strong>{fData.lastOutingPitches || '—'}</strong></div>
                          <div className="fatigue-tooltip-row"><span>Days rest</span><strong>{fData.daysSinceAppearance != null ? `${fData.daysSinceAppearance}d` : '—'}</strong></div>
                        </div>
                      </div>
                  )}
                </div>

                {/* ── In-game pitcher line (IP / H / R / BB / K) ─────────── */}
                <div className="sb-pitcher-game-line">
                  <span className="sb-game-line-lbl">TODAY</span>
                  {gameStatItems.map(s => (
                    <div key={s.l} className="sb-game-stat">
                      <span className="sb-game-stat-val">{s.v}</span>
                      <span className="sb-game-stat-lbl">{s.l}</span>
                    </div>
                  ))}
                </div>
                {pArsenal.length > 0 && (
                  <div className="sb-pitcher-arsenal">
                    <span className="arsenal-label">ARSENAL</span>
                    {pArsenal.slice(0, 5).map(p => (
                      <span key={p.type} className="sb-arsenal-pitch">
                        <span className="arsenal-type">{p.name}</span>
                        <span className="arsenal-pct">{Math.round(p.pct)}%</span>
                        {p.velocity && <span className="arsenal-velo">{p.velocity}mph</span>}
                      </span>
                    ))}
                  </div>
                )}
                  </>
                )}

                {showPitcherSub && onPitcherChange && (
                  <div className="sb-pitcher-sub">
                    <span className="sb-pitcher-sub-label">↳ Bring in reliever:</span>
                    <select
                      autoFocus
                      className="sb-pitcher-sub-select"
                      defaultValue=""
                      onChange={(e) => {
                        const newP = pitchingRoster.find(r => String(r.id) === e.target.value);
                        if (newP) {
                          onPitcherChange(pitchingSide, newP);
                          setShowPitcherSub(false);
                        }
                      }}
                    >
                      <option value="" disabled>Select pitcher…</option>
                      {availablePitchers.length > 0
                        ? availablePitchers.map(p => (
                            <option key={p.id} value={p.id}>{pitcherOptFmt(p)}</option>
                          ))
                        : <option disabled>No other pitchers on roster</option>
                      }
                    </select>
                  </div>
                )}
              </div>
            );
          })()}

          {/* NOW BATTING header + Show/Hide PA toggle */}
          <div className="sb-pitcher-header" style={{ marginTop: 16, marginBottom: 6 }}>
            <span className="label">NOW BATTING</span>
            <img
              src={`https://www.mlbstatic.com/team-logos/${(isTop ? awayTeam : homeTeam)?.id}.svg`}
              alt=""
              className="sb-team-logo-sm"
            />
            <span className="sb-pitcher-team-badge">{isTop ? awayTeam?.abbreviation : homeTeam?.abbreviation}</span>
            <span style={{ flex: 1 }} />
            <button
              className={`pitch-seq-toggle${showPitchSeq ? ' active' : ''}`}
              onClick={() => setShowPitchSeq(v => !v)}
              title={showPitchSeq ? 'Hide pitch sequences' : 'Show pitch sequences'}
            >{showPitchSeq ? '▾ Hide PA' : '▸ Show PA'}</button>
          </div>

          {/* Mini lineup */}
          {(() => {
            // Roster for the batting team, minus players already in the lineup
            const side          = isTop ? 'away' : 'home';
            const fullRoster    = (isTop ? awayRoster : homeRoster) || [];
            const isPitcher     = p => p.position?.type === 'Pitcher' || p.position?.code === '1' || p.position?.abbreviation === 'P';
            const benchRoster   = fullRoster.filter(p => !currentLineup.some(b => b?.id === p.id));
            // Players already subbed out for this side — they cannot return
            const playedRaw     = (gameData.subsLog || []).filter(s => s.side === side).map(s => s.outPlayer).filter(Boolean);
            const played        = [...new Map(playedRaw.map(p => [p.id, p])).values()];
            const playedIds     = new Set(played.map(p => p.id));
            const benchFielders = benchRoster.filter(p => !isPitcher(p) && !playedIds.has(p.id));
            const benchPitchers = benchRoster.filter(p =>  isPitcher(p) && !playedIds.has(p.id));
            const optFmt        = p => `${p.jerseyNumber ? `#${p.jerseyNumber} ` : ''}${p.name} · ${p.position?.abbreviation || '?'}${p.batSide ? ` · ${p.batSide}` : ''}`;

            return (
              <div className="mini-lineup">
                {currentLineup.map((batter, i) => {
                  if (!batter) return null;
                  const isCurrent    = i === (currentBatterIdx % Math.max(currentLineup.length, 1));
                  const effectiveHL  = highlightedBatterIdx ?? (currentBatterIdx % Math.max(currentLineup.length, 1));
                  const isHighlighted = i === effectiveHL;
                  const isActiveSub = activePHSlot === i;
                  return (
                    <React.Fragment key={batter.id}>
                      <div
                        className={`mini-lineup-row ${isCurrent ? 'current' : ''}${isHighlighted && !isCurrent ? ' highlighted' : ''}${dragIdx === i ? ' dragging' : ''}${dragOverIdx === i && dragIdx !== i ? ' drag-over' : ''}`}
                        draggable={!!onLineupReorder}
                        onDragStart={onLineupReorder ? (e) => handleLineupDragStart(e, i) : undefined}
                        onDragOver={onLineupReorder ? (e) => handleLineupDragOver(e, i) : undefined}
                        onDrop={onLineupReorder ? (e) => handleLineupDrop(e, i) : undefined}
                        onDragEnd={onLineupReorder ? handleLineupDragEnd : undefined}
                        onClick={() => {
                          const atBatIdx = currentBatterIdx % Math.max(currentLineup.length, 1);
                          setHighlightedBatterIdx(prev => {
                            if (prev === i) return null;      // toggle off → follow at-bat
                            if (i === atBatIdx) return null;  // clicking at-bat batter → stay in follow mode
                            return i;                         // lock highlight to a different batter
                          });
                        }}
                      >
                        {onLineupReorder && (
                          <span className="drag-handle" title="Drag to reorder">⠿</span>
                        )}
                        {isCurrent
                          ? <span className="slot-number at-bat-arrow" title="At bat">▶</span>
                          : <span className="slot-number">{i + 1}</span>
                        }
                        {/* Name + season stats sub-line */}
                        {(() => {
                          const bStats = (gameData.statsById || {})[batter.id] || {};
                          const bMlb   = bStats.mlb || {};
                          return (
                            <div className="mini-batter-info">
                              <div className="mini-name-row">
                                {batter.jerseyNumber != null && (
                                  <span className="mini-jersey">#{batter.jerseyNumber}</span>
                                )}
                                <span className="mini-name">{batter.name}</span>
                                {/* Base badge — shows which base this player is currently on */}
                                {(() => {
                                  const base = bases[0]?.id === batter.id ? '1B'
                                    : bases[1]?.id === batter.id ? '2B'
                                    : bases[2]?.id === batter.id ? '3B'
                                    : null;
                                  return base ? (
                                    <span className="mini-base-badge">{base}</span>
                                  ) : null;
                                })()}
                              </div>
                              {bMlb.avg != null && (
                                <span className="mini-season-line">
                                  {batter.batSide ? `${batter.batSide} · ` : ''}
                                  {`BA ${parseFloat(bMlb.avg).toFixed(3).replace(/^0/, '')}`}
                                  {bMlb.ops != null
                                    ? ` · ${parseFloat(bMlb.ops).toFixed(3).replace(/^0/, '')} OPS`
                                    : ''}
                                  {bMlb.hr != null ? ` · ${bMlb.hr} HR` : ''}
                                  {bMlb.rbi != null ? ` · ${bMlb.rbi} RBI` : ''}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        {/* Sub button — hidden until row hover */}
                        {onPinchHit && (
                          <button
                            className={`ph-btn ph-btn--mini${isActiveSub ? ' ph-btn--active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setActivePHSlot(prev => prev === i ? null : i); }}
                            title={`Sub ${batter.name}`}
                          >⇄</button>
                        )}
                        {/* Today's game stats — richer breakdown */}
                        {(() => {
                          const pas  = gameState.paLog.filter(p => p.batterId === batter.id);
                          const re   = (gameState.runnerEvents || []).filter(e => e.runnerId === batter.id);
                          const sb   = re.filter(e => e.type === 'sb').length;
                          const cs   = re.filter(e => e.type === 'cs').length;
                          if (pas.length === 0 && sb === 0 && cs === 0) return null;
                          const ab   = pas.filter(p => p.isAB).length;
                          const hits = pas.filter(p => p.isHit).length;
                          const hr   = pas.filter(p => p.isHR).length;
                          const rbi  = pas.reduce((s, p) => s + (p.rbi || 0), 0);
                          const bb   = pas.filter(p => p.isBB || p.isHBP).length;
                          const ks   = pas.filter(p => p.isK && p.outcome === 'k').length;
                          const kl   = pas.filter(p => p.isK && p.outcome === 'kl').length;
                          return (
                            <div className="today-line">
                              {pas.length > 0 && <span className={hits > 0 ? 'tl-hits' : 'tl-oh'}>{hits}-{ab}</span>}
                              {hr  > 0 && <span className="tl-badge tl-hr">{hr  > 1 ? `${hr}HR`  : 'HR'}</span>}
                              {rbi > 0 && <span className="tl-badge tl-rbi">{rbi > 1 ? `${rbi}R` : 'RBI'}</span>}
                              {bb  > 0 && <span className="tl-badge tl-bb">{bb  > 1 ? `${bb}BB`  : 'BB'}</span>}
                              {ks  > 0 && <span className="tl-badge tl-k">{ks  > 1 ? `${ks}K`   : 'K'}</span>}
                              {kl  > 0 && <span className="tl-badge tl-k">{kl  > 1 ? `${kl}ꓘ`   : 'ꓘ'}</span>}
                              {sb  > 0 && <span className="tl-badge tl-sb">{sb  > 1 ? `${sb}SB`  : 'SB'}</span>}
                              {cs  > 0 && <span className="tl-badge tl-cs">{cs  > 1 ? `${cs}CS`  : 'CS'}</span>}
                            </div>
                          );
                        })()}

                        {/* BK-39: pitch sequence per PA */}
                        {showPitchSeq && (() => {
                          const RCLS  = { B:'ball', C:'called', S:'swing', F:'foul', P:'bip' };
                          const RNAME = { B:'Ball', C:'Called Strike', S:'Swing & Miss', F:'Foul', P:'Ball in Play' };
                          const BIP_LABEL = {
                            single:'1B', double:'2B', triple:'3B', hr:'HR', ihr:'HR',
                            out:'Out', 'other-out':'Out', error:'E', fc:'FC',
                            sacfly:'SF', sacbunt:'SAC', dp:'DP',
                            bi:'Out', pfe:'E', fe:'E',
                          };
                          const pitchTitle = (p, pi, total, paOutcome) => {
                            const base = `Pitch ${pi + 1} of ${total}${p.type ? ` · ${p.type}` : ''} · ${RNAME[p.result] || p.result}`;
                            return (p.result === 'P' && BIP_LABEL[paOutcome])
                              ? `${base} → ${BIP_LABEL[paOutcome]}`
                              : base;
                          };
                          const batterPAs   = (gameState.paLog || []).filter(p => p.batterId === batter.id);
                          const livePitches = isCurrent ? (gameState.currentPAPitches || []) : [];
                          if (batterPAs.length === 0 && livePitches.length === 0) return null;
                          return (
                            <div className="pitch-seq-list">
                              {livePitches.length > 0 && (
                                <div className="pitch-seq-row pitch-seq-row--live">
                                  {livePitches.map((p, pi) => (
                                    <span
                                      key={pi}
                                      className={`pitch-dot pitch-dot--${RCLS[p.result] || 'other'}`}
                                      title={pitchTitle(p, pi, livePitches.length, null)}
                                    >{p.type || p.result}</span>
                                  ))}
                                </div>
                              )}
                              {batterPAs.slice().reverse().map((pa, paIdx) => {
                                if (!pa.pitches || pa.pitches.length === 0) return null;
                                return (
                                  <div key={paIdx} className="pitch-seq-row">
                                    {pa.pitches.map((p, pi) => (
                                      <span
                                        key={pi}
                                        className={`pitch-dot pitch-dot--${RCLS[p.result] || 'other'}${p.result === 'P' ? ' pitch-dot--bip-outlined' : ''}`}
                                        title={pitchTitle(p, pi, pa.pitches.length, pa.outcome)}
                                      >{p.type || p.result}</span>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Inline picker — expands below the row when sub button is active */}
                      {isActiveSub && (
                        <div className="ph-picker ph-picker--mini">
                          <span className="ph-picker-label">↳ Replace <strong>{batter.name}</strong>:</span>
                          <select
                            autoFocus
                            className="ph-picker-select"
                            defaultValue=""
                            onChange={(e) => {
                              const newP = benchRoster.find(r => String(r.id) === e.target.value);
                              if (newP) {
                                onPinchHit(isTop ? 'away' : 'home', i, newP);
                                setActivePHSlot(null);
                              }
                            }}
                          >
                            <option value="" disabled>Select substitute…</option>
                            {benchFielders.length > 0 && (
                              <optgroup label="Position Players">
                                {benchFielders.map(p => (
                                  <option key={p.id} value={p.id}>{optFmt(p)}</option>
                                ))}
                              </optgroup>
                            )}
                            {benchPitchers.length > 0 && (
                              <optgroup label="Pitchers">
                                {benchPitchers.map(p => (
                                  <option key={p.id} value={p.id}>{optFmt(p)}</option>
                                ))}
                              </optgroup>
                            )}
                            {played.length > 0 && (
                              <optgroup label="Already played — cannot return">
                                {played.map(p => (
                                  <option key={p.id} value={p.id} style={{ color: '#6b7280' }}>{optFmt(p)}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <button className="btn btn-ghost btn-sm" onClick={() => setActivePHSlot(null)}>Cancel</button>
                        </div>
                      )}

                    </React.Fragment>
                  );
                })}
              </div>
            );
          })()}

          {/* Manual score override */}
          <div className="score-adj">
            <div className="section-title" style={{ marginBottom: scoreOverrideOpen ? 6 : 0, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => {
              if (!scoreOverrideOpen) setScoreOverrideWarn(true);
              setScoreOverrideOpen(v => !v);
            }}>
              <span style={{ fontSize: 10, opacity: 0.5, transition: 'transform .15s', transform: scoreOverrideOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
              Override Score
            </div>
            {scoreOverrideOpen && (
              <>
                {scoreOverrideWarn && (
                  <div className="score-override-warn" onClick={() => setScoreOverrideWarn(false)}>
                    Manually adjusting the score will not update the play-by-play log or box score stats. Use only to correct scoring errors.
                    <span className="score-override-dismiss">Dismiss</span>
                  </div>
                )}
                <div className="score-adj-row">
                  <span>{awayTeam?.abbreviation}</span>
                  <button className="adj-btn" onClick={() => update({ score: { ...score, away: Math.max(0, score.away - 1) } })}>−</button>
                  <span className="adj-val">{score.away}</span>
                  <button className="adj-btn" onClick={() => update({ score: { ...score, away: score.away + 1 } })}>+</button>
                </div>
                <div className="score-adj-row">
                  <span>{homeTeam?.abbreviation}</span>
                  <button className="adj-btn" onClick={() => update({ score: { ...score, home: Math.max(0, score.home - 1) } })}>−</button>
                  <span className="adj-val">{score.home}</span>
                  <button className="adj-btn" onClick={() => update({ score: { ...score, home: score.home + 1 } })}>+</button>
                </div>
              </>
            )}
          </div>
        </div>

      </div>

      {/* ── Play-by-play log — full width below controls ───────────────── */}
      <PlayByPlayLog
        paLog={paLog || []}
        runnerEvents={gameState.runnerEvents || []}
        awayTeam={awayTeam}
        homeTeam={homeTeam}
        filterBatterId={highlightedBatter?.id || null}
        filterBatterName={highlightedBatter?.name || null}
        onDeletePA={deletePA}
        onDeleteRunner={deleteRunnerEvent}
      />

    </div>
  );
}

// ── AI Insights Panel (Scorebook) ─────────────────────────────────────────

function SbInsightsPanel({ insights, loading, subject }) {
  if (loading) {
    return (
      <div className="insights-panel" style={{ margin: '4px 0' }}>
        <div className="insights-loading">
          <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          <span>Generating insights for {subject?.name}…</span>
        </div>
      </div>
    );
  }
  if (!insights) return null;
  if (insights.error) {
    return (
      <div className="insights-panel" style={{ margin: '4px 0' }}>
        <div className="insights-error">
          {insights.error.includes('not configured')
            ? '⚠ AI insights require ANTHROPIC_API_KEY in backend/.env'
            : `⚠ ${insights.error}`}
        </div>
      </div>
    );
  }
  if (!insights.length) {
    return (
      <div className="insights-panel" style={{ margin: '4px 0' }}>
        <div className="insights-error">Nothing notable found.</div>
      </div>
    );
  }
  return (
    <div className="insights-panel" style={{ margin: '4px 0' }}>
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
    </div>
  );
}
