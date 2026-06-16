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
const WALL = 2.2;       // cover wall thickness
const CAP = 5;          // solid tip the cover adds above the core's point

const N_THETA = 180;    // segments around
const N_Z = 200;        // layers up the height

const HV = CONE_H + CAP; // total cover height (to its tip)

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

// --- Cover: hollow spiral cone, pointed top, open bottom ---------------------

function buildCover() {
  const { tris, tri, quad } = makeMesh();
  const tip = [0, 0, HV];          // outer tip
  const apex = [0, 0, CONE_H];     // cavity ceiling (top of the hollow)

  // Outer radius: follows the mating cone + wall up to the core's tip, then a
  // short solid taper to the point.
  function rOut(z, th) {
    if (z <= CONE_H) return rMesh(z / CONE_H, th) + CLEAR / 2 + WALL;
    const frac = (z - CONE_H) / CAP;
    return (CLEAR / 2 + WALL) * (1 - frac);
  }
  const rIn = (t, th) => rMesh(t, th) + CLEAR / 2;

  const outPt = (iz, jt) => {
    const z = (iz / N_Z) * HV;
    const th = theta(jt);
    const r = Math.max(rOut(z, th), 0);
    return [r * Math.cos(th), r * Math.sin(th), z];
  };
  const inPt = (iz, jt) => {
    const t = iz / N_Z;
    const th = theta(jt);
    const r = rIn(t, th);
    return [r * Math.cos(th), r * Math.sin(th), t * CONE_H];
  };

  // Outer surface (normals out).
  for (let iz = 0; iz < N_Z; iz++) {
    for (let jt = 0; jt < N_THETA; jt++) {
      const jn = (jt + 1) % N_THETA;
      if (iz === N_Z - 1) tri(outPt(iz, jt), outPt(iz, jn), tip);
      else quad(outPt(iz, jt), outPt(iz, jn), outPt(iz + 1, jn), outPt(iz + 1, jt));
    }
  }
  // Inner cavity surface (reversed winding so normals point inward).
  for (let iz = 0; iz < N_Z; iz++) {
    for (let jt = 0; jt < N_THETA; jt++) {
      const jn = (jt + 1) % N_THETA;
      if (iz === N_Z - 1) tri(inPt(iz, jn), inPt(iz, jt), apex);
      else quad(inPt(iz, jt), inPt(iz + 1, jt), inPt(iz + 1, jn), inPt(iz, jn));
    }
  }
  // Bottom annulus joining the inner and outer base rings (normal down).
  for (let jt = 0; jt < N_THETA; jt++) {
    const jn = (jt + 1) % N_THETA;
    quad(outPt(0, jt), inPt(0, jt), inPt(0, jn), outPt(0, jn));
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

writeStl('spiral-cone-core.stl', 'spiral cone fidget (core) - 3d-model-generator', buildCore());
writeStl('spiral-cone-cover.stl', 'spiral cone fidget (cover) - 3d-model-generator', buildCover());
