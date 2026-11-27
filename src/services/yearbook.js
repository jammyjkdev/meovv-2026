const { AttachmentBuilder } = require('discord.js');
const config = require('../config');
const { pickWinners } = require('../lib/tally');
const { allCategories, findMember } = require('./event');
const { renderAll } = require('./pages');
const log = require('../lib/log')('yearbook');

/**
 * Compile everything into the yearbook data structure.
 * Sections: superlatives, notes (approved "why" notes, by superlative), favorites, moments, memories.
 */
async function compile(db) {
  const polls = new Map((await db.allPolls()).map((p) => [p.poll_key, p]));
  const entry = (cat) => {
    const poll = polls.get(cat.id);
    const answers = poll?.results ?? null;
    const { winners, totalVotes } = answers ? pickWinners(answers) : { winners: [], totalVotes: 0 };
    return {
      id: cat.id,
      title: cat.title,
      type: cat.type,
      status: !poll ? 'not-posted' : poll.status === 'open' ? 'open' : winners.length ? 'decided' : 'no-votes',
      winners: winners.map((w) => ({ text: w.text, votes: w.votes, link: w.link ?? null })),
      totalVotes,
      results: answers ?? [],
    };
  };

  const cats = allCategories();
  const section = (name) => cats.filter((c) => c.section === name).map(entry);
  const memories = (await db.listMemories({ featuredOnly: true, limit: 500 })).map((m) => ({
    id: m.id,
    author: m.anonymous ? 'A MEOVV fan' : m.user_name,
    text: m.text,
  }));

  const superlatives = section('superlatives');
  return {
    title: config.event.eventName,
    generatedAt: new Date().toISOString(),
    superlatives,
    notes: groupNotes(superlatives, await db.approvedReasons()),
    favorites: section('favorites'),
    moments: section('moments'),
    memories,
  };
}

/**
 * Approved nomination notes, grouped by superlative and then member: the winner first,
 * then the other members in their usual order. Categories without approved notes are left out.
 */
function groupNotes(superlatives, reasons) {
  const order = config.event.members.map((m) => m.id);
  return superlatives
    .map((cat) => {
      const winners = new Set(cat.winners.map((w) => findMember(w.text)?.id).filter(Boolean));
      const byMember = new Map();
      for (const r of reasons.filter((x) => x.category_id === cat.id)) {
        if (!byMember.has(r.norm)) byMember.set(r.norm, []);
        byMember.get(r.norm).push({ author: r.reason_anonymous ? 'A MEOVV fan' : r.user_name, text: r.reason });
      }
      const groups = [...byMember.entries()]
        .map(([id, notes]) => {
          const m = findMember(id);
          return { member: m?.name ?? id, emoji: m?.emoji ?? null, color: m?.color ?? null, winner: winners.has(id), notes };
        })
        .sort((a, b) => b.winner - a.winner || order.indexOf(findMember(a.member)?.id) - order.indexOf(findMember(b.member)?.id));
      return { id: cat.id, title: cat.title, groups };
    })
    .filter((c) => c.groups.length);
}

/** Things staff should fix before publishing. */
function problems(book, pending = null) {
  const issues = [];
  for (const e of [...book.superlatives, ...book.favorites, ...book.moments]) {
    if (e.status === 'not-posted') issues.push(`**${e.title}** — poll never posted`);
    else if (e.status === 'open') issues.push(`**${e.title}** — poll still open / results not collected`);
    else if (e.status === 'no-votes') issues.push(`**${e.title}** — no votes`);
    else if (e.winners.length > 1) issues.push(`**${e.title}** — tie between ${e.winners.map((w) => w.text).join(' & ')}`);
  }
  if (!book.memories.length) issues.push('No fan moments approved yet (`/yb review`)');
  if (pending?.memory) issues.push(`${pending.memory} fan moment(s) still waiting for review (\`/yb review type:moments\`)`);
  if (pending?.reason) issues.push(`${pending.reason} nomination note(s) still waiting for review (\`/yb review type:notes\`)`);
  return issues;
}


// ── approval gate ──────────────────────────────────────────────
// Nothing publishes, by hand or on schedule, until an admin approves. Stored with the scheduler's jobs.
const APPROVAL_KEY = 'yearbook:approved';

/** `{ by, at }` when approved, else null. */
async function approval(db) {
  const job = await db.jobStatus(APPROVAL_KEY);
  return job?.status === 'done' ? { by: job.detail, at: job.at } : null;
}
async function approve(db, user) {
  await db.markJob(APPROVAL_KEY, 'done', user.id);
  log.info('yearbook approved for publishing', { by: user.id });
}
async function lock(db) {
  await db.resetJob(APPROVAL_KEY);
  log.info('yearbook locked');
}

/** Every page of the yearbook as PNG attachments. */
function pageFiles(book) {
  return renderAll(book).map((p) => new AttachmentBuilder(p.buffer, { name: p.name }));
}

/** Post the yearbook to the main event channel: the cover with the ping, then one message per page so each shows full size. */
async function publish(ctx) {
  if (!(await approval(ctx.db))) throw new Error('The yearbook has not been approved for publishing (/yb yearbook approve)');
  const book = await compile(ctx.db);
  const channel = await ctx.client.channels.fetch(config.env.announceChannelId);
  const files = pageFiles(book);
  log.info('publishing yearbook', { pages: files.length, channel: channel.id });
  const ping = config.env.pingRoleId ? `<@&${config.env.pingRoleId}> ` : '';
  let first;
  for (let i = 0; i < files.length; i++) {
    const msg = await channel.send({
      content: i === 0 ? `${ping}📖 **The ${book.title} is here!**` : undefined,
      files: [files[i]],
      allowedMentions: { roles: config.env.pingRoleId ? [config.env.pingRoleId] : [] },
    });
    first ??= msg;
  }
  return { url: first?.url, book };
}

module.exports = { compile, groupNotes, problems, pageFiles, publish, approval, approve, lock };