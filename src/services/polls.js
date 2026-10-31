const config = require('../config');
const { pollDurationHours } = require('../lib/plan');
const { pickWinners } = require('../lib/tally');
const { truncate } = require('../lib/text');
const { findCategory, ts } = require('./event');
const { pollOptions } = require('./nominations');
const { DateTime } = require('luxon');

const SECTION_HEADERS = {
  superlatives: '🏆 Member Superlatives',
  favorites: '💿 2026 Fan Favorites',
  moments: '✨ MEOVV Moments of 2026',
};

function pollIntro(cat, options, endsAt) {
  const name = config.event.eventName.toUpperCase();
  const kicker = cat.type === 'review' ? `🔁 Year in Review · ${SECTION_HEADERS[cat.section] ?? ''}` : SECTION_HEADERS[cat.section] ?? '';
  const lines = [`## ${name}`, `${kicker}`.trim(), ''];
  if (cat.type === 'superlative') {
    lines.push(`**${cat.title}** — who takes this superlative? Vote below! 🗳️`);
  } else if (cat.type === 'nomination') {
    lines.push(`**${cat.title}** — these are your top nominations from Week 1. Vote for your favorite! 🗳️`);
  } else {
    lines.push(`**${cat.title}** — vote below! 🗳️`);
  }
  const linked = options.filter((o) => o.link);
  if (linked.length) {
    lines.push('', '**Revisit the nominees before you vote:**');
    options.forEach((o) => {
      if (o.link) lines.push(`• **${o.text}** — <${o.link}>`);
    });
  }
  lines.push('', `Poll closes ${ts(endsAt, 'R')} (${ts(endsAt, 'f')}).`);
  if (config.env.pingRoleId) lines.push(`<@&${config.env.pingRoleId}>`);
  return truncate(lines.join('\n'), 2000);
}

/**
 * Post the poll for `pollKey`.
 * @param {{client, db}} ctx
 * @param {string} pollKey
 * @param {{options?:Array, force?:boolean}} opts  options overrides the automatic answers
 * @returns {Promise<{posted:boolean, reason?:string, url?:string, note?:string}>}
 */
async function postPoll(ctx, pollKey, opts = {}) {
  const { client, db } = ctx;
  const cat = findCategory(pollKey);
  if (!cat) return { posted: false, reason: `Unknown or disabled category \`${pollKey}\`.` };

  const existing = db.getPoll(pollKey);
  if (existing && !opts.force) {
    return { posted: false, reason: `A poll for **${cat.title}** was already posted. Use \`force\` to post a new one (the old results will be replaced).` };
  }

  const built = opts.options ? { options: opts.options } : pollOptions(db, pollKey);
  const options = built.options.slice(0, 10);
  if (options.length < 2) {
    return { posted: false, reason: `**${cat.title}** has only ${options.length} eligible option(s) — need at least 2. Add options with \`/yb poll post options:\` or check nominations.` };
  }

  const channel = await client.channels.fetch(config.env.pollChannelId);
  const duration = pollDurationHours(config.event, config.now());
  const endsAt = DateTime.now().plus({ hours: duration });
  const message = await channel.send({
    content: pollIntro(cat, options, endsAt),
    poll: {
      question: { text: truncate(`${cat.title}`, 300) },
      answers: options.map((o) => (o.emoji ? { text: o.text, emoji: o.emoji } : { text: o.text })),
      duration,
      allowMultiselect: false,
    },
    allowedMentions: { roles: config.env.pingRoleId ? [config.env.pingRoleId] : [] },
  });

  db.savePoll({
    pollKey,
    kind: cat.type,
    question: cat.title,
    options,
    channelId: channel.id,
    messageId: message.id,
    postedAt: Date.now(),
    endsAt: message.poll?.expiresTimestamp ?? endsAt.toMillis(),
  });
  return { posted: true, url: message.url, note: built.note };
}

/** Read live vote counts from Discord. */
async function fetchResults(ctx, poll) {
  const channel = await ctx.client.channels.fetch(poll.channel_id);
  const message = await channel.messages.fetch({ message: poll.message_id, force: true });
  if (!message.poll) throw new Error(`Message ${poll.message_id} has no poll`);
  const answers = [...message.poll.answers.values()]
    .sort((a, b) => a.id - b.id)
    .map((a, i) => ({ text: a.text, votes: a.voteCount ?? 0, link: poll.options[i]?.link ?? null }));
  return { answers, finalized: Boolean(message.poll.resultsFinalized), url: message.url };
}

function formatResults(title, answers) {
  const { winners, totalVotes } = pickWinners(answers);
  const sorted = [...answers].sort((a, b) => b.votes - a.votes);
  const lines = sorted.map((a) => {
    const pct = totalVotes ? Math.round((a.votes / totalVotes) * 100) : 0;
    const crown = winners.includes(a) ? '👑 ' : '';
    return `${crown}**${a.text}** — ${a.votes} vote${a.votes === 1 ? '' : 's'} (${pct}%)`;
  });
  const tie = winners.length > 1 ? '\n⚠️ **Tie!** Decide how to break it before the reveal (or feature both).' : '';
  return `**${title}** · ${totalVotes} total votes\n${lines.join('\n')}${tie}`;
}

/** Collect results of every poll whose time is up. Called from the scheduler. */
async function closeDuePolls(ctx, log) {
  for (const poll of ctx.db.pollsDue(Date.now())) {
    try {
      const { answers, finalized } = await fetchResults(ctx, poll);
      // Discord finalises counts shortly after expiry; give it up to 15 minutes.
      if (!finalized && Date.now() < poll.ends_at + 15 * 60_000) continue;
      ctx.db.saveResults(poll.poll_key, answers, 'closed');
      await log(`📊 Poll closed — results saved (keep it secret until the reveal 🤫)\n${formatResults(poll.question, answers)}`);
    } catch (err) {
      console.error(`[polls] failed to collect ${poll.poll_key}`, err);
      if (Date.now() > poll.ends_at + 6 * 3600_000) {
        ctx.db.saveResults(poll.poll_key, [], 'closed');
        await log(`⚠️ Could not read results for **${poll.question}** (${err.message}). Was the poll message deleted? Marked closed with no results.`);
      }
    }
  }
}

/** End a poll early. */
async function endPoll(ctx, pollKey) {
  const poll = ctx.db.getPoll(pollKey);
  if (!poll) return { ok: false, reason: 'No poll has been posted for that category yet.' };
  if (poll.status === 'closed') return { ok: false, reason: 'That poll is already closed.' };
  const channel = await ctx.client.channels.fetch(poll.channel_id);
  try {
    await channel.messages.endPoll(poll.message_id);
  } catch (err) {
    if (!/expired/i.test(err.message)) throw err;
  }
  ctx.db.setPollEndsAt(pollKey, Date.now());
  return { ok: true };
}

module.exports = { postPoll, fetchResults, formatResults, closeDuePolls, endPoll, pollIntro, SECTION_HEADERS };
