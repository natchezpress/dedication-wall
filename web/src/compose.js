// Composes the dedication page on a canvas at the 9:16 master size and cuts the three outputs.

export const MASTER = { w: 1648, h: 2944 };
export const CUTS = {
  story: { w: 1648, h: 2944, y: 0, label: 'Story 9:16' },
  feed: { w: 1648, h: 2060, y: 442, label: 'Feed 4:5' },
  card: { w: 1648, h: 1648, y: 648, label: 'Card 1:1' },
};

const BOOK = { w: 1400, h: 1000 };
BOOK.x = (MASTER.w - BOOK.w) / 2;
BOOK.y = (MASTER.h - BOOK.h) / 2;
BOOK.gutter = MASTER.w / 2;
const INSET = 64;
const PAGE_W = BOOK.w / 2;
const PHOTO = { x: BOOK.x + INSET, w: PAGE_W - INSET * 2 };
PHOTO.h = Math.round(PHOTO.w * 1.25); // 4:5 portrait
PHOTO.y = BOOK.y + (BOOK.h - PHOTO.h) / 2;
const TEXT = { x: BOOK.gutter + INSET + 8, w: PAGE_W - INSET * 2 - 8 };

const PAPER = '#f7f1e6';
const INK = '#2b2622';
const QUIET = '#6b625a';
const SERIF = '"EB Garamond", Garamond, Georgia, "Times New Roman", serif';

export const FOOTER_LINE = 'Every dog deserves a dedication';
export const SITE = 'dedication.jetsonsjourney.com';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxWidth || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Fit a block of text: shrink the font until it wraps to maxLines or fewer.
function fitLines(ctx, text, maxWidth, maxLines, startSize, minSize, weight = 400, style = 'normal') {
  let size = startSize;
  let lines;
  for (;;) {
    ctx.font = `${style} ${weight} ${size}px ${SERIF}`;
    lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines || size <= minSize) break;
    size -= 2;
  }
  return { size, lines };
}

// On the book page the photo can't be slid out of its frame (11/13): it always covers the frame, or, made
// smaller than the frame, stays wholly inside it. Returns the view with dx/dy held to that.
export function bookPhotoView(photo) {
  const img = photo?.img, view = photo?.view || {};
  if (!img) return view;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const cover = Math.max(PHOTO.w / iw, PHOTO.h / ih) * (view.scale || 1);
  const mx = Math.abs(iw * cover - PHOTO.w) / 2, my = Math.abs(ih * cover - PHOTO.h) / 2;
  const hold = (v, m) => Math.min(m, Math.max(-m, v || 0));
  return { ...view, dx: hold(view.dx, mx), dy: hold(view.dy, my) };
}

function drawCover(ctx, img, x, y, w, h, view) {
  // view: {scale, dx, dy} relative to a cover-fit; scale 1 = cover fit, dx/dy in canvas px
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const cover = Math.max(w / iw, h / ih) * (view?.scale || 1);
  const dw = iw * cover, dh = ih * cover;
  const cx = x + w / 2 + (view?.dx || 0), cy = y + h / 2 + (view?.dy || 0);
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
}

function drawBackground(ctx, bg, img) {
  if (bg.tile) {
    const scale = 0.5;
    const t = document.createElement('canvas');
    t.width = Math.round(img.width * scale); t.height = Math.round(img.height * scale);
    t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
    ctx.fillStyle = ctx.createPattern(t, 'repeat');
    ctx.fillRect(0, 0, MASTER.w, MASTER.h);
  } else {
    drawCover(ctx, img, 0, 0, MASTER.w, MASTER.h);
  }
}

// The footer sits on a small paper plate, like the words panel on a Spot, so it reads the same on
// leaves, sky or a sidewalk. Nothing else is drawn in its band.
const FOOTER = { h: 200, pad: 80, line: 64, site: 44 };

// The plate as drawn: centered, as wide as its two lines need.
function plateBox(ctx, top) {
  ctx.font = `italic 600 ${FOOTER.line}px ${SERIF}`;
  const lineW = ctx.measureText(FOOTER_LINE).width;
  ctx.font = `500 ${FOOTER.site}px ${SERIF}`;
  const siteW = ctx.measureText(SITE).width;
  const w = Math.min(MASTER.w - 160, Math.max(lineW, siteW) + FOOTER.pad * 2);
  return { x: (MASTER.w - w) / 2, y: top, w, h: FOOTER.h };
}

function drawFooter(ctx, top) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const { w } = plateBox(ctx, top);
  ctx.save();
  ctx.fillStyle = 'rgba(247,241,230,0.86)';
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 10;
  roundRect(ctx, (MASTER.w - w) / 2, top, w, FOOTER.h, 24); ctx.fill();
  ctx.restore();
  ctx.fillStyle = INK;
  ctx.font = `italic 600 ${FOOTER.line}px ${SERIF}`;
  ctx.fillText(FOOTER_LINE, MASTER.w / 2, top + 90);
  ctx.fillStyle = QUIET;
  ctx.font = `500 ${FOOTER.site}px ${SERIF}`;
  ctx.fillText(SITE, MASTER.w / 2, top + 156);
}

// k: type scale. The book page uses 1; the words panel on a Spot uses SCENE.type, so the dog gets more of
// the square card (11/13: Brock found the dog's space narrow between the words and the plate).
// kName: the name's own scale (11/13: the name stays full size on a Spot; only the line and labels shrink).
function measureTextBlock(ctx, d, w, k = 1, kName = k) {
  const modeLabel = d.mode === 'inMemory' ? 'IN MEMORY OF' : 'TO';
  const name = (d.name || 'Your dog').trim();
  const line = (d.line || '').trim();
  const nameFit = fitLines(ctx, name, w, 2, Math.round(112 * kName), Math.round(64 * kName), 600);
  // A short line earns a bigger size; a long one shrinks until it fits in five rows.
  const lineFit = line ? fitLines(ctx, line, w, 5, Math.round(80 * k), Math.round(44 * k), 400, 'italic') : { size: Math.round(80 * k), lines: [] };
  const labelSize = Math.round(40 * k), gap1 = Math.round(24 * k), gap2 = Math.round(36 * k);
  const nameLH = Math.round(nameFit.size * 1.1), lineLH = Math.round(lineFit.size * 1.32);
  const total = labelSize + gap1 + nameFit.lines.length * nameLH + (lineFit.lines.length ? gap2 + lineFit.lines.length * lineLH : 0);
  return { modeLabel, nameFit, lineFit, labelSize, gap1, gap2, nameLH, lineLH, total };
}

function drawTextBlock(ctx, d, x, w, centerY, align = 'left', ink = INK, quiet = QUIET, k = 1, kName = k) {
  const { modeLabel, nameFit, lineFit, labelSize, gap1, gap2, nameLH, lineLH, total } = measureTextBlock(ctx, d, w, k, kName);
  let y = centerY - total / 2;
  const ax = align === 'center' ? x + w / 2 : x;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = quiet;
  ctx.font = `500 ${labelSize}px ${SERIF}`;
  // letter-spaced small caps by hand
  const spaced = modeLabel.split('').join(' ');
  ctx.fillText(spaced, ax, y + labelSize);
  y += labelSize + gap1;
  ctx.fillStyle = ink;
  ctx.font = `600 ${nameFit.size}px ${SERIF}`;
  for (const l of nameFit.lines) { y += nameLH; ctx.fillText(l, ax, y - nameLH * 0.22); }
  if (lineFit.lines.length) {
    y += gap2;
    ctx.font = `italic 400 ${lineFit.size}px ${SERIF}`;
    for (const l of lineFit.lines) { y += lineLH; ctx.fillText(l, ax, y - lineLH * 0.3); }
  }
}

function drawBook(ctx, d, photo) {
  // shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.38)';
  ctx.shadowBlur = 60; ctx.shadowOffsetY = 24;
  ctx.fillStyle = PAPER;
  roundRect(ctx, BOOK.x, BOOK.y, BOOK.w, BOOK.h, 10);
  ctx.fill();
  ctx.restore();
  // paper with a soft gutter
  ctx.save();
  roundRect(ctx, BOOK.x, BOOK.y, BOOK.w, BOOK.h, 10);
  ctx.clip();
  ctx.fillStyle = PAPER;
  ctx.fillRect(BOOK.x, BOOK.y, BOOK.w, BOOK.h);
  const g = ctx.createLinearGradient(BOOK.gutter - 90, 0, BOOK.gutter + 90, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.13)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(BOOK.gutter - 90, BOOK.y, 180, BOOK.h);
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(BOOK.gutter, BOOK.y); ctx.lineTo(BOOK.gutter, BOOK.y + BOOK.h); ctx.stroke();
  ctx.restore();
  // photo
  ctx.save();
  roundRect(ctx, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, 14);
  ctx.clip();
  if (photo?.img) drawCover(ctx, photo.img, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, bookPhotoView(photo));
  else {
    ctx.fillStyle = '#e9e1d2'; ctx.fillRect(PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
    ctx.fillStyle = QUIET; ctx.font = `italic 400 40px ${SERIF}`; ctx.textAlign = 'center';
    ctx.fillText('your dog’s photo', PHOTO.x + PHOTO.w / 2, PHOTO.y + PHOTO.h / 2);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 2;
  roundRect(ctx, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, 14); ctx.stroke();
  // words
  drawTextBlock(ctx, d, TEXT.x, TEXT.w, BOOK.y + BOOK.h / 2);
}

// ---- the scene layout: the cut-out dog standing on the background, words on a panel above, the footer plate below.
// The panel and the plate can each be moved up or down by the reader (d.layout.panelDy / footerDy); the order
// never flips: the panel stays above the plate, and the dog's feet stay between them.
const SCENE = {
  panel: { x: 164, y: 700, w: MASTER.w - 328, pad: 44, minH: 300 }, // top sits inside the 1:1 card (starts 648); height follows the words
  type: 0.86,                                            // the words a little smaller than on the book page (11/13)
  dogMaxW: 1240,                                         // a wide (standing) dog at scale 1: up to three-quarters of the card's width (was 900)
  footerTop: 2080,                                       // plate 2080–2280: inside the 1:1 card (ends 2296), so every cut carries it
  // The panel and the plate drag only within the square card (y 648–2296), so the words and the address
  // always show on the wall and in every link preview (11/11: Lola's card lost “To Lola” and the plate).
  topMin: CUTS.card.y + 24, bottomMax: CUTS.card.y + CUTS.card.h - 16, dogGap: 20, roomMin: 240,
  hiddenMax: 0.3, // a posted card is tidied if more than this share of the dog is hidden (tidyScene, 11/14):
                  // a tail tucked under the words is well under it; his whole head plus some body is over it
};

// Everything the scene needs, in master pixels: where the panel, the plate and the dog are.
// 11/14 (Brock): “as long as things don't go out of the viewing area the user can move it.” The words panel,
// the plate and the dog each move on their own, anywhere on the square card (the part the wall shows), and
// nothing pushes anything else. The panel and the plate are drawn over the dog, so the words always stay
// readable. If the result looks wrong (the dog mostly hidden, or the panel and the plate on top of each
// other or out of order), tidyScene() below puts it right when the card is posted, so no post looks bad.
export function sceneGeometry(ctx, d, sticker) {
  const lay = d.layout || {};
  const hold = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const panelH = Math.max(SCENE.panel.minH, measureTextBlock(ctx, d, SCENE.panel.w - 120, SCENE.type, 1).total + SCENE.panel.pad * 2);
  const panelY = hold(SCENE.panel.y + (lay.panelDy || 0), SCENE.topMin, SCENE.bottomMax - panelH);
  const footerY = hold(SCENE.footerTop + (lay.footerDy || 0), SCENE.topMin, SCENE.bottomMax - FOOTER.h);
  const footer = { x: 0, y: footerY, w: MASTER.w, h: FOOTER.h };
  const floor = SCENE.footerTop - SCENE.dogGap; // where his feet start: just above the plate's own place
  let dog = null;
  if (sticker?.img) {
    const img = sticker.img;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    // At scale 1 the dog fits the room between the panel's and the plate's own places, whatever his shape;
    // moving the panel or the plate never resizes or drags him.
    const room = Math.max(SCENE.roomMin, floor - (SCENE.panel.y + panelH) - 40);
    const fitW = Math.min(SCENE.dogMaxW, room * iw / ih);
    const w = fitW * (sticker.view?.scale || 1);
    const h = w * ih / iw;
    // He can't be slid off the card (11/13): his middle stays on the square card, at least a quarter of his
    // size in from its edges (a small dog stays mostly in view; a big one can't wander off).
    const card = CUTS.card;
    const inX = Math.min(w, card.w) / 4, inY = Math.min(h, card.h) / 4;
    const cx = hold(MASTER.w / 2 + (sticker.view?.dx || 0), inX, MASTER.w - inX);
    const midY = hold(floor + (sticker.view?.dy || 0) - h / 2, card.y + inY, card.y + card.h - inY);
    dog = { x: cx - w / 2, y: midY - h / 2, w, h, img };
  }
  const panel = { x: SCENE.panel.x, y: panelY, w: SCENE.panel.w, h: panelH };
  // dogDx, dogDy, panelDy and footerDy: the offsets that match what is drawn, so the maker keeps its saved
  // layout honest (a drag past an edge doesn't build up a hidden offset; 11/13).
  const dogDx = dog ? dog.x + dog.w / 2 - MASTER.w / 2 : 0;
  const dogDy = dog ? dog.y + dog.h - floor : 0;
  return { panel, footer, plate: plateBox(ctx, footerY), dog, dogDx, dogDy, panelDy: panelY - SCENE.panel.y, footerDy: footerY - SCENE.footerTop };
}

// How much of the dog can't be seen: measured on his own pixels (a coarse grid of the cut-out), not his box,
// so a tail tucked under the words counts for little and his head counts for a lot. Hidden means behind the
// words panel or the plate, or off the square card.
const alphaGrids = new WeakMap();
function dogMask(img) {
  if (alphaGrids.has(img)) return alphaGrids.get(img);
  let grid = null;
  try {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const gw = 48, gh = Math.max(8, Math.min(96, Math.round(48 * ih / iw)));
    const c = document.createElement('canvas'); c.width = gw; c.height = gh;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, gw, gh);
    const a = x.getImageData(0, 0, gw, gh).data;
    grid = { gw, gh, on: [] };
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (a[(j * gw + i) * 4 + 3] > 128) grid.on.push([(i + 0.5) / gw, (j + 0.5) / gh]);
  } catch { grid = null; }
  alphaGrids.set(img, grid);
  return grid;
}
function hiddenShare(g) {
  const { dog, panel, plate } = g, card = { x: 0, y: CUTS.card.y, w: CUTS.card.w, h: CUTS.card.h };
  const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const covered = (x, y) => inside(panel, x, y) || inside(plate, x, y) || !inside(card, x, y);
  const mask = dogMask(dog.img);
  const pts = mask?.on?.length ? mask.on : Array.from({ length: 400 }, (_, k) => [((k % 20) + 0.5) / 20, (Math.floor(k / 20) + 0.5) / 20]);
  let hid = 0;
  for (const [u, v] of pts) if (covered(dog.x + u * dog.w, dog.y + v * dog.h)) hid++;
  return hid / pts.length;
}

export const dogHiddenShare = (ctx, d, sticker) => { const g = sceneGeometry(ctx, d, sticker); return g.dog ? hiddenShare(g) : 0; };

// What a posted card must not be (11/14): 'order' (the words below the plate), 'overlap' (the words and the
// plate on top of each other) or 'dog' (more than SCENE.hiddenMax of the dog hidden).
export function sceneProblems(ctx, d, sticker) {
  const g = sceneGeometry(ctx, d, sticker);
  const out = [];
  if (g.panel.y >= g.plate.y) out.push('order');
  else if (g.panel.y + g.panel.h > g.plate.y) out.push('overlap');
  if (g.dog && hiddenShare(g) > SCENE.hiddenMax) out.push('dog');
  return out;
}

// The cleanup before posting: the gentlest change that puts the card right, or null if nothing is wrong.
// 1. The plate back to its place at the foot; if the words still sit on it or below it, the words back too.
// 2. The dog back to his starting spot; then, if he's still hidden, the words and the plate to theirs; then,
//    if he's still too big to show, a little smaller each step until he shows (never below his starting size).
export function tidyScene(ctx, d, sticker) {
  const problems = sceneProblems(ctx, d, sticker);
  if (!problems.length) return null;
  const layout = { panelDy: 0, footerDy: 0, ...(d.layout || {}) };
  const view = { scale: 1, dx: 0, dy: 0, ...(sticker?.view || {}) };
  const left = () => sceneProblems(ctx, { ...d, layout }, sticker && { ...sticker, view });
  let now = problems;
  if (now.includes('order') || now.includes('overlap')) { layout.footerDy = 0; now = left(); }
  if (now.includes('order') || now.includes('overlap')) { layout.panelDy = 0; now = left(); }
  if (now.includes('dog')) { view.dx = 0; view.dy = 0; now = left(); }
  if (now.includes('dog')) { layout.panelDy = 0; layout.footerDy = 0; now = left(); }
  for (let i = 0; i < 20 && now.includes('dog') && view.scale > 1; i++) { view.scale = Math.max(1, view.scale * 0.9); now = left(); }
  return { problems, layout, view, left: now };
}

// Which part of the scene is under a master-pixel point: 'panel', 'footer', 'dog' or null.
export function sceneHit(canvas, d, sticker, x, y) {
  const g = sceneGeometry(canvas.getContext('2d'), d, sticker);
  const inside = (r) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inside(g.panel)) return 'panel';
  if (inside(g.plate)) return 'footer';
  if (inside(g.dog)) return 'dog';
  return null;
}

function drawScene(ctx, d, sticker) {
  const g = sceneGeometry(ctx, d, sticker);
  if (g.dog) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    ctx.drawImage(g.dog.img, g.dog.x, g.dog.y, g.dog.w, g.dog.h);
    ctx.restore();
  }
  const panel = g.panel;
  ctx.save();
  ctx.fillStyle = 'rgba(247,241,230,0.82)';
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 10;
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 18); ctx.fill();
  ctx.restore();
  drawTextBlock(ctx, d, panel.x + 60, panel.w - 120, panel.y + panel.h / 2, 'center', INK, QUIET, SCENE.type, 1);
  drawFooter(ctx, g.footer.y);
}

/**
 * Render the master.
 * @param {HTMLCanvasElement} canvas  sized MASTER.w × MASTER.h
 * @param {object} d  {mode, name, line, layout?: {panelDy, footerDy}}
 * @param {object} bg  manifest entry
 * @param {HTMLImageElement} bgImg
 * @param {object} photo  {img, view} for the book page, or {img, view, sticker: true} for the scene (a cut-out dog)
 */
export function render(canvas, d, bg, bgImg, photo) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, MASTER.w, MASTER.h);
  if (bgImg) drawBackground(ctx, bg, bgImg);
  else { ctx.fillStyle = PAPER; ctx.fillRect(0, 0, MASTER.w, MASTER.h); }
  if (photo?.sticker) {
    drawScene(ctx, d, photo);
  } else {
    drawBook(ctx, d, photo);
    drawFooter(ctx, BOOK.y + BOOK.h + 60);
  }
}

export function cut(master, which, type = 'image/jpeg', quality = 0.92) {
  const c = CUTS[which];
  const out = document.createElement('canvas');
  out.width = c.w; out.height = c.h;
  out.getContext('2d').drawImage(master, 0, c.y, c.w, c.h, 0, 0, c.w, c.h);
  return new Promise((res) => out.toBlob(res, type, quality));
}

export async function ensureFonts() {
  if (!document.fonts?.load) return;
  await Promise.all([
    document.fonts.load(`600 100px ${SERIF}`),
    document.fonts.load(`italic 400 54px ${SERIF}`),
    document.fonts.load(`500 34px ${SERIF}`),
  ]).catch(() => {});
}
