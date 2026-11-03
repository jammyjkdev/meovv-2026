const path = require('node:path');
const { DateTime } = require('luxon');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // no .env file — rely on real environment variables
}

const event = require('../config/yearbook.config.js');

// TZ in .env sets the event timezone; every date in the config is read in this zone.
if (process.env.TZ) event.timezone = process.env.TZ;

/** Parse a local date/time string from the config into a luxon DateTime in the event timezone. */
function at(value, zone = event.timezone) {
  const dt = DateTime.fromISO(value, { zone });
  if (!dt.isValid) throw new Error(`Invalid date in config: "${value}" (${dt.invalidExplanation})`);
  return dt;
}

function validate(cfg) {
  const errors = [];
  const ids = new Set();
  const all = [...cfg.superlatives, ...cfg.nominationCategories, ...cfg.reviewPolls];
  for (const c of all) {
    if (ids.has(c.id)) errors.push(`Duplicate category id "${c.id}"`);
    ids.add(c.id);
    if (c.title.length > 250) errors.push(`Title too long for "${c.id}"`);
  }
  const nomIds = new Set(cfg.nominationCategories.map((c) => c.id));
  for (const r of cfg.reviewPolls) {
    for (const s of r.sources ?? []) {
      if (!nomIds.has(s)) errors.push(`Review poll "${r.id}" has unknown source "${s}"`);
    }
    if (r.options && r.options.length > 10) errors.push(`Review poll "${r.id}" has more than 10 options`);
  }
  if (cfg.members.length < 2 || cfg.members.length > 10) errors.push('members must have 2–10 entries');
  if (cfg.polls.finalistsPerPoll < 2 || cfg.polls.finalistsPerPoll > 10) errors.push('polls.finalistsPerPoll must be 2–10');
  for (const p of ['nominations', 'voting', 'review']) {
    at(cfg.phases[p].start);
    at(cfg.phases[p].end);
  }
  at(cfg.phases.reveal);
  if (errors.length) throw new Error(`Config errors:\n - ${errors.join('\n - ')}`);
}

validate(event);

// Rehearsal clock: YEARBOOK_NOW shifts "now" so the schedule can be dry-run.
let clockOffsetMs = 0;
if (process.env.YEARBOOK_NOW) {
  clockOffsetMs = at(process.env.YEARBOOK_NOW).toMillis() - Date.now();
}

function now() {
  return DateTime.fromMillis(Date.now() + clockOffsetMs, { zone: event.timezone });
}

const env = {
  token: process.env.BOT_TOKEN,
  ownerId: process.env.BOT_OWNER_ID || null,
  guildId: process.env.GUILD_ID,
  mongoUri: process.env.MONGO_URI,
  announceChannelId: process.env.ANNOUNCE_CHANNEL_ID,
  pollChannelId: process.env.POLL_CHANNEL_ID,
  yearbookChannelId: process.env.YEARBOOK_CHANNEL_ID,
  logChannelId: process.env.LOG_CHANNEL_ID,
  pingRoleId: process.env.PING_ROLE_ID || null,
  adminRoleId: process.env.ADMIN_ROLE_ID || null,
  dataDir: path.join(__dirname, '..', 'data'),
  rehearsal: Boolean(process.env.YEARBOOK_NOW),
};

const enabled = (list) => list.filter((c) => c.enabled !== false);

module.exports = {
  event,
  env,
  at,
  now,
  validate,
  superlatives: () => enabled(event.superlatives),
  nominationCategories: () => enabled(event.nominationCategories),
  reviewPolls: () => enabled(event.reviewPolls),
};
