import { MASTER, CUTS, render, cut, ensureFonts, sceneHit, sceneGeometry } from './compose.js';
import { inWindow } from './windows.js';
import { suggest } from './lines.js';

const $ = (s) => document.querySelector(s);
// GA4 events (G-ZQLVEN820R). The landing utm_source is kept for the session so 'posted' can say which surface
// brought the dog, not just the visit. Nothing personal is sent: no email, no name, no line.
const SOURCE_KEY = 'dw_source';
function landingSource() {
  try {
    const q = new URLSearchParams(location.search);
    const src = q.get('utm_source');
    if (src) { sessionStorage.setItem(SOURCE_KEY, JSON.stringify({ source: src, medium: q.get('utm_medium') || '', campaign: q.get('utm_campaign') || '' })); }
    return JSON.parse(sessionStorage.getItem(SOURCE_KEY) || 'null') || { source: document.referrer ? 'referrer' : 'direct', medium: '', campaign: '' };
  } catch { return { source: 'unknown', medium: '', campaign: '' }; }
}
// /?fix=<id> (from /admin): the maker reopens a posted dog so its pictures can be laid out again. Nothing
// in fix mode counts in GA4 or touches the admin's own saved draft.
const FIX = (() => { try { return (new URLSearchParams(location.search).get('fix') || '').replace(/[^a-z0-9]/g, ''); } catch { return ''; } })();
const track = (name, params = {}) => { if (FIX) return; try { const s = landingSource(); window.gtag?.('event', name, { entry_source: s.source, entry_medium: s.medium, ...params }); } catch (_) { /* no analytics */ } };
const fired = new Set();
const trackOnce = (name, params = {}) => { if (fired.has(name)) return; fired.add(name); track(name, params); };

const state = {
  manifest: null,
  bg: null,          // manifest entry
  bgImg: null,
  photo: null,       // {img, view:{scale,dx,dy}, file}
  cutout: null,      // {img, file, status:'working'|'ok'|'failed'} — the dog with no background, for the scene layout
  layout: { panelDy: 0, footerDy: 0 }, // where the reader moved the words panel and the footer plate on a scene
  bgChosen: false,   // the reader picked a background (so the cutout box leaves it alone)
  mode: 'for',
  name: '',
  line: '',
  group: 'today',
};
const words = () => ({ mode: state.mode, name: state.name, line: state.line, layout: state.layout });

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

// With the box ticked and the cutout ready, the dog stands on the background (the scene layout) on any
// background; otherwise the photo sits in the book page. The drag/zoom view is shared.
function photoForRender() {
  if (cutoutOn() && state.cutout?.status === 'ok' && state.cutout.file === state.photo?.file) {
    return { img: state.cutout.img, view: state.photo.view, file: state.photo.file, sticker: true };
  }
  return state.photo;
}
const isScene = () => !!photoForRender()?.sticker;
function updateHint() {
  $('#preview-hint').textContent = isScene()
    ? 'Drag your dog, the words or the footer to move them. Pinch or use the slider to resize the dog.'
    : 'Drag the photo to move it. Pinch or use the slider to zoom.';
}
let raf = 0;
function draw() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    render(master, words(), state.bg, state.bgImg, photoForRender());
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
    b.addEventListener('click', () => { state.bgChosen = true; selectBackground(e); track('background_chosen', { id: e.id, group: e.group }); cueAfterBackground(); });
    grid.appendChild(b);
  }
}

async function selectBackground(e) {
  state.bg = e;
  updateHint();
  renderGrid();
  draw();
  if (cutoutOn()) requestCutout();
  try { state.bgImg = await loadImage(`/backgrounds/${e.file}`); } catch { state.bgImg = null; }
  if (state.bg === e) draw();
}

// ---------- next-step glow ----------
// When a step is done, the next step's main control pulses once (two beats), then stops. Each cue fires
// once per dedication. The step line is read to screen readers, so the glow is never the only cue.
const STEP_TOTAL = 4;
const cued = new Set();
function nudge(key, el, stepNo, stepName) {
  if (!el || cued.has(key)) return;
  cued.add(key);
  el.classList.remove('glow');
  void el.offsetWidth; // restart the animation if the class was just removed
  el.classList.add('glow');
  const done = () => el.classList.remove('glow');
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 1600);
  if (stepNo) { const live = $('#step-live'); if (live) live.textContent = `Step ${stepNo} of ${STEP_TOTAL}: ${stepName}`; }
}
// A gentle scroll, only when no keyboard can be up (after the photo, after the background).
function settle(el) {
  if (!el || document.activeElement?.matches?.('input, textarea')) return;
  // Land the step near the top of the screen. (If the preview is ever made sticky again on phones,
  // pad by its height here so the step lands under it.)
  const wrap = document.querySelector('.preview-wrap');
  const stuck = wrap && getComputedStyle(wrap).position === 'sticky' && !window.matchMedia('(min-width: 720px)').matches;
  el.style.scrollMarginTop = `${stuck ? wrap.offsetHeight + 8 : 16}px`;
  try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* old browser */ }
}
function spotsTab() { return [...document.querySelectorAll('#groups button')].find((b) => b.textContent === 'Jetson’s Spots'); }
function cueAfterPhoto() {
  settle($('#name').closest('.field') || $('#step-words'));
  nudge('words', $('#name'), 2, 'Words');
}
function cueAfterName() {
  if (state.name.trim().length >= 2 && !state.line.trim()) nudge('help', $('#help'));
}
function cueAfterWords() {
  if (!state.name.trim() || !state.line.trim()) return;
  trackOnce('words_done');
  nudge('background', spotsTab() || $('#grid'), 3, 'Background');
}
function cueAfterBackground() {
  if (!state.photo) return;
  settle($('#step-share'));
  const flowOpen = !$('#post-flow').hidden;
  const target = flowOpen ? ($('#post-form').hidden ? $('#post-link') : $('#post-submit')) : ($('#post-cta').hidden ? $('#share-instagram') : $('#post-cta-btn'));
  nudge('share', target, 4, 'Share');
}
// After a share or a save, the wall button gets one more pulse (only when posting is open).
function cueAfterShare() {
  if ($('#post-cta').hidden || post.url) return;
  nudge('post', $('#post-cta-btn'));
}
// "Put <Name> on the wall" opens the sign-in flow in place; the button steps aside and the box takes
// its words as a title, so there is never a second navy button above the one that matters.
function openPostFlow() {
  const flow = $('#post-flow');
  $('#flow-dog').textContent = state.name.trim() || 'my dog';
  $('#post-cta').hidden = true;
  if (flow.hidden) { flow.hidden = false; }
  settle(flow);
}
$('#post-cta-btn').addEventListener('click', () => {
  track('post_cta_tapped');
  trackOnce('post_started', { via: 'cta' });
  openPostFlow();
  const email = $('#post-email');
  if (email && !$('#post-signin').hidden) setTimeout(() => email.focus({ preventScroll: true }), 450);
});

// ---------- cutout (Jetson's Spots) ----------
// The photo is downsized here, sent once to /api/cutout, and the PNG that comes back stands in for the
// photo in the sticker layout. A transparent PNG the reader brought is used as is.
const cutoutOn = () => !!$('#cutout-on')?.checked;
const CUTOUT_HINT = {
  idle: 'Ticked, your dog is lifted out of the photo and set on the background like a sticker, with the words above and the footer below. Untick it for the book page with the photo as it is.',
  working: 'Cutting your dog out of the photo…',
  ok: 'Done. Drag your dog, the words or the footer to move them; untick the box to use the photo as it was.',
  own: 'That photo already has no background, so it is used as is.',
  failed: 'Couldn’t cut this one out just now. Use a cut-out of your own: on an iPhone, press and hold the dog in Photos, then Copy or Share it as a sticker.',
};
const cutoutStatus = (k) => { const el = $('#cutout-status'); if (el) el.textContent = CUTOUT_HINT[k] || k; };

async function downsized(file, max = 1600) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
}

// A PNG whose corners are transparent is already a cut-out.
function hasTransparentCorners(img) {
  try {
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const x = c.getContext('2d');
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    x.drawImage(img, 0, 0, 4, 4, 0, 0, 4, 4); x.drawImage(img, w - 4, 0, 4, 4, 4, 0, 4, 4);
    x.drawImage(img, 0, h - 4, 4, 4, 0, 4, 4, 4); x.drawImage(img, w - 4, h - 4, 4, 4, 4, 4, 4, 4);
    const d = x.getImageData(0, 0, 8, 8).data;
    let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 16) clear++;
    return clear > 40;
  } catch { return false; }
}

// The cut-out comes back at the photo's full size with the background cleared, so its edges are air.
// Trimming to the opaque box makes the sticker's bottom mean the paws, so it sits on the scene.
function trimAlpha(img) {
  try {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const a = x.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0, i = 3; y < h; y++) for (let xx = 0; xx < w; xx++, i += 4) {
      if (a[i] > 24) { if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return img;
    const pad = Math.round(Math.max(w, h) * 0.02);
    const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
    const sw = Math.min(w, maxX + pad + 1) - sx, sh = Math.min(h, maxY + pad + 1) - sy;
    if (sw < 16 || sh < 16) return img;
    const out = document.createElement('canvas'); out.width = sw; out.height = sh;
    out.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
    return out;
  } catch { return img; }
}

async function requestCutout() {
  if (!state.photo?.file || !cutoutOn()) return;
  const file = state.photo.file;
  if (state.cutout && state.cutout.file === file) { cutoutStatus(state.cutout.own ? 'own' : state.cutout.status); return; }
  if (file.type === 'image/png' && hasTransparentCorners(state.photo.img)) { state.cutout = { img: trimAlpha(state.photo.img), file, status: 'ok', own: true }; cutoutStatus('own'); updateHint(); draw(); return; }
  state.cutout = { file, status: 'working' };
  cutoutStatus('working');
  try {
    const small = await downsized(file);
    const fd = new FormData(); fd.set('photo', small, 'photo.jpg');
    const r = await fetch('/api/cutout', { method: 'POST', body: fd });
    if (!r.ok) throw new Error(String(r.status));
    const blob = await r.blob();
    if (!blob.type.startsWith('image/png')) throw new Error('not png');
    const img = trimAlpha(await loadImage(URL.createObjectURL(blob)));
    if (state.photo?.file !== file) return; // the reader changed photos meanwhile
    state.cutout = { img, file, status: 'ok' };
    cutoutStatus('ok');
    updateHint();
    track('cutout_ok');
  } catch (e) {
    if (state.photo?.file !== file) return;
    state.cutout = { file, status: 'failed' };
    cutoutStatus('failed');
    updateHint();
    track('cutout_failed', { why: e.message });
  }
  draw();
}
// The box is the layout: ticked, the dog is cut out and stands on whatever background is chosen; unticked,
// the book page shows the photo as it is. Until the reader picks a background, ticking the box (or adding a
// photo with it ticked) chooses a Spot to stand on: Gold Leaves in its season, else the hydrant.
function autoSpot() {
  const spots = visibleEntries('spot');
  if (!spots.length) return false;
  const pick = spots.find((e) => e.id === 'SpotGoldLeaves') || spots[0];
  state.group = 'spot'; renderTabs();
  selectBackground(pick);
  track('background_chosen', { id: pick.id, group: pick.group, via: 'cutout' });
  return true;
}
$('#cutout-on').addEventListener('change', () => {
  if (cutoutOn()) {
    if (state.photo && !state.bgChosen && !state.bg?.sticker) autoSpot();
    if (state.photo) requestCutout(); else cutoutStatus('idle');
  } else {
    cutoutStatus('idle');
  }
  updateHint();
  draw();
});

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
    state.cutout = null;
    $('#zoom').value = '1';
    $('#photo-label').textContent = 'Change photo';
    idbSet('photo', file); saveDraftNow();
    trackOnce('photo_added');
    draw();
    if (cutoutOn()) {
      if (!state.bgChosen && !state.bg?.sticker) autoSpot();
      requestCutout();
    }
    updateHint();
    cueAfterPhoto(); // also scrolls Words into view
  } catch { /* unreadable image */ }
});

$('#zoom').addEventListener('input', (ev) => {
  if (!state.photo) return;
  state.photo.view.scale = Number(ev.target.value);
  draw();
});

// drag and pinch on the preview. On a scene, whatever is under the finger moves: the words panel, the
// footer plate (each up or down, never past the other) or the dog; anywhere else moves the dog too.
const pointers = new Map();
let pinchStart = null;
let dragTarget = 'photo';
preview.addEventListener('pointerdown', (ev) => {
  if (!state.photo) return;
  preview.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) {
    dragTarget = 'photo';
    if (isScene()) {
      const r = preview.getBoundingClientRect();
      const k = MASTER.w / preview.clientWidth;
      dragTarget = sceneHit(master, words(), photoForRender(), (ev.clientX - r.left) * k, (ev.clientY - r.top) * k) || 'photo';
    }
  }
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
    const dx = (ev.clientX - prev.x) * k, dy = (ev.clientY - prev.y) * k;
    if (dragTarget === 'panel') state.layout.panelDy += dy;
    else if (dragTarget === 'footer') state.layout.footerDy += dy;
    else {
      state.photo.view.dx += dx; state.photo.view.dy += dy;
      // A dog stopped by the words keeps his real place, so dragging back down moves him at once.
      if (isScene()) state.photo.view.dy = sceneGeometry(master.getContext('2d'), words(), photoForRender()).dogDy;
    }
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
$('#name').addEventListener('input', (ev) => { state.name = ev.target.value; draw(); cueAfterName(); cueAfterWords(); const n = state.name.trim() || 'my dog'; for (const id of ['#post-cta-dog', '#flow-dog']) { const d = $(id); if (d) d.textContent = n; } });
$('#line').addEventListener('input', (ev) => {
  state.line = ev.target.value;
  $('#count').textContent = `${state.line.length} / 120`;
  draw();
  cueAfterWords();
});
// Word help: the fixed list shows at once; a few words about the dog ask Claude for five of its own.
// Nothing typed in the "about" box leaves the browser except to make that one request; it is not stored.
function showLines(lines) {
  const ul = $('#suggestions');
  ul.innerHTML = '';
  for (const s of lines) {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.type = 'button'; b.textContent = s;
    b.addEventListener('click', () => {
      $('#line').value = s; state.line = s; $('#count').textContent = `${s.length} / 120`; saveDraft(); draw();
      $('#help-box').hidden = true; ul.hidden = true; // the help steps aside; the button brings it back
      cueAfterWords();
    });
    li.appendChild(b); ul.appendChild(li);
  }
  ul.hidden = false;
}
$('#help').addEventListener('click', () => {
  const box = $('#help-box');
  box.hidden = !box.hidden;
  if (box.hidden) { $('#suggestions').hidden = true; return; }
  $('#help-status').textContent = 'Or pick one below and make it yours.';
  showLines(suggest(state.mode, 5));
  $('#about').focus({ preventScroll: true });
  track('words_help');
});
$('#about').addEventListener('input', (ev) => { $('#about-count').textContent = `${ev.target.value.length} / 240`; });
$('#suggest').addEventListener('click', async () => {
  const about = $('#about').value.trim();
  const status = $('#help-status');
  if (about.length < 3) { status.textContent = 'A few words first: what is your dog like?'; $('#about').focus(); return; }
  const btn = $('#suggest'); btn.disabled = true;
  status.textContent = 'Thinking…';
  const ul = $('#suggestions'); ul.innerHTML = '<li class="thinking">Finding the words…</li>'; ul.hidden = false;
  try {
    const r = await fetch('/api/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: state.mode, name: state.name.trim(), about }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.lines?.length) throw new Error(j.error || String(r.status));
    showLines(j.lines);
    status.textContent = 'Tap one to use it, then edit it however you like. Ask again for five more.';
    track('words_ai');
  } catch (e) {
    showLines(suggest(state.mode, 5));
    status.textContent = /plenty|resting/.test(e.message) ? e.message : 'Couldn’t reach the word help just now; here are a few from the book instead.';
  } finally { btn.disabled = false; }
});

// ---------- share and save ----------
function fileName(which) {
  const n = (state.name || 'dog').replace(/[^\w\-]+/g, '_').slice(0, 30);
  return `Dedication_${n}_${which}.jpg`;
}
async function makeFile(which) {
  await ensureFonts();
  render(master, words(), state.bg, state.bgImg, photoForRender());
  const blob = await cut(master, which);
  return new File([blob], fileName(which), { type: 'image/jpeg' });
}
function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const FOOTER = () => 'Every dog deserves a dedication.';
const makerLink = () => `${location.origin}/?utm_source=share&utm_medium=referral&utm_campaign=ops-57`;
// Before the dog is on the wall, every app button shares the picture (the share sheet on a phone, a
// download on a computer): Instagram gets the story, Facebook the feed, Messages the card. Once the
// page is live, Facebook and Messages carry the page link instead, and Copy link appears.
async function sharePicture(which, via, text) {
  const file = await makeFile(which);
  const data = { files: [file], title: FOOTER(), text };
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share(data); track('share_tapped', { via, how: 'sheet' }); cueAfterShare(); return true; } catch (e) { if (e?.name === 'AbortError') return false; }
  }
  download(file); track('share_tapped', { via, how: 'download' });
  $('#share-hint').textContent = `Saved ${file.name}. Open ${via === 'instagram' ? 'Instagram and add it to your story' : via === 'facebook' ? 'Facebook and post it' : 'Messages and send it'}.`;
  cueAfterShare();
  return true;
}
const pageText = () => `${state.mode === 'inMemory' ? 'In memory of' : 'To'} ${state.name.trim() || 'my dog'}: ${state.line.trim()}`;
$('#share-instagram').addEventListener('click', () => {
  $('#share-note').hidden = false; // Instagram only takes a picture through the phone's share sheet
  sharePicture('story', 'instagram', post.url ? `${pageText()} ${post.url}` : `${FOOTER()} ${makerLink()}`);
});
$('#share-x').addEventListener('click', () => {
  const url = post.url || makerLink();
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(post.url ? pageText() : FOOTER())}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
  track('share_tapped', { via: 'x', how: 'link' });
});
$('#share-facebook').addEventListener('click', () => {
  if (post.url) { window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(post.url)}`, '_blank', 'noopener'); track('share_tapped', { via: 'facebook', how: 'link' }); return; }
  sharePicture('feed', 'facebook', `${FOOTER()} ${makerLink()}`);
});
$('#share-messages').addEventListener('click', () => {
  if (post.url) { location.href = `sms:?&body=${encodeURIComponent(`${pageText()} ${post.url}`)}`; track('share_tapped', { via: 'messages', how: 'link' }); return; }
  sharePicture('card', 'messages', `${FOOTER()} ${makerLink()}`);
});
$('#share-save').addEventListener('click', () => {
  const menu = $('#save-menu'); const btn = $('#share-save');
  menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden));
});
for (const which of ['story', 'feed', 'card']) {
  $(`#dl-${which}`).addEventListener('click', async () => { download(await makeFile(which)); track('share_tapped', { via: 'save', cut: which }); cueAfterShare(); });
}
$('#share-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(post.url); $('#share-hint').textContent = 'Link copied.'; track('share_tapped', { via: 'copy' }); }
  catch { $('#share-hint').textContent = post.url; }
});
// Sharing comes after the wall, never instead of it: the share row appears once the page exists,
// and every share carries the page. (When posting is off, the row shows on its own as the only way out.)
function showShareRow() {
  for (const id of ['#share-label', '#share-row', '#share-hint']) $(id).hidden = false;
}
function shareLivePage(url) {
  post.url = url;
  showShareRow();
  $('#share-label').textContent = `Share ${state.name.trim() || 'your dog'}’s page:`;
  $('#share-copy').hidden = false;
  $('#share-hint').textContent = 'Facebook, X and Messages carry the link to the page; Instagram gets the story picture.';
  setTimeout(() => nudge('share-live', $('#share-instagram')), 600);
}

// ---------- post it to the wall ----------
// The maker keeps a draft (fields + the original photo) in this browser so a reload after the
// sign-in link, or a tab the phone threw away, lands back on the same dedication.
const DRAFT_KEY = 'dw_draft_v1';
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open('dw', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function idbSet(key, value) {
  if (FIX) return;
  try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch { /* no storage */ }
}
async function idbGet(key) {
  try { const db = await idb(); return await new Promise((res, rej) => { const t = db.transaction('kv', 'readonly'); const q = t.objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch { return undefined; }
}
async function idbDel(key) {
  try { const db = await idb(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(key); t.oncomplete = res; t.onerror = res; }); } catch { /* ignore */ }
}
let draftTimer = 0;
function saveDraftNow() {
  clearTimeout(draftTimer);
  if (FIX) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode: state.mode, name: state.name, line: state.line, bg: state.bg?.id, bgChosen: state.bgChosen, layout: state.layout, cutout: cutoutOn(), view: state.photo?.view || null, t: Date.now() }));
  } catch { /* no storage */ }
}
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 300);
}
window.addEventListener('pagehide', saveDraftNow);
async function restoreDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  if (!d || Date.now() - (d.t || 0) > 24 * 3600 * 1000) return;
  if (d.mode === 'inMemory') { document.querySelector('input[name="mode"][value="inMemory"]').checked = true; state.mode = 'inMemory'; }
  if (d.name) { $('#name').value = d.name; state.name = d.name; }
  if (d.line) { $('#line').value = d.line; state.line = d.line; $('#count').textContent = `${d.line.length} / 120`; }
  if (d.layout) state.layout = { panelDy: Number(d.layout.panelDy) || 0, footerDy: Number(d.layout.footerDy) || 0 };
  if (typeof d.cutout === 'boolean') $('#cutout-on').checked = d.cutout;
  const bg = d.bg && state.manifest.backgrounds.find((e) => e.id === d.bg);
  if (bg) { state.bgChosen = !!d.bgChosen; await selectBackground(bg); }
  const file = await idbGet('photo');
  if (file instanceof Blob) {
    try {
      const img = await loadImage(URL.createObjectURL(file));
      state.photo = { img, file, view: d.view || { scale: 1, dx: 0, dy: 0 } };
      $('#zoom').value = String(Math.min(3, Math.max(1, state.photo.view.scale)));
      $('#photo-label').textContent = 'Change photo';
    } catch { /* unreadable */ }
  }
  updateHint();
  draw();
  if (cutoutOn() && state.photo) requestCutout();
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } idbDel('photo'); }

const post = { config: null, email: '', poll: 0, url: '' };
const postStatus = (t, html = false) => { const el = $('#post-status'); if (html) el.innerHTML = t; else el.textContent = t; };

function showSignedIn(email) {
  trackOnce('signed_in');
  post.email = email;
  clearInterval(resendTimer);
  $('#flow-dog').textContent = state.name.trim() || 'my dog';
  if (post.config?.posting) $('#post-cta').hidden = true;
  $('#post-flow').hidden = false;
  $('#post-signin').hidden = true;
  setTimeout(readyToPost, 0);
  $('#post-wait').hidden = true;
  $('#post-form').hidden = false;
  $('#post-who').textContent = email;
  $('#post-dog').textContent = state.name.trim() || 'my dog';
  clearInterval(post.poll); post.poll = 0;
}

async function fetchConfig() {
  try { const r = await fetch('/api/config', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
}

function startPolling() {
  clearInterval(post.poll);
  const until = Date.now() + 15 * 60 * 1000;
  post.poll = setInterval(async () => {
    if (Date.now() > until) { clearInterval(post.poll); return; }
    const c = await fetchConfig();
    if (c?.signed_in) showSignedIn(c.signed_in);
  }, 3000);
}

// Ask for a sign-in link. The first send swaps the email form for a waiting panel; "Send it again" reuses
// the same address after a 60-second cooldown (the server enforces one a minute, six a day per address).
async function sendLink(email, { resend = false } = {}) {
  const r = await fetch('/api/auth/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, next: '/#step-share' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
  track(resend ? 'link_resent' : 'link_sent');
  return j;
}
let resendTimer = 0;
function armResend(seconds = 60) {
  const btn = $('#wait-resend');
  clearInterval(resendTimer);
  let left = seconds;
  btn.disabled = true; btn.textContent = `Send it again (${left})`;
  resendTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) { clearInterval(resendTimer); btn.disabled = false; btn.textContent = 'Send it again'; return; }
    btn.textContent = `Send it again (${left})`;
  }, 1000);
}
// Opened from the home-screen icon, the maker keeps its own cookies and draft, apart from the browser
// the emailed link opens in; there the code is the way in.
const fromHomeScreen = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
function showWaiting(email, devLink, devCode) {
  $('#post-signin').hidden = true;
  const wait = $('#post-wait');
  wait.hidden = false;
  $('#wait-email').textContent = email;
  $('#wait-code').value = '';
  $('#wait-code-status').textContent = '';
  if (fromHomeScreen()) {
    const hint = $('#wait-link-hint'), who = document.createElement('strong');
    who.textContent = email;
    hint.replaceChildren('Sent to ', who, '. Type the six-digit code from the email here; the link in it opens your browser instead of this app.');
    $('#wait-code-label').textContent = 'The six-digit code from the email';
    $('#wait-title').textContent = 'Check your email for a sign-in code. It works for 15 minutes.';
  }
  const st = $('#wait-status');
  if (devLink) st.innerHTML = `Test site: no email is sent. <a class="dev-link" href="${devLink}" target="_blank" rel="noopener">Open the sign-in link</a>, then come back here.${devCode ? ` Or type ${devCode}.` : ''}`;
  else st.textContent = '';
  armResend();
  settle(wait);
}
$('#wait-code-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const code = $('#wait-code').value.replace(/\D/g, '');
  const st = $('#wait-code-status');
  if (code.length !== 6) { st.textContent = 'Six digits, from the newest email.'; return; }
  const btn = $('#wait-code-go'); btn.disabled = true; st.textContent = 'Checking…';
  try {
    const r = await fetch('/api/auth/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: post.email, code }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { st.textContent = j.error ? j.error.charAt(0).toUpperCase() + j.error.slice(1) + '.' : `Couldn’t check the code (${r.status}).`; track('code_failed'); return; }
    st.textContent = '';
    track('code_used', { home_screen: fromHomeScreen() });
    showSignedIn(j.email || post.email);
  } catch (e) {
    st.textContent = 'Couldn’t reach the wall; check the connection and try again.';
  } finally { btn.disabled = false; }
});
// Six digits typed (or filled from the email by the phone) signs in without another tap.
$('#wait-code').addEventListener('input', (ev) => {
  const v = ev.target.value.replace(/\D/g, '').slice(0, 6);
  if (v !== ev.target.value) ev.target.value = v;
  if (v.length === 6) $('#wait-code-form').requestSubmit();
});
$('#post-link').addEventListener('click', async () => {
  const email = $('#post-email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { postStatus('A real email, please; the link goes there.'); return; }
  if (!state.name.trim() || !state.line.trim()) { postStatus('Give your dog a name and a line first (step 2).'); return; }
  if (!state.photo?.file) { postStatus('Add a photo first (step 1).'); return; }
  await idbSet('photo', state.photo.file); saveDraftNow();
  postStatus('Sending…');
  try {
    const j = await sendLink(email);
    post.email = email;
    postStatus('');
    showWaiting(email, j.dev_link, j.dev_code);
    startPolling();
  } catch (e) {
    postStatus(/minute|plenty|too many/.test(e.message) ? e.message : `Couldn’t send the link (${e.message}). Try again in a minute.`);
    if (!/minute|plenty|too many/.test(e.message)) report(`sign-in link: ${e.message}`, 'post');
  }
});
$('#wait-resend').addEventListener('click', async () => {
  const email = post.email || $('#post-email').value.trim();
  const st = $('#wait-status');
  st.textContent = 'Sending again…';
  try {
    const j = await sendLink(email, { resend: true });
    st.textContent = j.dev_link ? '' : 'Sent again. The newest link and code are the ones that work.';
    if (j.dev_link) st.innerHTML = `Test site: <a class="dev-link" href="${j.dev_link}" target="_blank" rel="noopener">Open the new sign-in link</a>.${j.dev_code ? ` Or type ${j.dev_code}.` : ''}`;
    $('#wait-code').value = ''; $('#wait-code-status').textContent = '';
    armResend();
    startPolling();
  } catch (e) {
    st.textContent = /minute|plenty|too many/.test(e.message) ? e.message : `Couldn’t send it again (${e.message}).`;
    armResend(30);
  }
});
$('#wait-change').addEventListener('click', () => {
  clearInterval(resendTimer);
  $('#post-wait').hidden = true;
  $('#post-signin').hidden = false;
  $('#post-email').focus({ preventScroll: true });
});

// The button only works when it can: the two required boxes enable it, and the line under it says
// why when it is off. While it works, the button itself says so, since the line under it may be
// below the edge of a phone screen.
function readyToPost() {
  const status = $('#post-form-status'), btn = $('#post-submit');
  const boxes = $('#post-attest').checked && $('#post-show').checked;
  const parts = state.photo?.file && state.name.trim() && state.line.trim() && state.bg;
  btn.disabled = !(boxes && parts);
  status.textContent = !boxes ? 'Tick the first two boxes to post.' : !parts ? 'A photo, a name, a line and a background are all needed.' : '';
}
for (const id of ['#post-attest', '#post-show']) $(id).addEventListener('change', readyToPost);
$('#post-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const status = $('#post-form-status');
  readyToPost();
  if ($('#post-submit').disabled) { status.scrollIntoView({ block: 'nearest' }); return; }
  const btn = $('#post-submit'); btn.disabled = true; btn.textContent = 'Making the page…'; status.textContent = 'Drawing the three sizes; a few seconds on a phone.';
  try {
    const [story, feed, card] = await Promise.all([makeFile('story'), makeFile('feed'), makeFile('card')]);
    const fd = new FormData();
    fd.set('dog_name', state.name.trim()); fd.set('line', state.line.trim());
    fd.set('mode', state.mode === 'inMemory' ? 'in_memory' : 'for');
    fd.set('background_id', state.bg.id);
    fd.set('attest', 'on'); fd.set('newsletter', $('#post-news').checked ? 'on' : 'off');
    fd.set('original', state.photo.file, state.photo.file.name || 'original.jpg');
    fd.set('story', story); fd.set('feed', feed); fd.set('card', card);
    btn.textContent = 'Posting…'; status.textContent = '';
    const r = await fetch('/api/post', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { status.textContent = 'Your sign-in expired. Ask for a new link.'; $('#post-form').hidden = true; $('#post-wait').hidden = true; $('#post-signin').hidden = false; return; }
    if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
    track('posted', { newsletter: $('#post-news').checked });
    $('#post-form').hidden = true;
    $('#done-dog').textContent = state.name.trim();
    $('#done-email').textContent = post.email;
    const a = $('#done-url'); a.href = j.url; a.textContent = j.url.replace(/^https?:\/\//, '');
    $('#post-done').hidden = false;
    showHomeKeep();
    shareLivePage(j.url);
    watchForLive(j.id);
    $('#post-done').scrollIntoView({ behavior: 'smooth', block: 'start' });
    clearDraft();
  } catch (e) {
    status.textContent = `Couldn’t post (${e.message}). Nothing was saved; try again.`;
    status.scrollIntoView({ block: 'nearest' });
    report(`post: ${e.message}`, 'post');
  } finally { btn.textContent = 'Post it'; readyToPost(); }
});
$('#done-again').addEventListener('click', () => { location.href = '/'; });

// ---------- keep the wall on your phone ----------
// Shown once, after posting, on phones only, and never inside the home-screen app itself. Android Chrome
// hands the page an install prompt (held back until now, so it never interrupts the making); iPhone has
// none, in Safari or Chrome, so it gets the two steps instead.
const phone = (() => {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod/.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return '';
})();
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  if (!$('#home-keep').hidden) $('#home-install').hidden = false;
});
window.addEventListener('appinstalled', () => {
  track('homescreen_installed');
  $('#home-install').hidden = true;
  $('#home-steps').textContent = 'Added. Look for Jetson on your home screen.';
});
const HOME_STEPS = {
  ios: 'Tap Share, then Add to Home Screen.',
  android: 'Tap ⋮, then Add to Home screen.',
};
function showHomeKeep() {
  if (!phone || fromHomeScreen()) return;
  $('#home-keep').hidden = false;
  if (phone === 'android' && installPrompt) {
    $('#home-install').hidden = false;
    $('#home-steps').textContent = '';
  } else {
    $('#home-steps').textContent = HOME_STEPS[phone];
  }
  track('homescreen_shown', { how: phone === 'android' && installPrompt ? 'button' : 'steps', phone });
}
$('#home-install').addEventListener('click', async () => {
  if (!installPrompt) { $('#home-install').hidden = true; $('#home-steps').textContent = HOME_STEPS.android; return; }
  const ev = installPrompt;
  installPrompt = null;
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    track('homescreen_prompt', { outcome });
    $('#home-install').hidden = true;
    $('#home-steps').textContent = outcome === 'accepted' ? 'Added. Look for Jetson on your home screen.' : `Any time: ${HOME_STEPS.android.charAt(0).toLowerCase()}${HOME_STEPS.android.slice(1)}`;
  } catch {
    $('#home-install').hidden = true;
    $('#home-steps').textContent = HOME_STEPS.android;
  }
});
// The screener usually answers within seconds. For half a minute after the post, ask whether the page went
// live, and if so say so instead of "in the queue".
function watchForLive(id) {
  const until = Date.now() + 30 * 1000;
  const tick = async () => {
    if (Date.now() > until) return;
    try {
      const r = await fetch('/api/mine', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      const e = j?.entries?.find((x) => x.id === id);
      if (e?.status === 'live') {
        $('#done-state').textContent = 'is on the wall.';
        $('#done-note').textContent = 'The page is live now. Share it with the buttons below, or invite friends by email from the page itself.';
        $('#done-will').textContent = 'The page is';
        track('posted_live');
        return;
      }
      if (e && e.status !== 'pending') return;
    } catch { /* try again */ }
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 2500);
}

async function initPost() {
  post.config = await fetchConfig();
  const cta = $('#post-cta');
  if (!post.config?.posting) { cta.hidden = true; showShareRow(); return; }
  cta.hidden = false;
  $('#post-cta-dog').textContent = state.name.trim() || 'my dog';
  if (post.config.signed_in) showSignedIn(post.config.signed_in);
  if (!$('#post-flow').hidden) cta.hidden = true;
  if (location.hash === '#step-share' || location.hash === '#step-post') setTimeout(() => settle($('#step-share')), 300);
}
for (const id of ['#name', '#line']) $(id).addEventListener('input', saveDraft);
$('#post-email').addEventListener('focus', () => trackOnce('post_started', { via: 'email' }));
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', saveDraft));
$('#zoom').addEventListener('change', saveDraft);
preview.addEventListener('pointerup', saveDraft);

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

// ---------- tell friends about the wall ----------
// Nothing leaves this page: the button opens the reader's own mail app with the addresses filled in.
const WALL_LINK = () => `${location.origin}/?utm_source=tell&utm_medium=email&utm_campaign=ops-57`;
const TELL_SUBJECT = 'Every dog deserves a dedication';
const TELL_BODY = () => `I made a dedication page for my dog here, and thought of yours. It takes about a minute, on your phone:\n\n${WALL_LINK()}\n\nIt comes from the novel Jetson’s Journey by Brock Alston.`;
$('#tell-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const status = $('#tell-status');
  const raw = $('#tell-emails').value;
  const all = [...new Set(raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
  const good = all.filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  if (!good.length) { status.textContent = 'An email address or two first.'; $('#tell-emails').focus(); return; }
  if (good.length > 5) { status.textContent = 'Five at a time, please; send the rest in a second note.'; return; }
  status.textContent = all.length > good.length ? `Skipped ${all.length - good.length} that didn’t look like an address.` : '';
  location.href = `mailto:${encodeURIComponent(good.join(','))}?subject=${encodeURIComponent(TELL_SUBJECT)}&body=${encodeURIComponent(TELL_BODY())}`;
  track('tell_friends', { count: good.length });
});
$('#tell-share').addEventListener('click', async () => {
  const data = { title: TELL_SUBJECT, text: 'Make a dedication page for your dog, in about a minute.', url: `${location.origin}/?utm_source=tell&utm_medium=share&utm_campaign=ops-57` };
  if (navigator.share) { try { await navigator.share(data); track('tell_friends', { via: 'sheet' }); } catch { /* closed */ } return; }
  try { await navigator.clipboard.writeText(data.url); $('#tell-status').textContent = 'Link copied; paste it anywhere.'; } catch { $('#tell-status').textContent = data.url; }
});
$('#tell-copy').addEventListener('click', async () => {
  const url = `${location.origin}/?utm_source=tell&utm_medium=copy&utm_campaign=ops-57`;
  try { await navigator.clipboard.writeText(url); $('#tell-status').textContent = 'Link copied.'; track('tell_friends', { via: 'copy' }); } catch { $('#tell-status').textContent = url; }
});

// ---------- the page reports its own errors ----------
// A JavaScript error or a dead call goes to /api/log with the step it happened on and nothing else;
// five per page load at most. The server keeps the browser family, not the address.
let reported = 0;
function report(detail, step) {
  if (reported >= 5) return;
  reported++;
  try {
    const live = $('#step-live')?.textContent || '';
    const body = JSON.stringify({ detail: String(detail).slice(0, 240), step: step || live.replace(/^Step \d+ of \d+: /, '').slice(0, 40) });
    if (!navigator.sendBeacon?.('/api/log', new Blob([body], { type: 'application/json' }))) fetch('/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* nothing to do */ }
}
// Only errors from the wall's own scripts. A browser blanks an error from anyone else's script to
// “Script error.” with no file or line (Firefox on iPhone adds its own scripts to every page; Google's
// tag is another): nothing we can act on, and it set off a false alert on 11/11.
const ours = (file) => { try { return !!file && new URL(file, location.href).origin === location.origin; } catch { return false; } };
window.addEventListener('error', (e) => { if (ours(e.filename)) report(`${e.message} @ ${String(e.filename).split('/').pop()}:${e.lineno}`); });
window.addEventListener('unhandledrejection', (e) => report(`unhandled: ${e.reason?.message || e.reason}`));

// ---------- now on the wall ----------
// The latest six dogs under Jetson's card, so a visitor sees the wall is alive before the steps.
async function showRecent() {
  try {
    const r = await fetch('/api/recent');
    const j = r.ok ? await r.json() : null;
    const entries = j?.entries || [];
    if (entries.length < 2) return;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    $('#recent-grid').innerHTML = entries.map((e) => `<a href="/d/${esc(e.id)}"><img src="/p/${esc(e.id)}/card.jpg${e.v ? `?v=${esc(e.v)}` : ''}" alt="${esc(e.dog_name)}’s dedication" loading="lazy" width="300" height="300" /><span>${esc(e.dog_name)}<small>♥ ${Number(e.hearts) || 0}</small></span></a>`).join('');
    $('#recent').hidden = false;
  } catch { /* the strip is a bonus */ }
}
showRecent();

// ---------- boot ----------
async function boot() {
  $('#start').addEventListener('click', () => track('maker_start_tapped'));
  trackOnce('maker_open', { posting: 'unknown' });
  const r = await fetch('/backgrounds/backgrounds.json');
  state.manifest = await r.json();
  await ensureFonts();
  renderTabs(); renderGrid();
  const def = state.manifest.backgrounds.find((e) => e.default) || state.manifest.backgrounds[0];
  await selectBackground(def);
  if (!visibleEntries('today').length) { state.group = 'always'; renderTabs(); renderGrid(); }
  if (FIX) await loadFix(FIX); else await restoreDraft();
  renderTabs(); renderGrid();
  draw();
  window.addEventListener('resize', draw);
  document.fonts?.ready?.then(draw);
  if (!FIX) initPost();
}

// ---------- fix mode (admin) ----------
// Loads the post's own photo, words and background, ticks the cutout (untick for a book-page post), and
// swaps Step 4 for one button that replaces the three pictures. The words fields are locked: changing what
// an owner wrote is not a layout fix.
async function loadFix(id) {
  const panel = $('#fix-panel'), st = $('#fix-status'), go = $('#fix-go');
  $('#post-cta').hidden = true; $('#post-flow').hidden = true; panel.hidden = false;
  try {
    const r = await fetch(`/api/admin/entry/${id}`, { cache: 'no-store' });
    if (r.status === 401) { st.textContent = 'Open /admin in this browser first (the admin cookie lives there), then come back.'; return; }
    const j = await r.json();
    if (!r.ok || !j.ok) { st.textContent = `Couldn’t load that post (${j.error || r.status}).`; return; }
    const e = j.entry;
    $('#fix-dog').textContent = e.dog_name;
    state.name = e.dog_name; state.line = e.line; state.mode = e.mode === 'in_memory' ? 'inMemory' : 'for';
    $('#name').value = e.dog_name; $('#line').value = e.line; $('#count').textContent = `${e.line.length} / 120`;
    $('#name').readOnly = true; $('#line').readOnly = true;
    document.querySelectorAll('input[name="mode"]').forEach((el) => { el.checked = el.value === state.mode; el.disabled = true; });
    const bg = state.manifest.backgrounds.find((b) => b.id === e.background_id);
    if (bg) { state.bgChosen = true; await selectBackground(bg); }
    const pr = await fetch(`/api/admin/entry/${id}/original`, { cache: 'no-store' });
    if (!pr.ok) { st.textContent = `The original photo didn’t load (${pr.status}).`; return; }
    const blob = await pr.blob();
    const file = new File([blob], 'original.jpg', { type: blob.type || 'image/jpeg' });
    const img = await loadImage(URL.createObjectURL(file));
    state.photo = { img, file, view: { scale: 1, dx: 0, dy: 0 } };
    $('#photo-label').textContent = 'Change photo';
    $('#cutout-on').checked = true;
    updateHint(); draw();
    st.textContent = 'Cutting the dog out…';
    await requestCutout();
    st.textContent = state.cutout?.status === 'ok' ? 'Ready. Move things in the preview, then replace the pictures.' : 'The cutout didn’t work; untick the box to fix it as a book page.';
    go.disabled = false;
    window.__fix = { state, draw }; // for exact nudges from the console
  } catch (err) {
    st.textContent = `Couldn’t load that post (${err.message}).`;
  }
}
$('#fix-go').addEventListener('click', async () => {
  const st = $('#fix-status'), go = $('#fix-go');
  go.disabled = true; go.textContent = 'Drawing…'; st.textContent = '';
  try {
    const [story, feed, card] = await Promise.all([makeFile('story'), makeFile('feed'), makeFile('card')]);
    const fd = new FormData(); fd.set('story', story); fd.set('feed', feed); fd.set('card', card);
    go.textContent = 'Replacing…';
    const r = await fetch(`/api/admin/entry/${FIX}/pictures`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
    st.innerHTML = '';
    st.append('Replaced. ', Object.assign(document.createElement('a'), { href: `/d/${FIX}`, textContent: 'See the page' }), '.');
  } catch (err) {
    st.textContent = `Couldn’t replace the pictures (${err.message}). The old ones are still up.`;
  } finally { go.disabled = false; go.textContent = 'Replace the pictures'; }
});
boot();
