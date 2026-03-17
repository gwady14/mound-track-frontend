/**
 * GameHistory — BK-35
 *
 * Slide-in panel showing the user's saved games.
 * Allows loading a previous game or deleting it.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api }     from '../api/index.js';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function GameHistory({ onClose, onLoad }) {
  const { token } = useAuth();
  const [games,   setGames]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [deleting, setDeleting] = useState(null); // id being deleted

  useEffect(() => {
    setLoading(true);
    api.getGames(token)
      .then(setGames)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleLoad(game) {
    try {
      const full = await api.getGame(game.id, token);
      onLoad(full.gameData, full.gameState);
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    setDeleting(id);
    try {
      await api.deleteGame(id, token);
      setGames(prev => prev.filter(g => g.id !== id));
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="gh-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="gh-panel">
        <div className="gh-header">
          <span className="gh-title">Saved Games</span>
          <button className="gh-close" onClick={onClose}>✕</button>
        </div>

        {loading && (
          <div className="gh-empty">
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        )}

        {!loading && error && (
          <div className="auth-error" style={{ margin: '16px' }}>{error}</div>
        )}

        {!loading && !error && games.length === 0 && (
          <div className="gh-empty">
            <p>No saved games yet.</p>
            <p className="gh-empty-sub">Use the "Save Game" button during a game to keep a record.</p>
          </div>
        )}

        {!loading && games.length > 0 && (
          <ul className="gh-list">
            {games.map(g => (
              <li key={g.id} className="gh-item">
                {/* Team logos + score */}
                <div className="gh-matchup">
                  <div className="gh-team">
                    {g.awayTeam?.id && (
                      <img
                        src={`https://www.mlbstatic.com/team-logos/${g.awayTeam.id}.svg`}
                        alt={g.awayTeam.abbreviation}
                        className="gh-logo"
                      />
                    )}
                    <span className="gh-abbr">{g.awayTeam?.abbreviation}</span>
                  </div>
                  <div className="gh-score">
                    <span>{g.score?.away ?? '–'}</span>
                    <span className="gh-score-sep">–</span>
                    <span>{g.score?.home ?? '–'}</span>
                  </div>
                  <div className="gh-team">
                    <span className="gh-abbr">{g.homeTeam?.abbreviation}</span>
                    {g.homeTeam?.id && (
                      <img
                        src={`https://www.mlbstatic.com/team-logos/${g.homeTeam.id}.svg`}
                        alt={g.homeTeam.abbreviation}
                        className="gh-logo"
                      />
                    )}
                  </div>
                </div>

                {/* Meta */}
                <div className="gh-meta">
                  <span className="gh-inning">
                    {g.isComplete ? 'Final' : `Inning ${g.inning}`}
                  </span>
                  <span className="gh-date">{fmtDate(g.savedAt)}</span>
                </div>

                {/* Actions */}
                <div className="gh-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleLoad(g)}
                  >
                    Load
                  </button>
                  <button
                    className="btn btn-sm btn-ghost gh-delete-btn"
                    onClick={() => handleDelete(g.id)}
                    disabled={deleting === g.id}
                  >
                    {deleting === g.id ? '…' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
