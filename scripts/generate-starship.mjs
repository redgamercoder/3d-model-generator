#!/usr/bin/env node
// Generates models/starship.stl — the Starship (upper stage) that mounts on top
// of the Super Heavy booster STL the user provided.
//
// Measured from the supplied booster:
//   • body outer Ø80 mm  (r = 40)
//   • top is an OPEN socket at z ≈ 180, inner Ø75 mm (r = 37.5), wall ≈ 2.5 mm
//
// So this part is built to match:
//   • a hollow steel-banded body at Ø80 mm (continuous silhouette with booster)
//   • a tangent-ogive nose
//   • two forward + two aft flaps
//   • a MATING RING at the base — a Ø74 mm spigot (0.5 mm radial clearance into
//     the Ø75 socket) that plugs down into the booster, with a Ø80 mm shoulder
//     that seats on the booster's top rim.
//
// Units mm, Z up, base ring at Z = 0 (printable nose-up, open base on the bed).
//
//   node scripts/generate-starship.mjs

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

// --- solid construction ------------------------------------------------------

// Append a closed mesh, flipping it so the signed volume is positive (outward
// normals).
function addSolid(tris) {
  let v6 = 0;
  for (const [a, b, c] of tris) {
    v6 += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  for (const [a, b, c] of tris) triangles.push(v6 < 0 ? [a, c, b] : [a, b, c]);
}

// Revolve a closed 2D outline (list of [r, z], CCW) around the Z axis into a
// watertight solid. Points with r ≈ 0 collapse to the axis (apex fans), so a
// shell outline that touches the axis at the nose tip closes cleanly.
function revolve(outline, seg) {
  const eps = 1e-6;
  const ring = (r, z, j) => {
    if (r < eps) return [0, 0, z];
    const a = (2 * Math.PI * j) / seg;
    return [r * Math.cos(a), r * Math.sin(a), z];
  };
  const tris = [];
  const m = outline.length;
  for (let i = 0; i < m; i++) {
    const [r0, z0] = outline[i];
    const [r1, z1] = outline[(i + 1) % m];
    for (let j = 0; j < seg; j++) {
      const A = ring(r0, z0, j), B = ring(r0, z0, j + 1);
      const C = ring(r1, z1, j + 1), D = ring(r1, z1, j);
      if (r0 < eps && r1 < eps) continue;          // axis-to-axis: nothing
      if (r0 < eps) { tris.push([A, C, D]); }       // apex fan (A==B)
      else if (r1 < eps) { tris.push([A, B, C]); }  // apex fan (C==D)
      else { tris.push([A, B, C], [A, C, D]); }
    }
  }
  addSolid(tris);
}

// 2D rounded rectangle (CCW) in the s-t plane.
function roundedRect(w, h, r, k = 6) {
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw - 1e-3, hh - 1e-3);
  const pts = [];
  const corners = [[hw - r, hh - r, 0], [-(hw - r), hh - r, 90], [-(hw - r), -(hh - r), 180], [hw - r, -(hh - r), 270]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= k; i++) {
      const a = deg(start + (90 * i) / k);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
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

// Skin a list of equal-length 3D loops into a closed, capped solid.
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

// =============================================================================
//  DIMENSIONS (mm) — driven by the measured booster
// =============================================================================
const R_BODY = 40.0;     // Ø80 body, matches booster outer
const WALL = 2.5;        // shell wall thickness
const R_SPIGOT = 37.0;   // Ø74 mating ring — 0.5 mm radial clearance into Ø75 socket
const SPIGOT_H = 14.0;   // insertion depth into the booster
const SHOULDER_Z = 16.5; // where the Ø80 shoulder finishes (seats on booster rim)
const BODY_TOP = 100.0;  // top of the cylindrical tank section
const NOSE_LEN = 58.0;   // tangent-ogive nose length
const TIP_Z = BODY_TOP + NOSE_LEN; // 158

// Tangent-ogive radius as a function of height u above the nose base (0..NOSE_LEN)
const rho = (R_BODY * R_BODY + NOSE_LEN * NOSE_LEN) / (2 * R_BODY);
const ogive = (u) => Math.sqrt(Math.max(0, rho * rho - u * u)) - (rho - R_BODY);

// Steel weld-band ridges (the look of Starship's stacked barrel sections)
const RIDGES = [32, 48, 64, 80, 96];
const ridgeBump = (z) => RIDGES.reduce((s, zr) => s + 0.7 * Math.exp(-(((z - zr) / 0.85) ** 2)), 0);

// =============================================================================
//  THE SHELL — one watertight revolve of a hollow outline (open ring base)
// =============================================================================
const outer = [];   // bottom -> top, outer surface
outer.push([R_SPIGOT, 0]);            // ring base, outer
outer.push([R_SPIGOT, SPIGOT_H]);     // straight spigot wall
outer.push([R_BODY, SHOULDER_Z]);     // flare out to the seating shoulder
for (let z = SHOULDER_Z + 1; z <= BODY_TOP; z += 1) outer.push([R_BODY + ridgeBump(z), z]); // banded body
for (let u = 1; u <= NOSE_LEN; u += 1) outer.push([Math.max(0, ogive(u)), BODY_TOP + u]);   // nose to apex

const inner = [];   // top -> bottom, inner surface (cavity), coarser (hidden)
for (let u = NOSE_LEN - 2; u >= 0; u -= 2.5) {
  const ri = ogive(u) - WALL;
  if (ri > 0.4) inner.push([ri, BODY_TOP + u]);   // hollow nose interior
}
inner.push([R_BODY - WALL, BODY_TOP]);            // inner body wall
inner.push([R_BODY - WALL, SHOULDER_Z]);
inner.push([R_SPIGOT - WALL, SPIGOT_H]);          // inner spigot wall
inner.push([R_SPIGOT - WALL, 0]);                 // ring base, inner

// closed outline: up the outside, across the apex, down the inside; the wrap
// from the last inner point back to the first outer point forms the base ring.
revolve([...outer, ...inner], 220);

// =============================================================================
//  FLAPS — two forward (by the nose) + two aft (by the tail)
// =============================================================================
// A flap is a thin, swept, tapering fin lofted along the radial (±X) span; thin
// in Y, chord along Z, rounded edges. Root starts inside the body so it unions
// with the shell when sliced.
function flap(side, zRoot, chordRoot, chordTip, span, sweep, thick) {
  const N = 14, loops = [];
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const x = side * (R_BODY - 4 + span * f);
    const chord = chordRoot + (chordTip - chordRoot) * f;
    const t = thick * (1 - 0.5 * f);
    const zc = zRoot + sweep * f;
    const rr = roundedRect(chord, t, Math.min(t * 0.5, chord * 0.25), 5);
    loops.push(rr.map(([s, yy]) => [x, yy, zc + s]));
  }
  loft(loops);
}
// forward flaps (smaller, high on the body, swept toward the nose)
flap(+1, 90, 20, 13, 17, 4, 4.0);
flap(-1, 90, 20, 13, 17, 4, 4.0);
// aft flaps (larger, low on the body, swept toward the tail)
flap(+1, 34, 30, 18, 22, -5, 5.0);
flap(-1, 34, 30, 18, 22, -5, 5.0);

// =============================================================================
//  write binary STL
// =============================================================================
const buffer = Buffer.alloc(84 + triangles.length * 50);
buffer.write('Starship upper stage - fits Super Heavy booster', 0, 'ascii');
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
writeFileSync(join(outDir, 'starship.stl'), buffer);

const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const tri of triangles) for (const p of tri) for (let k = 0; k < 3; k++) {
  if (p[k] < lo[k]) lo[k] = p[k];
  if (p[k] > hi[k]) hi[k] = p[k];
}
console.log(`Wrote models/starship.stl — ${triangles.length} triangles`);
console.log(`bbox x ${lo[0].toFixed(1)}..${hi[0].toFixed(1)}  y ${lo[1].toFixed(1)}..${hi[1].toFixed(1)}  z ${lo[2].toFixed(1)}..${hi[2].toFixed(1)}`);
console.log(`mating ring Ø${(R_SPIGOT * 2).toFixed(1)} (into booster Ø75.0 socket) · shoulder Ø${(R_BODY * 2).toFixed(1)} seats on rim · spigot depth ${SPIGOT_H}`);
