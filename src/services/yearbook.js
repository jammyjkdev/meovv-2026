const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { pickWinners } = require('../lib/tally');
const { escapeHtml, truncate } = require('../lib/text');
const { allCategories } = require('./event');

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

function winnerLine(e) {
  if (!e.winners.length) return '*TBA*';
  return e.winners.map((w) => (w.link ? `[${w.text}](${w.link})` : `**${w.text}**`)).join(' & ');
}

/** Discord embeds for the reveal. */
function toEmbeds(book) {
  const color = config.event.color;
  const embeds = [
    new EmbedBuilder()
      .setColor(color)
      .setTitle(`📖 THE ${book.title.toUpperCase()}`)
      .setDescription('Three weeks of nominations, votes and memories — here’s the year **MEOVV** and this fandom made together. Thank you for every nomination, vote and story. 💗'),
  ];
  const sectionEmbed = (title, entries) => {
    if (!entries.length) return;
    const e = new EmbedBuilder().setColor(color).setTitle(title);
    for (const item of entries.slice(0, 25)) e.addFields({ name: item.title, value: truncate(winnerLine(item), 1024), inline: true });
    embeds.push(e);
  };
  sectionEmbed('🏆 MEMBER SUPERLATIVES', book.superlatives);
  sectionEmbed('💿 2026 FAN FAVORITES', book.favorites);
  sectionEmbed('✨ MEOVV MOMENTS OF 2026', book.moments);

  if (book.memories.length) {
    const title = `💌 ${config.event.memories.prompt.toUpperCase()}`;
    let current = new EmbedBuilder().setColor(color).setTitle(title);
    let size = 0;
    for (const m of book.memories) {
      const value = truncate(`“${m.text}”`, 1024);
      if (current.data.fields?.length >= 25 || size + value.length > 4500) {
        embeds.push(current);
        current = new EmbedBuilder().setColor(color).setTitle(`${title} (cont.)`);
        size = 0;
      }
      current.addFields({ name: `— ${truncate(m.author, 200)}`, value });
      size += value.length + m.author.length;
    }
    embeds.push(current);
  }
  return embeds;
}

/** A standalone, printable HTML yearbook page. */
function toHtml(book) {
  const h = escapeHtml;
  const card = (e) => `
      <article class="card">
        <h3>${h(e.title)}</h3>
        <p class="winner">${e.winners.length ? e.winners.map((w) => (w.link ? `<a href="${h(w.link)}">${h(w.text)}</a>` : h(w.text))).join(' &amp; ') : '<em>TBA</em>'}</p>
        ${e.totalVotes ? `<p class="votes">${e.winners[0]?.votes ?? 0} of ${e.totalVotes} votes</p>` : ''}
      </article>`;
  const section = (title, entries) =>
    entries.length ? `<section><h2>${h(title)}</h2><div class="grid">${entries.map(card).join('')}</div></section>` : '';
  const memories = book.memories.length
    ? `<section><h2>${h(config.event.memories.prompt)}</h2><div class="memories">${book.memories
        .map((m) => `<blockquote><p>${h(m.text).replace(/\n/g, '<br>')}</p><cite>— ${h(m.author)}</cite></blockquote>`)
        .join('')}</div></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(book.title)}</title>
<style>
  :root { --accent: #${config.event.color.toString(16).padStart(6, '0')}; --ink: #1b1b1f; --paper: #fffaf7; --muted: #6b6470; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); }
  header { padding: 64px 16px 40px; text-align: center; border-bottom: 4px solid var(--accent); }
  header h1 { font-size: clamp(2rem, 6vw, 4rem); letter-spacing: .04em; margin: 0; }
  header p { color: var(--muted); }
  main { max-width: 1080px; margin: 0 auto; padding: 16px; }
  h2 { font-size: 1.5rem; letter-spacing: .08em; text-transform: uppercase; border-left: 6px solid var(--accent); padding-left: 12px; margin-top: 48px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .card { background: #fff; border-radius: 14px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card h3 { margin: 0 0 8px; font-size: .95rem; color: var(--muted); font-weight: 600; }
  .winner { font-size: 1.35rem; font-weight: 800; margin: 0; }
  .winner a { color: var(--accent); text-decoration: none; }
  .votes { margin: 6px 0 0; font-size: .8rem; color: var(--muted); }
  .memories { columns: 2 300px; column-gap: 16px; }
  blockquote { break-inside: avoid; margin: 0 0 16px; background: #fff; border-radius: 14px; padding: 18px; border-top: 4px solid var(--accent); }
  blockquote p { margin: 0 0 10px; line-height: 1.5; }
  cite { color: var(--muted); font-style: normal; font-weight: 600; }
  footer { text-align: center; color: var(--muted); padding: 48px 16px; font-size: .85rem; }
</style>
</head>
<body>
<header><h1>${h(book.title.toUpperCase())}</h1><p>Voted by the fandom · Nov 2026</p></header>
<main>
${section('Member Superlatives', book.superlatives)}
${section('2026 Fan Favorites', book.favorites)}
${section('MEOVV Moments of 2026', book.moments)}
${memories}
</main>
<footer>Made with 💗 by the MEOVV fandom</footer>
</body>
</html>`;
}

/** Write HTML + JSON exports to disk and return Discord attachments for them. */
function exportFiles(book) {
  const dir = path.join(config.env.dataDir, 'yearbook');
  fs.mkdirSync(dir, { recursive: true });
  const html = toHtml(book);
  const jsonText = JSON.stringify(book, null, 2);
  fs.writeFileSync(path.join(dir, 'meovv-2026-yearbook.html'), html);
  fs.writeFileSync(path.join(dir, 'meovv-2026-yearbook.json'), jsonText);
  return [
    new AttachmentBuilder(Buffer.from(html), { name: 'meovv-2026-yearbook.html' }),
    new AttachmentBuilder(Buffer.from(jsonText), { name: 'meovv-2026-yearbook.json' }),
  ];
}

/** Post the yearbook to the yearbook channel (embeds in batches of ≤10, total ≤6000 chars each). */
async function publish(ctx) {
  const book = await compile(ctx.db);
  const channel = await ctx.client.channels.fetch(config.env.yearbookChannelId);
  const embeds = toEmbeds(book);
  const batches = [];
  let batch = [];
  let size = 0;
  for (const e of embeds) {
    const len = JSON.stringify(e.toJSON()).length; // conservative proxy for embed character count
    if (batch.length === 10 || size + len > 5500) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(e);
    size += len;
  }
  if (batch.length) batches.push(batch);

  const ping = config.env.pingRoleId ? `<@&${config.env.pingRoleId}> ` : '';
  let first;
  for (let i = 0; i < batches.length; i++) {
    const msg = await channel.send({
      content: i === 0 ? `${ping}📖 **The ${book.title} is here!**` : undefined,
      embeds: batches[i],
      allowedMentions: { roles: config.env.pingRoleId ? [config.env.pingRoleId] : [] },
    });
    first ??= msg;
  }
  await channel.send({ content: '🖨️ Printable version + raw data:', files: exportFiles(book) });
  return { url: first?.url, book };
}

module.exports = { compile, problems, toEmbeds, toHtml, exportFiles, publish };
