/**
 * PlayByPlayLog.jsx
 *
 * Broadcast-style scrollable play-by-play event feed.
 * Auto-generates from paLog + runnerEvents as the game is scored.
 *
 * Entry format examples:
 *   ▲3  Soto — HR, 2 RBI  (off Ashcraft)
 *   ▼2  Judge — Ꝁ
 *   ▲1  Acuña — 2B, 1 RBI  (off Clase)
 *   ▲3  NYY  Judge — SB (2B→3B)
 *   ▲3  NYY  Soto — CS
 *
 * Newest plays appear at the top.
 *
 * BK-28: Toggle button in header filters to the currently highlighted batter.
 */

import React, { useState, useRef, useEffect } from 'react';

// Human-readable outcome labels
const OUTCOME_LABEL = {
  out:        'Out',
  k:          'K',
  kl:         'ꓘ',        // backwards K = called strikeout (Unicode U+A4D8)
  single:     '1B',
  double:     '2B',
  triple:     '3B',
  hr:         'HR',
  ihr:        'IHR',     // in-the-park home run
  bb:         'BB',
  hbp:        'HBP',
  fc:         'FC',
  error:      'E',
  dp:         'DP',
  sacfly:     'SF',
  sacbunt:    'SH',
  // BK-34 new outcomes
  bi:         'BI',
  'other-out':'Out',
  ibb:        'IBB',
  ci:         'CI',
  bk:         'BK',
  ilp:        'ILP',
  pfe:        'PFE',
  fe:         'F+E',
};

// Runner event labels and categories
const RUNNER_LABEL = {
  // Advances
  sb:           'SB',
  wp:           'WP',
  pb:           'PB',
  'on-play':    'Adv',
  other:        'Adv',
  // Scores
  score:        'Scores',
  'score-error':'Scores (E)',
  // Outs
  cs:           'CS',
  po:           'PO',
  'out-play':   'Out',
  rundown:      'Out',
  'out-other':  'Out',
};

const RUNNER_OUT_TYPES  = new Set(['cs', 'po', 'out-play', 'rundown', 'out-other']);
const BASE_NAME = { 0: '1B', 1: '2B', 2: '3B', 3: 'Home' };

// CSS class suffix for coloring PA outcomes
function outcomeClass(outcome) {
  if (['hr', 'ihr'].includes(outcome))                  return 'pbp-hr';
  if (['single', 'double', 'triple'].includes(outcome)) return 'pbp-hit';
  if (outcome === 'kl')                                 return 'pbp-k';
  if (outcome === 'k')                                  return 'pbp-k';
  if (['bb', 'hbp', 'ibb', 'ci'].includes(outcome))   return 'pbp-bb';
  if (['out','fc','dp','sacfly','sacbunt','bi','other-out'].includes(outcome)) return 'pbp-out';
  if (['error', 'pfe', 'fe'].includes(outcome))        return 'pbp-error';
  return '';
}

export default function PlayByPlayLog({ paLog = [], runnerEvents = [], pbpNotes = [], awayTeam, homeTeam, filterBatterId = null, filterBatterName = null, onDeletePA = null, onDeleteRunner = null, onAddNote = null, onDeleteNote = null }) {
  const [showAll, setShowAll] = useState(true);
  const [composing, setComposing] = useState(false);
  const [noteText, setNoteText]   = useState('');
  const inputRef = useRef(null);

  // Focus input when compose bar opens
  useEffect(() => {
    if (composing && inputRef.current) inputRef.current.focus();
  }, [composing]);

  const submitNote = () => {
    if (noteText.trim() && onAddNote) {
      onAddNote(noteText.trim());
    }
    setNoteText('');
    setComposing(false);
  };

  const handleNoteKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitNote(); }
    if (e.key === 'Escape') { setNoteText(''); setComposing(false); }
  };

  // Combine PA entries, runner events, and notes into a single sorted timeline.
  // Each event has a `seq` counter stamped at creation time — sort descending for newest-first.
  // Fall back to array index for older events that pre-date the seq counter.
  // Events WITH a `seq` counter (>= 0) sort above legacy events WITHOUT one.
  // Legacy events get negative fallback values that still preserve their relative order.
  const combined = [
    ...paLog.map((pa, i)        => ({ ...pa, _kind: 'pa',     _origIdx: i, _seq: pa.seq != null ? pa.seq : -(paLog.length - i) })),
    ...runnerEvents.map((re, i) => ({ ...re, _kind: 'runner', _origIdx: i, _seq: re.seq != null ? re.seq : -(runnerEvents.length - i) })),
    ...pbpNotes.map((n)         => ({ ...n,  _kind: 'note',   _origIdx: n.id, _seq: n.seq })),
  ].sort((a, b) => b._seq - a._seq); // newest first

  // Apply batter filter (includes runner events for that player; notes always shown)
  const filtered = showAll
    ? combined
    : combined.filter(e =>
        e._kind === 'note'   ? true :
        e._kind === 'pa'     ? e.batterId  === filterBatterId :
                               e.runnerId  === filterBatterId
      );

  const hasEvents = paLog.length > 0 || runnerEvents.length > 0 || pbpNotes.length > 0;

  if (!hasEvents) {
    return (
      <div className="pbp-log card">
        <div className="pbp-header">
          <span className="section-title">Play-by-Play</span>
          <div className="pbp-header-right">
            {onAddNote && (
              <button
                className="pbp-note-btn"
                onClick={() => setComposing(v => !v)}
                title="Add a note"
              >✏️</button>
            )}
          </div>
        </div>
        {composing && (
          <div className="pbp-compose">
            <input
              ref={inputRef}
              className="pbp-compose-input"
              placeholder="Add a note…"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={handleNoteKey}
              maxLength={200}
            />
            <button className="pbp-compose-submit" onClick={submitNote} disabled={!noteText.trim()}>Add</button>
          </div>
        )}
        <div className="pbp-empty">No plays yet — start scoring to see the log.</div>
      </div>
    );
  }

  return (
    <div className="pbp-log card">
      <div className="pbp-header">
        <span className="section-title">Play-by-Play</span>
        <div className="pbp-header-right">
          {filterBatterId && (
            <button
              className="pbp-filter-btn"
              onClick={() => setShowAll(v => !v)}
              title={showAll ? `Filter to ${filterBatterName}` : 'Show all plays'}
            >
              {showAll ? 'Team' : 'Player'}
            </button>
          )}
          {onAddNote && (
            <button
              className={`pbp-note-btn${composing ? ' pbp-note-btn-active' : ''}`}
              onClick={() => setComposing(v => !v)}
              title={composing ? 'Cancel note' : 'Add a note'}
            >✏️</button>
          )}
        </div>
      </div>

      {/* Compose bar — only visible when user opens it */}
      {composing && (
        <div className="pbp-compose">
          <input
            ref={inputRef}
            className="pbp-compose-input"
            placeholder="Add a note… (Enter to save, Esc to cancel)"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onKeyDown={handleNoteKey}
            maxLength={200}
          />
          <button className="pbp-compose-submit" onClick={submitNote} disabled={!noteText.trim()}>Add</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="pbp-empty">No plays for {filterBatterName || 'this batter'} yet.</div>
      ) : (
        <div className="pbp-scroll">
          {filtered.map((e, i) => {

            // ── Note row ──────────────────────────────────────────────────
            if (e._kind === 'note') {
              return (
                <div key={`note-${e.id}`} className="pbp-entry pbp-note">
                  <span className="pbp-note-icon">📝</span>
                  <span className="pbp-note-text">{e.text}</span>
                  {onDeleteNote && (
                    <button className="pbp-delete-btn" onClick={() => onDeleteNote(e.id)} title="Delete note">×</button>
                  )}
                </div>
              );
            }

            const half = e.side === 'away' ? '▲' : '▼';
            const team = e.side === 'away'
              ? (awayTeam?.abbreviation || 'AWY')
              : (homeTeam?.abbreviation || 'HME');

            // ── Runner event row ──────────────────────────────────────────
            if (e._kind === 'runner') {
              const isOut  = RUNNER_OUT_TYPES.has(e.type);
              const label  = RUNNER_LABEL[e.type] || e.type.toUpperCase();
              const lastName = e.runnerName ? e.runnerName.split(' ').slice(-1)[0] : '?';
              const baseSuffix = !isOut && e.fromBase != null && e.toBase != null
                ? ` (${BASE_NAME[e.fromBase]}→${BASE_NAME[e.toBase]})`
                : '';
              const isScoreError = e.type === 'score-error';
              const rowCls = isOut ? 'pbp-out' : isScoreError ? 'pbp-error-score' : 'pbp-sb';
              return (
                <div key={`re-${i}`} className={`pbp-entry pbp-runner ${rowCls}`}>
                  <span className="pbp-inning">{half}{e.inning}</span>
                  <span className="pbp-team">{team}</span>
                  <span className="pbp-batter">{lastName}</span>
                  <span className="pbp-dash">—</span>
                  <span className={`pbp-outcome ${rowCls}`}>{label}</span>
                  {baseSuffix && <span className="pbp-notation">{baseSuffix}</span>}
                  {onDeleteRunner && (
                    <button className="pbp-delete-btn" onClick={() => onDeleteRunner(e._origIdx)} title="Delete this play">×</button>
                  )}
                </div>
              );
            }

            // ── PA event row ──────────────────────────────────────────────
            const label = OUTCOME_LABEL[e.outcome] || e.outcome;
            const cls   = outcomeClass(e.outcome);
            const suffixParts = [];
            if (e.rbi  > 0) suffixParts.push(`${e.rbi} RBI`);
            if (e.runs > 0 && e.outcome !== 'hr') suffixParts.push(`${e.runs} run${e.runs > 1 ? 's' : ''} score`);

            return (
              <div key={`pa-${i}`} className={`pbp-entry ${cls}`}>
                <span className="pbp-inning">{half}{e.inning}</span>
                <span className="pbp-team">{team}</span>
                <span className="pbp-batter">{e.batterName}</span>
                <span className="pbp-dash">—</span>
                <span className={`pbp-outcome ${cls}`}>{label}</span>
                {e.fieldingNotation && <span className="pbp-notation">{e.fieldingNotation}</span>}
                {e.battedBallType   && <span className="pbp-ball-type">{e.battedBallType}</span>}
                {suffixParts.length > 0 && <span className="pbp-suffix">{suffixParts.join(', ')}</span>}
                {e.pitcherName && <span className="pbp-pitcher">off {e.pitcherName.split(' ').slice(-1)[0]}</span>}
                {onDeletePA && (
                  <button className="pbp-delete-btn" onClick={() => onDeletePA(e._origIdx)} title="Delete this play">×</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
