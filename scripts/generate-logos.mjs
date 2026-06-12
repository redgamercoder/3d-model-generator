#!/usr/bin/env node
// Generates models/company-logos.stl — five tech-company logomarks combined on
// one shared base plate, each as a raised, 3D-printable relief:
//
//   Apple · Anthropic · SpaceX · Nvidia · OpenAI
//
// The marks are stylized, single-colour approximations built from extruded
// polygons (apple silhouette, letter forms, a blossom) — enough to read at a
// glance and to print cleanly with no supports.
//
// Units are millimeters, Z is up, the model rests on Z = 0.
//
//   node scripts/generate-logos.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const triangles = [];

// --- 2D polygon → extruded prism --------------------------------------------

const TAU = Math.PI * 2;

// Signed area of a 2D ring (CCW positive).
function signedArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

const cross3 = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function pointInTri(p, a, b, c) {
  const d1 = cross3(p, a, b);
  const d2 = cross3(p, b, c);
  const d3 = cross3(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Ear-clipping triangulation of a simple polygon (handles concave shapes like
// the apple's bite). Returns an array of index triples.
function earClip(pts) {
  const n = pts.length;
  let idx = [...Array(n).keys()];
  if (signedArea(pts) < 0) idx.reverse(); // ensure CCW
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 20000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (cross3(a, b, c) <= 0) continue; // reflex / collinear — not an ear
      let contains = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(pts[j], a, b, c)) { contains = true; break; }
      }
      if (contains) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate ring — stop gracefully
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// Apply scale → rotate(deg) → translate to a list of 2D points.
function place(pts, { s = 1, rot = 0, dx = 0, dy = 0 } = {}) {
  const r = (rot * Math.PI) / 180, c = Math.cos(r), si = Math.sin(r);
  return pts.map(([x, y]) => {
    const X = x * s, Y = y * s;
    return [X * c - Y * si + dx, X * si + Y * c + dy];
  });
}

// Extrude a 2D ring between z0 and z1 and append it as a closed solid.
function extrude(ring, z0, z1) {
  let pts = ring;
  if (signedArea(pts) < 0) pts = pts.slice().reverse(); // CCW for outward walls
  const n = pts.length;
  const tris = earClip(pts);

  for (const [a, b, c] of tris) {
    // top (+z)
    triangles.push([
      [pts[a][0], pts[a][1], z1],
      [pts[b][0], pts[b][1], z1],
      [pts[c][0], pts[c][1], z1],
    ]);
    // bottom (−z), reversed winding
    triangles.push([
      [pts[a][0], pts[a][1], z0],
      [pts[c][0], pts[c][1], z0],
      [pts[b][0], pts[b][1], z0],
    ]);
  }
  // side walls
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const a0 = [a[0], a[1], z0], b0 = [b[0], b[1], z0];
    const a1 = [a[0], a[1], z1], b1 = [b[0], b[1], z1];
    triangles.push([a0, b0, b1], [a0, b1, a1]);
  }
}

// Convenience builders --------------------------------------------------------

function circle(cx, cy, r, n = 48) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    p.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return p;
}

function ellipse(cx, cy, rx, ry, n = 48) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    p.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return p;
}

// Axis-aligned rectangle centered at (cx, cy).
function rect(cx, cy, w, h) {
  const hw = w / 2, hh = h / 2;
  return [
    [cx - hw, cy - hh], [cx + hw, cy - hh],
    [cx + hw, cy + hh], [cx - hw, cy + hh],
  ];
}

// --- Geometry parameters -----------------------------------------------------

const BASE_Z = 2;        // plate thickness
const RELIEF_Z = 4;      // how far the marks stand proud of the plate
const Z0 = BASE_Z, Z1 = BASE_Z + RELIEF_Z;
const SPACING = 52;      // distance between logo centers
const SLOTS = [-2, -1, 0, 1, 2].map((k) => k * SPACING);
const PLATE_W = SPACING * 5 + 8;  // 268 → trimmed below
const PLATE_H = 56;

// Shared base plate (rests on Z = 0).
extrude(rect(0, 0, 250, PLATE_H), 0, BASE_Z);

// Emblem helpers: author each mark around its own origin, then drop into a slot.
function emblem(slot, rings) {
  const dx = SLOTS[slot];
  for (const ring of rings) extrude(place(ring, { dx }), Z0, Z1);
}

// 1. Apple — silhouette with a bite, plus leaf and stem ----------------------
function appleRings() {
  const body = circle(0, -1, 16, 64);
  // Carve a circular bite out of the right side.
  const biteC = [17, 2], biteR = 7.5;
  for (const p of body) {
    const dx = p[0] - biteC[0], dy = p[1] - biteC[1];
    const d = Math.hypot(dx, dy);
    if (d < biteR) {
      p[0] = biteC[0] + (dx / d) * biteR;
      p[1] = biteC[1] + (dy / d) * biteR;
    }
  }
  // Top dimple: pinch the crown inward to read as an apple, not a ball.
  for (const p of body) {
    if (p[1] > 12 && Math.abs(p[0]) < 6) p[1] -= 4;
  }
  const leaf = place(ellipse(0, 0, 3.2, 6.5), { rot: 35, dx: 5, dy: 16 });
  const stem = place(rect(0, 0, 1.6, 5), { rot: -12, dx: -1, dy: 16 });
  return [body, leaf, stem];
}

// 2. Anthropic — stylized "A" -------------------------------------------------
function anthropicRings() {
  const legL = place(rect(0, 0, 5, 34), { rot: -15, dx: -7, dy: 0 });
  const legR = place(rect(0, 0, 5, 34), { rot: 15, dx: 7, dy: 0 });
  const bar = rect(0, -3, 16, 5);
  return [legL, legR, bar];
}

// 3. SpaceX — bold "X" --------------------------------------------------------
function spacexRings() {
  const d1 = place(rect(0, 0, 5.5, 38), { rot: 38 });
  const d2 = place(rect(0, 0, 5.5, 38), { rot: -38 });
  return [d1, d2];
}

// 4. Nvidia — bold "N" --------------------------------------------------------
function nvidiaRings() {
  const left = rect(-11, 0, 5.5, 34);
  const right = rect(11, 0, 5.5, 34);
  const diag = place(rect(0, 0, 5.5, 40), { rot: 30 });
  return [left, right, diag];
}

// 5. OpenAI — six-petal blossom ----------------------------------------------
function openaiRings() {
  const rings = [];
  const R = 8;
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * 360;
    const r = (ang * Math.PI) / 180;
    const cx = R * Math.cos(r), cy = R * Math.sin(r);
    rings.push(place(ellipse(0, 0, 3.6, 9, 40), { rot: ang + 90, dx: cx, dy: cy }));
  }
  rings.push(circle(0, 0, 5.5, 40)); // hub
  return rings;
}

emblem(0, appleRings());
emblem(1, anthropicRings());
emblem(2, spacexRings());
emblem(3, nvidiaRings());
emblem(4, openaiRings());

// --- Binary STL writer -------------------------------------------------------

function normal([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const len = Math.hypot(...n) || 1;
  return n.map((x) => x / len);
}

const buffer = Buffer.alloc(84 + triangles.length * 50);
buffer.write('company logos - generated by 3d-model-generator', 0, 'ascii');
buffer.writeUInt32LE(triangles.length, 80);

let offset = 84;
for (const tri of triangles) {
  for (const vec of [normal(tri), ...tri]) {
    buffer.writeFloatLE(vec[0], offset);
    buffer.writeFloatLE(vec[1], offset + 4);
    buffer.writeFloatLE(vec[2], offset + 8);
    offset += 12;
  }
  offset += 2; // attribute byte count
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'models');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'company-logos.stl');
writeFileSync(outPath, buffer);

const xs = triangles.flat().map((p) => p[0]);
const zs = triangles.flat().map((p) => p[2]);
console.log(`Wrote ${outPath}`);
console.log(
  `${triangles.length} triangles, ` +
  `width ${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} mm, ` +
  `height ${Math.min(...zs).toFixed(2)}..${Math.max(...zs).toFixed(2)} mm`,
);
