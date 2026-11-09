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
  cutout: null,      // {img, file, status:'working'|'ok'|'failed'} — the dog with no background, for Jetson's Spots
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

// For a Spots background, the cutout (if on and ready) stands in for the photo; the drag/zoom view is shared.
function photoForRender() {
  if (state.bg?.sticker && cutoutOn() && state.cutout?.status === 'ok' && state.cutout.file === state.photo?.file) {
    return { img: state.cutout.img, view: state.photo.view, file: state.photo.file };
  }
  return state.photo;
}
let raf = 0;
function draw() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    render(master, { mode: state.mode, name: state.name, line: state.line }, state.bg, state.bgImg, photoForRender());
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
    b.addEventListener('click', () => { selectBackground(e); cueAfterBackground(); });
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
  if (e.sticker) requestCutout();
  try { state.bgImg = await loadImage(`/backgrounds/${e.file}`); } catch { state.bgImg = null; }
  if (state.bg === e) draw();
}

// ---------- next-step glow ----------
// When a step is done, the next step's main control pulses once (two beats), then stops. Each cue fires
// once per dedication. The step line is read to screen readers, so the glow is never the only cue.
const STEP_TOTAL = 5;
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
  // The preview is sticky at the top on phones; land the step just under it.
  const wrap = document.querySelector('.preview-wrap');
  const sticky = wrap && getComputedStyle(wrap).position === 'sticky' ? wrap.offsetHeight + 8 : 0;
  el.style.scrollMarginTop = `${sticky}px`;
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
  nudge('background', spotsTab() || $('#grid'), 3, 'Background');
}
function cueAfterBackground() {
  if (!state.photo) return;
  settle($('#step-share'));
  nudge('share', $('#share'), 4, 'Share');
}
// After Share or any Save, posting becomes the main action: Share steps back to a plain button and a
// "Put <Name> on the wall" button appears under it. Only when posting is open.
function promotePost() {
  const sec = $('#step-post');
  if (!sec || sec.hidden) return false;
  const cta = $('#post-cta');
  if (!cta) return false;
  $('#post-cta-dog').textContent = state.name.trim() || 'my dog';
  if (cta.hidden) { cta.hidden = false; $('#share').classList.remove('primary'); track('post_cta_shown'); }
  return true;
}
function cueAfterShare() {
  if (!promotePost()) return;
  settle($('#post-cta'));
  nudge('post', $('#post-cta-btn'), 5, 'Post it to the wall');
}
$('#post-cta-btn').addEventListener('click', () => {
  track('post_cta_tapped');
  const sec = $('#step-post');
  settle(sec);
  const email = $('#post-email');
  if (email && !$('#post-signin').hidden) setTimeout(() => email.focus({ preventScroll: true }), 450);
});

// ---------- cutout (Jetson's Spots) ----------
// The photo is downsized here, sent once to /api/cutout, and the PNG that comes back stands in for the
// photo in the sticker layout. A transparent PNG the reader brought is used as is.
const cutoutOn = () => !!$('#cutout-on')?.checked;
const CUTOUT_HINT = {
  idle: 'Pick a photo and the dog is cut out automatically. If it comes out wrong, untick the box and use a cut-out of your own: on an iPhone, press and hold the dog in Photos, then Copy or Share it as a sticker.',
  working: 'Cutting your dog out of the photo…',
  ok: 'Done. Drag your dog to where he sat; untick the box to use the photo as it was.',
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

async function requestCutout() {
  if (!state.photo?.file || !cutoutOn()) return;
  const file = state.photo.file;
  if (state.cutout && state.cutout.file === file) { cutoutStatus(state.cutout.status === 'ok' ? 'ok' : state.cutout.status === 'own' ? 'own' : state.cutout.status); return; }
  if (file.type === 'image/png' && hasTransparentCorners(state.photo.img)) { state.cutout = { file, status: 'own' }; cutoutStatus('own'); return; }
  state.cutout = { file, status: 'working' };
  cutoutStatus('working');
  try {
    const small = await downsized(file);
    const fd = new FormData(); fd.set('photo', small, 'photo.jpg');
    const r = await fetch('/api/cutout', { method: 'POST', body: fd });
    if (!r.ok) throw new Error(String(r.status));
    const blob = await r.blob();
    if (!blob.type.startsWith('image/png')) throw new Error('not png');
    const img = await loadImage(URL.createObjectURL(blob));
    if (state.photo?.file !== file) return; // the reader changed photos meanwhile
    state.cutout = { img, file, status: 'ok' };
    cutoutStatus('ok');
    track('cutout_ok');
  } catch (e) {
    if (state.photo?.file !== file) return;
    state.cutout = { file, status: 'failed' };
    cutoutStatus('failed');
    track('cutout_failed', { why: e.message });
  }
  draw();
}
$('#cutout-on').addEventListener('change', () => { if (cutoutOn()) requestCutout(); else cutoutStatus('idle'); draw(); });

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
    track('photo_added');
    draw();
    if (state.bg?.sticker) requestCutout();
    cueAfterPhoto(); // also scrolls Words into view, below the sticky preview
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
$('#name').addEventListener('input', (ev) => { state.name = ev.target.value; draw(); cueAfterName(); cueAfterWords(); const d = $('#post-cta-dog'); if (d) d.textContent = state.name.trim() || 'my dog'; });
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
    b.addEventListener('click', () => { $('#line').value = s; state.line = s; $('#count').textContent = `${s.length} / 120`; saveDraft(); draw(); cueAfterWords(); });
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
  render(master, { mode: state.mode, name: state.name, line: state.line }, state.bg, state.bgImg, photoForRender());
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
    try { await navigator.share(data); track('shared', { via: 'sheet' }); cueAfterShare(); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  download(file); track('shared', { via: 'download' });
  cueAfterShare();
});
const FOOTER = () => 'Every dog deserves a dedication.';
for (const which of ['story', 'feed', 'card']) {
  $(`#dl-${which}`).addEventListener('click', async () => { download(await makeFile(which)); track('downloaded', { cut: which }); cueAfterShare(); });
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
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode: state.mode, name: state.name, line: state.line, bg: state.bg?.id, view: state.photo?.view || null, t: Date.now() }));
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
  const bg = d.bg && state.manifest.backgrounds.find((e) => e.id === d.bg);
  if (bg) await selectBackground(bg);
  const file = await idbGet('photo');
  if (file instanceof Blob) {
    try {
      const img = await loadImage(URL.createObjectURL(file));
      state.photo = { img, file, view: d.view || { scale: 1, dx: 0, dy: 0 } };
      $('#zoom').value = String(Math.min(3, Math.max(1, state.photo.view.scale)));
      $('#photo-label').textContent = 'Change photo';
    } catch { /* unreadable */ }
  }
  draw();
  if (state.bg?.sticker && state.photo) requestCutout();
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } idbDel('photo'); }

const post = { config: null, email: '', poll: 0 };
const postStatus = (t, html = false) => { const el = $('#post-status'); if (html) el.innerHTML = t; else el.textContent = t; };

function showSignedIn(email) {
  post.email = email;
  $('#post-signin').hidden = true;
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

$('#post-link').addEventListener('click', async () => {
  const email = $('#post-email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { postStatus('A real email, please; the link goes there.'); return; }
  if (!state.name.trim() || !state.line.trim()) { postStatus('Give your dog a name and a line first (step 2).'); return; }
  if (!state.photo?.file) { postStatus('Add a photo first (step 1).'); return; }
  await idbSet('photo', state.photo.file); saveDraftNow();
  postStatus('Sending…');
  try {
    const r = await fetch('/api/auth/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, next: '/#step-post' }) });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
    track('post_link_sent');
    if (j.dev_link) {
      postStatus(`Test site: no email is sent. <a class="dev-link" href="${j.dev_link}" target="_blank" rel="noopener">Open the sign-in link</a>, then come back here.`, true);
    } else {
      postStatus(`We emailed a sign-in link to ${email}. Tap it on this phone, then come back here; this page will notice.`);
    }
    startPolling();
  } catch (e) {
    postStatus(`Couldn’t send the link (${e.message}). Try again in a minute.`);
  }
});

$('#post-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const status = $('#post-form-status');
  if (!$('#post-attest').checked) { status.textContent = 'The first box is required: 18 or older, and your dog or your permission.'; return; }
  if (!$('#post-show').checked) { status.textContent = 'Tick “Show on the public wall” to post; that is what posting is.'; return; }
  if (!state.photo?.file || !state.name.trim() || !state.line.trim() || !state.bg) { status.textContent = 'A photo, a name, a line and a background are all needed.'; return; }
  const btn = $('#post-submit'); btn.disabled = true; status.textContent = 'Making the page…';
  try {
    const [story, feed, card] = await Promise.all([makeFile('story'), makeFile('feed'), makeFile('card')]);
    const fd = new FormData();
    fd.set('dog_name', state.name.trim()); fd.set('line', state.line.trim());
    fd.set('mode', state.mode === 'inMemory' ? 'in_memory' : 'for');
    fd.set('background_id', state.bg.id);
    fd.set('attest', 'on'); fd.set('newsletter', $('#post-news').checked ? 'on' : 'off');
    fd.set('original', state.photo.file, state.photo.file.name || 'original.jpg');
    fd.set('story', story); fd.set('feed', feed); fd.set('card', card);
    status.textContent = 'Posting…';
    const r = await fetch('/api/post', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { status.textContent = 'Your sign-in expired. Ask for a new link.'; $('#post-form').hidden = true; $('#post-signin').hidden = false; return; }
    if (!r.ok || !j.ok) throw new Error(j.error || String(r.status));
    track('posted', { newsletter: $('#post-news').checked });
    $('#post-form').hidden = true;
    $('#done-dog').textContent = state.name.trim();
    $('#done-email').textContent = post.email;
    const a = $('#done-url'); a.href = j.url; a.textContent = j.url.replace(/^https?:\/\//, '');
    $('#post-done').hidden = false;
    $('#post-done').scrollIntoView({ behavior: 'smooth', block: 'start' });
    clearDraft();
  } catch (e) {
    status.textContent = `Couldn’t post (${e.message}). Nothing was saved; try again.`;
  } finally { btn.disabled = false; }
});
$('#done-again').addEventListener('click', () => { location.href = '/'; });

async function initPost() {
  post.config = await fetchConfig();
  const sec = $('#step-post');
  if (!post.config?.posting) { sec.hidden = true; return; }
  sec.hidden = false;
  if (post.config.signed_in) showSignedIn(post.config.signed_in);
  if (location.hash === '#step-post') setTimeout(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}
for (const id of ['#name', '#line']) $(id).addEventListener('input', saveDraft);
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
  await restoreDraft();
  renderTabs(); renderGrid();
  draw();
  window.addEventListener('resize', draw);
  document.fonts?.ready?.then(draw);
  initPost();
}
boot();
