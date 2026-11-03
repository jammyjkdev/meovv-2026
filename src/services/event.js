const config = require('../config');

/** Every pollable category, with a `type` tag. */
function allCategories() {
  return [
    ...config.superlatives().map((c) => ({ ...c, type: 'superlative', section: 'superlatives' })),
    ...config.nominationCategories().map((c) => ({ ...c, type: 'nomination' })),
    ...config.reviewPolls().map((c) => ({ ...c, type: 'review' })),
  ];
}

function findCategory(id) {
  return allCategories().find((c) => c.id === id) ?? null;
}

function findMember(idOrName) {
  const key = String(idOrName ?? '').toLowerCase();
  return config.event.members.find((m) => m.id === key || m.name.toLowerCase() === key) ?? null;
}

/**
 * Which part of the event we're in right now.
 * @returns {'before'|'nominations'|'between-1-2'|'voting'|'between-2-3'|'review'|'reveal-pending'|'revealed'}
 */
function currentPhase(now = config.now()) {
  const p = config.event.phases;
  const t = (v) => config.at(v);
  if (now < t(p.nominations.start)) return 'before';
  if (now <= t(p.nominations.end)) return 'nominations';
  if (now < t(p.voting.start)) return 'between-1-2';
  if (now <= t(p.voting.end)) return 'voting';
  if (now < t(p.review.start)) return 'between-2-3';
  if (now <= t(p.review.end)) return 'review';
  if (now < t(p.reveal)) return 'reveal-pending';
  return 'revealed';
}

/** Staff start the event by running this scheduled job with `/yb schedule run`. */
const START_JOB = 'announce:nominations';

async function hasStarted(db) {
  return (await db.jobStatus(START_JOB))?.status === 'done';
}

function nominationsOpen(now = config.now()) {
  return currentPhase(now) === 'nominations';
}

function memoriesOpen(now = config.now()) {
  const p = config.event.phases;
  const closes = config.at(config.event.memories.closesAt ?? p.review.end);
  return now >= config.at(p.review.start) && now <= closes;
}

const PHASE_LABELS = {
  before: 'Starting soon',
  nominations: 'Week 1 — Nominations',
  'between-1-2': 'Nominations closed — voting starts soon',
  voting: 'Week 2 — Voting',
  'between-2-3': 'Voting wrapping up — Year in Review starts soon',
  review: 'Week 3 — Year in Review',
  'reveal-pending': 'Yearbook reveal coming soon',
  revealed: 'Yearbook revealed',
};

/** Discord timestamp markup (renders in each viewer's local time). */
function ts(dt, style = 'F') {
  return `<t:${Math.floor(dt.toSeconds())}:${style}>`;
}

module.exports = { allCategories, findCategory, findMember, currentPhase, nominationsOpen, memoriesOpen, PHASE_LABELS, ts, START_JOB, hasStarted };
