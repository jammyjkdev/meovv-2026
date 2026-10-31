/** Normalise free-text nominations so "Toxic!!", "toxic" and "TOXIC " count as the same thing. */
function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip accents
    .normalize('NFC') // recompose Hangul etc.
    .toLowerCase()
    .replace(/['’‘`"“”]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function truncate(value, max) {
  const s = String(value ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Collapse whitespace and trim user input for display. */
function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Escape text for safe HTML output. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { normalize, truncate, isHttpUrl, clean, escapeHtml };
