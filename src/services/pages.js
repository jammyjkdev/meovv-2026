/**
 * Renders the yearbook as PNG pages (1080×1350, black, matching the embeds).
 *   cover · member superlatives · in the fans' words (approved nomination notes) · 2026 fan favorites ·
 *   MEOVV moments · fan responses. Member names print in their member colour; emoji use Noto Color Emoji.
 */
const path = require('node:path');
const fs = require('node:fs');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');
const config = require('../config');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Anton-Regular.ttf'), 'Anton');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Cinzel.ttf'), 'Cinzel');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoColorEmoji.ttf'), 'Emoji');

/**
 * The MEOVV logo for the cover: assets/logo.png or assets/logo.svg (white or light on transparent works best).
 * Without one, the cover prints MEOVV in type. Images decode in the background, so the logo is loaded
 * when this module is first required and `logoReady` resolves once it can be drawn.
 */
let LOGO = null;
const logoReady = new Promise((resolve) => {
  const file = ['logo.svg', 'logo.png'].map((n) => path.join(__dirname, '..', '..', 'assets', n)).find((f) => fs.existsSync(f));
  if (!file) return resolve(false);
  const img = new Image();
  img.onload = () => { LOGO = img; resolve(true); };
  img.onerror = () => resolve(false);
  img.src = fs.readFileSync(file);
});

const W = 1080;
const H = 1350;
const MARGIN = 80;
const INNER = W - MARGIN * 2;
const INK = '#ffffff';
const MUTED = 'rgba(255,255,255,0.55)';
const RULE = 'rgba(255,255,255,0.18)';
const PAPER = '#000000';

// Emoji is the fallback for any glyph the text fonts don't have.
const display = (px) => `${px}px Anton, Emoji`;
const label = (px) => `${px}px Cinzel, Emoji`;

/** A member's colour and heart when `text` is exactly a member's name (superlative winners). */
function memberStyle(text) {
  const m = config.event.members.find((x) => x.name.toLowerCase() === String(text).trim().toLowerCase());
  return m ? { color: m.color ?? INK, emoji: m.emoji ?? '' } : null;
}

/** Break text into lines that fit `maxWidth` with the current ctx.font. */
function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !line) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

/** Largest font size (≤ max) at which `text` fits on one line of `maxWidth`. */
function fit(ctx, text, maxWidth, font, max, min) {
  for (let px = max; px > min; px -= 2) {
    ctx.font = font(px);
    if (ctx.measureText(text).width <= maxWidth) return px;
  }
  ctx.font = font(min);
  return min;
}

function page() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  return { canvas, ctx };
}

/** Running header + footer shared by every inner page. Returns the y where content starts. */
function chrome(ctx, kicker, title, pageNo) {
  ctx.fillStyle = MUTED;
  ctx.font = label(22);
  ctx.textAlign = 'left';
  ctx.fillText(config.event.eventName.toUpperCase(), MARGIN, MARGIN + 10);
  ctx.textAlign = 'right';
  ctx.fillText(pageNo, W - MARGIN, MARGIN + 10);
  ctx.textAlign = 'left';

  let y = MARGIN + 110;
  if (kicker) {
    ctx.fillStyle = MUTED;
    ctx.font = label(24);
    ctx.fillText(kicker.toUpperCase(), MARGIN, y);
    y += 50;
  }
  ctx.fillStyle = INK;
  const px = fit(ctx, title, INNER, display, 96, 56);
  ctx.font = display(px);
  ctx.fillText(title, MARGIN, y + px * 0.8);
  y += px * 0.8 + 36;
  ctx.fillStyle = RULE;
  ctx.fillRect(MARGIN, y, INNER, 2);

  ctx.fillStyle = MUTED;
  ctx.font = label(20);
  ctx.textAlign = 'center';
  ctx.fillText(`🏁  ${config.event.credit}  ·  ${config.event.invite}  🏁`, W / 2, H - MARGIN + 10);
  ctx.textAlign = 'left';
  return y + 40;
}

/** Lowest y content may reach on an inner page. */
const BOTTOM = H - MARGIN - 24;

function renderCover(book) {
  const { canvas, ctx } = page();
  ctx.fillStyle = INK;
  if (LOGO) {
    // fit the logo into the space the MEOVV wordmark used, sitting on the same baseline
    const scale = Math.min(INNER / LOGO.width, 280 / LOGO.height);
    const w = LOGO.width * scale;
    const h = LOGO.height * scale;
    ctx.drawImage(LOGO, MARGIN, 510 - h, w, h);
  } else {
    ctx.font = display(260);
    ctx.fillText('MEOVV', MARGIN - 8, 540);
  }
  ctx.font = display(150);
  ctx.fillText('2026', MARGIN, 700);
  ctx.fillText('YEARBOOK', MARGIN, 860);
  ctx.fillStyle = RULE;
  ctx.fillRect(MARGIN, 930, INNER, 2);
  ctx.fillStyle = INK;
  ctx.font = label(26);
  ctx.fillText(config.event.credit, MARGIN, H - MARGIN - 62);
  ctx.fillStyle = MUTED;
  ctx.font = label(24);
  ctx.fillText(config.event.invite, MARGIN, H - MARGIN - 20);
  void book;
  return canvas.toBuffer('image/png');
}

/** Measure one category → winner cell at a given maximum name size. */
function measureCell(ctx, e, colW, labelPx, nameMax) {
  ctx.font = label(labelPx);
  const cat = wrap(ctx, e.title.toUpperCase(), colW).slice(0, 2);
  // winner(s), then the category's themed emoji (e.g. 👗 Best Dressed, 🏎️ Break the Rules)
  const name = e.winners.length ? `${e.winners.map((w) => w.text).join('  &  ')}${e.emoji ? ` ${e.emoji}` : ''}` : 'TBA';
  const px = fit(ctx, name, colW, display, nameMax, 30);
  ctx.font = display(px);
  const lines = wrap(ctx, name, colW).slice(0, 2);
  const votes = Boolean(e.totalVotes && e.winners.length);
  const h = 14 + cat.length * (labelPx + 6) + 6 + px * 0.85 + (lines.length - 1) * px + (votes ? 30 : 4) + 26;
  const solo = e.winners.length === 1 ? memberStyle(e.winners[0].text) : null;
  return { e, cat, px, lines, votes, h, labelPx, color: solo?.color ?? null };
}

function drawCell(ctx, c, x, top, colW) {
  ctx.fillStyle = MUTED;
  ctx.font = label(c.labelPx);
  c.cat.forEach((l, j) => ctx.fillText(l, x, top + 14 + (j + 1) * (c.labelPx + 6) - 6));
  const nameTop = top + 14 + c.cat.length * (c.labelPx + 6) + 6;
  ctx.fillStyle = c.e.winners.length ? (c.color ?? INK) : MUTED;
  ctx.font = display(c.px);
  c.lines.forEach((l, j) => ctx.fillText(l, x, nameTop + c.px * 0.85 + j * c.px));
  let y = nameTop + c.px * 0.85 + (c.lines.length - 1) * c.px;
  if (c.votes) {
    ctx.fillStyle = MUTED;
    ctx.font = label(18);
    const pct = Math.round((c.e.winners[0].votes / c.e.totalVotes) * 100);
    ctx.fillText(`${c.e.winners.length > 1 ? 'TIE  ·  ' : ''}${pct}% OF ${c.e.totalVotes} VOTES`, x, y + 30);
    y += 30;
  }
  ctx.fillStyle = RULE;
  ctx.fillRect(x, top + c.h - 12, colW, 1);
}

/**
 * Category → winner grid for superlatives, favorites and moments. Rows size to their content,
 * type shrinks to fit the page, and anything left spills onto a continuation page.
 * @returns {Buffer[]} one buffer per page
 */
function renderGrid(kicker, title, entries, firstPageNo) {
  const cols = entries.length > 6 ? 2 : 1;
  const gap = 40;
  const colW = (INNER - gap * (cols - 1)) / cols;
  const labelPx = cols === 2 ? 20 : 24;
  const probe = page().ctx;
  const top = chrome(probe, kicker, title, '00');
  const available = BOTTOM - top;

  // rows of measured cells; try progressively smaller names until it all fits one page
  let rows;
  let total;
  for (const nameMax of cols === 2 ? [64, 56, 48] : [84, 72, 60]) {
    const cells = entries.map((e) => measureCell(probe, e, colW, labelPx, nameMax));
    rows = [];
    for (let i = 0; i < cells.length; i += cols) {
      const row = cells.slice(i, i + cols);
      rows.push({ cells: row, h: Math.max(...row.map((c) => c.h)) });
    }
    total = rows.reduce((n, r) => n + r.h, 0);
    if (total <= available) break;
  }

  // Spill evenly across pages rather than cramming the first and leaving one row on the last.
  const pagesNeeded = Math.max(1, Math.ceil(total / available));
  const perPage = Math.ceil(rows.length / pagesNeeded);
  const chunks = [];
  for (let i = 0; i < rows.length; i += perPage) chunks.push(rows.slice(i, i + perPage));

  return chunks.map((chunk, p) => {
    const { canvas, ctx } = page();
    let y = chrome(ctx, p ? `${kicker} · continued` : kicker, title, String(firstPageNo + p).padStart(2, '0'));
    for (const row of chunk) {
      row.cells.forEach((c, j) => drawCell(ctx, { ...c, h: row.h }, MARGIN + j * (colW + gap), y, colW));
      y += row.h;
    }
    return canvas.toBuffer('image/png');
  });
}

// ── scrapbook cards (fan notes + fan memories) ───────────────────
// Quotes print as cards that are deliberately a little off: each has its own tilt, width and side,
// short ones pair up side by side, and a strip of "tape" holds each one down. Everything derives from
// a hash of the text, so the preview and the published pages always match.

/** Stable 32-bit hash of a string. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** '#RRGGBB' → 'rgba(r,g,b,a)'. */
function tint(hex, a) {
  const n = parseInt(String(hex ?? '#FFFFFF').replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const CARD_PAD = 24;
const SHORT = 90; // characters: short quotes can share a row

/** Type style by length: punchy one-liners in the display face, longer ones in the serif. */
function quoteStyle(text) {
  if (text.length <= 60) return { font: display, px: 44, lineH: 50, upper: false };
  if (text.length <= 160) return { font: label, px: 29, lineH: 40, upper: false };
  return { font: label, px: 25, lineH: 35, upper: false };
}

/** Measure a card at width `w`. */
function measureCard(ctx, { text, author, color }, w) {
  const st = quoteStyle(text);
  ctx.font = st.font(st.px);
  const lines = wrap(ctx, `“${text}”`, w - CARD_PAD * 2);
  const h = CARD_PAD + lines.length * st.lineH + 18 + 20 + CARD_PAD;
  const seed = hash(`${author}|${text}`);
  const angle = (((seed % 9) - 4) * 0.35 + (seed % 2 ? 0.2 : -0.2)) * (Math.PI / 180); // about ±1.6°
  return { text, author, color: color ?? '#FFFFFF', st, lines, w, h, seed, angle };
}

/** Draw a measured card with its top-left at (x, y), rotated about its centre. */
function drawCard(ctx, c, x, y) {
  ctx.save();
  ctx.translate(x + c.w / 2, y + c.h / 2);
  ctx.rotate(c.angle);
  ctx.translate(-c.w / 2, -c.h / 2);
  ctx.beginPath();
  ctx.roundRect(0, 0, c.w, c.h, 14);
  ctx.fillStyle = tint(c.color, 0.09);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = tint(c.color, 0.55);
  ctx.stroke();
  // tape
  ctx.save();
  const tx = c.w * (0.3 + (c.seed % 40) / 100);
  ctx.translate(tx, 0);
  ctx.rotate(((c.seed % 2 ? 1 : -1) * 4 * Math.PI) / 180);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(-48, -12, 96, 24);
  ctx.restore();
  // quote + credit
  ctx.fillStyle = INK;
  ctx.font = c.st.font(c.st.px);
  c.lines.forEach((l, j) => ctx.fillText(l, CARD_PAD, CARD_PAD + (j + 1) * c.st.lineH - (c.st.lineH - c.st.px) / 2));
  ctx.fillStyle = tint(c.color, 0.85);
  ctx.font = label(18);
  ctx.fillText(`—  ${c.author.toUpperCase()}`, CARD_PAD, c.h - CARD_PAD + 4);
  ctx.restore();
}

/** Room a tilted card needs vertically beyond its own height. */
const tiltRoom = (c) => Math.abs(Math.sin(c.angle)) * c.w + 12;

/**
 * Turn a list of quotes into rows: two short quotes side by side, or one card at a varied width,
 * nudged left or right. Returns rows with a height and a draw(ctx, y) function.
 */
function cardRows(ctx, quotes) {
  const rows = [];
  const gap = 30;
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const next = quotes[i + 1];
    if (q.text.length <= SHORT && next && next.text.length <= SHORT) {
      const half = (INNER - gap) / 2;
      const a = measureCard(ctx, q, half);
      const b = measureCard(ctx, next, half);
      const dy = (hash(q.text) % 3) * 14; // stagger the pair
      const h = Math.max(a.h, b.h + dy) + Math.max(tiltRoom(a), tiltRoom(b));
      rows.push({ h, draw: (c2, y) => { drawCard(c2, a, MARGIN, y + 8); drawCard(c2, b, MARGIN + half + gap, y + 8 + dy); } });
      i++;
      continue;
    }
    const seed = hash(q.text);
    const w = Math.round(INNER * [0.8, 0.86, 0.92][seed % 3]);
    const c = measureCard(ctx, q, w);
    const x = rows.length % 2 ? MARGIN + INNER - w : MARGIN; // alternate sides
    rows.push({ h: c.h + tiltRoom(c), draw: (c2, y) => drawCard(c2, c, x, y + 8) });
  }
  return rows;
}

/**
 * Lay rows out over as many pages as needed. A row with `keep` stays on the same page as the row after it
 * (headings never end a page). Returns one buffer per page.
 */
function flow(rows, header) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const { canvas, ctx } = page();
    let y = header(ctx, out.length);
    let placed = 0;
    while (i < rows.length) {
      let need = rows[i].h;
      for (let k = i; rows[k]?.keep && rows[k + 1]; k++) need += rows[k + 1].h;
      if (placed && y + need > BOTTOM) break;
      rows[i].draw(ctx, y);
      y += rows[i].h;
      i++;
      placed++;
    }
    out.push(canvas.toBuffer('image/png'));
  }
  return out;
}

/** Fan memories as scrapbook cards, colours cycling through the members. */
function renderMemories(book, firstPageNo) {
  const colors = config.event.members.map((m) => m.color).filter(Boolean);
  const { ctx } = page();
  const quotes = book.memories.map((m, i) => ({ text: m.text, author: m.author, color: colors[i % colors.length] }));
  return flow(cardRows(ctx, quotes), (c, n) =>
    chrome(c, n ? '💌 Year in Review · continued' : '💌 Year in Review', config.event.memories.prompt, String(firstPageNo + n).padStart(2, '0')));
}

/**
 * "In the fans' words": approved nomination notes under each superlative, as cards in the member's colour.
 * Flows across as many pages as needed; returns one buffer per page.
 */
function renderNotes(book, firstPageNo) {
  const { ctx } = page();
  const rows = [];
  for (const cat of book.notes) {
    const first = rows.length === 0;
    rows.push({
      h: first ? 54 : 70,
      keep: true,
      draw: (c, y) => {
        c.fillStyle = MUTED;
        c.font = label(24);
        c.fillText(`🏆  ${cat.title.toUpperCase()}`, MARGIN, y + (first ? 34 : 50));
      },
    });
    cat.groups.forEach((g, gi) => {
      const color = g.color ?? INK;
      const name = `${g.member} ${g.emoji ?? ''}${g.winner ? '  🏁' : ''}`;
      const right = gi % 2 === 1; // member names alternate sides too
      rows.push({
        h: 60,
        keep: true,
        draw: (c, y) => {
          c.fillStyle = color;
          c.font = display(46);
          c.textAlign = right ? 'right' : 'left';
          c.fillText(name, right ? W - MARGIN : MARGIN, y + 48);
          c.textAlign = 'left';
        },
      });
      rows.push(...cardRows(ctx, g.notes.map((n) => ({ text: n.text, author: n.author, color }))));
    });
  }
  return flow(rows, (c, n) => chrome(c, n ? '💬 Fan notes · continued' : '💬 Fan notes', 'IN THE FANS’ WORDS', String(firstPageNo + n).padStart(2, '0')));
}

/**
 * Every page of the yearbook as PNG buffers, in reading order.
 * @returns {Array<{name:string, buffer:Buffer}>}
 */
function renderAll(book) {
  const pages = [{ name: 'meovv-2026-yearbook-01-cover.png', buffer: renderCover(book) }];
  let n = 2;
  const add = (slug, buffers) => buffers.forEach((buffer, i) => pages.push({ name: `meovv-2026-yearbook-${String(n++).padStart(2, '0')}-${slug}${buffers.length > 1 ? `-${i + 1}` : ''}.png`, buffer }));
  if (book.superlatives.length) add('superlatives', renderGrid('🏆 Members', 'MEMBER SUPERLATIVES', book.superlatives, n));
  if (book.notes?.length) add('fan-notes', renderNotes(book, n));
  if (book.favorites.length) add('fan-favorites', renderGrid('💿 Fan favorites', '2026 FAN FAVORITES', book.favorites, n));
  if (book.moments.length) add('moments', renderGrid('📸 Moments', 'MEOVV MOMENTS OF 2026', book.moments, n));
  if (book.memories.length) add('memories', renderMemories(book, n));
  return pages;
}

module.exports = { logoReady, renderAll, renderCover, renderGrid, renderNotes, renderMemories, W, H };
