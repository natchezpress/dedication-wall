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

function drawFooter(ctx, top) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic 600 ${FOOTER.line}px ${SERIF}`;
  const lineW = ctx.measureText(FOOTER_LINE).width;
  ctx.font = `500 ${FOOTER.site}px ${SERIF}`;
  const siteW = ctx.measureText(SITE).width;
  const w = Math.min(MASTER.w - 160, Math.max(lineW, siteW) + FOOTER.pad * 2);
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
function measureTextBlock(ctx, d, w, k = 1) {
  const modeLabel = d.mode === 'inMemory' ? 'IN MEMORY OF' : 'TO';
  const name = (d.name || 'Your dog').trim();
  const line = (d.line || '').trim();
  const nameFit = fitLines(ctx, name, w, 2, Math.round(112 * k), Math.round(64 * k), 600);
  // A short line earns a bigger size; a long one shrinks until it fits in five rows.
  const lineFit = line ? fitLines(ctx, line, w, 5, Math.round(80 * k), Math.round(44 * k), 400, 'italic') : { size: Math.round(80 * k), lines: [] };
  const labelSize = Math.round(40 * k), gap1 = Math.round(24 * k), gap2 = Math.round(36 * k);
  const nameLH = Math.round(nameFit.size * 1.1), lineLH = Math.round(lineFit.size * 1.32);
  const total = labelSize + gap1 + nameFit.lines.length * nameLH + (lineFit.lines.length ? gap2 + lineFit.lines.length * lineLH : 0);
  return { modeLabel, nameFit, lineFit, labelSize, gap1, gap2, nameLH, lineLH, total };
}

function drawTextBlock(ctx, d, x, w, centerY, align = 'left', ink = INK, quiet = QUIET, k = 1) {
  const { modeLabel, nameFit, lineFit, labelSize, gap1, gap2, nameLH, lineLH, total } = measureTextBlock(ctx, d, w, k);
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
  topMin: CUTS.card.y + 24, bottomMax: CUTS.card.y + CUTS.card.h - 16, gap: 480, dogGap: 20, roomMin: 240, // gap: the band kept for the dog between panel and plate
};

// Everything the scene needs, in master pixels: where the panel, the plate and the dog are.
export function sceneGeometry(ctx, d, sticker) {
  const lay = d.layout || {};
  const panelH = Math.max(SCENE.panel.minH, measureTextBlock(ctx, d, SCENE.panel.w - 120, SCENE.type).total + SCENE.panel.pad * 2);
  const panelY = Math.min(Math.max(SCENE.topMin, SCENE.panel.y + (lay.panelDy || 0)), SCENE.bottomMax - FOOTER.h - SCENE.gap - panelH);
  const footerMin = panelY + panelH + SCENE.gap;
  const footerY = Math.min(Math.max(footerMin, SCENE.footerTop + (lay.footerDy || 0)), SCENE.bottomMax - FOOTER.h);
  const footer = { x: 0, y: footerY, w: MASTER.w, h: FOOTER.h };
  let dog = null, dogDy = 0;
  let topY = panelY;
  if (sticker?.img) {
    const img = sticker.img;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const floor = footerY - SCENE.dogGap;
    // At scale 1 the dog fits the room between the panel and the plate, whatever its shape.
    const room = Math.max(SCENE.roomMin, floor - (panelY + panelH) - 40);
    const fitW = Math.min(SCENE.dogMaxW, room * iw / ih);
    const w = fitW * (sticker.view?.scale || 1);
    const h = w * ih / iw;
    // The dog starts with his feet just above the plate and can be moved from there, in both directions;
    // the panel and the plate are drawn over him, so the words always stay readable. He can't be slid off
    // the card (11/13): his middle stays on the square card, at least a quarter of his size in from its edges
    // (a small dog stays mostly in view; a big one can't wander off).
    const card = CUTS.card, hold = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const inX = Math.min(w, card.w) / 4, inY = Math.min(h, card.h) / 4;
    const cx = hold(MASTER.w / 2 + (sticker.view?.dx || 0), inX, MASTER.w - inX);
    const midY = hold(floor + (sticker.view?.dy || 0) - h / 2, card.y + inY, card.y + card.h - inY);
    const bottom = midY + h / 2;
    dog = { x: cx - w / 2, y: bottom - h, w, h, img };
    // …but the words never cover him (Tanner and Lola, 11/11: pinched bigger or dragged up, the dog's head
    // went behind the panel). If he reaches up into it, the panel moves up out of his way, as far as the top
    // of the square card; past that, he stops at the panel and keeps his size (a very big dog runs down
    // behind the plate instead). A dog dragged wholly above the panel, or off to one side of it, is left alone.
    const across = dog.x < SCENE.panel.x + SCENE.panel.w && dog.x + dog.w > SCENE.panel.x;
    if (across && bottom > panelY && dog.y < panelY + panelH + SCENE.dogGap) {
      topY = Math.max(SCENE.topMin, dog.y - SCENE.dogGap - panelH);
      const clear = topY + panelH + SCENE.dogGap;
      if (dog.y < clear) dog = { ...dog, y: clear };
    }
    dogDy = dog.y + dog.h - floor;
  }
  const panel = { x: SCENE.panel.x, y: topY, w: SCENE.panel.w, h: panelH };
  // panelWant: where the reader's drags put the words before the dog moved them; panelDy and footerDy: the
  // offsets that match what is drawn, so the maker can keep its saved layout honest (11/13, below).
  const dogDx = dog ? dog.x + dog.w / 2 - MASTER.w / 2 : 0;
  return { panel, footer, dog, dogDx, dogDy, panelWant: panelY, panelDy: topY - SCENE.panel.y, footerDy: footerY - SCENE.footerTop };
}

// Which part of the scene is under a master-pixel point: 'panel', 'footer', 'dog' or null.
export function sceneHit(canvas, d, sticker, x, y) {
  const g = sceneGeometry(canvas.getContext('2d'), d, sticker);
  const inside = (r) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inside(g.panel)) return 'panel';
  if (inside(g.footer) && x >= (MASTER.w - 1100) / 2 && x <= (MASTER.w + 1100) / 2) return 'footer';
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
  drawTextBlock(ctx, d, panel.x + 60, panel.w - 120, panel.y + panel.h / 2, 'center', INK, QUIET, SCENE.type);
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
