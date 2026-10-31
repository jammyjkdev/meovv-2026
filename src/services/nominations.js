const config = require('../config');
const { rankNominations } = require('../lib/tally');
const { normalize, truncate } = require('../lib/text');
const { findCategory, findMember } = require('./event');

/** Ranked nominees for a category (superlative or 2026 nomination). */
function ranked(db, categoryId) {
  return rankNominations(db.nominationsFor(categoryId), db.overridesFor(categoryId));
}

/**
 * Build poll answers for a category.
 * @returns {{options:Array<{text:string,link:string|null,emoji:string|null,norm?:string}>, note?:string}}
 */
function pollOptions(db, categoryId) {
  const cat = findCategory(categoryId);
  if (!cat) throw new Error(`Unknown category "${categoryId}"`);
  const pc = config.event.polls;

  if (cat.type === 'superlative') {
    const members = config.event.members;
    let picked = members;
    if (pc.superlativeFinalists < members.length) {
      const counts = new Map(ranked(db, cat.id).map((n) => [n.norm, n.count]));
      picked = [...members]
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
        .slice(0, pc.superlativeFinalists);
      // keep the poll in the member list's natural order
      picked = members.filter((m) => picked.includes(m));
    }
    return { options: picked.map((m) => ({ text: m.name, link: null, emoji: m.emoji ?? null, norm: m.id })) };
  }

  if (cat.type === 'nomination') {
    const finalists = ranked(db, cat.id)
      .filter((n) => n.count >= (pc.minNominationsToQualify ?? 1))
      .slice(0, pc.finalistsPerPoll);
    return { options: finalists.map((n) => ({ text: truncate(n.display, 55), link: n.link, emoji: null, norm: n.norm, nominations: n.count })) };
  }

  // review poll: hand-picked options win, otherwise pool the source categories' top nominees.
  if (cat.options?.length) {
    return {
      options: cat.options.slice(0, 10).map((o) => (typeof o === 'string' ? { text: truncate(o, 55), link: null, emoji: null } : { text: truncate(o.text, 55), link: o.link ?? null, emoji: o.emoji ?? null })),
    };
  }
  const pooled = new Map();
  for (const src of cat.sources ?? []) {
    for (const n of ranked(db, src)) {
      const cur = pooled.get(n.norm);
      if (cur) cur.count += n.count;
      else pooled.set(n.norm, { ...n });
    }
  }
  const top = [...pooled.values()].sort((a, b) => b.count - a.count || a.firstAt - b.firstAt).slice(0, Math.min(10, Math.max(pc.finalistsPerPoll, 5)));
  return {
    options: top.map((n) => ({ text: truncate(n.display, 55), link: n.link, emoji: null, norm: n.norm })),
    note: 'Options were pulled automatically from Week 1 nominations. Set `options` in the config to hand-pick them.',
  };
}

/** Record a member superlative nomination. */
function nominateMember(db, { categoryId, memberId, user, reason }) {
  const member = findMember(memberId);
  if (!member) throw new UserError('That member isn’t on the list.');
  return db.upsertNomination({ categoryId, userId: user.id, userName: user.name, value: member.name, norm: member.id, reason: reason || null });
}

/** Record a 2026 content/moment nomination. */
function nominateMoment(db, { categoryId, text, link, user }) {
  const norm = normalize(text);
  if (!norm) throw new UserError('Please type a nomination (letters or numbers).');
  return db.upsertNomination({ categoryId, userId: user.id, userName: user.name, value: text, norm, link: link || null });
}

class UserError extends Error {}

module.exports = { ranked, pollOptions, nominateMember, nominateMoment, UserError };
