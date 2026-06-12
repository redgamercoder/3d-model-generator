#!/usr/bin/env node
// Generates models/f1-car.stl — a detailed Formula 1 car built from lofted
// cross-sections, airfoil wings, swept tubes, and revolved solids.
// Scale ≈ 1:24.5 (230 mm long). Units mm, Z up, resting on Z = 0.
//
//   node scripts/generate-f1-car.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const triangles = [];

// --- vector helpers ----------------------------------------------------------

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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
function loft(loops) {
  const t = [];
  const n = loops[0].length;
  for (let i = 0; i < loops.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = loops[i][j], b = loops[i][(j + 1) % n];
      const c = loops[i + 1][(j + 1) % n], d = loops[i + 1][j];
      t.push([a, b, c], [a, c, d]);
    }
  }
  t.push(...capFan(loops[0], true), ...capFan(loops[loops.length - 1], false));
  addSolid(t);
}

// --- 2D profiles --------------------------------------------------------------

function roundedRect(w, h, r, k = 5) {
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

function circle2d(r, n = 32) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  return pts;
}

// NACA-style cambered airfoil, chord along +u (leading edge at 0), thickness in v.
function airfoil(chord, thickness, camber = 0.35, m = 14) {
  const yt = (x) => thickness * (1.4845 * Math.sqrt(x) - 0.63 * x - 1.758 * x * x + 1.4215 * x ** 3 - 0.5075 * x ** 4);
  const pts = [];
  for (let i = 0; i <= m; i++) { const x = i / m; pts.push([x * chord, yt(x)]); }
  for (let i = m - 1; i > 0; i--) { const x = i / m; pts.push([x * chord, -yt(x) * camber]); }
  return pts;
}

// Place a 2D profile into 3D: p2d -> origin + u*s + v*t
const place = (pts, origin, u, v) => pts.map(([s, t]) => add(origin, add(mul(u, s), mul(v, t))));

// --- primitive solids ----------------------------------------------------------

function box([sx, sy, sz], [cx, cy, cz], rotZdeg = 0) {
  const lo = roundedRect(sx, sy, 0.01, 1).map(([x, y]) => rotZp([x, y, 0], deg(rotZdeg)));
  loft([
    lo.map((p) => [p[0] + cx, p[1] + cy, cz - sz / 2]),
    lo.map((p) => [p[0] + cx, p[1] + cy, cz + sz / 2]),
  ]);
}

// Cylinder along X (used for wheels), centered at (cy, cz), from x0 to x1.
function cylX(r, x0, x1, cy, cz, seg = 96) {
  const prof = circle2d(r, seg);
  loft([
    place(prof, [x0, cy, cz], [0, 1, 0], [0, 0, 1]),
    place(prof, [x1, cy, cz], [0, 1, 0], [0, 0, 1]),
  ]);
}

// Round rod between two arbitrary points (suspension, halo struts).
function rod(p, q, r, seg = 24) {
  const d = norm(sub(q, p));
  const u = norm(Math.abs(d[2]) < 0.9 ? cross(d, [0, 0, 1]) : cross(d, [1, 0, 0]));
  const v = cross(d, u);
  const prof = circle2d(r, seg);
  loft([place(prof, p, u, v), place(prof, q, u, v)]);
}

// Tube swept along a 3D path (halo).
function tubeAlongPath(path, r, seg = 24) {
  const loops = [];
  let u = null;
  for (let i = 0; i < path.length; i++) {
    const d = norm(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]));
    if (!u) u = norm(Math.abs(d[2]) < 0.9 ? cross(d, [0, 0, 1]) : cross(d, [1, 0, 0]));
    else u = norm(sub(u, mul(d, u[0] * d[0] + u[1] * d[1] + u[2] * d[2]))); // re-orthogonalize
    const v = cross(d, u);
    loops.push(place(circle2d(r, seg), path[i], u, v));
  }
  loft(loops);
}

// Wing element: airfoil profile extruded along X with arch + twist.
function wing({ span, chord, thickness, yLE, z, aoaDeg, arch = 0, camber = 0.35, segs = 24 }) {
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
}

// =============================================================================
//  THE CAR — axis along Y (front = -Y), 230 mm long, scale ≈ 1:24.5
// =============================================================================

// --- floor -------------------------------------------------------------------
box([64, 118, 2.4], [0, 10, 2.6]);            // main floor, y -49..69
box([46, 16, 2.4], [0, 77, 3.4], 0);          // rear floor section

// --- monocoque + engine cover (one continuous loft) ---------------------------
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
loft(bodySections.map(([y, w, h, zb, r]) =>
  place(roundedRect(w, h, r), [0, y, zb + h / 2], [1, 0, 0], [0, 0, 1])));

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
  loft(pod.map(([y, w, h, zb, r]) =>
    place(roundedRect(w, h, r), [s * (17 + w / 2 - 1), y, zb + h / 2], [1, 0, 0], [0, 0, 1])));
}

// --- airbox / roll hoop --------------------------------------------------------
loft([
  place(roundedRect(10, 7, 2.5), [0, 12, 26], [1, 0, 0], [0, 0, 1]),
  place(roundedRect(8, 6, 2.2), [0, 22, 27], [1, 0, 0], [0, 0, 1]),
  place(roundedRect(5, 4, 1.6), [0, 42, 25.5], [1, 0, 0], [0, 0, 1]),
]);

// --- shark fin + T-wing ---------------------------------------------------------
box([1.6, 38, 8], [0, 70, 26]);                                    // fin
wing({ span: 26, chord: 7, thickness: 1.6, yLE: 82, z: 30.5, aoaDeg: 14 }); // T-wing

// --- cockpit: headrest + helmet -------------------------------------------------
box([18, 4, 5], [0, 12, 25]);                  // headrest behind driver
box([4, 12, 4.5], [-10, 5, 25]);               // cockpit side padding L
box([4, 12, 4.5], [10, 5, 25]);                // cockpit side padding R
{ // helmet: sphere via lofted circles
  const loops = [];
  const R = 5.2, hc = [0, 0, 23.5];
  for (let i = 0; i <= 14; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 14;
    loops.push(place(circle2d(Math.max(0.05, R * Math.cos(a)), 28), add(hc, [0, 0, R * Math.sin(a)]), [1, 0, 0], [0, 1, 0]));
  }
  loft(loops);
}

// --- halo ------------------------------------------------------------------------
{
  const path = [];
  for (let i = 0; i <= 40; i++) {
    const th = deg(-118 + (236 * i) / 40);
    const p = rotXp([13.5 * Math.sin(th), -14.5 * Math.cos(th), 0], deg(-8));
    path.push(add(p, [0, 6, 27]));
  }
  tubeAlongPath(path, 1.5);
  rod([0, -8.4, 26.6], [0, -5, 19], 1.2);      // center strut
  rod([12.5, 11.5, 25.8], [12, 12, 21], 1.4);  // rear posts down to body
  rod([-12.5, 11.5, 25.8], [-12, 12, 21], 1.4);
}

// --- mirrors ----------------------------------------------------------------------
for (const s of [-1, 1]) {
  rod([s * 17, -8, 21], [s * 21.5, -9, 23.5], 0.7, 12);
  box([4.6, 1.6, 2.8], [s * 22.5, -9.2, 24.2]);
}

// --- front wing --------------------------------------------------------------------
wing({ span: 78, chord: 13, thickness: 2, yLE: -113, z: 2.6, aoaDeg: 6, arch: 1.2 });    // main plane
wing({ span: 74, chord: 9, thickness: 1.6, yLE: -106, z: 5.2, aoaDeg: 16, arch: 1.4 });  // flap 1
wing({ span: 70, chord: 7, thickness: 1.4, yLE: -101, z: 8.2, aoaDeg: 26, arch: 1.6 });  // flap 2
wing({ span: 66, chord: 6, thickness: 1.3, yLE: -97.5, z: 11, aoaDeg: 34, arch: 1.8 });  // flap 3
for (const s of [-1, 1]) {
  box([1.6, 22, 13.5], [s * 39.5, -103, 8.2]);          // endplate
  box([1.2, 12, 5], [s * 36.5, -99, 13.5], s * 12);     // endplate vane
}
rod([-3.5, -95, 13], [-3.5, -90, 16.5], 1.3);           // nose pylons
rod([3.5, -95, 13], [3.5, -90, 16.5], 1.3);
box([2.2, 4.5, 2.2], [0, -88, 22.5]);                    // nose camera pod

// --- bargeboards -------------------------------------------------------------------
for (const s of [-1, 1]) {
  box([1.2, 16, 9], [s * 22, -14, 8], s * 18);
  box([1.2, 12, 7], [s * 26, -10, 7], s * 22);
  box([1.2, 8, 5], [s * 30, -6, 6], s * 26);
}

// --- rear wing ----------------------------------------------------------------------
wing({ span: 64, chord: 13, thickness: 2.2, yLE: 96, z: 31, aoaDeg: 24, arch: -1.2, camber: 0.5 }); // main
wing({ span: 64, chord: 9, thickness: 1.8, yLE: 103, z: 37.5, aoaDeg: 38, arch: -1, camber: 0.5 }); // upper flap
for (const s of [-1, 1]) box([1.8, 26, 18], [s * 32.5, 99, 32]);   // endplates
rod([0, 88, 24], [0, 96, 30], 1.6);                                 // swan-neck pylon
rod([0, 92, 22], [0, 102, 29.5], 1.6);
cylX(1.5, -2.5, 2.5, 104, 41.5, 24);                                // DRS actuator pod
// lower beam wing
wing({ span: 40, chord: 8, thickness: 1.8, yLE: 99, z: 19, aoaDeg: 18, camber: 0.5 });

// --- diffuser -------------------------------------------------------------------------
box([46, 18, 2.2], [0, 80, 6.2], 0);                       // angled kick (embedded wedge)
for (let i = -2; i <= 2; i++) box([1.4, 14, 7], [i * 10.5, 80, 7.5]); // strakes

// --- wheels + suspension -----------------------------------------------------------------
function wheelAssembly(cx, cy, R, W) {
  const s = Math.sign(cx);
  const xo = cx + s * (W / 2);   // outboard face
  const xi = cx - s * (W / 2);   // inboard face
  cylX(R, xi, xo, cy, R, 128);                       // tire
  cylX(R * 0.62, xo, xo + s * 0.8, cy, R, 96);       // rim lip
  for (let i = 0; i < 8; i++) {                      // 8 spokes
    const a = deg(45 * i + 22.5);
    rod([xo + s * 0.5, cy + Math.cos(a) * 2, R + Math.sin(a) * 2],
        [xo + s * 0.5, cy + Math.cos(a) * R * 0.58, R + Math.sin(a) * R * 0.58], 0.9, 10);
  }
  cylX(R * 0.16, xo, xo + s * 1.6, cy, R, 6);        // hex wheel nut
  box([2, R * 0.9, R * 1.1], [xi - s * 1.4, cy + 1.5, R]); // brake duct
  // wishbones + pushrod to body
  const hub = [xi, cy, R];
  rod(add(hub, [0, 0, 3.5]), [s * 14, cy - 9, R + 6], 1.1);
  rod(add(hub, [0, 0, 3.5]), [s * 14, cy + 9, R + 6], 1.1);
  rod(add(hub, [0, 0, -4]), [s * 14, cy - 9, R - 6.5], 1.1);
  rod(add(hub, [0, 0, -4]), [s * 14, cy + 9, R - 6.5], 1.1);
  rod(add(hub, [0, 1, 2]), [s * 12, cy + 4, R + 9], 1.0);  // pushrod
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
buffer.write('F1 race car - 3d-model-generator', 0, 'ascii');
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

const xs = triangles.flat().map((p) => p[0]);
const ys = triangles.flat().map((p) => p[1]);
const zs = triangles.flat().map((p) => p[2]);
console.log(`Wrote models/f1-car.stl — ${triangles.length} triangles`);
console.log(`bbox x ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}  y ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)}  z ${Math.min(...zs).toFixed(1)}..${Math.max(...zs).toFixed(1)}`);
