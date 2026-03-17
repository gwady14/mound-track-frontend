/**
 * AuthPage — BK-35
 *
 * Sign-in / Sign-up portal. Shown when no authenticated session exists.
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode,     setMode]     = useState('signin'); // 'signin' | 'signup'
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (!name.trim()) { setError('Name is required'); setBusy(false); return; }
        await signUp(name.trim(), email.trim(), password);
      } else {
        await signIn(email.trim(), password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(m) {
    setMode(m);
    setError('');
    setName('');
    setEmail('');
    setPassword('');
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Brand */}
        <div className="auth-brand">
          <img src="/logo.svg" alt="Mound Track" className="brand-logo-img" />
        </div>

        {/* Mode tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => switchMode('signin')}
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => switchMode('signup')}
          >
            Create Account
          </button>
        </div>

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="auth-field">
              <label className="auth-label">Name</label>
              <input
                className="auth-input"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}

          <div className="auth-field">
            <label className="auth-label">Email</label>
            <input
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus={mode === 'signin'}
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input
              className="auth-input"
              type="password"
              placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button
            className="btn btn-primary auth-submit"
            type="submit"
            disabled={busy}
          >
            {busy
              ? (mode === 'signup' ? 'Creating account…' : 'Signing in…')
              : (mode === 'signup' ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'signin' ? (
            <>Don't have an account?{' '}
              <button className="auth-switch-btn" onClick={() => switchMode('signup')}>
                Create one
              </button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button className="auth-switch-btn" onClick={() => switchMode('signin')}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
