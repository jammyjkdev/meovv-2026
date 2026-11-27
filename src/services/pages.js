/**
 * Renders the yearbook as PNG pages (1080×1350, black, matching the embeds).
 *   cover · member superlatives · 2026 fan favorites (album sleeves) · MEOVV moments · fan moments (sticky notes).
 * Inside pages pair up into double-width spreads by default. Member names print in their member colour;
 * fan moments are handwritten (Caveat); emoji use Noto Color Emoji.
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
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Caveat-SemiBold.woff2'), 'Caveat');

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
  return canvas;
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
    return canvas;
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
  return [canvas];
}

// ── sticky notes (fan moments) ───────────────────────────────────
// Each fan moment is a handwritten sticky note in a muted paper colour: soft shadow, a slightly darker
// adhesive band, a curled corner, sometimes taped down or wearing a sticker. Notes pack into rows by
// their tilted footprint, so they never touch.

const STICKY = ['#EDE1A6', '#E7CBCC', '#CADBE2', '#D9D0E5', '#DAE3C9', '#ECE4D3', '#E9D3B8'];
const hand = (px) => `${px}px Caveat, Cinzel, Emoji`;
const NOTE_PAD = 26;
const NOTE_GAP = 34; // minimum space between notes side by side, measured on their tilted outlines
const ROW_GAP = 26; // and between rows

/** Size and type for a note by length: short ones are small squares, long ones wide sheets. */
function noteSize(text, key) {
  const n = text.length;
  if (n <= 60) return { w: rand(key, 'nw', 215, 255), px: 36 };
  if (n <= 140) return { w: rand(key, 'nw', 265, 315), px: 31 };
  if (n <= 280) return { w: rand(key, 'nw', 380, 450), px: 30 };
  return { w: rand(key, 'nw', 500, 600), px: 28 };
}

/** Measure a note: wrapped lines, height (at least nearly square), tilt and the tilted bounding box. */
function measureNote(ctx, text, i) {
  const key = `${i}|${text}`;
  const { w, px } = noteSize(text, key);
  ctx.font = hand(px);
  const lineH = px * 1.12;
  const lines = wrap(ctx, text, w - NOTE_PAD * 2);
  const h = Math.max(w * 0.82, NOTE_PAD * 2 + 18 + lines.length * lineH);
  const angle = deg(rand(key, 'na', -5, 5));
  const bw = Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h;
  const bh = Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h;
  return { key, text, w, h, px, lineH, lines, angle, bw, bh, color: STICKY[hash(key) % STICKY.length], taped: rand(key, 'nt', 0, 1) < 0.3 };
}

/** Draw a note whose tilted bounding box has its top-left at (x, y). */
function drawNote(ctx, n, x, y) {
  tilted(ctx, x + (n.bw - n.w) / 2, y + (n.bh - n.h) / 2, n.w, n.h, n.angle, () => {
    const { w, h } = n;
    const curl = Math.min(w, h) * 0.12;
    // paper with a curled bottom-right corner
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 7;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h - curl);
    ctx.quadraticCurveTo(w - curl * 0.2, h - curl * 0.2, w - curl, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, mix(n.color, '#FFFFFF', 0.18));
    g.addColorStop(1, mix(n.color, '#000000', 0.06));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    // the curl itself
    ctx.beginPath();
    ctx.moveTo(w, h - curl);
    ctx.quadraticCurveTo(w - curl * 0.75, h - curl * 0.75, w - curl, h);
    ctx.quadraticCurveTo(w - curl * 0.55, h - curl * 0.55, w, h - curl);
    ctx.fillStyle = mix(n.color, '#000000', 0.22);
    ctx.fill();
    // adhesive band, or tape on paper-style notes
    if (n.taped) tapeCard(ctx, w, h, n.key);
    else {
      ctx.fillStyle = 'rgba(0,0,0,0.045)';
      ctx.fillRect(0, 0, w, Math.min(46, h * 0.14));
    }
    // handwriting
    ctx.fillStyle = INK_DARK;
    ctx.font = hand(n.px);
    const textH = n.lines.length * n.lineH;
    const top = Math.max(NOTE_PAD + 8, (h - textH) / 2);
    n.lines.forEach((l, j) => ctx.fillText(l, NOTE_PAD, top + (j + 0.8) * n.lineH));
    maybeSticker(ctx, w, h, n.key, 0.22);
  });
}

/** Pack notes into rows that fit the page width, keeping NOTE_GAP between tilted outlines. */
function noteRows(ctx, texts) {
  const notes = texts.map((t, i) => measureNote(ctx, t, i));
  const rows = [];
  let row = [];
  let used = 0;
  for (const n of notes) {
    if (row.length && used + NOTE_GAP + n.bw > INNER) { rows.push(row); row = []; used = 0; }
    used += (row.length ? NOTE_GAP : 0) + n.bw;
    row.push(n);
  }
  if (row.length) rows.push(row);

  return rows.map((r) => {
    const key = r.map((n) => n.key).join('|');
    const tallest = Math.max(...r.map((n) => n.bh));
    const width = r.reduce((s, n) => s + n.bw, 0) + NOTE_GAP * (r.length - 1);
    // share the spare width out at random: some before, some between
    const spare = INNER - width;
    const cuts = r.map((_, i) => rand(key, `cut${i}`, 0, 1));
    const sum = cuts.reduce((a, b) => a + b, 0) + rand(key, 'cutEnd', 0.2, 1);
    const offsets = r.map((n) => rand(n.key, 'ny', 0, Math.max(0, tallest - n.bh) + 16));
    const ext = Math.max(...r.map((n, i) => n.bh + offsets[i])); // what is actually drawn
    return {
      h: ext + ROW_GAP,
      ext,
      draw: (c, y) => {
        let x = MARGIN;
        r.forEach((n, i) => {
          x += (spare * cuts[i]) / sum;
          drawNote(c, n, x, y + offsets[i]);
          x += n.bw + NOTE_GAP;
        });
      },
    };
  });
}

/**
 * Lay rows out over as many pages as needed. Returns one canvas per page.
 */
function flow(rows, header) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const { canvas, ctx } = page();
    let y = header(ctx, out.length);
    let placed = 0;
    while (i < rows.length) {
      if (placed && y + (rows[i].ext ?? rows[i].h) > BOTTOM - 10) break; // leave room for tape
      rows[i].draw(ctx, y);
      y += rows[i].h;
      i++;
      placed++;
    }
    out.push(canvas);
  }
  return out;
}

/** Fan moments ("What MEOVV moment made your 2026?") as sticky notes. */
function renderMemories(book, firstPageNo) {
  const { ctx } = page();
  return flow(noteRows(ctx, book.memories.map((m) => m.text)), (c, n) =>
    chrome(c, n ? '💌 Year in Review · continued' : '💌 Year in Review', config.event.memories.prompt, String(firstPageNo + n).padStart(2, '0')));
}

// ── spreads ───────────────────────────────────────────────────────

/** Two pages side by side (2160×1350) with a soft fold down the middle; `right` may be null (blank page). */
function spread(left, right) {
  const canvas = createCanvas(W * 2, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W * 2, H);
  ctx.drawImage(left, 0, 0);
  if (right) ctx.drawImage(right, W, 0);
  else if (LOGO) {
    // closing blank page: a small logo, centred
    const w = 360;
    const h = (LOGO.height / LOGO.width) * w;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(LOGO, W + (W - w) / 2, (H - h) / 2, w, h);
    ctx.globalAlpha = 1;
  }
  const g = ctx.createLinearGradient(W - 60, 0, W + 60, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(W - 60, 0, 120, H);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(W - 1, 0, 2, H);
  return canvas;
}

/**
 * Every page of the yearbook as PNGs, in reading order. With `spreads` (the default, `yearbook.spreads` in the
 * config) the cover stays a single page and the inside pages pair up into double-width spreads.
 * @returns {Array<{name:string, buffer:Buffer}>}
 */
function renderAll(book, { spreads = config.event.yearbook?.spreads ?? true } = {}) {
  const inside = [];
  let n = 2;
  const add = (slug, canvases) => canvases.forEach((canvas, i) => inside.push({ no: n++, slug: `${slug}${canvases.length > 1 ? `-${i + 1}` : ''}`, canvas }));
  if (book.superlatives.length) add('superlatives', renderGrid('🏆 Members', 'MEMBER SUPERLATIVES', book.superlatives, n));
  if (book.favorites.length) add('fan-favorites', renderAlbums('💿 Fan favorites', '2026 FAN FAVORITES', book.favorites, n));
  if (book.moments.length) add('moments', renderGrid('📸 Moments', 'MEOVV MOMENTS OF 2026', book.moments, n));
  if (book.memories.length) add('memories', renderMemories(book, n));

  const num = (x) => String(x).padStart(2, '0');
  const pages = [{ name: 'meovv-2026-yearbook-01-cover.png', buffer: renderCover(book).toBuffer('image/png') }];
  if (!spreads) {
    for (const p of inside) pages.push({ name: `meovv-2026-yearbook-${num(p.no)}-${p.slug}.png`, buffer: p.canvas.toBuffer('image/png') });
    return pages;
  }
  for (let i = 0; i < inside.length; i += 2) {
    const [l, r] = [inside[i], inside[i + 1]];
    const name = r ? `meovv-2026-yearbook-${num(l.no)}-${num(r.no)}-${l.slug}--${r.slug}.png` : `meovv-2026-yearbook-${num(l.no)}-${l.slug}.png`;
    pages.push({ name, buffer: spread(l.canvas, r?.canvas ?? null).toBuffer('image/png') });
  }
  return pages;
}

module.exports = { assetsReady, logoReady, renderAll, renderCover, renderGrid, renderAlbums, renderMemories, W, H };
