/**
 * Console logging with timestamps and levels.
 *
 *   const log = require('./lib/log')('scheduler');
 *   log.info('posted poll', { key: 'song' });   →  2026-11-03 20:01:15 INFO  [scheduler] posted poll key=song
 *
 * LOG_LEVEL in .env sets the minimum level: debug | info | warn | error (default info).
 * Times are shown in the event timezone (TZ).
 */
const { DateTime } = require('luxon');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

const minLevel = LEVELS[String(process.env.LOG_LEVEL ?? 'info').toLowerCase()] ?? LEVELS.info;
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function stamp() {
  return DateTime.now().setZone(process.env.TZ || 'local').toFormat('yyyy-LL-dd HH:mm:ss');
}

/** Render extra fields as key=value, quoting values with spaces. */
function fields(data) {
  if (!data || typeof data !== 'object') return '';
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const s = v instanceof Error ? v.message : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k}=${/[\s"]/.test(s) ? JSON.stringify(s) : s}`;
    })
    .join(' ');
}

function write(level, scope, message, data) {
  if (LEVELS[level] < minLevel) return;
  const tag = level.toUpperCase().padEnd(5);
  const head = useColor ? `${COLORS[level]}${tag}${RESET}` : tag;
  const extra = fields(data);
  const line = `${stamp()} ${head} [${scope}] ${message}${extra ? ` ${extra}` : ''}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(line);
  if (data instanceof Error) out(data.stack ?? data);
  else if (data?.err instanceof Error && level === 'error') out(data.err.stack ?? data.err);
}

/** Create a logger for one part of the bot. */
function createLogger(scope) {
  return {
    debug: (message, data) => write('debug', scope, message, data),
    info: (message, data) => write('info', scope, message, data),
    warn: (message, data) => write('warn', scope, message, data),
    error: (message, data) => write('error', scope, message, data),
  };
}

module.exports = createLogger;
