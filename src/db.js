const { MongoClient } = require('mongodb');
const log = require('./lib/log')('db');

// Used when MONGO_URI doesn't name a database (Mongo would otherwise fall back to "test").
const DEFAULT_DB_NAME = 'meovv-yearbook';
const DUPLICATE_KEY = 11000;

/** The database named in a Mongo connection string, or the bot's default if there isn't one. */
function resolveDbName(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri);
  return match?.[1] ? decodeURIComponent(match[1]) : DEFAULT_DB_NAME;
}

/** Concurrent upserts on the same unique key can collide; the retry then finds the existing doc. */
async function retryOnDuplicate(write) {
  try {
    return await write();
  } catch (err) {
    if (err.code !== DUPLICATE_KEY) throw err;
    return write();
  }
}

/** Connect, ensure indexes exist and return the repository used by the rest of the bot. */
async function open(uri, { dbName = resolveDbName(uri) } = {}) {
  const client = new MongoClient(uri);
  await client.connect();
  const database = client.db(dbName);
  log.info('Connected to MongoDB', { host: uri.replace(/\/\/.*?@/, '//'), database: dbName });
  client.on('serverHeartbeatFailed', (e) => log.warn('MongoDB heartbeat failed', { err: e.failure?.message }));
  client.on('topologyClosed', () => log.info('MongoDB connection closed'));
  const col = {
    nominations: database.collection('yearbook_nominations'),
    overrides: database.collection('yearbook_nominee_overrides'),
    polls: database.collection('yearbook_polls'),
    memories: database.collection('yearbook_memories'),
    jobs: database.collection('yearbook_jobs'),
    counters: database.collection('yearbook_counters'),
  };
  await Promise.all([
    col.nominations.createIndex({ category_id: 1, user_id: 1 }, { unique: true }),
    col.nominations.createIndex({ category_id: 1, norm: 1 }),
    col.nominations.createIndex({ user_id: 1 }),
    col.overrides.createIndex({ category_id: 1, norm: 1 }, { unique: true }),
    col.polls.createIndex({ poll_key: 1 }, { unique: true }),
    col.polls.createIndex({ status: 1, ends_at: 1 }),
    col.memories.createIndex({ id: 1 }, { unique: true }),
    col.memories.createIndex({ user_id: 1 }, { unique: true }),
    col.jobs.createIndex({ key: 1 }, { unique: true }),
  ]);
  log.debug('Indexes ready');
  return createRepo(client, col);
}

function createRepo(client, col) {
  const now = () => Date.now();

  /** Short sequential number, so staff can type `/yb memories feature id:12`. */
  async function nextMemoryId() {
    const doc = await col.counters.findOneAndUpdate(
      { _id: 'memories' },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    return doc.value;
  }

  return {
    close: () => client.close(),

    // ── nominations ───────────────────────────────────────────────
    /** Insert or replace a user's nomination for a category. Returns 'created' | 'updated'. */
    async upsertNomination({ categoryId, userId, userName, value, norm, link = null, reason = null }) {
      const t = now();
      const res = await retryOnDuplicate(() =>
        col.nominations.updateOne(
          { category_id: categoryId, user_id: userId },
          { $set: { user_name: userName, value, norm, link, reason, updated_at: t }, $setOnInsert: { created_at: t } },
          { upsert: true },
        ),
      );
      const status = res.upsertedCount ? 'created' : 'updated';
      log.debug(`nomination ${status}`, { category: categoryId, user: userId, norm });
      return status;
    },
    nominationsFor(categoryId) {
      return col.nominations.find({ category_id: categoryId }).sort({ created_at: 1 }).toArray();
    },
    nominationsByUser(userId) {
      return col.nominations.find({ user_id: userId }).sort({ category_id: 1 }).toArray();
    },
    async deleteNomination(categoryId, userId) {
      return (await col.nominations.deleteOne({ category_id: categoryId, user_id: userId })).deletedCount;
    },
    /** Remove everything a user nominated (spam / ineligible accounts). */
    async deleteNominationsByUser(userId) {
      return (await col.nominations.deleteMany({ user_id: userId })).deletedCount;
    },
    nominationCounts() {
      return col.nominations
        .aggregate([
          { $group: { _id: '$category_id', n: { $sum: 1 }, norms: { $addToSet: '$norm' } } },
          { $project: { _id: 0, category_id: '$_id', n: 1, nominees: { $size: '$norms' } } },
        ])
        .toArray();
    },
    async nominatorCount() {
      return (await col.nominations.distinct('user_id')).length;
    },
    /** Merge nominee `fromNorm` into `toNorm` within a category. */
    async mergeNominees(categoryId, fromNorm, toNorm) {
      const res = await col.nominations.updateMany({ category_id: categoryId, norm: fromNorm }, { $set: { norm: toNorm } });
      await col.overrides.deleteOne({ category_id: categoryId, norm: fromNorm });
      return res.modifiedCount;
    },
    async overridesFor(categoryId) {
      const rows = await col.overrides.find({ category_id: categoryId }).toArray();
      return new Map(rows.map((r) => [r.norm, { display: r.display, link: r.link, excluded: Boolean(r.excluded) }]));
    },
    async setOverride(categoryId, norm, patch) {
      const defaults = { display: null, link: null, excluded: false };
      const set = {};
      for (const key of Object.keys(defaults)) {
        if (key in patch) {
          set[key] = key === 'excluded' ? Boolean(patch[key]) : patch[key];
          delete defaults[key];
        }
      }
      await retryOnDuplicate(() =>
        col.overrides.updateOne({ category_id: categoryId, norm }, { $set: set, $setOnInsert: defaults }, { upsert: true }),
      );
    },

    // ── polls ─────────────────────────────────────────────────────
    async savePoll({ pollKey, kind, question, options, channelId, messageId, postedAt, endsAt }) {
      const doc = {
        poll_key: pollKey,
        kind,
        question,
        options,
        channel_id: channelId,
        message_id: messageId,
        posted_at: postedAt,
        ends_at: endsAt,
        status: 'open',
        results: null,
      };
      await retryOnDuplicate(() => col.polls.replaceOne({ poll_key: pollKey }, doc, { upsert: true }));
    },
    getPoll(pollKey) {
      return col.polls.findOne({ poll_key: pollKey });
    },
    allPolls() {
      return col.polls.find().sort({ posted_at: 1 }).toArray();
    },
    pollsDue(nowMs) {
      return col.polls.find({ status: 'open', ends_at: { $lte: nowMs } }).toArray();
    },
    async saveResults(pollKey, results, status = 'closed') {
      await col.polls.updateOne({ poll_key: pollKey }, { $set: { results, status } });
    },
    async setPollEndsAt(pollKey, endsAt) {
      await col.polls.updateOne({ poll_key: pollKey }, { $set: { ends_at: endsAt } });
    },

    // ── memories ──────────────────────────────────────────────────
    async upsertMemory({ userId, userName, text }) {
      const update = async () => {
        const doc = await col.memories.findOneAndUpdate(
          { user_id: userId },
          { $set: { user_name: userName, text, updated_at: now(), removed: false } },
        );
        return doc && { id: doc.id, status: 'updated' };
      };
      const updated = await update();
      if (updated) return updated;

      const id = await nextMemoryId();
      const t = now();
      try {
        await col.memories.insertOne({ id, user_id: userId, user_name: userName, text, created_at: t, updated_at: t, featured: false, anonymous: false, removed: false });
        return { id, status: 'created' };
      } catch (err) {
        if (err.code !== DUPLICATE_KEY) throw err;
        return update(); // the same fan submitted twice at once
      }
    },
    memoryByUser(userId) {
      return col.memories.findOne({ user_id: userId, removed: false });
    },
    getMemory(id) {
      return col.memories.findOne({ id });
    },
    listMemories({ featuredOnly = false, limit = 10, offset = 0 } = {}) {
      const filter = featuredOnly ? { removed: false, featured: true } : { removed: false };
      return col.memories.find(filter).sort({ featured: -1, created_at: 1, id: 1 }).skip(offset).limit(limit).toArray();
    },
    async countMemories() {
      const [total, featured] = await Promise.all([
        col.memories.countDocuments({ removed: false }),
        col.memories.countDocuments({ removed: false, featured: true }),
      ]);
      return { total, featured };
    },
    async updateMemory(id, patch) {
      if (!Object.keys(patch).length) return 0;
      return (await col.memories.updateOne({ id }, { $set: patch })).matchedCount;
    },

    // ── scheduled jobs ────────────────────────────────────────────
    jobStatus(key) {
      return col.jobs.findOne({ key });
    },
    async allJobs() {
      const rows = await col.jobs.find().toArray();
      return new Map(rows.map((r) => [r.key, r]));
    },
    async markJob(key, status, detail = null) {
      await retryOnDuplicate(() => col.jobs.updateOne({ key }, { $set: { status, detail, at: now() } }, { upsert: true }));
      log.debug('job marked', { key, status });
    },
    async resetJob(key) {
      await col.jobs.deleteOne({ key });
    },
  };
}

module.exports = { open, resolveDbName, DEFAULT_DB_NAME };
