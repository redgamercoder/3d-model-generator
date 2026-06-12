# 3D Model Generator

A browser-based CAD editor for designing 3D-printable models, plus a
ready-to-print example. Everything works in millimeters with Z up, so exported
STL files drop straight into your slicer (Cura, PrusaSlicer, Bambu Studio,
OrcaSlicer…).

## Quick start

The editor is a static page — no build step. Serve the folder and open it:

```sh
npx serve .          # or: python3 -m http.server
```

Then open the printed URL in your browser. (It needs to be served over HTTP,
not opened as a `file://` URL, because it loads three.js as an ES module.)

## AI generation

Type what you want into the **AI bar** ("a hexagonal pen cup", "a wall hook for
headphones", "a stand for a Nintendo Switch") and click **Generate** — the AI
designs the model and builds it on the print bed, ready to tweak and export
as STL.

- Uses the Gemini API (`gemini-2.5-flash`) with structured JSON output, so the
  model always comes back as a valid scene.
- You'll be asked for your Gemini API key on first use — get a free one at
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The key
  is stored only in your browser's localStorage and sent only to
  `generativelanguage.googleapis.com` — there is no backend.
- By default each generation replaces the scene; check **Keep existing
  objects** to add to it instead.
- Generated objects are regular editor objects — select, resize, recolor, or
  delete parts, then **Export STL**.

## The editor

- **Add shapes**: box, cylinder, sphere, cone, torus — sized in mm.
- **Presets**: one-click phone stand, pen cup, and wall hook builds.
- **Edit**: click an object to select it, then set position, rotation, size,
  and color in the sidebar. "Drop to Bed" rests the object on the print bed.
- **Export STL**: writes a binary STL of everything on the bed. Overlapping
  solids are fine — modern slicers union them automatically.
- **Save / Load**: projects are plain JSON files.

The outlined box is a 256 × 256 × 256 mm build volume for scale reference. Three.js is vendored locally in `vendor/`, so the editor itself works offline (only AI generation needs the network).

## Example model: phone stand

[`models/phone-stand.stl`](models/phone-stand.stl) is ready to print:

- 90 × 70 mm footprint, ~78 mm tall
- 20° backrest, fits phones with or without a case
- 26 mm gap in the front lip for a charging cable
- Prints flat with no supports; ~15% infill is plenty

Regenerate it (or tweak the dimensions) with:

```sh
node scripts/generate-phone-stand.mjs
```

## Example model: F1 race car

[`models/f1-car.stl`](models/f1-car.stl) is a maximum-detail, display-scale
Formula 1 car (~230 mm long, ≈1:24.5) procedurally built from lofted
cross-sections and airfoils — **74k+ triangles**. It packs in:

- a smooth, spline-lofted monocoque, sidepods, airbox and shark fin
- multi-element front and rear wings with Gurney flaps, cascades, endplate
  louvres and a beam wing
- treaded tyres, drilled brake discs with calipers, and spoked rims
- full aero-bladed suspension wishbones, pushrods and track rods
- cockpit detail: halo, steering wheel, helmet with visor, and mirrors
- diffuser strakes, floor fences, exhaust, rain light and rear crash structure

Regenerate it with:

```sh
node scripts/generate-f1-car.mjs
```
