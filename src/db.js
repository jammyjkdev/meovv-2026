const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nominations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  value       TEXT NOT NULL,          -- display text (member name for superlatives)
  norm        TEXT NOT NULL,          -- grouping key (member id for superlatives)
  link        TEXT,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (category_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_nominations_cat ON nominations (category_id, norm);

-- Staff edits to a nominee: canonical name, canonical link, or excluded from finals.
CREATE TABLE IF NOT EXISTS nominee_overrides (
  category_id TEXT NOT NULL,
  norm        TEXT NOT NULL,
  display     TEXT,
  link        TEXT,
  excluded    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, norm)
);

CREATE TABLE IF NOT EXISTS polls (
  poll_key    TEXT PRIMARY KEY,       -- category id
  kind        TEXT NOT NULL,          -- superlative | nomination | review | custom
  question    TEXT NOT NULL,
  options     TEXT NOT NULL,          -- JSON [{text, link, emoji}]
  channel_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  posted_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open', -- open | closed
  results     TEXT                    -- JSON [{text, votes}]
);

CREATE TABLE IF NOT EXISTS memories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL UNIQUE,
  user_name   TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  featured    INTEGER NOT NULL DEFAULT 0,
  anonymous   INTEGER NOT NULL DEFAULT 0,
  removed     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
  key         TEXT PRIMARY KEY,
  status      TEXT NOT NULL,          -- done | skipped | failed
  detail      TEXT,
  at          INTEGER NOT NULL
);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return createRepo(db);
}

function createRepo(db) {
  const now = () => Date.now();
  const json = (v) => (v == null ? null : JSON.parse(v));

  const repo = {
    raw: db,

    // ── nominations ───────────────────────────────────────────────
    /** Insert or replace a user's nomination for a category. Returns 'created' | 'updated'. */
    upsertNomination({ categoryId, userId, userName, value, norm, link = null, reason = null }) {
      const existing = db.prepare('SELECT id FROM nominations WHERE category_id = ? AND user_id = ?').get(categoryId, userId);
      if (existing) {
        db.prepare('UPDATE nominations SET user_name = ?, value = ?, norm = ?, link = ?, reason = ?, updated_at = ? WHERE id = ?')
          .run(userName, value, norm, link, reason, now(), existing.id);
        return 'updated';
      }
      db.prepare(`INSERT INTO nominations (category_id, user_id, user_name, value, norm, link, reason, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(categoryId, userId, userName, value, norm, link, reason, now(), now());
      return 'created';
    },
    nominationsFor(categoryId) {
      return db.prepare('SELECT * FROM nominations WHERE category_id = ? ORDER BY created_at').all(categoryId);
    },
    nominationsByUser(userId) {
      return db.prepare('SELECT * FROM nominations WHERE user_id = ? ORDER BY category_id').all(userId);
    },
    deleteNomination(categoryId, userId) {
      return db.prepare('DELETE FROM nominations WHERE category_id = ? AND user_id = ?').run(categoryId, userId).changes;
    },
    nominationCounts() {
      return db.prepare('SELECT category_id, COUNT(*) AS n, COUNT(DISTINCT norm) AS nominees FROM nominations GROUP BY category_id').all();
    },
    nominatorCount() {
      return db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM nominations').get().n;
    },
    /** Merge nominee `fromNorm` into `toNorm` within a category. */
    mergeNominees(categoryId, fromNorm, toNorm) {
      return db.transaction(() => {
        const n = db.prepare('UPDATE nominations SET norm = ? WHERE category_id = ? AND norm = ?').run(toNorm, categoryId, fromNorm).changes;
        db.prepare('DELETE FROM nominee_overrides WHERE category_id = ? AND norm = ?').run(categoryId, fromNorm);
        return n;
      })();
    },
    overridesFor(categoryId) {
      const rows = db.prepare('SELECT * FROM nominee_overrides WHERE category_id = ?').all(categoryId);
      return new Map(rows.map((r) => [r.norm, { display: r.display, link: r.link, excluded: Boolean(r.excluded) }]));
    },
    setOverride(categoryId, norm, patch) {
      const cur = db.prepare('SELECT * FROM nominee_overrides WHERE category_id = ? AND norm = ?').get(categoryId, norm) ?? {};
      const next = {
        display: 'display' in patch ? patch.display : cur.display ?? null,
        link: 'link' in patch ? patch.link : cur.link ?? null,
        excluded: 'excluded' in patch ? (patch.excluded ? 1 : 0) : cur.excluded ?? 0,
      };
      db.prepare(`INSERT INTO nominee_overrides (category_id, norm, display, link, excluded) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT (category_id, norm) DO UPDATE SET display = excluded.display, link = excluded.link, excluded = excluded.excluded`)
        .run(categoryId, norm, next.display, next.link, next.excluded);
    },

    // ── polls ─────────────────────────────────────────────────────
    savePoll({ pollKey, kind, question, options, channelId, messageId, postedAt, endsAt }) {
      db.prepare(`INSERT INTO polls (poll_key, kind, question, options, channel_id, message_id, posted_at, ends_at, status, results)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL)
                  ON CONFLICT (poll_key) DO UPDATE SET kind = excluded.kind, question = excluded.question, options = excluded.options,
                    channel_id = excluded.channel_id, message_id = excluded.message_id, posted_at = excluded.posted_at,
                    ends_at = excluded.ends_at, status = 'open', results = NULL`)
        .run(pollKey, kind, question, JSON.stringify(options), channelId, messageId, postedAt, endsAt);
    },
    getPoll(pollKey) {
      const r = db.prepare('SELECT * FROM polls WHERE poll_key = ?').get(pollKey);
      return r && { ...r, options: json(r.options), results: json(r.results) };
    },
    allPolls() {
      return db.prepare('SELECT * FROM polls ORDER BY posted_at').all().map((r) => ({ ...r, options: json(r.options), results: json(r.results) }));
    },
    pollsDue(nowMs) {
      return db.prepare("SELECT * FROM polls WHERE status = 'open' AND ends_at <= ?").all(nowMs).map((r) => ({ ...r, options: json(r.options) }));
    },
    saveResults(pollKey, results, status = 'closed') {
      db.prepare('UPDATE polls SET results = ?, status = ? WHERE poll_key = ?').run(JSON.stringify(results), status, pollKey);
    },
    setPollEndsAt(pollKey, endsAt) {
      db.prepare('UPDATE polls SET ends_at = ? WHERE poll_key = ?').run(endsAt, pollKey);
    },

    // ── memories ──────────────────────────────────────────────────
    upsertMemory({ userId, userName, text }) {
      const existing = db.prepare('SELECT id FROM memories WHERE user_id = ?').get(userId);
      if (existing) {
        db.prepare('UPDATE memories SET user_name = ?, text = ?, updated_at = ?, removed = 0 WHERE id = ?').run(userName, text, now(), existing.id);
        return { id: existing.id, status: 'updated' };
      }
      const info = db.prepare('INSERT INTO memories (user_id, user_name, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(userId, userName, text, now(), now());
      return { id: Number(info.lastInsertRowid), status: 'created' };
    },
    memoryByUser(userId) {
      return db.prepare('SELECT * FROM memories WHERE user_id = ? AND removed = 0').get(userId);
    },
    getMemory(id) {
      return db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    },
    listMemories({ featuredOnly = false, limit = 10, offset = 0 } = {}) {
      const where = featuredOnly ? 'removed = 0 AND featured = 1' : 'removed = 0';
      return db.prepare(`SELECT * FROM memories WHERE ${where} ORDER BY featured DESC, created_at LIMIT ? OFFSET ?`).all(limit, offset);
    },
    countMemories() {
      return db.prepare('SELECT COUNT(*) AS total, SUM(featured) AS featured FROM memories WHERE removed = 0').get();
    },
    updateMemory(id, patch) {
      const fields = Object.keys(patch);
      if (!fields.length) return 0;
      const set = fields.map((f) => `${f} = ?`).join(', ');
      return db.prepare(`UPDATE memories SET ${set} WHERE id = ?`).run(...fields.map((f) => (typeof patch[f] === 'boolean' ? Number(patch[f]) : patch[f])), id).changes;
    },

    // ── scheduled jobs ────────────────────────────────────────────
    jobStatus(key) {
      return db.prepare('SELECT * FROM jobs WHERE key = ?').get(key);
    },
    allJobs() {
      return new Map(db.prepare('SELECT * FROM jobs').all().map((r) => [r.key, r]));
    },
    markJob(key, status, detail = null) {
      db.prepare(`INSERT INTO jobs (key, status, detail, at) VALUES (?, ?, ?, ?)
                  ON CONFLICT (key) DO UPDATE SET status = excluded.status, detail = excluded.detail, at = excluded.at`)
        .run(key, status, detail, now());
    },
    resetJob(key) {
      db.prepare('DELETE FROM jobs WHERE key = ?').run(key);
    },
  };
  return repo;
}

module.exports = { open };
