#!/usr/bin/env node
// Generates models/company-logos.stl — five tech-company logos combined into
// ONE mark: a big Apple silhouette (bite + leaf) forms the base plate, and the
// other four marks sit on top of it as raised, 3D-printable reliefs:
//
//   Anthropic "A" (upper left) · SpaceX swoosh + X (across / right)
//   Nvidia swirl-eye (lower left) · OpenAI blossom (bottom center)
//
// The marks are stylized, single-colour approximations — enough to read at a
// glance and to print flat with no supports.
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
const deg = (d) => (d * Math.PI) / 180;

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
// the apple's bite and the swirl). Returns an array of index triples.
function earClip(pts) {
  const n = pts.length;
  let idx = [...Array(n).keys()];
  if (signedArea(pts) < 0) idx.reverse(); // ensure CCW
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
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
  const r = deg(rot), c = Math.cos(r), si = Math.sin(r);
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
    triangles.push([
      [pts[a][0], pts[a][1], z1],
      [pts[b][0], pts[b][1], z1],
      [pts[c][0], pts[c][1], z1],
    ]);
    triangles.push([
      [pts[a][0], pts[a][1], z0],
      [pts[c][0], pts[c][1], z0],
      [pts[b][0], pts[b][1], z0],
    ]);
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    triangles.push(
      [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]],
      [[a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]],
    );
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

function rect(cx, cy, w, h) {
  const hw = w / 2, hh = h / 2;
  return [
    [cx - hw, cy - hh], [cx + hw, cy - hh],
    [cx + hw, cy + hh], [cx - hw, cy + hh],
  ];
}

// Tapered band along a quadratic bezier: width w0 at the start easing to w1 at
// the tip. Used for the SpaceX swoosh.
function sweep(p0, p1, p2, w0, w1, n = 40) {
  const pts = [], left = [], right = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
    const tx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const ty = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const l = Math.hypot(tx, ty) || 1;
    const w = (w0 + (w1 - w0) * t) / 2;
    left.push([x - (ty / l) * w, y + (tx / l) * w]);
    right.push([x + (ty / l) * w, y - (tx / l) * w]);
  }
  return pts.concat(left, right.reverse());
}

// Spiral band (one polygon, no hole): outer edge out, inner edge back.
// Reads as the Nvidia swirl-eye.
function spiral(cx, cy, rIn, rOut, turns, w, n = 80) {
  const outer = [], inner = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = deg(120) + t * turns * TAU;
    const r = rIn + (rOut - rIn) * t;
    outer.push([cx + (r + w / 2) * Math.cos(ang), cy + (r + w / 2) * Math.sin(ang)]);
    inner.push([cx + (r - w / 2) * Math.cos(ang), cy + (r - w / 2) * Math.sin(ang)]);
  }
  return outer.concat(inner.reverse());
}

// --- The apple base plate ----------------------------------------------------

const PLATE_Z = 4;       // apple plate thickness
const RELIEF_Z = 3;      // how far the inner marks stand proud of the plate
const Z1 = PLATE_Z, Z2 = PLATE_Z + RELIEF_Z;

// Apple body: a tall circle with a deep dimple at the crown, a slight dimple
// at the bottom, and a circular bite carved out of the right side.
function appleBody() {
  const R = 50, n = 200;
  const body = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    let r = R;
    // crown dimple (around 90°) and base dimple (around 270°)
    const dTop = Math.exp(-(((th - deg(90)) / deg(16)) ** 2));
    const dBot = Math.exp(-(((th - deg(270)) / deg(13)) ** 2));
    r -= 13 * dTop + 6 * dBot;
    body.push([r * Math.cos(th), r * Math.sin(th) * 1.04]);
  }
  // Bite: project points that fall inside the bite circle onto its boundary.
  const biteC = [54, 12], biteR = 24;
  for (const p of body) {
    const dx = p[0] - biteC[0], dy = p[1] - biteC[1];
    const d = Math.hypot(dx, dy);
    if (d < biteR) {
      p[0] = biteC[0] + (dx / d) * biteR;
      p[1] = biteC[1] + (dy / d) * biteR;
    }
  }
  return body;
}

extrude(appleBody(), 0, Z1);
// Leaf, floating above the crown gap like the real mark.
extrude(place(ellipse(0, 0, 9, 18, 56), { rot: -38, dx: 14, dy: 64 }), 0, Z1);

// --- The four marks raised on the apple --------------------------------------

// Anthropic "A" — upper left.
{
  const at = { dx: -19, dy: 18 };
  extrude(place(rect(0, 0, 4.5, 26), { rot: -16, dx: -6 + at.dx, dy: at.dy }), Z1, Z2);
  extrude(place(rect(0, 0, 4.5, 26), { rot: 16, dx: 6 + at.dx, dy: at.dy }), Z1, Z2);
  extrude(place(rect(0, -2.5, 13, 4.5), at), Z1, Z2);
}

// SpaceX — swoosh sweeping across the apple, tapering to a point upper right.
extrude(sweep([-32, -10], [4, 0], [35, 27], 5.5, 1.0), Z1, Z2);
// …and the "X", mid right.
{
  const at = { dx: 18, dy: -4 };
  extrude(place(rect(0, 0, 4.5, 21), { rot: 35, ...at }), Z1, Z2);
  extrude(place(rect(0, 0, 4.5, 21), { rot: -35, ...at }), Z1, Z2);
}

// Nvidia swirl-eye — lower left.
extrude(spiral(-25, -24, 2.5, 10.5, 1.4, 4), Z1, Z2);

// OpenAI blossom — bottom center-right.
{
  const cx = 10, cy = -29, R = 6.5;
  for (let i = 0; i < 6; i++) {
    const ang = i * 60;
    const r = deg(ang);
    extrude(
      place(ellipse(0, 0, 2.9, 7.5, 36), {
        rot: ang + 90,
        dx: cx + R * Math.cos(r),
        dy: cy + R * Math.sin(r),
      }),
      Z1, Z2,
    );
  }
  extrude(circle(cx, cy, 4.4, 36), Z1, Z2);
}

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
const ys = triangles.flat().map((p) => p[1]);
const zs = triangles.flat().map((p) => p[2]);
console.log(`Wrote ${outPath}`);
console.log(
  `${triangles.length} triangles, ` +
  `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ` +
  `${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} mm footprint, ` +
  `height ${Math.min(...zs).toFixed(2)}..${Math.max(...zs).toFixed(2)} mm`,
);
