/**
 * ZoneMap.jsx
 *
 * Batter hot/cold zone map — 3×3 strike-zone SVG grid colored by batting
 * average per zone location.
 *
 * Color scale:
 *   Blue  (cold, BA near .000)
 *   Slate (league avg ~.260)
 *   Red   (hot, BA .380+)
 *
 * Grid layout (catcher's POV):
 *   col 0 = inside (left)   col 1 = middle   col 2 = outside (right)
 *   row 0 = high             row 1 = middle   row 2 = low
 *
 * Cell layout (top → bottom):
 *   ① BA value  — large, white
 *   ② AB count  — tiny, dimmed
 *
 * Data source: /api/stats/batter/:id/zones (Statcast CSV, same cache as spray)
 */

import React from 'react';

// ── Color helpers ─────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/.{2}/g).map(h => parseInt(h, 16));
  return { r: m[0], g: m[1], b: m[2] };
}

function lerpColor(hexA, hexB, t) {
  const a  = hexToRgb(hexA);
  const b  = hexToRgb(hexB);
  const r  = Math.round(a.r  + (b.r  - a.r)  * t);
  const g  = Math.round(a.g  + (b.g  - a.g)  * t);
  const bl = Math.round(a.b  + (b.b  - a.b)  * t);
  return `rgb(${r},${g},${bl})`;
}

// BA → cell background color
// .000 → cold blue  |  .260 → neutral slate  |  .380+ → hot red
function zoneColor(ba) {
  if (ba == null) return '#1a2b38'; // no data
  const AVG     = 0.260;
  const HOT_MAX = 0.380;
  const clamped = Math.max(0, Math.min(0.500, ba));

  if (clamped >= AVG) {
    const t = Math.min(1, (clamped - AVG) / (HOT_MAX - AVG));
    return lerpColor('#2d4a5c', '#dc2626', t); // slate → red
  } else {
    const t = Math.min(1, clamped / AVG);
    return lerpColor('#1d4ed8', '#2d4a5c', t); // blue → slate
  }
}

function fmtBA(ba) {
  if (ba == null) return '—';
  return ba.toFixed(3).replace(/^0/, '');
}

// ── Component ─────────────────────────────────────────────────────────────
export default function ZoneMap({ zones = [], loading = false, batSide = 'R' }) {
  // For left-handed batters, mirror columns so "In" is on the right and "Out" on the left.
  // Switch hitters default to R. The server data uses catcher's POV (col 0 = left, col 2 = right).
  // For RHB: col 0 = In, col 2 = Out (default).
  // For LHB: col 0 = Out, col 2 = In → we flip the display column mapping.
  const isLefty = batSide === 'L';
  const CELL_W = 62;
  const CELL_H = 52;
  const PAD    = 2;
  const SVG_W  = 3 * CELL_W + 2 * PAD;
  const SVG_H  = 3 * CELL_H + 2 * PAD;

  // Index zones by row/col
  const byCell = {};
  for (const z of zones) byCell[`${z.row}_${z.col}`] = z;

  const totalAB   = zones.reduce((s, z) => s + (z.ab   || 0), 0);
  const totalHits = zones.reduce((s, z) => s + (z.hits || 0), 0);
  const overallBA = totalAB > 0
    ? (totalHits / totalAB).toFixed(3).replace(/^0/, '')
    : null;

  return (
    <div className="zone-map">
      <div className="zone-map-header">
        <span className="zone-map-title">HOT/COLD ZONES</span>
        <span className="zone-map-sub">BA by strike-zone location</span>
      </div>

      {loading ? (
        <div className="zone-map-placeholder">Loading…</div>
      ) : totalAB === 0 ? (
        <div className="zone-map-placeholder">No zone data available</div>
      ) : (
        <div className="zone-map-body">
          {/* Vertical labels — High / Mid / Low */}
          <div className="zone-map-vlabels">
            <span>High</span>
            <span>Mid</span>
            <span>Low</span>
          </div>

          <div className="zone-map-inner">
            <svg
              width={SVG_W}
              height={SVG_H}
              className="zone-map-svg"
              style={{ display: 'block' }}
            >
              {[0, 1, 2].map(row =>
                [0, 1, 2].map(col => {
                  // For lefties, flip the data column so the grid mirrors
                  const dataCol = isLefty ? (2 - col) : col;
                  const z       = byCell[`${row}_${dataCol}`] || { ab: 0, hits: 0, ba: null };
                  const x       = PAD + col * CELL_W;
                  const y       = PAD + row * CELL_H;
                  const bg      = zoneColor(z.ba);
                  const hasData = z.ab > 0;

                  // Y positions within cell
                  const yBA = y + CELL_H / 2 - 6;  // BA — upper half
                  const yAB = y + CELL_H - 8;       // AB count — bottom

                  return (
                    <g key={`${row}_${col}`}>
                      <rect
                        x={x} y={y}
                        width={CELL_W} height={CELL_H}
                        fill={bg}
                        stroke="rgba(255,255,255,0.12)"
                        strokeWidth={1}
                        rx={3}
                      />

                      {/* ① BA value */}
                      <text
                        x={x + CELL_W / 2}
                        y={yBA}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={hasData ? '#ffffff' : '#3d5566'}
                        fontSize={15}
                        fontWeight="700"
                        fontFamily="var(--font-mono, monospace)"
                      >
                        {fmtBA(z.ba)}
                      </text>

                      {/* ② AB count */}
                      <text
                        x={x + CELL_W / 2}
                        y={yAB}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={hasData ? 'rgba(255,255,255,0.42)' : '#2d4050'}
                        fontSize={8}
                        fontFamily="var(--font-mono, monospace)"
                      >
                        {hasData ? `${z.ab} AB` : '·'}
                      </text>
                    </g>
                  );
                })
              )}

              {/* Outer strike-zone border */}
              <rect
                x={PAD} y={PAD}
                width={3 * CELL_W} height={3 * CELL_H}
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth={1.5}
                rx={3}
              />
            </svg>

            {/* Horizontal labels — In / Mid / Out (flipped for LHB) */}
            <div className="zone-map-hlabels">
              <span>{isLefty ? 'Out' : 'In'}</span>
              <span>Mid</span>
              <span>{isLefty ? 'In' : 'Out'}</span>
            </div>
          </div>

          {/* Right column: color scale */}
          <div className="zone-map-scale">
            <div className="zone-map-scale-bar" />
            <div className="zone-map-scale-ticks">
              <span>.000</span>
            </div>
            {overallBA && (
              <div className="zone-map-overall">
                In-zone: {overallBA} BA · {totalAB} AB
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
