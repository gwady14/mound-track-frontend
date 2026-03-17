/**
 * AdminPanel — BK-35
 *
 * Slide-in panel (admin only) showing all registered users,
 * their game counts, roles, and join dates. Admins can expand
 * any user to browse and load their saved games, or delete accounts.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api }     from '../api/index.js';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function UserGames({ userId, token, onLoad, onClose }) {
  const [games,   setGames]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.adminGetUserGames(userId, token)
      .then(setGames)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, token]);

  async function handleLoad(gameId) {
    try {
      const full = await api.getGame(gameId, token);
      onLoad(full.gameData, full.gameState);
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <div className="admin-games-empty">Loading…</div>;
  if (error)   return <div className="admin-games-empty" style={{ color: '#f87171' }}>{error}</div>;
  if (!games?.length) return <div className="admin-games-empty">No saved games.</div>;

  return (
    <ul className="admin-games-list">
      {games.map(g => (
        <li key={g.id} className="admin-game-row">
          <div className="gh-matchup" style={{ flex: 1 }}>
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
          <div className="admin-game-meta">
            <span className="gh-inning">{g.isComplete ? 'Final' : `Inn. ${g.inning}`}</span>
            <span className="gh-date">{fmtDateTime(g.savedAt)}</span>
          </div>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => handleLoad(g.id)}
          >
            Load
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function AdminPanel({ onClose, onLoad }) {
  const { token, user: me } = useAuth();
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [deleting,  setDeleting]  = useState(null);
  const [approving, setApproving] = useState(null);
  const [expanded,  setExpanded]  = useState(null); // userId with games open

  useEffect(() => {
    api.adminGetUsers(token)
      .then(setUsers)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleDelete(id) {
    if (!confirm('Delete this user and all their saved games?')) return;
    setDeleting(id);
    try {
      await api.adminDeleteUser(id, token);
      setUsers(prev => prev.filter(u => u.id !== id));
      if (expanded === id) setExpanded(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleStatusChange(id, status) {
    setApproving(id);
    try {
      await api.adminUpdateUserStatus(id, status, token);
      setUsers(prev => prev.map(u => u.id === id ? { ...u, status } : u));
    } catch (e) {
      setError(e.message);
    } finally {
      setApproving(null);
    }
  }

  function toggleExpand(id) {
    setExpanded(prev => prev === id ? null : id);
  }

  return (
    <div className="gh-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="gh-panel admin-panel">
        <div className="gh-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="gh-title">Admin — Users</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {users.length} account{users.length !== 1 ? 's' : ''}
              {users.filter(u => u.status === 'pending').length > 0 && (
                <span className="admin-pending-badge">{users.filter(u => u.status === 'pending').length} pending</span>
              )}
            </span>
          </div>
          <button className="gh-close" onClick={onClose}>✕</button>
        </div>

        {loading && (
          <div className="gh-empty">
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        )}

        {!loading && error && (
          <div className="auth-error" style={{ margin: 16 }}>{error}</div>
        )}

        {!loading && !error && users.length === 0 && (
          <div className="gh-empty">No users found.</div>
        )}

        {!loading && users.length > 0 && (
          <div className="admin-user-list">
            {/* Header */}
            <div className="admin-user-row admin-user-header">
              <span>User</span>
              <span className="admin-col-games">Games</span>
              <span className="admin-col-role">Role</span>
              <span className="admin-col-status">Status</span>
              <span className="admin-col-joined">Joined</span>
              <span className="admin-col-action" />
            </div>

            {[...users].sort((a, b) => {
              if (a.status === 'pending' && b.status !== 'pending') return -1;
              if (b.status === 'pending' && a.status !== 'pending') return 1;
              return 0;
            }).map(u => (
              <React.Fragment key={u.id}>
                <div className={`admin-user-row ${u.id === me.id ? 'admin-user-me' : ''}`}>
                  {/* User info */}
                  <div className="admin-user-info">
                    <div className="admin-user-avatar">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="admin-user-name">
                        {u.name}
                        {u.id === me.id && <span className="admin-me-tag">You</span>}
                      </div>
                      <div className="admin-user-email">{u.email}</div>
                    </div>
                  </div>

                  {/* Game count — click to expand */}
                  <button
                    className={`admin-col-games admin-games-btn ${expanded === u.id ? 'active' : ''}`}
                    onClick={() => toggleExpand(u.id)}
                    title="View saved games"
                    disabled={u.gameCount === 0}
                  >
                    {u.gameCount ?? 0}
                    {u.gameCount > 0 && (
                      <span className="admin-games-arrow">{expanded === u.id ? '▲' : '▼'}</span>
                    )}
                  </button>

                  <span className="admin-col-role">
                    <span className={`admin-role-badge ${u.role}`}>{u.role}</span>
                  </span>

                  <span className="admin-col-status">
                    <span className={`admin-status-badge ${u.status || 'approved'}`}>{u.status || 'approved'}</span>
                  </span>

                  <span className="admin-col-joined admin-date">{fmtDate(u.createdAt)}</span>

                  <span className="admin-col-action">
                    {u.id !== me.id && u.status === 'pending' && (
                      <>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleStatusChange(u.id, 'approved')}
                          disabled={approving === u.id}
                          title="Approve this user"
                        >
                          {approving === u.id ? '…' : 'Approve'}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost gh-delete-btn"
                          onClick={() => handleStatusChange(u.id, 'rejected')}
                          disabled={approving === u.id}
                          title="Reject this user"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {u.id !== me.id && u.status !== 'pending' && (
                      <button
                        className="btn btn-sm btn-ghost gh-delete-btn"
                        onClick={() => handleDelete(u.id)}
                        disabled={deleting === u.id}
                      >
                        {deleting === u.id ? '…' : 'Remove'}
                      </button>
                    )}
                  </span>
                </div>

                {/* Expanded games sub-panel */}
                {expanded === u.id && (
                  <div className="admin-games-panel">
                    <UserGames
                      userId={u.id}
                      token={token}
                      onLoad={onLoad}
                      onClose={onClose}
                    />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
