#!/usr/bin/env node
// Builds dist/3d-model-generator.html — the entire app (CSS + three.js +
// editor code) bundled into one self-contained file that runs when opened
// directly in a browser, no server required. Needs dev deps: esbuild, three.
//
//   node scripts/build-single-file.mjs

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Bundle app.js (resolving the three.js imports) into a classic script.
// The Anthropic SDK is loaded at runtime via dynamic import — keep it external.
execSync(
  'npx esbuild app.js --bundle --minify --format=iife ' +
    '--alias:three=./vendor/three.module.js ' +
    '--alias:three/addons/controls/OrbitControls.js=./vendor/addons/controls/OrbitControls.js ' +
    '--external:https://* --outfile=/tmp/app.bundle.js',
  { cwd: root, stdio: 'inherit' }
);

const css = readFileSync(join(root, 'style.css'), 'utf8');
const js = readFileSync('/tmp/app.bundle.js', 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');

// Strip the importmap (everything is bundled) and the external references.
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(/<link rel="stylesheet" href="style.css" \/>/, `<style>\n${css}</style>`);
html = html.replace(
  /<script type="module" src="app.js"><\/script>/,
  () => `<script type="module">\n${js}</script>`
);
// The file:// warning doesn't apply to the bundled build — it has no modules to block.
html = html.replace(/if \(location\.protocol === 'file:'\) \{[\s\S]*?\n    \}\n/, '');

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', '3d-model-generator.html');
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
