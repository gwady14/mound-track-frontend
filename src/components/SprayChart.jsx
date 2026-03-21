/**
 * SprayChart.jsx
 *
 * Renders a Baseball Savant-style spray chart using the hc_x / hc_y
 * coordinates returned by the /api/stats/batter/:id/spray endpoint.
 *
 * Coordinate system (Baseball Savant):
 *   hc_x  — 0 (left) to ~250 (right), home plate center ≈ 125
 *   hc_y  — 0 (center field wall) to ~210 (home plate area)
 * The y-axis maps naturally to SVG: outfield is at the top (low y),
 * home plate is at the bottom (high y) — standard spray chart orientation.
 *
 * Outcome color coding:
 *   HR     — amber
 *   Triple — purple
 *   Double — blue
 *   Single — green
 *   Out    — gray
 */

import React from 'react';

// ── Outcome colors ───────────────────────────────────────────────────────────
const COLORS = {
  hr:     { fill: '#f59e0b', stroke: '#d97706' },
  triple: { fill: '#a855f7', stroke: '#9333ea' },
  double: { fill: '#60a5fa', stroke: '#3b82f6' },
  single: { fill: '#4ade80', stroke: '#22c55e' },
  out:    { fill: '#4b5563', stroke: '#374151' },
};

const LEGEND = [
  { key: 'hr',     label: 'HR'     },
  { key: 'triple', label: '3B'     },
  { key: 'double', label: '2B'     },
  { key: 'single', label: '1B'     },
  { key: 'out',    label: 'Out'    },
];

// ── Field geometry (Baseball Savant coordinate space) ────────────────────────
// These approximate values match where Savant places field landmarks.
const HP  = { x: 125, y: 202 };   // home plate
const B1  = { x: 163, y: 163 };   // first base
const B2  = { x: 125, y: 124 };   // second base
const B3  = { x:  87, y: 163 };   // third base
const LF  = { x:  30, y:  50 };   // LF foul pole
const RF  = { x: 220, y:  50 };   // RF foul pole
const CF  = { x: 125, y:  18 };   // center field wall (bezier control)
const MOUND = { x: 125, y: 166 }; // pitcher's mound

// SVG canvas — viewBox matches Savant coordinate space
const VB_W = 250;
const VB_H = 215;

export default function SprayChart({ dots = [], playerName = '', loading = false, season }) {
  const currentYear = new Date().getFullYear();
  const isPriorYear = season && season < currentYear;
  // Separate outs from hits so hits render on top
  const outs = dots.filter(d => d.o === 'out');
  const hits = dots.filter(d => d.o !== 'out');

  const total  = dots.length;
  const hitCnt = hits.length;
  const hrCnt  = dots.filter(d => d.o === 'hr').length;

  // Fair territory path: home plate → LF pole → CF arc → RF pole → back
  const fairPath = [
    `M ${HP.x} ${HP.y}`,
    `L ${LF.x} ${LF.y}`,
    `Q ${CF.x} ${CF.y} ${RF.x} ${RF.y}`,
    `L ${HP.x} ${HP.y}`,
    'Z',
  ].join(' ');

  // Infield dirt: rough diamond inscribed circle
  const dirtCX = 125, dirtCY = 170, dirtR = 38;

  return (
    <div className="spray-chart">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="spray-chart-svg"
        aria-label={`${playerName} spray chart`}
      >
        {/* ── Background ──────────────────────────────────────────────── */}
        <rect x="0" y="0" width={VB_W} height={VB_H} fill="#111827" />

        {/* ── Fair territory grass ─────────────────────────────────────── */}
        <path d={fairPath} fill="#1a2f1a" />

        {/* ── Infield dirt circle ──────────────────────────────────────── */}
        <circle cx={dirtCX} cy={dirtCY} r={dirtR} fill="#2d1f0e" />

        {/* ── Foul lines ───────────────────────────────────────────────── */}
        <line x1={HP.x} y1={HP.y} x2={LF.x} y2={LF.y}
          stroke="#2d4a2d" strokeWidth="1" />
        <line x1={HP.x} y1={HP.y} x2={RF.x} y2={RF.y}
          stroke="#2d4a2d" strokeWidth="1" />

        {/* ── Outfield wall arc ────────────────────────────────────────── */}
        <path
          d={`M ${LF.x} ${LF.y} Q ${CF.x} ${CF.y} ${RF.x} ${RF.y}`}
          fill="none" stroke="#2d4a2d" strokeWidth="1.5"
        />

        {/* ── Base paths ───────────────────────────────────────────────── */}
        {[[HP, B1], [B1, B2], [B2, B3], [B3, HP]].map(([a, b], i) => (
          <line key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="#3a5c3a" strokeWidth="0.8"
          />
        ))}

        {/* ── Pitcher's mound ──────────────────────────────────────────── */}
        <circle cx={MOUND.x} cy={MOUND.y} r={5} fill="#3a2810" />

        {/* ── Base markers ─────────────────────────────────────────────── */}
        {[B1, B2, B3].map((b, i) => (
          <rect key={i}
            x={b.x - 2.5} y={b.y - 2.5} width="5" height="5"
            fill="#c9a96e"
            transform={`rotate(45, ${b.x}, ${b.y})`}
          />
        ))}
        {/* Home plate pentagon approximated as a rotated rect */}
        <rect
          x={HP.x - 3} y={HP.y - 3} width="6" height="6"
          fill="#d0d0d0"
          transform={`rotate(45, ${HP.x}, ${HP.y})`}
        />

        {/* ── Outs (rendered first, behind hits) ──────────────────────── */}
        {outs.map((dot, i) => (
          <circle
            key={`o${i}`}
            cx={dot.x} cy={dot.y} r={2.2}
            fill={COLORS.out.fill}
            stroke={COLORS.out.stroke}
            strokeWidth="0.4"
            opacity="0.55"
          />
        ))}

        {/* ── Hits (rendered on top, by value) ─────────────────────────── */}
        {/* singles first (bottom), then doubles, triples, HRs on top */}
        {['single', 'double', 'triple', 'hr'].flatMap(type =>
          hits
            .filter(d => d.o === type)
            .map((dot, i) => (
              <circle
                key={`${type}${i}`}
                cx={dot.x} cy={dot.y} r={type === 'hr' ? 3.5 : 2.8}
                fill={COLORS[type].fill}
                stroke={COLORS[type].stroke}
                strokeWidth="0.5"
                opacity="0.85"
              />
            ))
        )}
      </svg>

      {/* ── Legend + summary ──────────────────────────────────────────────── */}
      <div className="spray-legend">
        {LEGEND.map(({ key, label }) => {
          const count = dots.filter(d => d.o === key).length;
          if (count === 0 && key !== 'out') return null;
          return (
            <span key={key} className="spray-legend-item">
              <span className="spray-dot-icon" style={{
                background: COLORS[key].fill,
                border: `1px solid ${COLORS[key].stroke}`,
              }} />
              <span className="spray-legend-label">{label}</span>
              <span className="spray-legend-count">{count}</span>
            </span>
          );
        })}
        <span className="spray-legend-divider" />
        {isPriorYear && (
          <span className="spray-legend-item" style={{ color: 'var(--text-dim)', fontSize: 10 }}>
            {season} Stats
          </span>
        )}
        <span className="spray-summary">
          {total > 0
            ? <>{hitCnt}/{total} BIP · BABIP {(hitCnt / total).toFixed(3).replace(/^0/, '')}{hrCnt > 0 ? ` · ${hrCnt} HR` : ''}</>
            : loading
              ? 'Loading…'
              : 'No batted-ball data'}
        </span>
      </div>
    </div>
  );
}
