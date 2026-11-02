import { MASTER, CUTS, render, cut, ensureFonts } from './compose.js';
import { inWindow } from './windows.js';
import { suggest } from './lines.js';

const $ = (s) => document.querySelector(s);
const track = (name, params = {}) => { try { window.gtag?.('event', name, params); } catch (_) { /* no analytics */ } };

const state = {
  manifest: null,
  bg: null,          // manifest entry
  bgImg: null,
  photo: null,       // {img, view:{scale,dx,dy}, file}
  mode: 'for',
  name: '',
  line: '',
  group: 'today',
};

const master = document.createElement('canvas');
master.width = MASTER.w; master.height = MASTER.h;
const preview = $('#preview');
const pctx = preview.getContext('2d');
const imgCache = new Map();

function loadImage(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  imgCache.set(src, p);
  return p;
}

let raf = 0;
function draw() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    render(master, { mode: state.mode, name: state.name, line: state.line }, state.bg, state.bgImg, state.photo);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = preview.clientWidth || 280, cssH = cssW * 16 / 9;
    if (preview.width !== Math.round(cssW * dpr)) { preview.width = Math.round(cssW * dpr); preview.height = Math.round(cssH * dpr); }
    pctx.drawImage(master, 0, 0, preview.width, preview.height);
  });
}

// ---------- backgrounds ----------
const GROUPS = [
  ['today', 'Today'],
  ['always', 'Always'],
  ['milestone', 'Milestones'],
  ['spot', 'Jetson’s Spots'],
  ['more', 'More'],
];

function visibleEntries(group) {
  const all = state.manifest.backgrounds.filter((e) => !e.winnersOnly);
  const mem = state.mode === 'inMemory';
  const ok = (e) => !mem || e.inMemory;
  const today = new Date();
  switch (group) {
    case 'today': return all.filter((e) => (e.group === 'season' || e.group === 'holiday') && inWindow(e.window, today) && ok(e));
    case 'always': return all.filter((e) => e.group === 'always' && ok(e));
    case 'milestone': return all.filter((e) => e.group === 'milestone' && ok(e));
    case 'spot': return all.filter((e) => e.group === 'spot' && ok(e));
    case 'more': return all.filter((e) => (e.group === 'season' || e.group === 'holiday') && !inWindow(e.window, today) && ok(e));
    default: return all.filter(ok);
  }
}

function renderTabs() {
  const tabs = $('#groups');
  tabs.innerHTML = '';
  for (const [key, label] of GROUPS) {
    const n = visibleEntries(key).length;
    if (!n) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.role = 'tab'; b.textContent = label;
    b.setAttribute('aria-selected', String(key === state.group));
    b.addEventListener('click', () => { state.group = key; renderTabs(); renderGrid(); });
    tabs.appendChild(b);
  }
  if (!visibleEntries(state.group).length) { state.group = 'always'; renderTabs(); }
}

function renderGrid() {
  const grid = $('#grid');
  grid.innerHTML = '';
  for (const e of visibleEntries(state.group)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.bg?.id === e.id));
    b.title = e.name;
    const img = document.createElement('img');
    img.loading = 'lazy'; img.alt = ''; img.src = `/backgrounds/thumbs/${e.id}.webp`;
    const span = document.createElement('span'); span.textContent = e.name.replace(/^Spot: /, '');
    b.append(img, span);
    b.addEventListener('click', () => selectBackground(e));
    grid.appendChild(b);
  }
}

async function selectBackground(e) {
  state.bg = e;
  $('#sticker-hint').hidden = !e.sticker;
  $('#preview-hint').textContent = e.sticker
    ? 'Drag your dog to where he sat. Pinch or use the slider to resize.'
    : 'Drag the photo to move it. Pinch or use the slider to zoom.';
  renderGrid();
  track('background_picked', { id: e.id, group: e.group });
  draw();
  try { state.bgImg = await loadImage(`/backgrounds/${e.file}`); } catch { state.bgImg = null; }
  if (state.bg === e) draw();
}

function applyModeToBackground() {
  if (state.mode === 'inMemory' && state.bg && !state.bg.inMemory) {
    const dusk = state.manifest.backgrounds.find((e) => e.inMemoryDefault) || state.manifest.backgrounds.find((e) => e.default);
    if (dusk) selectBackground(dusk);
  }
}

// ---------- photo ----------
$('#photo').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    state.photo = { img, file, view: { scale: 1, dx: 0, dy: 0 } };
    $('#zoom').value = '1';
    $('#photo-label').textContent = 'Change photo';
    track('photo_added');
    draw();
    document.querySelector('#step-words')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch { /* unreadable image */ }
});

$('#zoom').addEventListener('input', (ev) => {
  if (!state.photo) return;
  state.photo.view.scale = Number(ev.target.value);
  draw();
});

// drag and pinch on the preview
const pointers = new Map();
let pinchStart = null;
preview.addEventListener('pointerdown', (ev) => {
  if (!state.photo) return;
  preview.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: state.photo.view.scale };
  }
});
preview.addEventListener('pointermove', (ev) => {
  if (!state.photo || !pointers.has(ev.pointerId)) return;
  const prev = pointers.get(ev.pointerId);
  const k = MASTER.w / preview.clientWidth;
  if (pointers.size === 1) {
    state.photo.view.dx += (ev.clientX - prev.x) * k;
    state.photo.view.dy += (ev.clientY - prev.y) * k;
  }
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const s = Math.min(3, Math.max(0.5, pinchStart.scale * d / pinchStart.d));
    state.photo.view.scale = s;
    $('#zoom').value = String(Math.min(3, Math.max(1, s)));
  }
  draw();
});
const endPointer = (ev) => { pointers.delete(ev.pointerId); if (pointers.size < 2) pinchStart = null; };
preview.addEventListener('pointerup', endPointer);
preview.addEventListener('pointercancel', endPointer);

// ---------- words ----------
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', (ev) => {
  state.mode = ev.target.value;
  applyModeToBackground();
  renderTabs(); renderGrid();
  $('#suggestions').hidden = true;
  draw();
}));
$('#name').addEventListener('input', (ev) => { state.name = ev.target.value; draw(); });
$('#line').addEventListener('input', (ev) => {
  state.line = ev.target.value;
  $('#count').textContent = `${state.line.length} / 120`;
  draw();
});
$('#help').addEventListener('click', () => {
  const ul = $('#suggestions');
  ul.innerHTML = '';
  for (const s of suggest(state.mode, 5)) {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.type = 'button'; b.textContent = s;
    b.addEventListener('click', () => { $('#line').value = s; state.line = s; $('#count').textContent = `${s.length} / 120`; ul.hidden = true; draw(); });
    li.appendChild(b); ul.appendChild(li);
  }
  ul.hidden = false;
  track('words_help');
});

// ---------- share and save ----------
function fileName(which) {
  const n = (state.name || 'dog').replace(/[^\w\-]+/g, '_').slice(0, 30);
  return `Dedication_${n}_${which}.jpg`;
}
async function makeFile(which) {
  await ensureFonts();
  render(master, { mode: state.mode, name: state.name, line: state.line }, state.bg, state.bgImg, state.photo);
  const blob = await cut(master, which);
  return new File([blob], fileName(which), { type: 'image/jpeg' });
}
function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
$('#share').addEventListener('click', async () => {
  const file = await makeFile('story');
  const data = { files: [file], title: 'Every dog deserves a dedication', text: `${FOOTER()} ${location.origin}` };
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share(data); track('shared', { via: 'sheet' }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  download(file); track('shared', { via: 'download' });
});
const FOOTER = () => 'Every dog deserves a dedication.';
for (const which of ['story', 'feed', 'card']) {
  $(`#dl-${which}`).addEventListener('click', async () => { download(await makeFile(which)); track('downloaded', { cut: which }); });
}

// ---------- request a background ----------
$('#request-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = $('#req-text').value.trim(), email = $('#req-email').value.trim();
  const status = $('#req-status');
  if (!text || !email) { status.textContent = 'Both lines, please.'; return; }
  status.textContent = 'Sending…';
  try {
    const r = await fetch('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, email }) });
    if (!r.ok) throw new Error(String(r.status));
    status.textContent = 'Got it. I will email you when it goes live.';
    ev.target.reset();
    track('request_sent');
  } catch {
    status.innerHTML = 'Couldn’t send just now. <a href="mailto:admin@brockalston.com?subject=Background%20request&body=' + encodeURIComponent(text) + '">Email it instead</a>.';
  }
});

// ---------- boot ----------
async function boot() {
  $('#start').addEventListener('click', () => track('started'));
  const r = await fetch('/backgrounds/backgrounds.json');
  state.manifest = await r.json();
  await ensureFonts();
  renderTabs(); renderGrid();
  const def = state.manifest.backgrounds.find((e) => e.default) || state.manifest.backgrounds[0];
  await selectBackground(def);
  if (!visibleEntries('today').length) { state.group = 'always'; renderTabs(); renderGrid(); }
  draw();
  window.addEventListener('resize', draw);
  document.fonts?.ready?.then(draw);
}
boot();
