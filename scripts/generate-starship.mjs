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
const TOTAL_H = 250.0;   // overall Starship height (taller than the booster)
const R_BLEND = 4.0;     // ogive radius where the tip rounding begins (smaller = sharper, still smooth)
const NOSE_VIRT = 87.0;  // tangent-ogive "virtual" length — long, pointed nose like the photo

// Tangent-ogive radius as a function of height u above the nose base
const rho = (R_BODY * R_BODY + NOSE_VIRT * NOSE_VIRT) / (2 * R_BODY);
const ogive = (u) => Math.sqrt(Math.max(0, rho * rho - u * u)) - (rho - R_BODY);

// Round the nose tip with an arc that is TANGENT to the ogive, so the dome
// closes smoothly to a single clean apex (no tip nub/dot). The tangent circle
// that meets the ogive at radius R_BLEND and reaches the axis has radius
// rhoTip = R_BLEND·rho/A, centred on the axis.
let uB = NOSE_VIRT;
for (let u = 0; u <= NOSE_VIRT; u += 0.01) { if (ogive(u) <= R_BLEND) { uB = u; break; } }
const Rb = ogive(uB);
const A = Math.sqrt(rho * rho - uB * uB);
const rhoTip = Rb * rho / A;                 // tangent tip-arc radius
const zCenter = uB - Rb * uB / A;            // arc centre height (above nose base)
const thetaB = Math.acos(Rb / rhoTip);       // arc angle at the blend point
const NOSE_LEN = zCenter + rhoTip;           // nose height incl. domed tip
const BODY_TOP = TOTAL_H - NOSE_LEN;         // top of the cylindrical tank section

// =============================================================================
//  THE SHELL — one watertight revolve of a hollow outline (open ring base)
// =============================================================================
// Smooth steel body (no weld bands) — a clean cylinder up to the domed nose.
const outer = [];   // bottom -> top, outer surface
outer.push([R_SPIGOT, 0]);            // ring base, outer
outer.push([R_SPIGOT, SPIGOT_H]);     // straight spigot wall
outer.push([R_BODY, SHOULDER_Z]);     // flare out to the seating shoulder
outer.push([R_BODY, BODY_TOP]);       // smooth cylindrical body
for (let u = 1; u <= uB; u += 1) outer.push([ogive(u), BODY_TOP + u]);            // ogive nose
for (let i = 1; i <= 16; i++) {                                                   // tangent rounded dome
  const a = thetaB + (Math.PI / 2 - thetaB) * (i / 16);
  outer.push([rhoTip * Math.cos(a), BODY_TOP + zCenter + rhoTip * Math.sin(a)]);
}

const inner = [];   // top -> bottom, inner surface (cavity), coarser (hidden)
for (let u = uB - 2; u >= 0; u -= 2.5) {
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
//  FLAPS — Starship V2 control surfaces: two forward + two larger aft.
// =============================================================================
// Modelled as panel-like surfaces: a long chord along the body axis, a short
// radial protrusion, a swept (raked) leading edge and rounded corners — i.e.
// flaps lying back against the hull, not airplane wings. Placed on the ±Y sides
// (clear of the +X launch lug). Root starts just inside the skin so it unions
// with the shell when sliced.
function flap(thetaDeg, zRoot, chordRoot, chordTip, span, sweep, thick) {
  const th = deg(thetaDeg);
  const er = [Math.cos(th), Math.sin(th), 0];   // radial (protrusion) direction
  const et = [-Math.sin(th), Math.cos(th), 0];  // tangential (thickness) direction
  const N = 16, loops = [];
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const r = (R_BODY - 10) + span * f;           // start deep inside the skin (solid attach on the narrowing nose)
    const chord = chordRoot + (chordTip - chordRoot) * f;
    const t = thick * (1 - 0.45 * f);
    const zc = zRoot + sweep * f;                 // swept leading/trailing edge
    const rr = roundedRect(chord, t, Math.min(t * 0.5, chord * 0.3), 6); // [s=chord(z), y=thick(et)]
    loops.push(rr.map(([s, yy]) => [
      er[0] * r + et[0] * yy,
      er[1] * r + et[1] * yy,
      zc + s,
    ]));
  }
  loft(loops);
}
// forward flaps: up high on the nose (top reaches ~82% of height), swept back —
// same tilt/size, just raised into the circled region.
flap(90, 182, 44, 17, 33, -22, 5.5);
flap(270, 182, 44, 17, 33, -22, 5.5);
// aft flaps: swept deltas at the base of the body
flap(90, 46, 56, 18, 32, -18, 6.0);
flap(270, 46, 56, 18, 32, -18, 6.0);

// =============================================================================
//  LAUNCH LUG / ROD HOLE — matches the booster's lug (bore at x=45.5, y=0)
// =============================================================================
// A SINGLE short launch lug (not a full-length rail) standing off the +X side
// with a through-bore, collinear with the booster's rod hole so the same launch
// rod threads both stages. Tied to the hull by a thin standoff web clear of the
// bore. Bore sized to match the booster (Ø5).
const LUG_X = 45.5, LUG_RO = 4.5, LUG_RI = 2.5; // bore Ø5, outer Ø9 — same as booster
const LUG_LEN = 26;                             // one short lug, not a massive rail
const LUG_Z0 = SHOULDER_Z + 14, LUG_Z1 = SHOULDER_Z + 14 + LUG_LEN; // low on the body

function ringPts(cx, r, z, seg) {
  const a = [];
  for (let i = 0; i < seg; i++) { const t = (2 * Math.PI * i) / seg; a.push([cx + r * Math.cos(t), r * Math.sin(t), z]); }
  return a;
}
// Hollow tube (pipe) along Z with an open through-bore — a watertight solid.
function pipe(cx, rOut, rIn, z0, z1, seg = 40) {
  const oa = ringPts(cx, rOut, z0, seg), ob = ringPts(cx, rOut, z1, seg);
  const ia = ringPts(cx, rIn, z0, seg), ib = ringPts(cx, rIn, z1, seg);
  const t = [];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    t.push([oa[i], oa[j], ob[j]], [oa[i], ob[j], ob[i]]);   // outer wall
    t.push([ia[i], ib[j], ia[j]], [ia[i], ib[i], ib[j]]);   // inner wall
    t.push([oa[i], ia[j], oa[j]], [oa[i], ia[i], ia[j]]);   // bottom annulus
    t.push([ob[i], ob[j], ib[j]], [ob[i], ib[j], ib[i]]);   // top annulus
  }
  addSolid(t);
}
// Axis-aligned box [x0,x1]×[y0,y1]×[z0,z1].
function box3(x0, x1, y0, y1, z0, z1) {
  const lo = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  loft([lo.map(([x, y]) => [x, y, z0]), lo.map(([x, y]) => [x, y, z1])]);
}
pipe(LUG_X, LUG_RO, LUG_RI, LUG_Z0, LUG_Z1);                       // the rod tube
// continuous standoff web tying the tube to the hull, stopping short of the bore
box3(R_BODY - 1, LUG_X - LUG_RI - 0.6, -1.8, 1.8, LUG_Z0, LUG_Z1);

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
console.log(`height ${TOTAL_H} mm · nose ${NOSE_LEN.toFixed(1)} mm (${(NOSE_LEN / TOTAL_H * 100).toFixed(0)}%) tangent dome r${rhoTip.toFixed(1)} · single lug bore Ø${(LUG_RI * 2)} at x=${LUG_X}`);
console.log(`mating ring Ø${(R_SPIGOT * 2).toFixed(1)} (into booster Ø75.0 socket) · shoulder Ø${(R_BODY * 2).toFixed(1)} seats on rim · spigot depth ${SPIGOT_H}`);
