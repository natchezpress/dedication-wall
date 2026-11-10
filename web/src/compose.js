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

function measureTextBlock(ctx, d, w) {
  const modeLabel = d.mode === 'inMemory' ? 'IN MEMORY OF' : 'TO';
  const name = (d.name || 'Your dog').trim();
  const line = (d.line || '').trim();
  const nameFit = fitLines(ctx, name, w, 2, 112, 64, 600);
  // A short line earns a bigger size; a long one shrinks until it fits in five rows.
  const lineFit = line ? fitLines(ctx, line, w, 5, 80, 44, 400, 'italic') : { size: 80, lines: [] };
  const labelSize = 40, gap1 = 24, gap2 = 36;
  const nameLH = Math.round(nameFit.size * 1.1), lineLH = Math.round(lineFit.size * 1.32);
  const total = labelSize + gap1 + nameFit.lines.length * nameLH + (lineFit.lines.length ? gap2 + lineFit.lines.length * lineLH : 0);
  return { modeLabel, nameFit, lineFit, labelSize, gap1, gap2, nameLH, lineLH, total };
}

function drawTextBlock(ctx, d, x, w, centerY, align = 'left', ink = INK, quiet = QUIET) {
  const { modeLabel, nameFit, lineFit, labelSize, gap1, gap2, nameLH, lineLH, total } = measureTextBlock(ctx, d, w);
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
  if (photo?.img) drawCover(ctx, photo.img, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, photo.view);
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

const SPOT_FOOTER_TOP = 2080;          // plate 2080–2280: inside the 1:1 card (ends 2296), so every cut carries it
const SPOT_FLOOR = SPOT_FOOTER_TOP - 20; // lowest the dog's feet can go
const SPOT_PANEL = { x: 164, y: 700, w: MASTER.w - 328, pad: 56 }; // top sits inside the 1:1 card (starts 648); height follows the words

function drawSpot(ctx, d, sticker) {
  // the reader's cut-out dog, placed on the photo; words in the open area above with a soft panel
  const panelH = Math.max(380, measureTextBlock(ctx, d, SPOT_PANEL.w - 120).total + SPOT_PANEL.pad * 2);
  if (sticker?.img) {
    const img = sticker.img;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    // At scale 1 the dog fits the room between the words panel and the footer, whatever its shape.
    const room = SPOT_FLOOR - (SPOT_PANEL.y + panelH) - 40;
    const fitW = Math.min(900, room * iw / ih);
    const baseW = fitW * (sticker.view?.scale || 1);
    const h = baseW * ih / iw;
    const cx = MASTER.w / 2 + (sticker.view?.dx || 0);
    // The dog can be moved up and sideways, never down into the footer's band.
    const bottom = Math.min(SPOT_FLOOR, SPOT_FLOOR + (sticker.view?.dy || 0));
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    ctx.drawImage(img, cx - baseW / 2, bottom - h, baseW, h);
    ctx.restore();
  }
  const panel = { ...SPOT_PANEL, h: panelH };
  ctx.save();
  ctx.fillStyle = 'rgba(247,241,230,0.82)';
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 10;
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 18); ctx.fill();
  ctx.restore();
  drawTextBlock(ctx, d, panel.x + 60, panel.w - 120, panel.y + panel.h / 2, 'center');
}

/**
 * Render the master.
 * @param {HTMLCanvasElement} canvas  sized MASTER.w × MASTER.h
 * @param {object} d  {mode, name, line}
 * @param {object} bg  manifest entry
 * @param {HTMLImageElement} bgImg
 * @param {object} photo  {img, view}  (book layout) or sticker (spot layout)
 */
export function render(canvas, d, bg, bgImg, photo) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, MASTER.w, MASTER.h);
  if (bgImg) drawBackground(ctx, bg, bgImg);
  else { ctx.fillStyle = PAPER; ctx.fillRect(0, 0, MASTER.w, MASTER.h); }
  if (bg?.sticker) {
    drawSpot(ctx, d, photo);
    drawFooter(ctx, SPOT_FOOTER_TOP);
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
