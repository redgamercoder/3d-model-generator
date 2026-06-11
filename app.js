import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// The whole app works in millimeters with Z up, matching 3D-printing
// conventions, so exported STL needs no axis conversion.
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

const BED_SIZE = 256;   // X/Y, mm
const BED_HEIGHT = 256; // Z, mm

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

const viewport = document.getElementById('viewport');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
camera.position.set(180, -220, 160);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 30);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(150, -200, 300);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(-200, 150, 100);
scene.add(fillLight);

// Print bed: GridHelper lives in the XZ plane, rotate it into XY.
const grid = new THREE.GridHelper(BED_SIZE, 16, 0x4f9cff, 0x2c323e);
grid.rotation.x = Math.PI / 2;
scene.add(grid);

// Build volume outline (BED_SIZE × BED_SIZE × BED_HEIGHT).
const buildVolume = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(BED_SIZE, BED_SIZE, BED_HEIGHT)),
  new THREE.LineBasicMaterial({ color: 0x4f9cff, transparent: true, opacity: 0.5 })
);
buildVolume.position.z = BED_HEIGHT / 2;
scene.add(buildVolume);

const modelGroup = new THREE.Group();
scene.add(modelGroup);

function resize() {
  const { clientWidth: w, clientHeight: h } = viewport;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// Object creation
// ---------------------------------------------------------------------------

// Unit geometries are normalized to a 1 mm bounding box (torus: 1 x 1 x 0.25)
// so mesh.scale is the object's size in millimeters.
const UNIT_GEOMETRY = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 48).rotateX(Math.PI / 2),
  sphere: () => new THREE.SphereGeometry(0.5, 32, 24),
  cone: () => new THREE.ConeGeometry(0.5, 1, 48).rotateX(Math.PI / 2),
  torus: () => new THREE.TorusGeometry(0.375, 0.125, 16, 48),
};

const DEFAULT_SIZE = {
  box: [40, 40, 40],
  cylinder: [40, 40, 50],
  sphere: [40, 40, 40],
  cone: [40, 40, 50],
  torus: [50, 50, 12.5],
};

const PALETTE = ['#4f9cff', '#ff8c42', '#42d68c', '#e055a0', '#ffd24f', '#9b6bff'];
let objectCounter = 0;
let selected = null;

function addObject(type, opts = {}) {
  objectCounter += 1;
  const color = opts.color ?? PALETTE[(objectCounter - 1) % PALETTE.length];
  const mesh = new THREE.Mesh(
    UNIT_GEOMETRY[type](),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 })
  );
  mesh.userData.type = type;
  mesh.name = opts.name ?? `${type[0].toUpperCase() + type.slice(1)} ${objectCounter}`;

  const size = opts.size ?? DEFAULT_SIZE[type];
  mesh.scale.set(...size);
  mesh.userData.baseSize = [...size];
  if (opts.rot) mesh.rotation.set(...opts.rot.map(THREE.MathUtils.degToRad));
  if (opts.pos) {
    mesh.position.set(...opts.pos);
  } else {
    mesh.position.set(0, 0, 0);
    dropToBed(mesh);
  }

  modelGroup.add(mesh);
  select(mesh);
  return mesh;
}

function dropToBed(mesh) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  mesh.position.z -= box.min.z;
}

// ---------------------------------------------------------------------------
// Selection + UI
// ---------------------------------------------------------------------------

const objectList = document.getElementById('object-list');
const propsPanel = document.getElementById('properties');

function select(mesh) {
  if (selected) selected.material.emissive.setHex(0x000000);
  selected = mesh;
  if (selected) selected.material.emissive.setHex(0x224466);
  refreshObjectList();
  refreshProps();
  updateQuickbar();
}

function refreshObjectList() {
  objectList.innerHTML = '';
  if (modelGroup.children.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing yet — add a shape or load a preset.';
    objectList.appendChild(li);
    return;
  }
  for (const mesh of modelGroup.children) {
    const li = document.createElement('li');
    if (mesh === selected) li.classList.add('selected');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = `#${mesh.material.color.getHexString()}`;
    li.appendChild(swatch);
    li.appendChild(document.createTextNode(mesh.name));
    li.addEventListener('click', () => select(mesh));
    objectList.appendChild(li);
  }
}

const propInputs = {
  name: document.getElementById('prop-name'),
  color: document.getElementById('prop-color'),
  pos: ['pos-x', 'pos-y', 'pos-z'].map((id) => document.getElementById(id)),
  rot: ['rot-x', 'rot-y', 'rot-z'].map((id) => document.getElementById(id)),
  size: ['size-x', 'size-y', 'size-z'].map((id) => document.getElementById(id)),
};

function refreshProps() {
  if (!selected) {
    propsPanel.classList.add('hidden');
    return;
  }
  propsPanel.classList.remove('hidden');
  propInputs.name.value = selected.name;
  propInputs.color.value = `#${selected.material.color.getHexString()}`;
  ['x', 'y', 'z'].forEach((axis, i) => {
    propInputs.pos[i].value = round(selected.position[axis]);
    propInputs.rot[i].value = round(THREE.MathUtils.radToDeg(selected.rotation[axis]));
    propInputs.size[i].value = round(selected.scale[axis]);
  });
}

function round(v) {
  return Math.round(v * 100) / 100;
}

function applyProps() {
  if (!selected) return;
  selected.name = propInputs.name.value || selected.name;
  selected.material.color.set(propInputs.color.value);
  ['x', 'y', 'z'].forEach((axis, i) => {
    selected.position[axis] = parseFloat(propInputs.pos[i].value) || 0;
    selected.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(propInputs.rot[i].value) || 0);
    selected.scale[axis] = Math.max(0.1, parseFloat(propInputs.size[i].value) || 0.1);
  });
  refreshObjectList();
  updateQuickbar();
}

for (const input of [propInputs.name, propInputs.color, ...propInputs.pos, ...propInputs.rot, ...propInputs.size]) {
  input.addEventListener('input', applyProps);
}

function deleteSelected() {
  if (!selected) return;
  const mesh = selected;
  select(null);
  modelGroup.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  refreshObjectList();
}

function duplicateSelected() {
  if (!selected) return;
  const src = selected;
  objectCounter += 1;
  const copy = src.clone();
  copy.material = src.material.clone();
  copy.material.emissive.setHex(0x000000);
  copy.name = `${src.name} copy`;
  copy.position.x += 15;
  modelGroup.add(copy);
  select(copy);
}

function dropSelected() {
  if (!selected) return;
  dropToBed(selected);
  refreshProps();
}

document.getElementById('delete-btn').addEventListener('click', deleteSelected);
document.getElementById('duplicate-btn').addEventListener('click', duplicateSelected);
document.getElementById('drop-btn').addEventListener('click', dropSelected);

// ---------------------------------------------------------------------------
// Quick actions bar (shown when an object is selected)
// ---------------------------------------------------------------------------

const quickbar = document.getElementById('quickbar');
const qbScaleLabel = document.getElementById('qb-scale-label');

function updateQuickbar() {
  quickbar.classList.toggle('hidden', !selected);
  if (selected && selected.userData.baseSize) {
    const pct = (selected.scale.x / selected.userData.baseSize[0]) * 100;
    qbScaleLabel.textContent = `${Math.round(pct)}%`;
  }
}

// Run a transform on the selected object while keeping its lowest point at
// the same height, so parts stay resting on the bed (or on each other).
function withBottomAnchored(fn) {
  if (!selected) return;
  selected.updateMatrixWorld(true);
  const before = new THREE.Box3().setFromObject(selected).min.z;
  fn(selected);
  selected.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(selected).min.z;
  selected.position.z += before - after;
  refreshProps();
  updateQuickbar();
}

const scaleSelected = (factor) => withBottomAnchored((m) => m.scale.multiplyScalar(factor));
const rotateSelected = (deg) => withBottomAnchored((m) => (m.rotation.z += THREE.MathUtils.degToRad(deg)));

document.getElementById('qb-scale-up').addEventListener('click', () => scaleSelected(1.1));
document.getElementById('qb-scale-down').addEventListener('click', () => scaleSelected(1 / 1.1));
document.getElementById('qb-rot-ccw').addEventListener('click', () => rotateSelected(45));
document.getElementById('qb-rot-cw').addEventListener('click', () => rotateSelected(-45));
document.getElementById('qb-drop').addEventListener('click', dropSelected);
document.getElementById('qb-dup').addEventListener('click', duplicateSelected);
document.getElementById('qb-del').addEventListener('click', deleteSelected);

// ---------------------------------------------------------------------------
// Tap to select, drag to move (orbit only when dragging empty space)
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPoint = new THREE.Vector3();
let downPos = null;
let drag = null; // { mesh, plane, offset }

function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  downPos = [e.clientX, e.clientY];
  setPointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(modelGroup.children, false);
  if (!hits.length) return;
  select(hits[0].object);
  // Drag the object in the horizontal plane through the grab point.
  drag = {
    mesh: hits[0].object,
    plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -hits[0].point.z),
    offset: hits[0].object.position.clone().sub(hits[0].point),
  };
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!drag) return;
  setPointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(drag.plane, dragPoint)) return;
  const half = BED_SIZE / 2;
  drag.mesh.position.x = THREE.MathUtils.clamp(dragPoint.x + drag.offset.x, -half, half);
  drag.mesh.position.y = THREE.MathUtils.clamp(dragPoint.y + drag.offset.y, -half, half);
  refreshProps();
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (drag) {
    drag = null;
    controls.enabled = true;
  } else if (downPos && Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) <= 5) {
    select(null); // tapped empty space
  }
  downPos = null;
});

// ---------------------------------------------------------------------------
// Toolbar: shapes + presets
// ---------------------------------------------------------------------------

for (const btn of document.querySelectorAll('[data-add]')) {
  btn.addEventListener('click', () => addObject(btn.dataset.add));
}

const PRESETS = {
  // Angled phone/tablet stand — same dimensions as scripts/generate-phone-stand.mjs.
  phoneStand(color) {
    addObject('box', { name: 'Stand base', size: [90, 70, 6], pos: [0, 0, 3], color });
    addObject('box', { name: 'Backrest', size: [90, 6, 80], pos: [0, 14, 38], rot: [-20, 0, 0], color });
    addObject('box', { name: 'Front lip L', size: [32, 6, 22], pos: [-29, -28, 14], color });
    addObject('box', { name: 'Front lip R', size: [32, 6, 22], pos: [29, -28, 14], color });
  },
  // Hollow square pen cup built from a floor and four walls.
  penCup(color) {
    addObject('box', { name: 'Cup floor', size: [54, 54, 3], pos: [0, 0, 1.5], color });
    addObject('box', { name: 'Wall front', size: [54, 3, 80], pos: [0, -25.5, 40], color });
    addObject('box', { name: 'Wall back', size: [54, 3, 80], pos: [0, 25.5, 40], color });
    addObject('box', { name: 'Wall left', size: [3, 48, 80], pos: [-25.5, 0, 40], color });
    addObject('box', { name: 'Wall right', size: [3, 48, 80], pos: [25.5, 0, 40], color });
  },
  // J-shaped wall hook: backplate, arm, upturned lip.
  hook(color) {
    addObject('box', { name: 'Backplate', size: [30, 6, 60], pos: [0, 0, 30], color });
    addObject('box', { name: 'Arm', size: [30, 40, 8], pos: [0, -20, 10], color });
    addObject('box', { name: 'Lip', size: [30, 6, 24], pos: [0, -37, 18], color });
  },
};

for (const btn of document.querySelectorAll('[data-preset]')) {
  btn.addEventListener('click', () => {
    const color = PALETTE[objectCounter % PALETTE.length];
    PRESETS[btn.dataset.preset](color);
  });
}

// ---------------------------------------------------------------------------
// Binary STL export
// ---------------------------------------------------------------------------

function exportSTL() {
  const triangles = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  modelGroup.updateMatrixWorld(true);
  for (const mesh of modelGroup.children) {
    const geom = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      for (let j = 0; j < 3; j++) {
        v[j].fromBufferAttribute(pos, i + j).applyMatrix4(mesh.matrixWorld);
      }
      const normal = new THREE.Vector3()
        .subVectors(v[1], v[0])
        .cross(new THREE.Vector3().subVectors(v[2], v[0]))
        .normalize();
      triangles.push([normal.clone(), v[0].clone(), v[1].clone(), v[2].clone()]);
    }
    if (geom !== mesh.geometry) geom.dispose();
  }

  if (triangles.length === 0) {
    alert('Nothing to export — add some shapes first.');
    return;
  }

  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const tri of triangles) {
    for (const vec of tri) {
      view.setFloat32(offset, vec.x, true);
      view.setFloat32(offset + 4, vec.y, true);
      view.setFloat32(offset + 8, vec.z, true);
      offset += 12;
    }
    offset += 2; // attribute byte count
  }

  downloadBlob(new Blob([buffer], { type: 'model/stl' }), 'model.stl');
}

document.getElementById('export-stl').addEventListener('click', exportSTL);

// ---------------------------------------------------------------------------
// Save / load project (JSON)
// ---------------------------------------------------------------------------

document.getElementById('save-project').addEventListener('click', () => {
  const data = modelGroup.children.map((m) => ({
    type: m.userData.type,
    name: m.name,
    color: `#${m.material.color.getHexString()}`,
    pos: m.position.toArray(),
    rot: ['x', 'y', 'z'].map((a) => THREE.MathUtils.radToDeg(m.rotation[a])),
    size: m.scale.toArray(),
  }));
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'project.json');
});

const fileInput = document.getElementById('file-input');
document.getElementById('load-project').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = '';
  try {
    const data = JSON.parse(await file.text());
    select(null);
    for (const m of [...modelGroup.children]) {
      modelGroup.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    for (const o of data) addObject(o.type, o);
    select(null);
  } catch (err) {
    alert(`Could not load project: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// AI generation (Gemini API)
// ---------------------------------------------------------------------------

// gemini-2.5-flash has a generous free tier; gemini-2.5-pro is barely (or not)
// available on free API keys and immediately returns 429 there.
const GEMINI_MODEL = 'gemini-2.5-flash';

const AI_SYSTEM_PROMPT = `You design 3D-printable models in a simple CAD editor by composing primitive solids.

Coordinate system: millimeters, Z is up, the print bed is ${BED_SIZE} × ${BED_SIZE} mm centered on the origin at z = 0, with ${BED_HEIGHT} mm of build height. The model must rest on the bed: its lowest point must be at z = 0, never below, and it must fit inside the build volume.

Available primitive types — "size" is the shape's bounding box in mm:
- box: rectangular cuboid
- cylinder: axis along Z; size x/y are the diameters, size z is the height
- sphere: ellipsoid filling the bounding box
- cone: apex points up (+Z); size x/y are the base diameters, size z is the height
- torus: ring lying flat in the XY plane; size x/y are the outer diameter, size z is the tube height (use about a quarter of the outer diameter for a round tube)

Each object has: type, name (short, human-readable), color (hex), pos (the center of the object, [x, y, z]), rot (rotation in degrees [x, y, z], applied about the object's center), and size ([x, y, z] in mm).

Design rules for printability:
- Overlapping solids are fine — slicers union them. Use overlap to join parts firmly; never leave parts floating or touching only at an edge.
- Prefer flat bases and avoid steep overhangs (> 45° from vertical) so the model prints without supports.
- Build hollow containers from a floor plus walls (around 2–3 mm thick); there are no boolean subtract operations.
- Keep the model within the bed and at a sensible real-world scale for what's asked.
- Remember that for a rotated object, pos is still its center — compute z so the lowest point after rotation sits at exactly 0 (or slightly embedded in another part).

Worked example — an angled phone stand:
{"model_name": "Phone stand", "objects": [
  {"type": "box", "name": "Base", "color": "#4f9cff", "pos": [0, 0, 3], "rot": [0, 0, 0], "size": [90, 70, 6]},
  {"type": "box", "name": "Backrest", "color": "#4f9cff", "pos": [0, 14, 39], "rot": [-20, 0, 0], "size": [90, 6, 80]},
  {"type": "box", "name": "Front lip L", "color": "#4f9cff", "pos": [-29, -28, 14], "rot": [0, 0, 0], "size": [32, 6, 22]},
  {"type": "box", "name": "Front lip R", "color": "#4f9cff", "pos": [29, -28, 14], "rot": [0, 0, 0], "size": [32, 6, 22]}
]}`;

// Gemini structured-output schema (OpenAPI-style subset).
const AI_SCENE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    model_name: { type: 'STRING', description: 'Short name for the model' },
    objects: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['box', 'cylinder', 'sphere', 'cone', 'torus'] },
          name: { type: 'STRING' },
          color: { type: 'STRING', description: 'Hex color like #4f9cff' },
          pos: { type: 'ARRAY', items: { type: 'NUMBER' }, description: 'Center [x, y, z] in mm, exactly 3 numbers' },
          rot: { type: 'ARRAY', items: { type: 'NUMBER' }, description: 'Rotation [x, y, z] in degrees, exactly 3 numbers' },
          size: { type: 'ARRAY', items: { type: 'NUMBER' }, description: 'Bounding box [x, y, z] in mm, exactly 3 numbers' },
        },
        required: ['type', 'name', 'color', 'pos', 'rot', 'size'],
        propertyOrdering: ['type', 'name', 'color', 'pos', 'rot', 'size'],
      },
    },
  },
  required: ['model_name', 'objects'],
};

const aiPrompt = document.getElementById('ai-prompt');
const aiGenerateBtn = document.getElementById('ai-generate');
const aiKeepCheckbox = document.getElementById('ai-keep');
const aiStatus = document.getElementById('ai-status');

function getApiKey({ forcePrompt = false } = {}) {
  let key = localStorage.getItem('gemini-api-key');
  if (!key || forcePrompt) {
    key = window.prompt(
      'Enter your Gemini API key (aistudio.google.com/apikey).\n' +
        'It is stored only in this browser (localStorage) and sent only to generativelanguage.googleapis.com.',
      key ?? ''
    );
    if (key) localStorage.setItem('gemini-api-key', key.trim());
  }
  return key?.trim() || null;
}

document.getElementById('ai-key-btn').addEventListener('click', () => getApiKey({ forcePrompt: true }));

function setAiStatus(text, isError = false) {
  aiStatus.textContent = text;
  aiStatus.classList.toggle('error', isError);
}

function clearScene() {
  select(null);
  for (const m of [...modelGroup.children]) {
    modelGroup.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
}

async function generateFromPrompt() {
  const prompt = aiPrompt.value.trim();
  if (!prompt) return;
  const apiKey = getApiKey();
  if (!apiKey) return;

  aiGenerateBtn.disabled = true;
  setAiStatus('Loading…');

  try {
    setAiStatus('Designing…');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
          contents: [
            {
              role: 'user',
              parts: [{ text: `Design this as a 3D-printable model: ${prompt}` }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: AI_SCENE_SCHEMA,
          },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const apiMsg = body?.error?.message ?? `HTTP ${res.status}`;
      const err = new Error(apiMsg);
      err.status = res.status;
      // Google includes a RetryInfo detail like {"retryDelay": "14s"} on 429s.
      err.retryDelay = body?.error?.details?.find((d) => d.retryDelay)?.retryDelay;
      throw err;
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error(data.promptFeedback?.blockReason
        ? `Request was blocked (${data.promptFeedback.blockReason}).`
        : 'No design returned.');
    }
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error('Response was cut off — try a simpler description.');
    }
    if (candidate.finishReason === 'SAFETY') {
      throw new Error('Gemini declined this request.');
    }

    const text = candidate.content?.parts?.map((p) => p.text ?? '').join('');
    if (!text) throw new Error('No design returned.');
    const scene = JSON.parse(text);

    if (!aiKeepCheckbox.checked) clearScene();
    for (const o of scene.objects) {
      addObject(o.type, {
        name: o.name,
        color: o.color,
        pos: o.pos,
        rot: o.rot,
        size: o.size.map((v) => Math.max(0.1, v)),
      });
    }
    select(null);
    setAiStatus(`Built "${scene.model_name}" — ${scene.objects.length} parts`);
  } catch (err) {
    if (err?.status === 400 && /api key/i.test(err.message) || err?.status === 401 || err?.status === 403) {
      localStorage.removeItem('gemini-api-key');
      setAiStatus('Invalid API key — click "API key" to re-enter it.', true);
    } else if (err?.status === 429) {
      const wait = err.retryDelay ? ` Try again in ${err.retryDelay}.` : ' Wait a minute and try again.';
      const quota = /quota|free tier|plan/i.test(err.message)
        ? ' (Free-tier quota — see aistudio.google.com for limits.)'
        : '';
      setAiStatus(`Rate limited.${wait}${quota}`, true);
    } else {
      setAiStatus(err.message || 'Generation failed.', true);
    }
    console.error(err);
  } finally {
    aiGenerateBtn.disabled = false;
  }
}

aiGenerateBtn.addEventListener('click', generateFromPrompt);
aiPrompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') generateFromPrompt();
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

refreshObjectList();
