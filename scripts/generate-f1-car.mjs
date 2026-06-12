#!/usr/bin/env node
// Generates models/f1-car.stl — an extremely detailed Formula 1 car built from
// lofted cross-sections, airfoil wings, swept tubes, treaded tyres, drilled
// brake discs, multi-element wings, floor fences and full suspension.
// Scale ≈ 1:24.5 (230 mm long). Units mm, Z up, resting on Z = 0.
//
//   node scripts/generate-f1-car.mjs
//
// This is the "maximum detail" build: every primitive is finely tessellated and
// the car carries hundreds of individually modelled aero and mechanical parts.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const triangles = [];

// --- vector helpers ----------------------------------------------------------

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return mul(a, 1 / l); };
const deg = (d) => (d * Math.PI) / 180;

function rotXp(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
function rotZp(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }

// --- solid construction ------------------------------------------------------

// Append a closed mesh, flipping it if its signed volume is negative so every
// solid ends up with outward-facing normals.
function addSolid(tris) {
  let v6 = 0;
  for (const [a, b, c] of tris) {
    v6 += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  for (const [a, b, c] of tris) triangles.push(v6 < 0 ? [a, c, b] : [a, b, c]);
}

function capFan(loop, flip) {
  const c = mul(loop.reduce(add, [0, 0, 0]), 1 / loop.length);
  const out = [];
  for (let j = 0; j < loop.length; j++) {
    const a = loop[j], b = loop[(j + 1) % loop.length];
    out.push(flip ? [c, b, a] : [c, a, b]);
  }
  return out;
}

// Skin a list of equal-length 3D loops into a closed solid.
function loft(loops, { capStart = true, capEnd = true } = {}) {
  const t = [];
  const n = loops[0].length;
  for (let i = 0; i < loops.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = loops[i][j], b = loops[i][(j + 1) % n];
      const c = loops[i + 1][(j + 1) % n], d = loops[i + 1][j];
      t.push([a, b, c], [a, c, d]);
    }
  }
  if (capStart) t.push(...capFan(loops[0], true));
  if (capEnd) t.push(...capFan(loops[loops.length - 1], false));
  addSolid(t);
}

// Skin two loops as an open band (annulus side), no caps. Used inside hollow
// parts (rims, ducts) where the surface wraps back on itself.
function band(loopA, loopB, flip = false) {
  const t = [];
  const n = loopA.length;
  for (let j = 0; j < n; j++) {
    const a = loopA[j], b = loopA[(j + 1) % n];
    const c = loopB[(j + 1) % n], d = loopB[j];
    if (flip) t.push([a, d, c], [a, c, b]);
    else t.push([a, b, c], [a, c, d]);
  }
  for (const tri of t) triangles.push(tri);
}

// --- 2D profiles --------------------------------------------------------------

function roundedRect(w, h, r, k = 6) {
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw - 0.01, hh - 0.01);
  const pts = [];
  const corners = [[hw - r, hh - r, 0], [-(hw - r), hh - r, 90], [-(hw - r), -(hh - r), 180], [hw - r, -(hh - r), 270]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= k; i++) {
      const a = deg(start + (90 * i) / k);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts; // 4*(k+1) points, CCW
}

function circle2d(r, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  return pts;
}

// NACA-style cambered airfoil, chord along +u (leading edge at 0), thickness in v.
function airfoil(chord, thickness, camber = 0.35, m = 28) {
  const yt = (x) => thickness * (1.4845 * Math.sqrt(x) - 0.63 * x - 1.758 * x * x + 1.4215 * x ** 3 - 0.5075 * x ** 4);
  const pts = [];
  for (let i = 0; i <= m; i++) { const x = i / m; pts.push([x * chord, yt(x)]); }
  for (let i = m - 1; i > 0; i--) { const x = i / m; pts.push([x * chord, -yt(x) * camber]); }
  return pts;
}

// Place a 2D profile into 3D: p2d -> origin + u*s + v*t
const place = (pts, origin, u, v) => pts.map(([s, t]) => add(origin, add(mul(u, s), mul(v, t))));

// Catmull-Rom interpolation of a list of numbers -> denser list (smoother body).
function smoothSections(rows, sub = 4) {
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const out = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const p0 = rows[Math.max(0, i - 1)], p1 = rows[i], p2 = rows[i + 1], p3 = rows[Math.min(rows.length - 1, i + 2)];
    const steps = i === rows.length - 2 ? sub : sub;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push(p1.map((_, k) => cr(p0[k], p1[k], p2[k], p3[k], t)));
    }
  }
  out.push(rows[rows.length - 1]);
  return out;
}

// --- primitive solids ----------------------------------------------------------

function box([sx, sy, sz], [cx, cy, cz], rotZdeg = 0) {
  const lo = roundedRect(sx, sy, 0.01, 1).map(([x, y]) => rotZp([x, y, 0], deg(rotZdeg)));
  loft([
    lo.map((p) => [p[0] + cx, p[1] + cy, cz - sz / 2]),
    lo.map((p) => [p[0] + cx, p[1] + cy, cz + sz / 2]),
  ]);
}

// Rounded "soft" box with filleted vertical edges.
function softBox([sx, sy, sz], [cx, cy, cz], r = 1, rotZdeg = 0) {
  const lo = roundedRect(sx, sy, r, 4).map(([x, y]) => rotZp([x, y, 0], deg(rotZdeg)));
  loft([
    lo.map((p) => [p[0] + cx, p[1] + cy, cz - sz / 2]),
    lo.map((p) => [p[0] + cx, p[1] + cy, cz + sz / 2]),
  ]);
}

// Cylinder along X (used for wheels), centered at (cy, cz), from x0 to x1.
function cylX(r, x0, x1, cy, cz, seg = 128) {
  const prof = circle2d(r, seg);
  loft([
    place(prof, [x0, cy, cz], [0, 1, 0], [0, 0, 1]),
    place(prof, [x1, cy, cz], [0, 1, 0], [0, 0, 1]),
  ]);
}

// Round rod between two arbitrary points (suspension, halo struts).
function rod(p, q, r, seg = 20) {
  const d = norm(sub(q, p));
  const u = norm(Math.abs(d[2]) < 0.9 ? cross(d, [0, 0, 1]) : cross(d, [1, 0, 0]));
  const v = cross(d, u);
  const prof = circle2d(r, seg);
  loft([place(prof, p, u, v), place(prof, q, u, v)]);
}

// Aero-profiled strut between two points (suspension arms / wishbones) — a thin
// airfoil cross-section swept from p to q, the broad face roughly horizontal.
function aeroStrut(p, q, chord, thick) {
  const d = norm(sub(q, p));
  let u = norm(Math.abs(d[2]) < 0.9 ? cross([0, 0, 1], d) : cross([1, 0, 0], d));
  const v = norm(cross(d, u));
  const prof = airfoil(chord, thick, 0.6, 10).map(([s, t]) => [s - chord / 2, t]);
  loft([place(prof, p, u, v), place(prof, q, u, v)]);
}

// Tube swept along a 3D path (halo).
function tubeAlongPath(path, r, seg = 28) {
  const loops = [];
  let u = null;
  for (let i = 0; i < path.length; i++) {
    const d = norm(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]));
    if (!u) u = norm(Math.abs(d[2]) < 0.9 ? cross(d, [0, 0, 1]) : cross(d, [1, 0, 0]));
    else u = norm(sub(u, mul(d, dot(u, d)))); // re-orthogonalize
    const v = cross(d, u);
    loops.push(place(circle2d(r, seg), path[i], u, v));
  }
  loft(loops);
}

// Wing element: airfoil profile extruded along X with arch + twist, optionally
// with a Gurney flap (small lip at the trailing edge).
function wing({ span, chord, thickness, yLE, z, aoaDeg, arch = 0, camber = 0.35, segs = 40, gurney = 0 }) {
  const prof = airfoil(chord, thickness, camber);
  const loops = [];
  for (let i = 0; i <= segs; i++) {
    const x = -span / 2 + (span * i) / segs;
    const f = (x / (span / 2)) ** 2;
    const a = deg(-aoaDeg);
    const rotated = prof.map(([s, t]) => [s * Math.cos(a) - t * Math.sin(a), s * Math.sin(a) + t * Math.cos(a)]);
    loops.push(place(rotated, [x, yLE, z + arch * f], [0, 1, 0], [0, 0, 1]));
  }
  loft(loops);
  if (gurney > 0) {
    const a = deg(-aoaDeg);
    const te = [chord * Math.cos(a), chord * Math.sin(a)];
    box([span * 0.96, 0.8, gurney], [0, yLE + te[1] + 0.4, z + arch + te[0] / chord * 0 + te[1] * 0 + 0]);
  }
}

// =============================================================================
//  THE CAR — axis along Y (front = -Y), 230 mm long, scale ≈ 1:24.5
// =============================================================================

// --- floor / plank ------------------------------------------------------------
softBox([64, 118, 2.4], [0, 10, 2.6], 3);          // main floor, y -49..69
softBox([46, 16, 2.4], [0, 77, 3.4], 3);           // rear floor section
box([20, 116, 0.8], [0, 10, 1.3]);                 // wooden plank underneath
// floor edge wing (raised lip down both sides)
for (const s of [-1, 1]) {
  box([2.2, 110, 5], [s * 32.5, 10, 4], s * 2);
}

// --- monocoque + engine cover (one continuous, finely-lofted body) ------------
// sections: [y, width, height, zBottom, corner radius]
const bodySections = [
  [-96, 7, 6, 12, 2.6],     // nose tip
  [-85, 11, 8, 11, 3.5],
  [-70, 16, 11, 9, 4.5],
  [-55, 22, 14, 6.5, 5.5],
  [-42, 27, 17, 4.5, 6.5],
  [-30, 31, 19, 3.8, 7],    // cockpit front
  [-12, 33, 20, 3.8, 7.5],
  [6, 33, 20, 3.8, 7.5],    // cockpit rear
  [24, 31, 19, 3.8, 7],
  [45, 26, 17, 3.8, 6],
  [65, 19, 13, 3.8, 4.5],
  [82, 12, 9, 3.8, 3],
  [94, 7, 5.5, 4.2, 2],     // tail
];
loft(smoothSections(bodySections, 5).map(([y, w, h, zb, r]) =>
  place(roundedRect(w, h, r, 8), [0, y, zb + h / 2], [1, 0, 0], [0, 0, 1])));

// --- sidepods (left/right mirrored) -------------------------------------------
for (const s of [-1, 1]) {
  const pod = [
    [2, 4, 4, 4, 1.5],
    [10, 13, 13, 4, 4],
    [22, 14, 14, 4, 4.5],
    [38, 12, 11, 4.5, 4],
    [54, 8, 7, 5.5, 2.5],
    [64, 4, 3.5, 6.5, 1.2],
  ];
  loft(smoothSections(pod, 4).map(([y, w, h, zb, r]) =>
    place(roundedRect(w, h, r, 7), [s * (17 + w / 2 - 1), y, zb + h / 2], [1, 0, 0], [0, 0, 1])));
  // sidepod inlet lip (rounded mouth)
  loft([
    place(circle2d(1.0, 28), [s * 20, 1.5, 9], [0, 1, 0], [0, 0, 1]),
    place(roundedRect(11, 11, 4, 7), [s * 20, 3.5, 9], [1, 0, 0], [0, 0, 1]),
  ]);
  // undercut cooling louvres on top of the pod
  for (let i = 0; i < 6; i++) {
    box([7, 1.0, 1.4], [s * 18, 28 + i * 4.5, 13.5 - i * 0.7], s * 6);
  }
}

// --- airbox / roll hoop --------------------------------------------------------
loft(smoothSections([
  [12, 10, 7, 26, 2.5],
  [22, 8, 6, 27, 2.2],
  [42, 5, 4, 25.5, 1.6],
], 4).map(([y, w, h, zb, r]) =>
  place(roundedRect(w, h, r, 6), [0, y, zb + h / 2], [1, 0, 0], [0, 0, 1])));
// airbox intake mouth (open-ish horseshoe)
loft([
  place(circle2d(3.4, 32), [0, 9, 26.5], [1, 0, 0], [0, 0, 1]),
  place(circle2d(2.4, 32), [0, 13, 26.5], [1, 0, 0], [0, 0, 1]),
], { capStart: false });

// --- shark fin + T-wing ---------------------------------------------------------
loft([                                                              // tapered fin
  place(roundedRect(1.6, 0.1, 0.04, 1), [0, 52, 22], [0, 1, 0], [0, 0, 1]),
  place(roundedRect(1.6, 36, 0.6, 1), [0, 70, 26], [0, 1, 0], [0, 0, 1]),
]);
box([1.6, 40, 9], [0, 70, 26]);                                    // fin body
wing({ span: 26, chord: 7, thickness: 1.6, yLE: 82, z: 30.5, aoaDeg: 14, gurney: 1.0 }); // T-wing

// --- cockpit: headrest, padding, steering wheel, helmet -------------------------
softBox([18, 5, 5], [0, 12, 25], 1.5);         // headrest behind driver
softBox([4, 12, 4.5], [-10, 5, 25], 1);        // cockpit side padding L
softBox([4, 12, 4.5], [10, 5, 25], 1);         // cockpit side padding R
box([10, 1.2, 6], [0, -4, 21], 0);             // dashboard bulkhead
// steering wheel (rounded rectangle ring + hub)
{
  const cy = -8, cz = 19.5, tilt = deg(35);
  const ring = roundedRect(9, 6, 2, 6);
  const inner = ring.map(([x, y]) => [x * 0.6, y * 0.6]);
  const place3 = (pts, off) => pts.map(([x, y]) => add([0, cy, cz], rotXp([x, off, y], tilt)));
  const o0 = place3(ring, -0.8), o1 = place3(ring, 0.8);
  const i0 = place3(inner, -0.8), i1 = place3(inner, 0.8);
  band(o0, o1); band(i1, i0); band(o0, i0, true); band(o1, i1);
  box([5, 1.2, 3], [0, cy + 0.3, cz - 0.6]); // hub / display
}
{ // helmet: sphere via lofted circles with a visor band
  const loops = [];
  const R = 5.2, hc = [0, -1, 23.8];
  for (let i = 0; i <= 22; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 22;
    loops.push(place(circle2d(Math.max(0.05, R * Math.cos(a)), 36), add(hc, [0, 0, R * Math.sin(a)]), [1, 0, 0], [0, 1, 0]));
  }
  loft(loops);
  box([8.6, 1.0, 2.2], [0, -5.4, 24.2]);       // visor surround
}

// --- halo ------------------------------------------------------------------------
{
  const path = [];
  for (let i = 0; i <= 64; i++) {
    const th = deg(-118 + (236 * i) / 64);
    const p = rotXp([13.5 * Math.sin(th), -14.5 * Math.cos(th), 0], deg(-8));
    path.push(add(p, [0, 6, 27]));
  }
  tubeAlongPath(path, 1.5);
  aeroStrut([0, -8.4, 26.6], [0, -5, 19], 3.0, 1.2);   // central vee strut (bladed)
  rod([12.5, 11.5, 25.8], [12, 12, 21], 1.4);          // rear posts down to body
  rod([-12.5, 11.5, 25.8], [-12, 12, 21], 1.4);
}

// --- mirrors ----------------------------------------------------------------------
for (const s of [-1, 1]) {
  rod([s * 17, -8, 21], [s * 21.5, -9, 23.5], 0.7, 14);
  softBox([4.6, 1.8, 2.8], [s * 22.5, -9.2, 24.2], 0.8);
  box([3.6, 0.4, 2.0], [s * 22.5, -10.1, 24.2]);   // mirror glass
}

// =============================================================================
//  FRONT WING — multi-element with cascades, endplates and footplates
// =============================================================================
wing({ span: 78, chord: 13, thickness: 2, yLE: -113, z: 2.6, aoaDeg: 6, arch: 1.2, gurney: 0.8 });    // main plane
wing({ span: 74, chord: 9, thickness: 1.6, yLE: -106, z: 5.2, aoaDeg: 16, arch: 1.4, gurney: 0.7 });  // flap 1
wing({ span: 70, chord: 7, thickness: 1.4, yLE: -101, z: 8.2, aoaDeg: 26, arch: 1.6, gurney: 0.6 });  // flap 2
wing({ span: 66, chord: 6, thickness: 1.3, yLE: -97.5, z: 11, aoaDeg: 34, arch: 1.8, gurney: 0.6 });  // flap 3
for (const s of [-1, 1]) {
  // main endplate with curled top
  loft([
    place(roundedRect(22, 13.5, 1.5, 4), [s * 39.5, -103, 8.2], [0, 1, 0], [0, 0, 1]),
    place(roundedRect(22, 13.5, 1.5, 4), [s * 40.7, -103, 8.6], [0, 1, 0], [0, 0, 1]),
  ]);
  box([1.2, 12, 5], [s * 36.5, -99, 13.5], s * 12);     // upper endplate vane
  box([1.0, 14, 3], [s * 41.0, -104, 3.5], s * 4);      // footplate
  // cascade winglets
  for (let i = 0; i < 3; i++) box([1.0, 5, 1.0], [s * (30 - i * 6), -100 - i * 1.5, 12 - i * 1.0], s * (10 + i * 4));
  // turning vanes under the nose
  box([0.9, 10, 6], [s * 8, -78, 7], s * 14);
  box([0.9, 8, 5], [s * 11, -72, 6.5], s * 18);
}
aeroStrut([-3.5, -95, 13], [-3.5, -90, 16.5], 3.0, 1.3);  // nose pylons (bladed)
aeroStrut([3.5, -95, 13], [3.5, -90, 16.5], 3.0, 1.3);
softBox([2.4, 4.5, 2.4], [0, -88, 22.5], 0.8);            // nose camera pod
rod([0, -90, 22.5], [0, -86, 22.5], 0.9, 12);             // camera stalk

// --- bargeboards / floor fences ----------------------------------------------------
for (const s of [-1, 1]) {
  box([1.2, 16, 9], [s * 22, -14, 8], s * 18);
  box([1.2, 12, 7], [s * 26, -10, 7], s * 22);
  box([1.2, 8, 5], [s * 30, -6, 6], s * 26);
  // floor edge fences (row of curved vanes ahead of the rear tyre)
  for (let i = 0; i < 5; i++) {
    box([0.8, 6, 4 - i * 0.3], [s * (31 - i * 0.4), 18 + i * 8, 5], s * (20 - i * 2));
  }
}

// =============================================================================
//  REAR WING — main + flap + DRS, endplates with louvres, beam wing
// =============================================================================
wing({ span: 64, chord: 13, thickness: 2.2, yLE: 96, z: 31, aoaDeg: 24, arch: -1.2, camber: 0.5, gurney: 1.2 }); // main
wing({ span: 64, chord: 9, thickness: 1.8, yLE: 103, z: 37.5, aoaDeg: 38, arch: -1, camber: 0.5 });             // upper flap (DRS)
for (const s of [-1, 1]) {
  box([1.8, 26, 18], [s * 32.5, 99, 32]);            // endplate
  for (let i = 0; i < 4; i++) box([2.0, 1.0, 3], [s * 32.5, 92 + i * 3, 28 + i * 1.5]); // endplate louvres
}
rod([0, 88, 24], [0, 96, 30], 1.6);                  // swan-neck pylon
rod([0, 92, 22], [0, 102, 29.5], 1.6);
cylX(1.5, -2.5, 2.5, 104, 41.5, 28);                 // DRS actuator pod
wing({ span: 40, chord: 8, thickness: 1.8, yLE: 99, z: 19, aoaDeg: 18, camber: 0.5, gurney: 0.8 }); // lower beam wing
// rear crash structure + rain light + exhaust
softBox([6, 14, 5], [0, 92, 14], 1.5);               // crash structure
box([2.2, 2.2, 2.2], [0, 100, 16]);                  // rain light
loft([                                               // exhaust tailpipe
  place(circle2d(2.0, 28), [0, 90, 17], [1, 0, 0], [0, 0, 1]),
  place(circle2d(1.7, 28), [0, 99, 17.5], [1, 0, 0], [0, 0, 1]),
], { capStart: true, capEnd: false });

// --- diffuser -------------------------------------------------------------------------
box([46, 18, 2.2], [0, 80, 6.2], 0);                       // angled kick (embedded wedge)
for (let i = -3; i <= 3; i++) box([1.2, 14, 7 - Math.abs(i) * 0.4], [i * 6.6, 80, 7.5]); // strakes
box([44, 2, 9], [0, 88, 8]);                               // diffuser trailing arch

// =============================================================================
//  WHEELS + BRAKES + SUSPENSION  (treaded tyres, drilled discs, spoked rims)
// =============================================================================

// One grooved tyre: a treaded outer surface (radial tread blocks + shoulder
// fillet) plus inner sidewalls, modelled as a finely lofted ring of loops.
function tyre(cx, cy, R, W) {
  const s = Math.sign(cx);
  const xo = cx + s * (W / 2);   // outboard face
  const xi = cx - s * (W / 2);   // inboard face
  const xs = [xi, xi + s * 1.0, cx - W * 0.28 * s, cx, cx + W * 0.28 * s, xo - s * 1.0, xo];
  const seg = 180;               // angular resolution of the tread
  const grooves = 6;             // circumferential tread blocks per quarter
  const loops = xs.map((x, k) => {
    const shoulder = (k === 0 || k === xs.length - 1) ? 0.86
      : (k === 1 || k === xs.length - 2) ? 0.97 : 1.0;
    const loop = [];
    for (let i = 0; i < seg; i++) {
      const a = (2 * Math.PI * i) / seg;
      // tread: square-wave radial modulation on the contact band only
      let rr = R * shoulder;
      if (k > 1 && k < xs.length - 2) {
        const block = Math.floor((i / seg) * grooves * 4) % 2;
        rr -= block ? 0.0 : 0.5;          // grooves ~0.5 mm deep
      }
      loop.push([x, cy + rr * Math.cos(a), R + rr * Math.sin(a)]);
    }
    return loop;
  });
  loft(loops);
}

// Brake disc: a thin cylinder with a ring of drilled cooling holes, plus caliper.
function brakeDisc(cx, cy, R) {
  const s = Math.sign(cx);
  const xi = cx - s * 0.6, xo = cx + s * 0.6;
  const dr = R * 0.66;
  const outer0 = place(circle2d(dr, 64), [xi, cy, R], [0, 1, 0], [0, 0, 1]);
  const outer1 = place(circle2d(dr, 64), [xo, cy, R], [0, 1, 0], [0, 0, 1]);
  const innerR = dr * 0.42;
  const inner0 = place(circle2d(innerR, 64), [xi, cy, R], [0, 1, 0], [0, 0, 1]);
  const inner1 = place(circle2d(innerR, 64), [xo, cy, R], [0, 1, 0], [0, 0, 1]);
  band(outer0, outer1);                 // outer rim
  band(inner1, inner0);                 // bore wall
  band(outer0, inner0, true);           // inboard face
  band(inner1, outer1, true);           // outboard face
  // drilled cooling holes (small thru tubes) around the friction band
  for (let i = 0; i < 24; i++) {
    const a = (2 * Math.PI * i) / 24, hr = dr * 0.72;
    cylX(R * 0.05, xi - s * 0.1, xo + s * 0.1, cy + hr * Math.cos(a), R + hr * Math.sin(a), 8);
  }
  softBox([2.0, 5, 7], [cx, cy - 2, R + dr * 0.7], 1); // caliper
}

// Spoked rim sitting inside the tyre.
function rim(cx, cy, R, W) {
  const s = Math.sign(cx);
  const xo = cx + s * (W / 2 - 0.4);
  const rimR = R * 0.6;
  // barrel
  loft([
    place(circle2d(rimR, 48), [cx - s * (W / 2 - 1), cy, R], [0, 1, 0], [0, 0, 1]),
    place(circle2d(rimR, 48), [xo, cy, R], [0, 1, 0], [0, 0, 1]),
  ]);
  // five twin-spoke pairs to a central hub
  for (let i = 0; i < 5; i++) {
    const a = deg(72 * i);
    const a2 = a + deg(14);
    rod([xo - s * 0.4, cy + Math.cos(a) * rimR * 0.95, R + Math.sin(a) * rimR * 0.95],
        [xo - s * 0.4, cy + Math.cos(a) * rimR * 0.22, R + Math.sin(a) * rimR * 0.22], 0.7, 8);
    rod([xo - s * 0.4, cy + Math.cos(a2) * rimR * 0.95, R + Math.sin(a2) * rimR * 0.95],
        [xo - s * 0.4, cy + Math.cos(a2) * rimR * 0.22, R + Math.sin(a2) * rimR * 0.22], 0.7, 8);
  }
  cylX(rimR * 0.28, xo - s * 0.3, xo + s * 1.0, cy, R, 16);  // hub
  cylX(R * 0.14, xo + s * 0.6, xo + s * 1.8, cy, R, 6);      // hex wheel nut
}

function wheelAssembly(cx, cy, R, W) {
  const s = Math.sign(cx);
  const xi = cx - s * (W / 2);
  tyre(cx, cy, R, W);
  rim(cx, cy, R, W);
  brakeDisc(xi - s * 1.2, cy, R);
  // brake duct scoop
  softBox([2.4, R * 0.8, R * 1.0], [xi - s * 1.6, cy + 1.5, R], 1.2);
  // wishbones (aero-bladed) + pushrod to body
  const hub = [xi, cy, R];
  aeroStrut(add(hub, [0, 0, 3.5]), [s * 14, cy - 10, R + 6], 3.2, 0.9);   // upper front
  aeroStrut(add(hub, [0, 0, 3.5]), [s * 14, cy + 10, R + 6], 3.2, 0.9);   // upper rear
  aeroStrut(add(hub, [0, 0, -4]), [s * 14, cy - 10, R - 6.5], 3.2, 0.9);  // lower front
  aeroStrut(add(hub, [0, 0, -4]), [s * 14, cy + 10, R - 6.5], 3.2, 0.9);  // lower rear
  rod(add(hub, [0, 1, 2]), [s * 12, cy + 4, R + 9], 1.0);                 // pushrod
  rod(add(hub, [0, -1, 0]), [s * 13, cy - 6, R + 2], 0.8);                // track rod
}
const FR = 14.7, FW = 12.5, RR = 15.3, RW = 16.5;
wheelAssembly(-34.5, -78, FR, FW);
wheelAssembly(34.5, -78, FR, FW);
wheelAssembly(-35.5, 69, RR, RW);
wheelAssembly(35.5, 69, RR, RW);

// =============================================================================
//  write binary STL
// =============================================================================

const buffer = Buffer.alloc(84 + triangles.length * 50);
buffer.write('F1 race car - 3d-model-generator (max detail)', 0, 'ascii');
buffer.writeUInt32LE(triangles.length, 80);
let off = 84;
for (const [a, b, c] of triangles) {
  const n = norm(cross(sub(b, a), sub(c, a)));
  for (const v of [n, a, b, c]) {
    buffer.writeFloatLE(v[0], off); buffer.writeFloatLE(v[1], off + 4); buffer.writeFloatLE(v[2], off + 8);
    off += 12;
  }
  off += 2;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'models');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'f1-car.stl'), buffer);

const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const tri of triangles) for (const p of tri) for (let k = 0; k < 3; k++) {
  if (p[k] < lo[k]) lo[k] = p[k];
  if (p[k] > hi[k]) hi[k] = p[k];
}
console.log(`Wrote models/f1-car.stl — ${triangles.length} triangles`);
console.log(`bbox x ${lo[0].toFixed(1)}..${hi[0].toFixed(1)}  y ${lo[1].toFixed(1)}..${hi[1].toFixed(1)}  z ${lo[2].toFixed(1)}..${hi[2].toFixed(1)}`);
