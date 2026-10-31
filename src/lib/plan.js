const { DateTime } = require('luxon');

/**
 * Build the full event timeline from the config. Pure function — no Discord, no DB.
 *
 * Job types:
 *  - announce  { phase }           phase kick-off post
 *  - reminder  { index }           reminder post
 *  - poll      { pollKey, kind }   post a yearbook poll (kind: superlative | nomination | review)
 *  - reveal    {}                  publish yearbook (or remind staff to)
 *
 * @param {object} cfg the yearbook config object
 * @returns {Array<{key:string,type:string,at:DateTime,expiresAt:DateTime|null,payload:object}>}
 */
function buildPlan(cfg) {
  const zone = cfg.timezone;
  const t = (v) => DateTime.fromISO(v, { zone });
  const enabled = (list) => list.filter((c) => c.enabled !== false);
  const ph = cfg.phases;
  const reveal = t(ph.reveal);
  const pollDeadline = reveal.minus({ hours: cfg.polls.closeBeforeRevealHours ?? 2 });
  const jobs = [];

  jobs.push({ key: 'announce:nominations', type: 'announce', at: t(ph.nominations.start), expiresAt: t(ph.nominations.end), payload: { phase: 'nominations' } });
  jobs.push({ key: 'announce:voting', type: 'announce', at: t(ph.voting.start), expiresAt: t(ph.voting.end), payload: { phase: 'voting' } });
  jobs.push({ key: 'announce:review', type: 'announce', at: t(ph.review.start), expiresAt: t(ph.review.end), payload: { phase: 'review' } });

  (cfg.reminders ?? []).forEach((r, index) => {
    const at = t(r.at);
    jobs.push({ key: `reminder:${index}`, type: 'reminder', at, expiresAt: at.plus({ hours: 6 }), payload: { index } });
  });

  // WEEK 2 — interleave superlatives and 2026 nominations so every day has a mix.
  const sup = enabled(cfg.superlatives).map((c) => ({ pollKey: c.id, kind: 'superlative' }));
  const nom = enabled(cfg.nominationCategories).map((c) => ({ pollKey: c.id, kind: 'nomination' }));
  const week2 = [];
  for (let i = 0; i < Math.max(sup.length, nom.length); i++) {
    if (sup[i]) week2.push(sup[i]);
    if (nom[i]) week2.push(nom[i]);
  }
  const week2Days = daysBetween(t(ph.voting.start), t(ph.voting.end));
  spread(week2, week2Days, cfg.polls.postTimes, t(ph.voting.start), zone).forEach((s) => {
    jobs.push({ key: `poll:${s.item.pollKey}`, type: 'poll', at: s.at, expiresAt: pollDeadline.minus({ hours: 1 }), payload: s.item });
  });

  // WEEK 3 — retrospective polls.
  const review = enabled(cfg.reviewPolls).map((c) => ({ pollKey: c.id, kind: 'review' }));
  const lastReviewDay = cfg.polls.reviewPollsUntil ? t(cfg.polls.reviewPollsUntil) : t(ph.review.end);
  const reviewDays = daysBetween(t(ph.review.start), lastReviewDay);
  spread(review, reviewDays, cfg.polls.postTimes, t(ph.review.start), zone).forEach((s) => {
    jobs.push({ key: `poll:${s.item.pollKey}`, type: 'poll', at: s.at, expiresAt: pollDeadline.minus({ hours: 1 }), payload: s.item });
  });

  jobs.push({ key: 'reveal', type: 'reveal', at: reveal, expiresAt: null, payload: {} });

  return jobs.sort((a, b) => a.at.toMillis() - b.at.toMillis());
}

/** Calendar days (as start-of-day DateTimes) from a to b inclusive. */
function daysBetween(a, b) {
  const days = [];
  for (let d = a.startOf('day'); d <= b.startOf('day'); d = d.plus({ days: 1 })) days.push(d);
  return days;
}

/**
 * Spread items evenly over days. Each day uses the first N post times it needs, sorted
 * chronologically. Nothing is scheduled before `notBefore`.
 */
function spread(items, days, postTimes, notBefore, zone) {
  if (!items.length || !days.length) return [];
  const perDay = new Map();
  items.forEach((item, i) => {
    const d = Math.floor((i * days.length) / items.length);
    if (!perDay.has(d)) perDay.set(d, []);
    perDay.get(d).push(item);
  });

  const out = [];
  for (const [d, dayItems] of perDay) {
    const times = slotTimes(postTimes, dayItems.length);
    dayItems.forEach((item, j) => {
      const [h, m] = times[j].split(':').map(Number);
      let at = days[d].setZone(zone).set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (at < notBefore) at = notBefore.plus({ minutes: j * 5 });
      out.push({ item, at });
    });
  }
  return out;
}

/** Pick `n` posting times: the configured ones first, then hourly fallbacks. Sorted. */
function slotTimes(postTimes, n) {
  const times = [...postTimes];
  for (let h = 9; times.length < n && h < 24; h++) {
    const s = `${String(h).padStart(2, '0')}:00`;
    if (!times.includes(s)) times.push(s);
  }
  return times.slice(0, n).sort();
}

/**
 * Hours a poll posted at `postedAt` should run: the configured duration, but always
 * ending before the reveal deadline. Minimum 1 hour (Discord's minimum).
 */
function pollDurationHours(cfg, postedAt) {
  const reveal = DateTime.fromISO(cfg.phases.reveal, { zone: cfg.timezone });
  const deadline = reveal.minus({ hours: cfg.polls.closeBeforeRevealHours ?? 2 });
  const hoursLeft = Math.floor(deadline.diff(postedAt, 'hours').hours);
  return Math.max(1, Math.min(cfg.polls.durationHours, hoursLeft, 768));
}

module.exports = { buildPlan, pollDurationHours, daysBetween, slotTimes };
