import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as G from './geometry.js';
import { make3MF, makeSTLZip, download } from './export.js';

// ------------------------------------------------------------------ fonts
const FS = 'https://cdn.jsdelivr.net/npm/@fontsource/';
const FONTS = [
  { id: 'original', name: 'Original logo letters' },
  { id: 'secular-one', name: 'Secular One', pkg: 'secular-one@5.0.12', w: 400 },
  { id: 'rubik', name: 'Rubik ExtraBold', pkg: 'rubik@5.0.20', w: 800 },
  { id: 'heebo', name: 'Heebo Black', pkg: 'heebo@5.0.20', w: 900 },
  { id: 'assistant', name: 'Assistant ExtraBold', pkg: 'assistant@5.0.20', w: 800 },
  { id: 'suez-one', name: 'Suez One', pkg: 'suez-one@5.0.12', w: 400 },
  { id: 'varela-round', name: 'Varela Round', pkg: 'varela-round@5.0.12', w: 400 },
  { id: 'frank-ruhl-libre', name: 'Frank Ruhl Libre Black', pkg: 'frank-ruhl-libre@5.0.20', w: 900 },
  { id: 'karantina', name: 'Karantina Bold', pkg: 'karantina@5.0.12', w: 700 },
  { id: 'amatic-sc', name: 'Amatic SC Bold', pkg: 'amatic-sc@5.0.12', w: 700 },
  { id: 'noto-sans-hebrew', name: 'Noto Sans Hebrew Black', pkg: 'noto-sans-hebrew@5.0.20', w: 900 },
];
const ORIGINAL_CHARS = 'מסדהארץ';
const fontCache = new Map();
let customFont = null, originalData = null, standData = null;

async function parseFontUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return opentype.parse(await r.arrayBuffer());
}
async function getFontSource(id) {
  if (id === 'original') {
    const fb = await getFontSource('rubik');
    return { original: originalData, fonts: fb.fonts };
  }
  if (id === 'custom') return { original: null, fonts: customFont ? [customFont] : [] };
  if (fontCache.has(id)) return fontCache.get(id);
  const f = FONTS.find((x) => x.id === id);
  const p = (async () => {
    const url = (sub) => `${FS}${f.pkg}/files/${f.id}-${sub}-${f.w}-normal.woff`;
    const [heb, lat] = await Promise.all([parseFontUrl(url('hebrew')), parseFontUrl(url('latin')).catch(() => null)]);
    const ref = G.fontRefUnits(heb);
    return { original: null, fonts: [{ font: heb, ref }, lat && { font: lat, ref: ref * (lat.unitsPerEm / heb.unitsPerEm) }].filter(Boolean) };
  })();
  fontCache.set(id, p);
  p.catch(() => fontCache.delete(id));
  return p;
}

// ------------------------------------------------------------------ state
const DEFAULT = {
  text: 'מסד הארץ', font: 'original', height: 25.6, spacing: 2.5, wordSpace: 0, border: 4.5, offsetX: 0, offsetY: 0,
  stand: '#1d1d1d', backing: '#1d1d1d', letters: '#f3f3f3',
  per: { 3: { c: '#47b9dd', p: 1 } }, name: 'massad-haaretz',
};
let S = structuredClone(DEFAULT);
try {
  const m = location.hash.match(/s=([^&]+)/);
  if (m) S = { ...S, ...JSON.parse(decodeURIComponent(m[1])) };
} catch { /* ignore bad hash */ }
if (S.font === 'custom') S.font = 'original';
const saveHash = () => { const { ...s } = S; history.replaceState(null, '', '#s=' + encodeURIComponent(JSON.stringify(s))); };

// ------------------------------------------------------------------ UI
const $ = (s) => document.querySelector(s);
const fontSel = $('#font');
function fillFonts() {
  fontSel.innerHTML = FONTS.map((f) => `<option value="${f.id}">${f.name}</option>`).join('') +
    (customFont ? `<option value="custom">Uploaded: ${customFont.name}</option>` : '');
  fontSel.value = S.font;
}
fillFonts();
$('#text').value = S.text;
$('#name').value = S.name;

for (const el of document.querySelectorAll('.slider')) {
  const k = el.dataset.key;
  const num = Object.assign(document.createElement('input'), { type: 'number', min: el.dataset.min, max: el.dataset.max, step: el.dataset.step });
  const rng = Object.assign(document.createElement('input'), { type: 'range', min: el.dataset.min, max: el.dataset.max, step: el.dataset.step });
  num.value = rng.value = S[k];
  el.append(num, rng);
  const set = (v) => { v = parseFloat(v); if (Number.isNaN(v)) return; S[k] = v; num.value = rng.value = v; schedule(); };
  rng.addEventListener('input', () => set(rng.value));
  num.addEventListener('change', () => set(num.value));
  el._set = (v) => { num.value = rng.value = v; };
}
for (const inp of document.querySelectorAll('[data-color]')) {
  inp.value = S[inp.dataset.color];
  inp.addEventListener('input', () => { S[inp.dataset.color] = inp.value; schedule({ colorsOnly: true }); });
}
$('#text').addEventListener('input', (e) => { S.text = e.target.value; renderLetterChips(); schedule(); });
$('#name').addEventListener('input', (e) => { S.name = e.target.value; saveHash(); });
fontSel.addEventListener('change', () => {
  const was = S.font; S.font = fontSel.value;
  if (was === 'original' && S.font !== 'original' && S.wordSpace === 0) { S.wordSpace = 8; document.querySelector('[data-key=wordSpace]')._set(8); }
  if (was !== 'original' && S.font === 'original' && S.wordSpace === 8) { S.wordSpace = 0; document.querySelector('[data-key=wordSpace]')._set(0); }
  schedule();
});
$('#fontFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const font = opentype.parse(await file.arrayBuffer());
    customFont = { font, ref: G.fontRefUnits(font), name: file.name };
    S.font = 'custom'; fillFonts(); schedule();
  } catch (err) { alert('Could not read that font: ' + err.message); }
});

const letterChars = () => [...S.text].filter((c) => !/\s/.test(c));
const colorOf = (li) => (S.per[li] && S.per[li].c) || S.letters;
const isPegged = (li) => !!(S.per[li] && S.per[li].p);
function setPer(li, patch) {
  const cur = { ...(S.per[li] || {}), ...patch };
  if (!cur.c) delete cur.c; if (!cur.p) delete cur.p;
  if (Object.keys(cur).length) S.per[li] = cur; else delete S.per[li];
}
function renderLetterChips() {
  const box = $('#letters');
  box.innerHTML = '';
  letterChars().forEach((ch, li) => {
    const d = document.createElement('div');
    d.className = 'letter' + (isPegged(li) ? ' pegged' : '');
    d.innerHTML = `<div class="top"><span class="ch">${ch.replace(/[<&]/g, '')}</span><input type="color" value="${colorOf(li)}" title="Letter color"></div>
      <label><input type="checkbox" ${isPegged(li) ? 'checked' : ''}> Pegs</label>
      <div class="st" data-st="${li}"></div>${S.per[li] && S.per[li].c ? '<button class="reset">reset color</button>' : ''}`;
    d.querySelector('input[type=color]').addEventListener('input', (e) => { setPer(li, { c: e.target.value }); schedule({ colorsOnly: true }); });
    d.querySelector('input[type=color]').addEventListener('change', () => renderLetterChips());
    d.querySelector('input[type=checkbox]').addEventListener('change', (e) => { setPer(li, { p: e.target.checked ? 1 : 0 }); d.classList.toggle('pegged', e.target.checked); schedule(); });
    const rb = d.querySelector('.reset');
    if (rb) rb.addEventListener('click', () => { setPer(li, { c: null }); renderLetterChips(); schedule({ colorsOnly: true }); });
    box.appendChild(d);
  });
}

// ------------------------------------------------------------------ 3D view
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-200, 300, 400); scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(300, 150, -300); scene.add(rim);
const root = new THREE.Group(); root.rotation.x = -Math.PI / 2; scene.add(root); // content is Z-up (mm)
const groups = { assembled: new THREE.Group(), plate: new THREE.Group() };
root.add(groups.assembled, groups.plate);
let view = 'assembled';

function plateGrid() {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.BoxGeometry(256, 256, 1), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 }));
  bed.position.set(128, 128, -0.55); g.add(bed);
  const pts = [];
  for (let i = 0; i <= 256; i += 32) pts.push(i, 0, 0, i, 256, 0, 0, i, 0, 256, i, 0);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x4a505a })));
  return g;
}
const gridObj = plateGrid();

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
function bg() { scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#e9ebef'); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', bg);
bg();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function fitCamera() {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(groups[view]);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), radius = box.getSize(new THREE.Vector3()).length() / 2;
  const vFov = THREE.MathUtils.degToRad(camera.fov), hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.02;
  const dir = view === 'assembled' ? new THREE.Vector3(0.28, 0.3, 1) : new THREE.Vector3(0, 1.3, 0.75);
  camera.position.copy(c).add(dir.normalize().multiplyScalar(dist));
  controls.target.copy(c); controls.update();
}
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
  groups.assembled.visible = view === 'assembled'; groups.plate.visible = view === 'plate';
  fitCamera();
});
groups.plate.visible = false;

const matCache = new Map();
const mat = (hex) => {
  if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.02, flatShading: false }));
  return matCache.get(hex);
};
function toGeo(m) {
  const pos = new Float32Array(m.f.length * 9); let o = 0;
  for (const t of m.f) for (const i of t) { const v = m.v[i]; pos[o++] = v[0]; pos[o++] = v[1]; pos[o++] = v[2]; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
function asmMatrix(a) {
  const pre = new THREE.Matrix4().makeTranslation(...a.pre), post = new THREE.Matrix4().makeTranslation(...a.post);
  const R = a.R, r = new THREE.Matrix4().set(R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, 0, 0, 0, 1);
  return post.multiply(r).multiply(pre);
}
function clearGroup(g) { for (const c of [...g.children]) { if (c !== gridObj) { g.remove(c); c.geometry && c.geometry.dispose(); } } }

// ------------------------------------------------------------------ build
let model = null, token = 0, pending = null, firstFit = true;
function schedule(opts = {}) {
  saveHash();
  if (opts.colorsOnly && model) { applyColors(); return; }
  cancelAnimationFrame(pending); pending = requestAnimationFrame(() => rebuild());
}
// Pegs always use the letters color (they print in the same layers as the letters).
const pegColor = () => S.letters;
function colorName(hex) {
  hex = hex.toLowerCase();
  if (hex === S.letters.toLowerCase()) return 'Letters';
  if (hex === S.backing.toLowerCase()) return 'Background';
  if (hex === S.stand.toLowerCase()) return 'Stand';
  return 'Color ' + hex;
}

async function rebuild() {
  const my = ++token;
  $('#status').textContent = 'Building…';
  let src;
  try { src = await getFontSource(S.font); }
  catch (e) { $('#status').textContent = 'Font failed to load – check your connection.'; return; }
  if (my !== token) return;
  const notes = [];
  const P = { height: S.height, spacing: S.spacing, wordSpace: S.wordSpace, border: S.border, offsetX: S.offsetX, offsetY: S.offsetY };
  const { letters, missing } = G.layoutText(S.text, src, P);
  if (missing.length) notes.push({ level: 'warn', text: `This font has no shape for: ${[...new Set(missing)].join(' ')}` });
  if (S.font === 'original') {
    const extra = [...new Set(letterChars().filter((c) => !ORIGINAL_CHARS.includes(c) && !missing.includes(c)))];
    if (extra.length) notes.push({ level: 'info', text: `The original logo only has the letters ${[...ORIGINAL_CHARS].join(' ')}. ${extra.join(' ')} are drawn in Rubik – pick another font for a matching style.` });
  }
  const { backing, boss } = G.buildBacking(letters, P, notes);

  // pegs per pegged letter, per separate piece of that letter
  const allPegs = [];
  for (const l of letters) {
    l.pegs = []; l.status = '';
    if (!isPegged(l.li)) continue;
    const msgs = [];
    l.pieces.forEach((pc, i) => {
      const r = G.pegsForPiece(pc);
      l.pegs.push(...r.pegs);
      if (r.pegs.length < 2) msgs.push(r.pegs.length ? `part ${i + 1}: 1 peg` : `part ${i + 1}: no room`);
    });
    allPegs.push(...l.pegs);
    l.status = msgs.length ? msgs.join(', ') : `${l.pegs.length} pegs`;
    l.statusBad = msgs.length > 0;
    if (msgs.length) notes.push({ level: 'warn', text: `Letter ${l.char}: ${msgs.join(', ')} – that part is too thin for two pegs, so add a drop of glue.` });
  }

  const mounted = letters.map((l) => ({ l, mesh: G.letterMesh(l.pieces, l.pegs) }));
  const backMesh = G.backingMesh(backing, boss);
  const pegMesh = G.pegsMesh(allPegs);
  const printed = mounted.filter((x) => isPegged(x.l.li));
  const packed = G.packParts(printed.map((x) => G.dropForPrint(x.mesh)));
  if (packed.overflow) notes.push({ level: 'warn', text: 'The separate letters don’t all fit in the free plate space – rearrange them in Bambu Studio (or print them on a second plate).' });
  const bb = G.piecesBounds(backing);
  if (backing.length && (bb.minX < 0 || bb.maxX > G.K.plate)) notes.push({ level: 'warn', text: `The logo is ${(bb.maxX - bb.minX).toFixed(0)} mm wide, which doesn't fit the 256 mm plate. Make the letters smaller.` });
  else if (backing.length && bb.maxX - bb.minX > 230) notes.push({ level: 'info', text: `The logo is ${(bb.maxX - bb.minX).toFixed(0)} mm wide (the original is 197 mm). Check that the stand doesn't tip.` });

  model = {
    letters, mounted, backMesh, pegMesh, printed: printed.map((x, i) => ({ l: x.l, mesh: packed.meshes[i] })),
    arm: G.MeshB.from(standData.arm), base: G.MeshB.from(standData.base), notes,
  };
  drawScene();
  renderNotes(notes);
  for (const l of letters) { const st = document.querySelector(`[data-st="${l.li}"]`); if (st) { st.textContent = l.status || ''; st.classList.toggle('bad', !!l.statusBad); } }
  $('#status').textContent = `${letters.length} letters · ${allPegs.length} pegs · logo ${backing.length ? (bb.maxX - bb.minX).toFixed(0) + '×' + (bb.maxY - bb.minY).toFixed(0) + ' mm' : '–'}`;
  if (firstFit) { fitCamera(); firstFit = false; }
}

// Meshes keyed by role so colors can update without rebuilding geometry.
let drawn = [];
function drawScene() {
  clearGroup(groups.assembled); clearGroup(groups.plate); drawn = [];
  const A = standData.assembly, mLogo = asmMatrix(A.logo), mArm = asmMatrix(A.arm), mBase = asmMatrix(A.base);
  const add = (group, mesh, role, matrix) => {
    const o = new THREE.Mesh(toGeo(mesh), mat('#888888'));
    if (matrix) { o.matrixAutoUpdate = false; o.matrix.copy(matrix); }
    o.userData.role = role; group.add(o); drawn.push(o);
  };
  const m = model;
  // assembled
  for (const x of m.mounted) add(groups.assembled, x.mesh, { letter: x.l.li }, mLogo);
  add(groups.assembled, m.backMesh, 'backing', mLogo);
  if (m.pegMesh.f.length) add(groups.assembled, m.pegMesh, 'pegs', mLogo);
  add(groups.assembled, m.arm, 'stand', mArm);
  add(groups.assembled, m.base, 'stand', mBase);
  groups.assembled.position.set(-125, 0, 3.88);
  // plate
  if (!groups.plate.children.includes(gridObj)) groups.plate.add(gridObj);
  for (const x of m.mounted) if (!isPegged(x.l.li)) add(groups.plate, x.mesh, { letter: x.l.li });
  add(groups.plate, m.backMesh, 'backing');
  if (m.pegMesh.f.length) add(groups.plate, m.pegMesh, 'pegs');
  add(groups.plate, m.arm, 'stand'); add(groups.plate, m.base, 'stand');
  for (const x of m.printed) add(groups.plate, x.mesh, { letter: x.l.li });
  groups.plate.position.set(-128, -128, 0);
  applyColors();
}
function applyColors() {
  const pc = pegColor(model);
  for (const o of drawn) {
    const r = o.userData.role;
    o.material = mat(r === 'stand' ? S.stand : r === 'backing' ? S.backing : r === 'pegs' ? pc : colorOf(r.letter));
  }
}
function renderNotes(notes) {
  $('#notes').innerHTML = notes.map((n) => `<div class="note ${n.level}">${n.text.replace(/</g, '&lt;')}</div>`).join('');
}

// ------------------------------------------------------------------ export
function exportParts() {
  const m = model, pc = pegColor(m), parts = [];
  for (const x of m.mounted) if (!isPegged(x.l.li)) parts.push({ name: `Letter ${x.l.char}`, mesh: x.mesh, color: colorOf(x.l.li), group: 'logo' });
  parts.push({ name: 'Background', mesh: m.backMesh, color: S.backing, group: 'logo' });
  if (m.pegMesh.f.length) parts.push({ name: 'Pegs', mesh: m.pegMesh, color: pc, group: 'logo' });
  parts.push({ name: 'Arm', mesh: m.arm, color: S.stand });
  parts.push({ name: 'Base', mesh: m.base, color: S.stand });
  for (const x of m.printed) parts.push({ name: `Letter ${x.l.char} - separate (pegged)`, mesh: x.mesh, color: colorOf(x.l.li) });
  for (const p of parts) p.colorName = colorName(p.color);
  return parts;
}
const fileBase = () => (S.name || 'logo').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'logo';
$('#dl3mf').addEventListener('click', async (e) => {
  if (!model) return; e.target.disabled = true;
  try { download(await make3MF(exportParts(), S.text), fileBase() + '.3mf'); } finally { e.target.disabled = false; }
});
$('#dlstl').addEventListener('click', async (e) => {
  if (!model) return; e.target.disabled = true;
  try { download(await makeSTLZip(exportParts()), fileBase() + '-stl.zip'); } finally { e.target.disabled = false; }
});
$('#share').addEventListener('click', async (e) => {
  saveHash();
  try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'Copied!'; } catch { e.target.textContent = 'Copy failed'; }
  setTimeout(() => (e.target.textContent = 'Copy link'), 1500);
});

$('#reset').addEventListener('click', () => {
  if (!confirm('Reset everything to the original מסד הארץ logo?')) return;
  history.replaceState(null, '', location.pathname); location.reload();
});

// debug hook for testing: window.__logo.check() -> open edge counts per part
window.__logo = { get model() { return model; }, exportParts, G, check: () => exportParts().map((p) => [p.name, p.mesh.f.length, G.openEdges(p.mesh)]) };

// ------------------------------------------------------------------ boot
(async () => {
  [originalData, standData] = await Promise.all([fetch('data/original-glyphs.json').then((r) => r.json()), fetch('data/stand.json').then((r) => r.json())]);
  renderLetterChips();
  resize();
  rebuild();
})();
