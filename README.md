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

## The editor

- **Add shapes**: box, cylinder, sphere, cone, torus — sized in mm.
- **Presets**: one-click phone stand, pen cup, and wall hook builds.
- **Edit**: click an object to select it, then set position, rotation, size,
  and color in the sidebar. "Drop to Bed" rests the object on the print bed.
- **Export STL**: writes a binary STL of everything on the bed. Overlapping
  solids are fine — modern slicers union them automatically.
- **Save / Load**: projects are plain JSON files.

The grid is a 220 × 220 mm print bed for scale reference.

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
