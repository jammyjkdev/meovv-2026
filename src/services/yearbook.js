const { AttachmentBuilder } = require('discord.js');
const config = require('../config');
const { pickWinners } = require('../lib/tally');
const { allCategories } = require('./event');
const { renderAll } = require('./pages');
const log = require('../lib/log')('yearbook');

/**
 * Compile everything into the yearbook data structure.
 * Sections: superlatives, favorites, moments, memories.
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

  return {
    title: config.event.eventName,
    generatedAt: new Date().toISOString(),
    superlatives: section('superlatives'),
    favorites: section('favorites'),
    moments: section('moments'),
    memories,
  };
}

/** Things staff should fix before publishing. */
function problems(book) {
  const issues = [];
  for (const e of [...book.superlatives, ...book.favorites, ...book.moments]) {
    if (e.status === 'not-posted') issues.push(`**${e.title}** — poll never posted`);
    else if (e.status === 'open') issues.push(`**${e.title}** — poll still open / results not collected`);
    else if (e.status === 'no-votes') issues.push(`**${e.title}** — no votes`);
    else if (e.winners.length > 1) issues.push(`**${e.title}** — tie between ${e.winners.map((w) => w.text).join(' & ')}`);
  }
  if (!book.memories.length) issues.push('No fan responses featured yet (`/yb memories feature`)');
  return issues;
}


/** Every page of the yearbook as PNG attachments. */
function pageFiles(book) {
  return renderAll(book).map((p) => new AttachmentBuilder(p.buffer, { name: p.name }));
}

/** Post the yearbook to the yearbook channel: the cover with the ping, then one message per page so each shows full size. */
async function publish(ctx) {
  const book = await compile(ctx.db);
  const channel = await ctx.client.channels.fetch(config.env.yearbookChannelId);
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

module.exports = { compile, problems, pageFiles, publish };