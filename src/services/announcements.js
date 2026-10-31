const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { buildPlan } = require('../lib/plan');
const { findCategory, ts } = require('./event');

const MEMORY_BUTTON_ID = 'memory:open';

function memoryButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(MEMORY_BUTTON_ID).setStyle(ButtonStyle.Primary).setEmoji('💌').setLabel('Share your MEOVV moment'),
  );
}

function pollSchedule(kind) {
  return buildPlan(config.event)
    .filter((j) => j.type === 'poll' && (kind === 'review' ? j.payload.kind === 'review' : j.payload.kind !== 'review'))
    .map((j) => `${ts(j.at, 'f')} — ${findCategory(j.payload.pollKey)?.title ?? j.payload.pollKey}`);
}

function chunkLines(lines, max = 1000) {
  const out = [];
  let cur = '';
  for (const l of lines) {
    if (cur.length + l.length + 1 > max) {
      out.push(cur);
      cur = '';
    }
    cur += `${l}\n`;
  }
  if (cur) out.push(cur);
  return out;
}

/** Build the kick-off message for a phase. */
function phaseAnnouncement(phase) {
  const ev = config.event;
  const p = ev.phases;
  const at = (v) => config.at(v);
  const color = ev.color;
  const ping = config.env.pingRoleId ? `<@&${config.env.pingRoleId}>` : undefined;

  if (phase === 'nominations') {
    const intro = new EmbedBuilder()
      .setColor(color)
      .setTitle(`📸 Welcome to the ${ev.eventName}!`)
      .setDescription(
        [
          'This November we’re looking back on everything **MEOVV** gave us in 2026 — and you decide what goes in the yearbook.',
          '',
          `**Week 1 · Nominations** — ${ts(at(p.nominations.start), 'D')} – ${ts(at(p.nominations.end), 'D')}`,
          `**Week 2 · Voting** — ${ts(at(p.voting.start), 'D')} – ${ts(at(p.voting.end), 'D')}`,
          `**Week 3 · Year in Review** — ${ts(at(p.review.start), 'D')} – ${ts(at(p.review.end), 'D')}`,
          `**📖 Yearbook Reveal** — ${ts(at(p.reveal), 'F')}`,
        ].join('\n'),
      );
    const how = new EmbedBuilder()
      .setColor(color)
      .setTitle('🗳️ Week 1: Nominations are OPEN!')
      .setDescription(
        [
          'Nominate once per category — nominating again just updates your pick. The most-nominated picks move on to final voting in Week 2!',
          '',
          `Nominations close ${ts(at(p.nominations.end), 'R')}. Check your picks anytime with \`/mynominations\`.`,
        ].join('\n'),
      )
      .addFields(
        { name: '🏆 Member Superlatives — `/nominate member`', value: config.superlatives().map((c) => `• ${c.title}`).join('\n') },
        { name: '💿 2026 Nominations — `/nominate moment`', value: `${config.nominationCategories().map((c) => `• ${c.title}`).join('\n')}\n\n*Add a link (YouTube, X, TikTok…) so everyone can rewatch it before voting!*` },
      );
    return { content: ping, embeds: [intro, how] };
  }

  if (phase === 'voting') {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('🗳️ Week 2: Yearbook Voting is OPEN!')
      .setDescription(
        [
          'Your nominations are in — now it’s time to pick the winners! New polls drop **every day this week** in ' +
            `<#${config.env.pollChannelId}>, so keep coming back. 💗`,
          '',
          'Where it helps, each poll links the nominated content so you can rewatch before voting.',
        ].join('\n'),
      );
    chunkLines(pollSchedule('voting')).forEach((chunk, i) => embed.addFields({ name: i === 0 ? '📅 Poll schedule' : '​', value: chunk }));
    return { content: ping, embeds: [embed] };
  }

  if (phase === 'review') {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('🔁 Week 3: MEOVV Year in Review')
      .setDescription(
        [
          `## 💌 ${ev.memories.prompt}`,
          'Tell us about the MEOVV moment that defined your year — a stage, a song that got you through, a concert, a meme, a memory. ' +
            'Some responses will be **featured in the final Yearbook!**',
          '',
          `Tap the button below or use \`/moment\`. Submissions close ${ts(at(ev.memories.closesAt ?? p.review.end), 'R')}.`,
          '',
          `We’ll also run a few final retrospective polls in <#${config.env.pollChannelId}> this week.`,
        ].join('\n'),
      );
    const sched = pollSchedule('review');
    if (sched.length) chunkLines(sched).forEach((chunk, i) => embed.addFields({ name: i === 0 ? '📅 Retrospective polls' : '​', value: chunk }));
    return { content: ping, embeds: [embed], components: [memoryButtonRow()] };
  }

  throw new Error(`Unknown phase ${phase}`);
}

function reminderMessage(index) {
  const r = config.event.reminders[index];
  const ping = config.env.pingRoleId ? `<@&${config.env.pingRoleId}>\n` : '';
  return { content: `${ping}${r.text}`, components: r.memoryButton ? [memoryButtonRow()] : [] };
}

module.exports = { phaseAnnouncement, reminderMessage, memoryButtonRow, MEMORY_BUTTON_ID };
