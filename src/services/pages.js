/**
 * Renders the yearbook as PNG pages (1080×1350, black, matching the embeds).
 *   cover · member superlatives · 2026 fan favorites · MEOVV moments · fan responses (one or more pages)
 */
const path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const config = require('../config');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Anton-Regular.ttf'), 'Anton');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Cinzel.ttf'), 'Cinzel');

const W = 1080;
const H = 1350;
const MARGIN = 80;
const INNER = W - MARGIN * 2;
const INK = '#ffffff';
const MUTED = 'rgba(255,255,255,0.55)';
const RULE = 'rgba(255,255,255,0.18)';
const PAPER = '#000000';

const display = (px) => `${px}px Anton`;
const label = (px) => `${px}px Cinzel`;

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
  ctx.fillText('VOTED BY THE FANDOM', W / 2, H - MARGIN + 10);
  ctx.textAlign = 'left';
  return y + 40;
}

/** Lowest y content may reach on an inner page. */
const BOTTOM = H - MARGIN - 24;

const winnerText = (e) => (e.winners.length ? e.winners.map((w) => w.text).join('  &  ') : 'TBA');

function renderCover(book) {
  const { canvas, ctx } = page();
  ctx.fillStyle = MUTED;
  ctx.font = label(26);
  ctx.fillText('THE', MARGIN, 300);
  ctx.fillStyle = INK;
  ctx.font = display(260);
  ctx.fillText('MEOVV', MARGIN - 8, 540);
  ctx.font = display(150);
  ctx.fillText('2026', MARGIN, 700);
  ctx.fillText('YEARBOOK', MARGIN, 860);
  ctx.fillStyle = RULE;
  ctx.fillRect(MARGIN, 930, INNER, 2);
  ctx.fillStyle = MUTED;
  ctx.font = label(26);
  ctx.fillText('MEMBER SUPERLATIVES  ·  2026 FAN FAVORITES', MARGIN, 1000);
  ctx.fillText('MEOVV MOMENTS OF 2026  ·  FAN MEMORIES', MARGIN, 1046);
  ctx.fillStyle = INK;
  ctx.font = label(24);
  ctx.fillText(`VOTED BY THE FANDOM  ·  NOVEMBER 2026`, MARGIN, H - MARGIN - 20);
  void book;
  return canvas.toBuffer('image/png');
}

/** Measure one category → winner cell at a given maximum name size. */
function measureCell(ctx, e, colW, labelPx, nameMax) {
  ctx.font = label(labelPx);
  const cat = wrap(ctx, e.title.toUpperCase(), colW).slice(0, 2);
  const name = winnerText(e);
  const px = fit(ctx, name, colW, display, nameMax, 30);
  ctx.font = display(px);
  const lines = wrap(ctx, name, colW).slice(0, 2);
  const votes = Boolean(e.totalVotes && e.winners.length);
  const h = 14 + cat.length * (labelPx + 6) + 6 + px * 0.85 + (lines.length - 1) * px + (votes ? 30 : 4) + 26;
  return { e, cat, px, lines, votes, h, labelPx };
}

function drawCell(ctx, c, x, top, colW) {
  ctx.fillStyle = MUTED;
  ctx.font = label(c.labelPx);
  c.cat.forEach((l, j) => ctx.fillText(l, x, top + 14 + (j + 1) * (c.labelPx + 6) - 6));
  const nameTop = top + 14 + c.cat.length * (c.labelPx + 6) + 6;
  ctx.fillStyle = c.e.winners.length ? INK : MUTED;
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

/** Fan responses, as many per page as fit; returns one buffer per page. */
function renderMemories(book, firstPageNo) {
  const out = [];
  const quoteFont = 30;
  const lineH = 42;
  const bodyW = INNER - 40;
  const blocks = book.memories.map((m) => {
    const { ctx } = page();
    ctx.font = label(quoteFont);
    const lines = wrap(ctx, `“${m.text}”`, bodyW);
    return { lines, author: m.author, height: lines.length * lineH + 70 + 40 };
  });

  let i = 0;
  let pageNo = firstPageNo;
  while (i < blocks.length) {
    const { canvas, ctx } = page();
    let y = chrome(ctx, 'Year in Review', config.event.memories.prompt, String(pageNo++).padStart(2, '0'));
    const bottom = BOTTOM;
    let placed = 0;
    while (i < blocks.length && (y + blocks[i].height <= bottom || placed === 0)) {
      const b = blocks[i++];
      ctx.fillStyle = RULE;
      ctx.fillRect(MARGIN, y, 4, Math.min(b.height - 40, bottom - y));
      ctx.fillStyle = INK;
      ctx.font = label(quoteFont);
      for (const l of b.lines) {
        if (y + lineH > bottom) break;
        y += lineH;
        ctx.fillText(l, MARGIN + 40, y);
      }
      y += 48;
      ctx.fillStyle = MUTED;
      ctx.font = label(22);
      ctx.fillText(`—  ${b.author.toUpperCase()}`, MARGIN + 40, y);
      y += 60;
      placed++;
    }
    out.push(canvas.toBuffer('image/png'));
  }
  return out;
}

/**
 * Every page of the yearbook as PNG buffers, in reading order.
 * @returns {Array<{name:string, buffer:Buffer}>}
 */
function renderAll(book) {
  const pages = [{ name: 'meovv-2026-yearbook-01-cover.png', buffer: renderCover(book) }];
  let n = 2;
  const add = (slug, buffers) => buffers.forEach((buffer, i) => pages.push({ name: `meovv-2026-yearbook-${String(n++).padStart(2, '0')}-${slug}${buffers.length > 1 ? `-${i + 1}` : ''}.png`, buffer }));
  if (book.superlatives.length) add('superlatives', renderGrid('Section one', 'MEMBER SUPERLATIVES', book.superlatives, n));
  if (book.favorites.length) add('fan-favorites', renderGrid('Section two', '2026 FAN FAVORITES', book.favorites, n));
  if (book.moments.length) add('moments', renderGrid('Section three', 'MEOVV MOMENTS OF 2026', book.moments, n));
  if (book.memories.length) add('memories', renderMemories(book, n));
  return pages;
}

module.exports = { renderAll, renderCover, renderGrid, renderMemories, W, H };
