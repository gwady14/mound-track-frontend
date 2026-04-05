/**
 * AuthPage — BK-35
 *
 * Sign-in / Sign-up portal. Shown when no authenticated session exists.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/index.js';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  // mode: 'signin' | 'signup' | 'forgot' | 'reset'
  const [mode,     setMode]     = useState('signin');
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [pending,  setPending]  = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [sentReset,  setSentReset]  = useState(false);
  const [resetDone,  setResetDone]  = useState(false);

  // BK-85: auto-enter reset mode when ?token= is in the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (t) { setResetToken(t); setMode('reset'); }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (!name.trim()) { setError('Name is required'); setBusy(false); return; }
        const result = await signUp(name.trim(), email.trim(), password);
        if (result?.pending) { setPending(true); return; }
      } else if (mode === 'forgot') {
        await api.forgotPassword(email.trim());
        setSentReset(true);
      } else if (mode === 'reset') {
        await api.resetPassword(resetToken, password);
        setResetDone(true);
        // Clear token from URL without reload
        window.history.replaceState({}, '', window.location.pathname);
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
    setSentReset(false);
    setResetDone(false);
  }

  if (pending) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <img src="/logo.svg" alt="Mound Track" className="brand-logo-img" />
          </div>
          <div className="auth-pending">
            <div className="auth-pending-icon">⏳</div>
            <div className="auth-pending-title">Account Pending Approval</div>
            <div className="auth-pending-msg">
              Your account has been created and is awaiting admin approval.
              You'll be able to sign in once an admin reviews your request.
            </div>
            <button className="btn btn-ghost auth-pending-back" onClick={() => { setPending(false); switchMode('signin'); }}>
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // BK-85: "check your email" screen after forgot-password submit
  if (sentReset) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <img src="/logo.svg" alt="Mound Track" className="brand-logo-img" />
          </div>
          <div className="auth-pending">
            <div className="auth-pending-icon">📬</div>
            <div className="auth-pending-title">Check Your Email</div>
            <div className="auth-pending-msg">
              If an account exists for that email, we've sent a password reset link. Check your inbox — it expires in 1 hour.
            </div>
            <button className="btn btn-ghost auth-pending-back" onClick={() => switchMode('signin')}>
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // BK-85: "password updated" screen after successful reset
  if (resetDone) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <img src="/logo.svg" alt="Mound Track" className="brand-logo-img" />
          </div>
          <div className="auth-pending">
            <div className="auth-pending-icon">✅</div>
            <div className="auth-pending-title">Password Updated</div>
            <div className="auth-pending-msg">
              Your password has been reset. You can now sign in with your new password.
            </div>
            <button className="btn btn-primary auth-pending-back" onClick={() => switchMode('signin')}>
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Brand */}
        <div className="auth-brand">
          <img src="/logo.svg" alt="Mound Track" className="brand-logo-img" />
        </div>

        {/* Mode tabs — hidden for forgot/reset */}
        <div className="auth-tabs" style={mode === 'forgot' || mode === 'reset' ? { display: 'none' } : {}}>
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

        {/* Forgot/reset headings */}
        {mode === 'forgot' && (
          <div className="auth-mode-heading">
            <div className="auth-mode-title">Reset Password</div>
            <div className="auth-mode-sub">Enter your email and we'll send you a reset link.</div>
          </div>
        )}
        {mode === 'reset' && (
          <div className="auth-mode-heading">
            <div className="auth-mode-title">Set New Password</div>
            <div className="auth-mode-sub">Choose a new password for your account.</div>
          </div>
        )}

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

          {mode !== 'reset' && (
            <div className="auth-field">
              <label className="auth-label">Email</label>
              <input
                className="auth-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus={mode === 'signin' || mode === 'forgot'}
                required
              />
            </div>
          )}

          {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
            <div className="auth-field">
              <label className="auth-label">
                {mode === 'reset' ? 'New Password' : 'Password'}
              </label>
              <input
                className="auth-input"
                type="password"
                placeholder={mode === 'signup' || mode === 'reset' ? 'At least 6 characters' : '••••••••'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus={mode === 'reset'}
                required
              />
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button
            className="btn btn-primary auth-submit"
            type="submit"
            disabled={busy}
          >
            {busy ? (
              mode === 'signup' ? 'Creating account…' :
              mode === 'forgot' ? 'Sending…' :
              mode === 'reset'  ? 'Updating…' : 'Signing in…'
            ) : (
              mode === 'signup' ? 'Create Account' :
              mode === 'forgot' ? 'Send Reset Link' :
              mode === 'reset'  ? 'Update Password' : 'Sign In'
            )}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'signin' ? (
            null
          ) : mode === 'forgot' || mode === 'reset' ? (
            <button className="auth-switch-btn" onClick={() => switchMode('signin')}>
              Back to Sign In
            </button>
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
