const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { normalize, truncate, isHttpUrl } = require('../src/lib/text');
const { rankNominations, pickWinners } = require('../src/lib/tally');
const { buildPlan, pollDurationHours, slotTimes } = require('../src/lib/plan');
const cfg = require('../config/yearbook.config.js');

test('normalize groups spelling variants', () => {
  assert.equal(normalize('TOXIC!!'), normalize(' toxic '));
  assert.equal(normalize('“Hands Up”'), 'hands up');
  assert.equal(normalize('Café'), 'cafe');
  assert.equal(normalize('미야오'), '미야오');
  assert.equal(normalize('!!!'), '');
});

test('truncate and url checks', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
  assert.ok(isHttpUrl('https://youtu.be/x'));
  assert.ok(!isHttpUrl('javascript:alert(1)'));
  assert.ok(!isHttpUrl('not a url'));
});

test('rankNominations counts, picks display/link, applies overrides', () => {
  const rows = [
    { norm: 'a', value: 'A!', link: 'https://x/1', created_at: 1 },
    { norm: 'a', value: 'a', link: 'https://x/2', created_at: 2 },
    { norm: 'a', value: 'a', link: 'https://x/2', created_at: 3 },
    { norm: 'b', value: 'B', link: null, created_at: 0 },
    { norm: 'c', value: 'C', link: null, created_at: 5 },
    { norm: 'c', value: 'C', link: null, created_at: 6 },
  ];
  const r = rankNominations(rows);
  assert.deepEqual(r.map((n) => [n.norm, n.count]), [['a', 3], ['c', 2], ['b', 1]]);
  assert.equal(r[0].display, 'a');
  assert.equal(r[0].link, 'https://x/2');
  const o = rankNominations(rows, new Map([['a', { excluded: true }], ['c', { display: 'Cee', link: 'https://c' }]]));
  assert.deepEqual(o.map((n) => n.norm), ['c', 'b']);
  assert.equal(o[0].display, 'Cee');
  assert.equal(o[0].link, 'https://c');
});

test('pickWinners handles ties and zero votes', () => {
  assert.deepEqual(pickWinners([{ text: 'a', votes: 0 }]).winners, []);
  assert.deepEqual(pickWinners([{ text: 'a', votes: 2 }, { text: 'b', votes: 2 }, { text: 'c', votes: 1 }]).winners.map((w) => w.text), ['a', 'b']);
});

test('plan covers every enabled category exactly once, inside the right weeks', () => {
  const plan = buildPlan(cfg);
  const z = cfg.timezone;
  const polls = plan.filter((j) => j.type === 'poll');
  const enabled = (l) => l.filter((c) => c.enabled !== false).map((c) => c.id);
  const expected = [...enabled(cfg.superlatives), ...enabled(cfg.nominationCategories), ...enabled(cfg.reviewPolls)];
  assert.deepEqual(polls.map((p) => p.payload.pollKey).sort(), expected.sort());
  assert.equal(new Set(plan.map((j) => j.key)).size, plan.length, 'keys unique');

  const vStart = DateTime.fromISO(cfg.phases.voting.start, { zone: z });
  const vEnd = DateTime.fromISO(cfg.phases.voting.end, { zone: z });
  const rStart = DateTime.fromISO(cfg.phases.review.start, { zone: z });
  const reveal = DateTime.fromISO(cfg.phases.reveal, { zone: z });
  for (const p of polls) {
    if (p.payload.kind === 'review') assert.ok(p.at >= rStart && p.at < reveal, p.key);
    else assert.ok(p.at >= vStart && p.at <= vEnd, p.key);
  }
  // every voting day gets at least one poll
  const days = new Set(polls.filter((p) => p.payload.kind !== 'review').map((p) => p.at.toISODate()));
  assert.equal(days.size, 7);
  // no more than 3 a day
  const perDay = {};
  for (const p of polls) perDay[p.at.toISODate()] = (perDay[p.at.toISODate()] ?? 0) + 1;
  assert.ok(Math.max(...Object.values(perDay)) <= 3, JSON.stringify(perDay));
  assert.equal(plan.at(-1).key, 'reveal');
});

test('poll duration never runs past the reveal deadline', () => {
  const z = cfg.timezone;
  const early = DateTime.fromISO('2026-11-09T12:00', { zone: z });
  assert.equal(pollDurationHours(cfg, early), cfg.polls.durationHours);
  const late = DateTime.fromISO('2026-11-21T20:00', { zone: z });
  const h = pollDurationHours(cfg, late);
  const reveal = DateTime.fromISO(cfg.phases.reveal, { zone: z });
  assert.ok(late.plus({ hours: h }) <= reveal.minus({ hours: cfg.polls.closeBeforeRevealHours }));
  assert.equal(pollDurationHours(cfg, reveal), 1);
});

test('slotTimes pads and sorts', () => {
  assert.deepEqual(slotTimes(['20:00', '12:00'], 2), ['12:00', '20:00']);
  assert.equal(slotTimes(['12:00'], 4).length, 4);
});
