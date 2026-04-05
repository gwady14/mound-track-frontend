/**
 * GamePrepPanel.jsx
 *
 * Pre-game research hub for broadcasters.
 * Displays weather, park factors, player spotlights, and "on this day" history.
 * Cards can be highlighted (starred) or dismissed per game.
 * All data is fetched lazily when the tab first opens.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { getWeather, getParkFactors, getOnThisDay, getPlayerBio, getSavantPercentiles } from '../api/index.js';

// ── Small useLocalStorage hook ────────────────────────────────────────────
function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const set = (v) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  };

  return [value, set];
}

// ── Percentile bar ────────────────────────────────────────────────────────
function PctBar({ value }) {
  if (value == null) return null;
  const color = value >= 70 ? '#22c55e' : value >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{
        display: 'inline-block',
        width: 48,
        height: 5,
        borderRadius: 3,
        background: 'var(--border)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <span style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${value}%`,
          background: color,
          borderRadius: 3,
        }} />
      </span>
      <span style={{ color, fontWeight: 700 }}>{value}th</span>
    </span>
  );
}

// ── Card component ────────────────────────────────────────────────────────
function PrepCard({ id, category, text, icon, highlighted, onHighlight, onDismiss }) {
  return (
    <div className={`prep-card ${highlighted ? 'prep-card-hl' : ''}`}>
      <div className="prep-card-actions">
        <button
          onClick={() => onHighlight(id)}
          title={highlighted ? 'Remove highlight' : 'Highlight'}
          style={{ color: highlighted ? '#fbbf24' : undefined, opacity: highlighted ? 1 : undefined }}
        >⭐</button>
        <button onClick={() => onDismiss(id)} title="Dismiss">✕</button>
      </div>
      <span className="prep-card-cat">{icon ? `${icon} ` : ''}{category}</span>
      <p className="prep-card-text">{text}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function GamePrepPanel({ gameData, streaksById = {}, milestonesById = {} }) {
  const homeTeam = gameData?.homeTeam;
  const awayTeam = gameData?.awayTeam;
  const gameDate = gameData?.gameDate || new Date().toISOString().slice(0, 10);
  const gameKey  = `${homeTeam?.id}_${awayTeam?.id}`;

  const [highlighted, setHighlighted] = useLocalStorage(`gameprep_hl_${gameKey}`, []);
  const [dismissed,   setDismissed]   = useLocalStorage(`gameprep_dm_${gameKey}`, []);
  const [showDismissed, setShowDismissed] = useState(false);

  const [weather,  setWeather]  = useState(null);
  const [park,     setPark]     = useState(null);
  const [history,  setHistory]  = useState([]);
  const [bios,     setBios]     = useState({});
  const [pcts,     setPcts]     = useState({});
  const [loading,  setLoading]  = useState(true);
  const [fetched,  setFetched]  = useState(false);

  // Fetch all game prep data once on mount
  useEffect(() => {
    if (fetched) return;
    setFetched(true);

    const [, month, day] = gameDate.split('-');
    const city = homeTeam?.locationName;

    if (city) {
      getWeather(city, gameDate)
        .then(setWeather)
        .catch(() => {});
    }

    if (homeTeam?.id) {
      getParkFactors(homeTeam.id)
        .then(setPark)
        .catch(() => {});
    }

    getOnThisDay(parseInt(month, 10), parseInt(day, 10))
      .then(setHistory)
      .catch(() => {});

    const players = [
      ...(gameData.homeLineup || []),
      ...(gameData.awayLineup || []),
    ].filter(Boolean);

    let remaining = players.length * 2;
    const done = () => { remaining--; if (remaining <= 0) setLoading(false); };

    if (players.length === 0) setLoading(false);

    players.forEach(p => {
      getPlayerBio(p.id)
        .then(bio => { if (bio) setBios(prev => ({ ...prev, [p.id]: bio })); })
        .catch(() => {})
        .finally(done);

      getSavantPercentiles(p.id)
        .then(pct => { if (pct) setPcts(prev => ({ ...prev, [p.id]: pct })); })
        .catch(() => {})
        .finally(done);
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate all cards from available data ────────────────────────────
  const allCards = useMemo(() => {
    const cards = [];
    let idCounter = 0;
    const id = (prefix) => `${prefix}_${idCounter++}`;

    // Weather card
    if (weather && weather.tempF != null) {
      const parts = [`${weather.tempF}°F`];
      if (weather.windMph != null) parts.push(`${weather.windDir || ''} ${weather.windMph}mph wind`);
      if (weather.desc) parts.push(weather.desc);
      if (weather.humidity != null) parts.push(`${weather.humidity}% humidity`);
      cards.push({
        id: id('weather'),
        category: 'Weather',
        icon: weather.tempF < 45 ? '🥶' : weather.tempF > 85 ? '☀️' : '🌤',
        text: `${homeTeam?.name || ''} home game: ${parts.join(' · ')}`,
        section: 'conditions',
        priority: 10,
      });
    }

    // Park factors cards
    if (park) {
      if (park.hr != null && park.hr !== 100) {
        const dir = park.hr > 100 ? 'HR-friendly' : 'pitcher-friendly for HR';
        cards.push({
          id: id('park_hr'),
          category: 'Park Factor',
          icon: '🏟',
          text: `${park.name}: ${dir} (HR index ${park.hr} vs. league avg 100)`,
          section: 'conditions',
          priority: 9,
        });
      }
      if (park.runs != null && park.runs !== 100) {
        const dir = park.runs > 104 ? 'high-scoring' : park.runs < 96 ? 'low-scoring' : 'neutral';
        cards.push({
          id: id('park_runs'),
          category: 'Park Factor',
          icon: '📊',
          text: `${park.name} plays ${dir} for runs (run index ${park.runs})`,
          section: 'conditions',
          priority: 8,
        });
      }
      if (park.doubles != null && park.doubles >= 115) {
        cards.push({
          id: id('park_doubles'),
          category: 'Park Factor',
          icon: '📐',
          text: `${park.name} is a doubles haven (doubles index ${park.doubles})`,
          section: 'conditions',
          priority: 7,
        });
      }
    }

    // ── Player spotlight cards ────────────────────────────────────────────
    const allPlayers = [
      ...(gameData.homeLineup || []).map(p => ({ ...p, side: 'home', teamName: homeTeam?.teamName })),
      ...(gameData.awayLineup || []).map(p => ({ ...p, side: 'away', teamName: awayTeam?.teamName })),
    ].filter(Boolean);

    for (const player of allPlayers) {
      const streak = streaksById[player.id];
      const milestone = milestonesById[player.id];
      const bio = bios[player.id];
      const pct = pcts[player.id];

      // Birthday check (use game date)
      if (player.birthDate) {
        const [byear, bmonth, bday] = player.birthDate.split('-').map(Number);
        const ref = new Date(gameDate + 'T12:00:00');
        if (ref.getMonth() + 1 === bmonth && ref.getDate() === bday) {
          const age = ref.getFullYear() - byear;
          cards.push({
            id: id(`bday_${player.id}`),
            category: 'Birthday',
            icon: '🎂',
            text: `${player.name} (${player.teamName}) turns ${age} today!`,
            section: 'spotlights',
            priority: 20,
          });
        }
      }

      // Streak cards
      if (streak?.activeStreaks?.length) {
        for (const s of streak.activeStreaks.slice(0, 2)) {
          if (s.games >= 5) {
            cards.push({
              id: id(`streak_${player.id}_${s.type}`),
              category: 'Hot Streak',
              icon: '🔥',
              text: `${player.name}: ${s.games}-game ${s.label || s.type} streak`,
              section: 'spotlights',
              priority: 15 + s.games,
            });
          }
        }
      }

      // Milestone cards
      if (milestone?.approaching?.length) {
        for (const m of milestone.approaching.slice(0, 2)) {
          cards.push({
            id: id(`milestone_${player.id}_${m.stat}`),
            category: 'Milestone Watch',
            icon: '🎯',
            text: `${player.name}: ${m.remaining} ${m.stat} from ${m.milestone} career`,
            section: 'spotlights',
            priority: 18,
          });
        }
      }

      // Savant percentile cards — show top standout metrics (≥80th or ≤20th)
      if (pct) {
        const PCT_LABELS = {
          exit_velocity: 'exit velocity',
          xwoba:         'xwOBA',
          brl_pa:        'barrel rate',
          hard_hit:      'hard-hit rate',
          sprint_speed:  'sprint speed',
          xba:           'xBA',
        };
        const standouts = Object.entries(PCT_LABELS)
          .map(([key, label]) => ({ key, label, val: pct[key] }))
          .filter(({ val }) => val != null && val >= 80)
          .sort((a, b) => b.val - a.val)
          .slice(0, 2);

        for (const { label, val } of standouts) {
          cards.push({
            id: id(`pct_${player.id}_${label}`),
            category: 'Statcast Rank',
            icon: '📡',
            text: `${player.name}: ${val}th percentile ${label} league-wide`,
            section: 'spotlights',
            priority: 12 + Math.floor((val - 80) / 4),
          });
        }
      }

      // Bio cards — interesting facts
      if (bio) {
        const facts = [];
        if (bio.college) {
          facts.push(`Attended ${bio.college}`);
        }
        if (bio.draftYear && bio.draftRound) {
          facts.push(`Drafted Round ${bio.draftRound} (${bio.draftYear})`);
        }
        if (bio.mlbDebutDate) {
          const debutYear = bio.mlbDebutDate.slice(0, 4);
          facts.push(`MLB debut: ${bio.mlbDebutDate.slice(5, 7)}/${bio.mlbDebutDate.slice(8, 10)}/${debutYear}`);
        }
        const birthParts = [bio.birthCity, bio.birthStateProvince, bio.birthCountry].filter(Boolean);
        if (birthParts.length >= 2) {
          facts.push(`Born in ${birthParts.join(', ')}`);
        }
        if (facts.length) {
          cards.push({
            id: id(`bio_${player.id}`),
            category: 'Player Bio',
            icon: '📋',
            text: `${player.name}: ${facts.join(' · ')}`,
            section: 'spotlights',
            priority: 5,
          });
        }
      }
    }

    // ── On This Day cards ─────────────────────────────────────────────────
    // Filter to games involving the home or away team, then fill with others
    const homeId = homeTeam?.id;
    const awayId = awayTeam?.id;
    const homeName = homeTeam?.name || '';
    const awayName = awayTeam?.name || '';

    const relevant = history.filter(g =>
      g.home === homeName || g.away === homeName || g.home === awayName || g.away === awayName
    );
    const others = history.filter(g =>
      g.home !== homeName && g.away !== homeName && g.home !== awayName && g.away !== awayName
    );

    const historyCards = [...relevant, ...others].slice(0, 12);
    for (const g of historyCards) {
      cards.push({
        id: id(`otd_${g.year}_${g.away}_${g.home}`),
        category: 'On This Day',
        icon: '📅',
        text: g.summary,
        section: 'history',
        priority: relevant.includes(g) ? 6 : 3,
      });
    }

    return cards;
  }, [weather, park, history, bios, pcts, streaksById, milestonesById, gameDate]);

  // ── Card actions ──────────────────────────────────────────────────────
  const toggleHighlight = (cardId) => {
    setHighlighted(prev =>
      prev.includes(cardId) ? prev.filter(x => x !== cardId) : [...prev, cardId]
    );
  };

  const dismiss = (cardId) => {
    setDismissed(prev => [...prev, cardId]);
  };

  const restore = (cardId) => {
    setDismissed(prev => prev.filter(x => x !== cardId));
  };

  // ── Section helpers ───────────────────────────────────────────────────
  const visibleCards = allCards.filter(c => !dismissed.includes(c.id));
  const dismissedCards = allCards.filter(c => dismissed.includes(c.id));

  const conditionCards  = visibleCards.filter(c => c.section === 'conditions').sort((a, b) => b.priority - a.priority);
  const spotlightCards  = visibleCards.filter(c => c.section === 'spotlights').sort((a, b) => b.priority - a.priority);
  const historyCards    = visibleCards.filter(c => c.section === 'history');

  const renderCard = (card) => (
    <PrepCard
      key={card.id}
      {...card}
      highlighted={highlighted.includes(card.id)}
      onHighlight={toggleHighlight}
      onDismiss={dismiss}
    />
  );

  return (
    <div className="gameprep-layout">
      <div className="gameprep-header">
        <div>
          <h2 className="gameprep-title">
            {awayTeam?.name || 'Away'} @ {homeTeam?.name || 'Home'}
          </h2>
          <div className="gameprep-subtitle">
            {gameDate} {gameData?.gameTime ? `· First pitch ${gameData.gameTime}` : ''}
          </div>
        </div>
      </div>

      {/* Game Conditions */}
      <section>
        <div className="gameprep-section-title">Game Conditions</div>
        {conditionCards.length > 0 ? (
          <div className="gameprep-cards">
            {conditionCards.map(renderCard)}
          </div>
        ) : (
          <div className="gameprep-empty">Loading weather &amp; park data…</div>
        )}
      </section>

      {/* Player Spotlights */}
      <section>
        <div className="gameprep-section-title">Player Spotlights</div>
        {spotlightCards.length > 0 ? (
          <div className="gameprep-cards">
            {spotlightCards.map(renderCard)}
          </div>
        ) : (
          <div className="gameprep-empty">
            {loading ? 'Loading player data…' : 'No spotlight facts available.'}
          </div>
        )}
      </section>

      {/* On This Day */}
      <section>
        <div className="gameprep-section-title">On This Day in Baseball</div>
        {historyCards.length > 0 ? (
          <div className="gameprep-cards">
            {historyCards.map(renderCard)}
          </div>
        ) : (
          <div className="gameprep-empty">Loading historical games…</div>
        )}
      </section>

      {/* Dismissed cards */}
      {dismissedCards.length > 0 && (
        <section>
          <button
            className="prep-show-dismissed"
            onClick={() => setShowDismissed(v => !v)}
          >
            {showDismissed ? 'Hide' : 'Show'} {dismissedCards.length} dismissed card{dismissedCards.length !== 1 ? 's' : ''}
          </button>
          {showDismissed && (
            <div className="gameprep-cards" style={{ marginTop: 8, opacity: 0.6 }}>
              {dismissedCards.map(card => (
                <div key={card.id} className="prep-card prep-card-dismissed">
                  <div className="prep-card-actions">
                    <button onClick={() => restore(card.id)} title="Restore">↩</button>
                  </div>
                  <span className="prep-card-cat">{card.icon ? `${card.icon} ` : ''}{card.category}</span>
                  <p className="prep-card-text">{card.text}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
