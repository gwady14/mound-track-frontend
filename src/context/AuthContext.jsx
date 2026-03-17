/**
 * AuthContext — BK-35
 *
 * Provides authentication state and methods to the entire app.
 * Token is stored in localStorage under 'gametrack_auth_token'.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY = 'gametrack_auth_token';

const AUTH_BASE = import.meta.env.DEV
  ? '/api/auth'
  : 'https://boothcast-backend-production.up.railway.app/api/auth';

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);  // { id, name, email, role }
  const [token,   setToken]   = useState(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);  // true while validating stored token

  // Validate the stored token on mount
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch(`${AUTH_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(u => setUser(u))
      .catch(() => {
        // Token expired or invalid — clear it
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const _persist = useCallback((tok, usr) => {
    localStorage.setItem(TOKEN_KEY, tok);
    setToken(tok);
    setUser(usr);
  }, []);

  const signUp = useCallback(async (name, email, password) => {
    const res  = await fetch(`${AUTH_BASE}/signup`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sign-up failed');
    _persist(data.token, data.user);
    return data.user;
  }, [_persist]);

  const signIn = useCallback(async (email, password) => {
    const res  = await fetch(`${AUTH_BASE}/signin`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sign-in failed');
    _persist(data.token, data.user);
    return data.user;
  }, [_persist]);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
