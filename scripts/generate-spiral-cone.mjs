#!/usr/bin/env node
// Generates the two-part "spiral cone" fidget:
//   models/spiral-cone-core.stl   — the positive inner cone (solid)
//   models/spiral-cone-cover.stl  — the cover that slides/spins over the core
//                                   (hollow spiral cone, pointed top, open base)
//
// Both parts share the same helical flute so the cover screws/spins down the
// core's threads, with a small radial clearance for a smooth FDM fit. Units are
// millimeters, Z is up, each part rests on Z = 0 and prints upright (base down,
// point up) with no supports.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Parameters (mm / counts) -----------------------------------------------

const RB = 15.5;        // interface (mating) radius at the base, before fluting
const AMP = 2.8;        // depth of the helical flutes
const FLUTES = 8;       // number of spiral arms
const TWIST_TURNS = 1.25; // full revolutions the flutes make over the height
const CONE_H = 78;      // core height = depth of the cover's cavity

const CLEAR = 0.40;     // radial clearance between core and cover (≈0.8 mm dia.)
const WALL = 2.6;       // rib / wall thickness (radial)

// Cover is an open spiral cage: a solid base band with separate spiral ribs
// rising from it and free tips at the top (the core spins inside it).
const BAND_H = 13;      // height of the solid connecting band at the base
const RIB_HALF = 12 * Math.PI / 180; // angular half-width of each rib
const RIB_TOP_T = 0.93; // ribs stop short of the point, leaving free tips
const NA = 8;           // angular segments across a rib
const NZ_RIB = 180;     // layers up a rib
const NZ_BAND = 48;     // layers up the base band

const N_THETA = 180;    // segments around
const N_Z = 200;        // layers up the height

// The shared mating helicoid: a tapered cone with helical flutes that fade to a
// point at the top. The core sits CLEAR/2 inside this; the cover CLEAR/2 outside.
function rMesh(t, theta) {
  const phase = theta + TWIST_TURNS * 2 * Math.PI * t;
  return RB * (1 - t) + AMP * (1 - t) * Math.cos(FLUTES * phase);
}

const theta = (jt) => (jt / N_THETA) * 2 * Math.PI;

// --- Mesh helpers ------------------------------------------------------------

function makeMesh() {
  const tris = [];
  const tri = (a, b, c) => tris.push([a, b, c]);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); }; // CCW from outside
  return { tris, tri, quad };
}

// --- Core: solid fluted cone -------------------------------------------------

function buildCore() {
  const { tris, tri, quad } = makeMesh();
  const EPS = 0.35; // keep all ring vertices off the axis; close with one tip
  const coreR = (t, th) => rMesh(t, th) - CLEAR / 2;
  const pt = (iz, jt) => {
    const t = iz / N_Z;
    const th = theta(jt);
    const r = coreR(t, th);
    return [r * Math.cos(th), r * Math.sin(th), t * CONE_H];
  };

  // Highest ring whose narrowest point is still clear of the axis.
  let lastFull = 0;
  for (let iz = 0; iz <= N_Z; iz++) {
    let mn = Infinity;
    for (let jt = 0; jt < N_THETA; jt++) mn = Math.min(mn, coreR(iz / N_Z, theta(jt)));
    if (mn > EPS) lastFull = iz; else break;
  }
  const tip = [0, 0, CONE_H - 1]; // a hair below the cover's cavity ceiling

  for (let iz = 0; iz < lastFull; iz++) {
    for (let jt = 0; jt < N_THETA; jt++) {
      const jn = (jt + 1) % N_THETA;
      quad(pt(iz, jt), pt(iz, jn), pt(iz + 1, jn), pt(iz + 1, jt));
    }
  }
  // Close the top from the last full ring to a single tip.
  for (let jt = 0; jt < N_THETA; jt++) {
    const jn = (jt + 1) % N_THETA;
    tri(pt(lastFull, jt), pt(lastFull, jn), tip);
  }
  // Flat fluted bottom cap (normal points down).
  const center = [0, 0, 0];
  for (let jt = 0; jt < N_THETA; jt++) {
    const jn = (jt + 1) % N_THETA;
    tri(center, pt(0, jn), pt(0, jt));
  }
  return tris;
}

// --- Cover: open spiral cage (base band + free spiral ribs) ------------------

const rIn = (t, th) => rMesh(t, th) + CLEAR / 2;        // clears the core
const rOut = (t, th) => rMesh(t, th) + CLEAR / 2 + WALL; // cage outer surface

function buildCover() {
  const { tris, tri, quad } = makeMesh();

  // --- Base band: a short, closed fluted ring connecting all the ribs --------
  const inPt = (iz, jt) => {
    const t = (iz / NZ_BAND) * (BAND_H / CONE_H);
    const th = theta(jt);
    const r = rIn(t, th);
    return [r * Math.cos(th), r * Math.sin(th), t * CONE_H];
  };
  const outPt = (iz, jt) => {
    const t = (iz / NZ_BAND) * (BAND_H / CONE_H);
    const th = theta(jt);
    const r = rOut(t, th);
    return [r * Math.cos(th), r * Math.sin(th), t * CONE_H];
  };
  for (let iz = 0; iz < NZ_BAND; iz++) {
    for (let jt = 0; jt < N_THETA; jt++) {
      const jn = (jt + 1) % N_THETA;
      quad(outPt(iz, jt), outPt(iz, jn), outPt(iz + 1, jn), outPt(iz + 1, jt)); // outer
      quad(inPt(iz, jt), inPt(iz + 1, jt), inPt(iz + 1, jn), inPt(iz, jn));     // inner
    }
  }
  for (let jt = 0; jt < N_THETA; jt++) {
    const jn = (jt + 1) % N_THETA;
    quad(outPt(0, jt), inPt(0, jt), inPt(0, jn), outPt(0, jn));                 // bottom
    quad(inPt(NZ_BAND, jt), outPt(NZ_BAND, jt), outPt(NZ_BAND, jn), inPt(NZ_BAND, jn)); // top
  }

  // --- Spiral ribs: one swept beam per flute, dipping into the band ----------
  const M = 2 * (NA + 1); // perimeter samples per cross-section
  const tBottom = (BAND_H - 3) / CONE_H; // overlap 3 mm into the band to fuse
  const ribLoop = (k, iz) => {
    const t = tBottom + (RIB_TOP_T - tBottom) * (iz / NZ_RIB);
    const thetaC = (2 * Math.PI * k) / FLUTES - TWIST_TURNS * 2 * Math.PI * t;
    const z = t * CONE_H;
    const pts = [];
    for (let a = 0; a <= NA; a++) {              // outer arc, -Δ → +Δ
      const th = thetaC - RIB_HALF + (2 * RIB_HALF * a) / NA;
      const r = rOut(t, th);
      pts.push([r * Math.cos(th), r * Math.sin(th), z]);
    }
    for (let a = 0; a <= NA; a++) {              // inner arc, +Δ → -Δ
      const th = thetaC + RIB_HALF - (2 * RIB_HALF * a) / NA;
      const r = rIn(t, th);
      pts.push([r * Math.cos(th), r * Math.sin(th), z]);
    }
    return pts;
  };
  const centroid = (loop) => {
    const c = [0, 0, 0];
    for (const p of loop) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    return c.map((x) => x / loop.length);
  };
  for (let k = 0; k < FLUTES; k++) {
    let prev = ribLoop(k, 0);
    const bc = centroid(prev);
    for (let s = 0; s < M; s++) tri(bc, prev[(s + 1) % M], prev[s]); // bottom cap
    for (let iz = 1; iz <= NZ_RIB; iz++) {
      const cur = ribLoop(k, iz);
      for (let s = 0; s < M; s++) {
        const sn = (s + 1) % M;
        quad(prev[s], prev[sn], cur[sn], cur[s]);
      }
      prev = cur;
    }
    const tc = centroid(prev);
    for (let s = 0; s < M; s++) tri(tc, prev[s], prev[(s + 1) % M]); // top cap
  }
  return tris;
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

function writeStl(filename, header, triangles) {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.write(header, 0, 'ascii');
  buffer.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const t of triangles) {
    for (const vec of [normal(t), ...t]) {
      buffer.writeFloatLE(vec[0], offset);
      buffer.writeFloatLE(vec[1], offset + 4);
      buffer.writeFloatLE(vec[2], offset + 8);
      offset += 12;
    }
    offset += 2; // attribute byte count
  }
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'models');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, filename);
  writeFileSync(outPath, buffer);

  let zMin = Infinity, zMax = -Infinity, rMax = 0;
  for (const t of triangles) for (const p of t) {
    if (p[2] < zMin) zMin = p[2];
    if (p[2] > zMax) zMax = p[2];
    rMax = Math.max(rMax, Math.hypot(p[0], p[1]));
  }
  console.log(`Wrote ${outPath}`);
  console.log(`  ${triangles.length} triangles, ` +
    `Ø${(rMax * 2).toFixed(1)} mm, height ${zMin.toFixed(1)}..${zMax.toFixed(1)} mm`);
}

const coreTris = buildCore();
const coverTris = buildCover();

// Offset the cover to sit beside the core (gap of 5 mm between them).
const SPACING = RB * 2 + WALL * 2 + CLEAR + 5;
const coverOffset = coverTris.map(([a, b, c]) =>
  [a, b, c].map(([x, y, z]) => [x + SPACING, y, z])
);

writeStl('spiral-cone-core.stl', 'spiral cone fidget (core) - 3d-model-generator', coreTris);
writeStl('spiral-cone-cover.stl', 'spiral cone fidget (cover) - 3d-model-generator', coverTris);
writeStl('spiral-cone.stl', 'spiral cone fidget (both parts) - 3d-model-generator', [...coreTris, ...coverOffset]);
