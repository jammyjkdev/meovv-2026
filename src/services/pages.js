/**
 * Renders the yearbook as PNG pages (1080×1350, black, matching the embeds).
 *   cover · member superlatives · in the fans' words (approved nomination notes) · 2026 fan favorites ·
 *   MEOVV moments · fan responses. Member names print in their member colour; emoji use Noto Color Emoji.
 * Fan favorites are album sleeves on one page; fan writing prints on tilted paper cards with tape and stickers.
 */
const path = require('node:path');
const fs = require('node:fs');
const { createCanvas, GlobalFonts, Image } = require('@napi-rs/canvas');
const config = require('../config');
const { normalize } = require('../lib/text');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Anton-Regular.ttf'), 'Anton');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Cinzel.ttf'), 'Cinzel');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoColorEmoji.ttf'), 'Emoji');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

/** Decode an image file; resolves to the Image, or null if it can't be read. */
function decode(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    try { img.src = fs.readFileSync(file); } catch { resolve(null); }
  });
}

/**
 * Artwork, loaded when this module is first required (images decode in the background, so `assetsReady`
 * resolves once everything can be drawn):
 *   assets/logo.png|svg     the MEOVV logo for the cover (white on transparent); without it the cover prints MEOVV as text
 *   assets/covers/<name>.*  album/single covers for the Fan Favorites page, named after the winner ("go-hard.jpg")
 *                           or the category id ("song.png"); winners without art get a printed sleeve with the title
 */
let LOGO = null;
const COVERS = new Map();
const assetsReady = (async () => {
  const logo = ['logo.svg', 'logo.png'].map((n) => path.join(ASSETS, n)).find((f) => fs.existsSync(f));
  if (logo) LOGO = await decode(logo);
  const dir = path.join(ASSETS, 'covers');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f)) : [];
  for (const f of files) {
    const img = await decode(path.join(dir, f));
    if (img) COVERS.set(normalize(f.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')).replace(/\s+/g, '-'), img);
  }
  return { logo: Boolean(LOGO), covers: COVERS.size };
})();
const logoReady = assetsReady.then((a) => a.logo);

const W = 1080;
const H = 1350;
const MARGIN = 80;
const INNER = W - MARGIN * 2;
const INK = '#ffffff';
const MUTED = 'rgba(255,255,255,0.55)';
const RULE = 'rgba(255,255,255,0.18)';
const PAPER = '#000000';
// printed-paper tones for cards and sleeves (no neon)
const CREAM = '#EEE8DC';
const INK_DARK = '#1E1B18';
const TAPE = 'rgba(214,200,168,0.78)';

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
  ctx.fillText(`PAGE ${Number(pageNo)}`, W - MARGIN, MARGIN + 10);
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
  ctx.fillText(`${config.event.credit}  ·  ${config.event.invite}`, W / 2, H - MARGIN + 10);
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

// ── shared randomness ─────────────────────────────────────────────
// Layouts are deliberately a little off: tilts, nudges, tape and stickers. All of it comes from a hash of
// the content, so the preview and the published pages always match.

/** Stable 32-bit hash of a string. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A repeatable number in [min, max) for `key` (use different `salt`s for independent values). */
function rand(key, salt, min, max) {
  return min + (hash(`${salt}|${key}`) % 10000) / 10000 * (max - min);
}

const deg = (d) => (d * Math.PI) / 180;

/** '#RRGGBB' → 'rgba(r,g,b,a)'. */
function tint(hex, a) {
  const n = parseInt(String(hex ?? '#FFFFFF').replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Mix two '#RRGGBB' colours; `t` = share of b. */
function mix(a, b, t) {
  const p = (h) => parseInt(String(h).replace('#', ''), 16);
  const [x, y] = [p(a), p(b)];
  const ch = (s) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Draw `fn` rotated by `angle` about the centre of the box (x, y, w, h). */
function tilted(ctx, x, y, w, h, angle, fn) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.translate(-w / 2, -h / 2);
  fn();
  ctx.restore();
}

/** A strip of paper tape centred at (x, y). */
function tape(ctx, x, y, angle, len = 96) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = TAPE;
  ctx.fillRect(-len / 2, -13, len, 26);
  // torn ends
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = -13; i < 13; i += 6) {
    ctx.fillRect(-len / 2, i, 3, 3);
    ctx.fillRect(len / 2 - 3, i + 3, 3, 3);
  }
  ctx.restore();
}

/** Tape for a card: across the top, or two corner pieces, chosen per card. */
function tapeCard(ctx, w, h, seedKey) {
  const style = hash(`tape|${seedKey}`) % 3;
  if (style === 0) tape(ctx, w * rand(seedKey, 't1', 0.3, 0.7), 0, deg(rand(seedKey, 't2', -6, 6)));
  else if (style === 1) {
    tape(ctx, 10, 10, deg(-40), 80);
    tape(ctx, w - 10, h - 10, deg(-40), 80);
  } else {
    tape(ctx, w - 12, 8, deg(38), 80);
    tape(ctx, 16, h - 6, deg(30), 70);
  }
}

const STICKERS = ['🏁', '🐱', '⭐', '💿', '🎀', '🏎️', '📸', '🖤', '✨'];

/** Some cards get an emoji sticker slapped on a corner. */
function maybeSticker(ctx, w, h, seedKey, chance = 0.4) {
  if (rand(seedKey, 's0', 0, 1) > chance) return;
  const emoji = STICKERS[hash(`st|${seedKey}`) % STICKERS.length];
  const corner = hash(`sc|${seedKey}`) % 3;
  const [x, y] = [[w - 18, -14], [w - 26, h - 10], [-14, h - 18]][corner];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(deg(rand(seedKey, 's1', -25, 25)));
  ctx.font = label(rand(seedKey, 's2', 40, 58) | 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, 0);
  ctx.restore();
}

// ── category → winner grids (superlatives, moments) ─────────────

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

/** A cell, tilted and nudged a little so the grid doesn't read as a spreadsheet. */
function drawCell(ctx, c, x, top, colW) {
  const key = c.e.id ?? c.e.title;
  const angle = deg(rand(key, 'cell-a', -2.2, 2.2));
  const dx = rand(key, 'cell-x', -10, 14);
  tilted(ctx, x + dx, top, colW, c.h, angle, () => {
    ctx.fillStyle = MUTED;
    ctx.font = label(c.labelPx);
    c.cat.forEach((l, j) => ctx.fillText(l, 0, 14 + (j + 1) * (c.labelPx + 6) - 6));
    const nameTop = 14 + c.cat.length * (c.labelPx + 6) + 6;
    ctx.fillStyle = c.e.winners.length ? (c.color ?? INK) : MUTED;
    ctx.font = display(c.px);
    c.lines.forEach((l, j) => ctx.fillText(l, 0, nameTop + c.px * 0.85 + j * c.px));
    const y = nameTop + c.px * 0.85 + (c.lines.length - 1) * c.px;
    if (c.votes) {
      ctx.fillStyle = MUTED;
      ctx.font = label(18);
      const pct = Math.round((c.e.winners[0].votes / c.e.totalVotes) * 100);
      ctx.fillText(`${c.e.winners.length > 1 ? 'TIE  ·  ' : ''}${pct}% OF ${c.e.totalVotes} VOTES`, 0, y + 30);
    }
    ctx.fillStyle = RULE;
    ctx.fillRect(0, c.h - 12, colW * rand(key, 'cell-r', 0.55, 1), 1);
  });
}

/**
 * Category → winner grid for superlatives and moments. Rows size to their content,
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
    const cells = entries.map((e) => measureCell(probe, e, colW - 16, labelPx, nameMax));
    rows = [];
    for (let i = 0; i < cells.length; i += cols) {
      const row = cells.slice(i, i + cols);
      rows.push({ cells: row, h: Math.max(...row.map((c) => c.h)) + 8 });
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
      row.cells.forEach((c, j) => drawCell(ctx, { ...c, h: row.h - 8 }, MARGIN + j * (colW + gap), y, colW - 16));
      y += row.h;
    }
    return canvas.toBuffer('image/png');
  });
}

// ── 2026 fan favorites: album sleeves ────────────────────────────

/** Sleeve colours for winners without cover art: muted, printed-paper tones. */
const SLEEVES = ['#C9BFAE', '#8FA3B0', '#B49AA4', '#9E9AB4', '#A8A59A', '#7E7A74', '#C2A88E', '#8C9B8B'];

/** Cover art for a winner: assets/covers/<winner>.png, the category id, or a cover named inside the winner. */
function coverFor(e) {
  const slug = (t) => normalize(t).replace(/\s+/g, '-');
  const w = e.winners[0] ? slug(e.winners[0].text) : '';
  if (COVERS.has(w)) return COVERS.get(w);
  if (e.id && COVERS.has(e.id)) return COVERS.get(e.id);
  // "GO HARD at Music Bank" → go-hard.png
  const hit = [...COVERS.keys()].filter((k) => w && (w.startsWith(`${k}-`) || w.includes(`-${k}-`) || w.endsWith(`-${k}`))).sort((a, b) => b.length - a.length)[0];
  return hit ? COVERS.get(hit) : null;
}

/** One record sleeve: cover art (or a printed colour block with the title), with the vinyl peeking out. */
function drawSleeve(ctx, e, x, y, s, i) {
  const key = e.id ?? e.title;
  const art = coverFor(e);
  const angle = deg(rand(key, 'sl-a', -5, 5));
  const peek = s * rand(key, 'sl-p', 0.18, 0.3);
  tilted(ctx, x, y, s, s, angle, () => {
    // vinyl, half out of the sleeve
    ctx.fillStyle = '#242424';
    ctx.beginPath();
    ctx.arc(s / 2 + peek, s / 2, s * 0.47, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    for (let r = s * 0.2; r < s * 0.46; r += 6) { ctx.beginPath(); ctx.arc(s / 2 + peek, s / 2, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = SLEEVES[(i + 3) % SLEEVES.length];
    ctx.beginPath();
    ctx.arc(s / 2 + peek, s / 2, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
    // sleeve
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = SLEEVES[i % SLEEVES.length];
    ctx.fillRect(0, 0, s, s);
    ctx.shadowBlur = 0;
    if (art) {
      ctx.drawImage(art, 0, 0, s, s);
    } else {
      const title = e.winners.length ? e.winners.map((w) => w.text).join(' & ') : 'TBA';
      // biggest type at which the title fits inside the sleeve (above the small MEOVV mark)
      let px = 58;
      let lines;
      for (; px > 14; px -= 2) {
        ctx.font = display(px);
        lines = wrap(ctx, title, s - 28);
        const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
        if (widest <= s - 28 && 14 + lines.length * px * 1.02 <= s - 40) break;
      }
      ctx.fillStyle = INK_DARK;
      ctx.font = display(px);
      lines.forEach((l, j) => ctx.fillText(l, 14, 14 + px * 0.9 + j * px * 1.02));
      ctx.font = label(13);
      ctx.fillStyle = tint('#000000', 0.55);
      ctx.fillText('MEOVV', 14, s - 14);
    }
    tapeCard(ctx, s, s, `sleeve|${key}`);
    maybeSticker(ctx, s, s, `sleeve|${key}`, 0.3);
  });
}

/** Every 2026 fan favorite on one page, as a scatter of album sleeves with their category underneath. */
function renderAlbums(kicker, title, entries, pageNo) {
  const { canvas, ctx } = page();
  const top = chrome(ctx, kicker, title, String(pageNo).padStart(2, '0'));
  const cols = entries.length > 9 ? 4 : 3;
  const rows = Math.ceil(entries.length / cols);
  const colW = INNER / cols;
  const captionH = 70;
  const rowH = (BOTTOM - top) / rows;
  const s = Math.min(colW * 0.8, rowH - captionH - 30); // room for the caption and the next row's tape
  entries.forEach((e, i) => {
    const key = e.id ?? e.title;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * colW + rand(key, 'al-x', -6, Math.max(-6, colW - s * 1.12));
    const y = top + 18 + row * rowH + rand(key, 'al-y', 0, Math.max(0, rowH - s - captionH - 30));
    drawSleeve(ctx, e, x, y, s, i);
    // caption
    tilted(ctx, x, y + s + 12, colW - 12, captionH - 12, deg(rand(key, 'al-c', -2.5, 2.5)), () => {
      ctx.fillStyle = MUTED;
      ctx.font = label(14);
      wrap(ctx, e.title.toUpperCase(), colW - 16).slice(0, 2).forEach((l, j) => ctx.fillText(l, 0, 18 + j * 18));
      const votes = e.totalVotes && e.winners.length ? `${e.winners.length > 1 ? 'TIE · ' : ''}${Math.round((e.winners[0].votes / e.totalVotes) * 100)}% OF ${e.totalVotes} VOTES` : '';
      ctx.font = label(12);
      ctx.fillText(votes, 0, 54);
    });
  });
  return [canvas.toBuffer('image/png')];
}

// ── paper cards (fan notes + fan memories) ──────────────────────

const CARD_PAD = 26;
const SHORT = 90; // characters: short quotes can share a row

/** Type style by length: punchy one-liners in the display face, longer ones in the serif. */
function quoteStyle(text) {
  if (text.length <= 60) return { font: display, px: 42, lineH: 48 };
  if (text.length <= 160) return { font: label, px: 28, lineH: 38 };
  return { font: label, px: 24, lineH: 33 };
}

/** Measure a card at width `w`. */
function measureCard(ctx, { text, color }, w) {
  const st = quoteStyle(text);
  ctx.font = st.font(st.px);
  const lines = wrap(ctx, `“${text}”`, w - CARD_PAD * 2);
  const h = CARD_PAD + lines.length * st.lineH + 8 + CARD_PAD;
  const angle = deg(rand(text, 'card-a', -4.5, 4.5));
  return { text, color: color ?? '#FFFFFF', st, lines, w, h, angle };
}

/** Draw a measured card with its top-left at (x, y): paper tinted with the member colour, tape, maybe a sticker. */
function drawCard(ctx, c, x, y) {
  tilted(ctx, x, y, c.w, c.h, c.angle, () => {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = mix(CREAM, c.color, 0.28);
    ctx.fillRect(0, 0, c.w, c.h);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = INK_DARK;
    ctx.font = c.st.font(c.st.px);
    c.lines.forEach((l, j) => ctx.fillText(l, CARD_PAD, CARD_PAD + (j + 1) * c.st.lineH - (c.st.lineH - c.st.px) / 2));
    tapeCard(ctx, c.w, c.h, c.text);
    maybeSticker(ctx, c.w, c.h, c.text);
  });
}

/** Room a tilted card needs vertically beyond its own height. */
const tiltRoom = (c) => Math.abs(Math.sin(c.angle)) * c.w * 0.6 + 14;

/**
 * Turn a list of quotes into rows: two short quotes side by side, or one card at a random width and
 * position. Returns rows with a height and a draw(ctx, y) function.
 */
function cardRows(ctx, quotes) {
  const rows = [];
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const next = quotes[i + 1];
    if (q.text.length <= SHORT && next && next.text.length <= SHORT) {
      const gap = rand(q.text, 'pair-g', 20, 60);
      const split = rand(q.text, 'pair-s', 0.42, 0.58);
      const wa = (INNER - gap) * split;
      const wb = INNER - gap - wa;
      const a = measureCard(ctx, q, wa);
      const b = measureCard(ctx, next, wb);
      const dy = rand(q.text, 'pair-y', -10, 36);
      const h = Math.max(a.h, b.h + dy) + Math.max(tiltRoom(a), tiltRoom(b));
      rows.push({ h, draw: (c2, y) => { drawCard(c2, a, MARGIN, y + 14); drawCard(c2, b, MARGIN + wa + gap, y + 14 + dy); } });
      i++;
      continue;
    }
    const w = Math.round(INNER * rand(q.text, 'card-w', 0.62, 0.9));
    const c = measureCard(ctx, q, w);
    const x = MARGIN + rand(q.text, 'card-x', 0, INNER - w);
    rows.push({ h: c.h + tiltRoom(c), draw: (c2, y) => drawCard(c2, c, x, y + 14) });
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

/** Fan memories as paper cards, colours cycling through the members. */
function renderMemories(book, firstPageNo) {
  const colors = config.event.members.map((m) => m.color).filter(Boolean);
  const { ctx } = page();
  const quotes = book.memories.map((m, i) => ({ text: m.text, color: colors[i % colors.length] }));
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
    cat.groups.forEach((g) => {
      const color = g.color ?? INK;
      const name = `${g.member} ${g.emoji ?? ''}${g.winner ? '  🏁' : ''}`;
      const key = `${cat.id}|${g.member}`;
      rows.push({
        h: 64,
        keep: true,
        draw: (c, y) => {
          c.font = display(46);
          const w = c.measureText(name).width;
          const x = MARGIN + rand(key, 'name-x', 0, Math.max(0, INNER - w));
          tilted(c, x, y + 4, w, 56, deg(rand(key, 'name-a', -4, 4)), () => {
            c.fillStyle = color;
            c.fillText(name, 0, 48);
          });
        },
      });
      rows.push(...cardRows(ctx, g.notes.map((n) => ({ text: n.text, color }))));
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
  if (book.favorites.length) add('fan-favorites', renderAlbums('💿 Fan favorites', '2026 FAN FAVORITES', book.favorites, n));
  if (book.moments.length) add('moments', renderGrid('📸 Moments', 'MEOVV MOMENTS OF 2026', book.moments, n));
  if (book.memories.length) add('memories', renderMemories(book, n));
  return pages;
}

module.exports = { assetsReady, logoReady, renderAll, renderCover, renderGrid, renderAlbums, renderNotes, renderMemories, W, H };
