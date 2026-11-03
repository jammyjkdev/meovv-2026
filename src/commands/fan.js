const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const config = require('../config');
const { clean, isHttpUrl, normalize, truncate } = require('../lib/text');
const { findCategory, nominationsOpen, memoriesOpen, currentPhase, hasStarted, PHASE_LABELS, ts } = require('../services/event');
const { nominateMember, nominateMoment, ranked, matchChoice, UserError } = require('../services/nominations');
const { entries: logEntry } = require('../services/staffLog');

const MEMORY_MODAL_ID = 'memory:submit';
const ephemeral = MessageFlags.Ephemeral;

const displayName = (i) => i.member?.displayName ?? i.user.globalName ?? i.user.username;

/** Why a fan can't nominate right now, or null if they can. */
async function nominationsClosedMessage(db) {
  if (!(await hasStarted(db))) return 'Nominations haven’t opened yet — keep an eye on the announcements! 💗';
  if (nominationsOpen()) return null;
  return 'Nominations for the yearbook are closed — thank you! Keep an eye on the polls channel to vote. 🗳️';
}

// ── /nominate ──────────────────────────────────────────────────────
const nominate = {
  data: () =>
    new SlashCommandBuilder()
      .setName('nominate')
      .setDescription(`Nominate for the ${config.event.eventName}`)
      .addSubcommand((s) =>
        s
          .setName('member')
          .setDescription('Nominate a MEOVV member for a superlative')
          .addStringOption((o) =>
            o.setName('category').setDescription('Superlative').setRequired(true)
              .addChoices(...config.superlatives().map((c) => ({ name: truncate(c.title, 100), value: c.id }))),
          )
          .addStringOption((o) =>
            o.setName('member').setDescription('Which member?').setRequired(true)
              .addChoices(...config.event.members.map((m) => ({ name: m.name, value: m.id }))),
          )
          .addStringOption((o) => o.setName('why').setDescription('Why? (optional)').setMaxLength(200)),
      )
      .addSubcommand((s) =>
        s
          .setName('moment')
          .setDescription('Nominate your favorite MEOVV content or moment of 2026')
          .addStringOption((o) =>
            o.setName('category').setDescription('Category').setRequired(true)
              .addChoices(...config.nominationCategories().map((c) => ({ name: truncate(c.title, 100), value: c.id }))),
          )
          .addStringOption((o) =>
            o.setName('nomination').setDescription('Your pick — start typing to see suggestions (songs: choose from the list)').setRequired(true).setMaxLength(100).setAutocomplete(true),
          )
          .addStringOption((o) => o.setName('link').setDescription('Link to it (YouTube, X, TikTok…) — optional but helps voters!').setMaxLength(300)),
      )
      .addSubcommand((s) =>
        s
          .setName('withdraw')
          .setDescription('Remove one of your nominations')
          .addStringOption((o) => o.setName('category').setDescription('Category').setRequired(true).setAutocomplete(true)),
      ),

  async autocomplete(interaction, ctx) {
    const focused = interaction.options.getFocused(true);
    const sub = interaction.options.getSubcommand();
    if (sub === 'withdraw') {
      const mine = await ctx.db.nominationsByUser(interaction.user.id);
      return interaction.respond(
        mine.map((n) => ({ name: truncate(`${findCategory(n.category_id)?.title ?? n.category_id}: ${n.value}`, 100), value: n.category_id })).slice(0, 25),
      );
    }
    const categoryId = interaction.options.getString('category');
    const typed = clean(focused.value);
    const q = normalize(typed);
    // fixed-list category (songs): only offer the list
    const fixedList = findCategory(categoryId)?.choices;
    if (fixedList) {
      return interaction.respond(fixedList.filter((c) => !q || normalize(c).includes(q)).slice(0, 25).map((c) => ({ name: c, value: c })));
    }
    // free text: suggest what others already nominated so duplicates group together
    const existing = categoryId ? await ranked(ctx.db, categoryId) : [];
    const matches = existing.filter((n) => !q || n.norm.includes(q)).slice(0, 24);
    const choices = matches.map((n) => ({ name: truncate(`${n.display}`, 100), value: truncate(n.display, 100) }));
    if (typed && !matches.some((n) => n.norm === q)) choices.unshift({ name: truncate(typed, 100), value: truncate(typed, 100) });
    return interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const user = { id: interaction.user.id, name: displayName(interaction) };
    const closed = await nominationsClosedMessage(ctx.db);
    if (closed) return interaction.reply({ content: closed, flags: ephemeral });

    if (sub === 'withdraw') {
      const categoryId = interaction.options.getString('category');
      const n = await ctx.db.deleteNomination(categoryId, user.id);
      await interaction.reply({ content: n ? '🗑️ Nomination removed.' : 'You don’t have a nomination in that category.', flags: ephemeral });
      if (n) await logEntry.withdraw(interaction.client, { user, category: findCategory(categoryId)?.title ?? categoryId });
      return;
    }

    const categoryId = interaction.options.getString('category');
    const cat = findCategory(categoryId);
    if (!cat) return interaction.reply({ content: 'That category isn’t open for nominations.', flags: ephemeral });

    try {
      if (sub === 'member') {
        const memberId = interaction.options.getString('member');
        const why = clean(interaction.options.getString('why') ?? '');
        const result = await nominateMember(ctx.db, { categoryId, memberId, user, reason: why });
        const member = config.event.members.find((m) => m.id === memberId);
        await interaction.reply({
          content: `${result === 'updated' ? '🔁 Updated!' : '✅ Nominated!'} **${member.name}** for **${cat.title}**.${why ? `\n> ${why}` : ''}`,
          flags: ephemeral,
        });
        return logEntry.member(interaction.client, { user, category: cat.title, member: member.name, reason: why, status: result });
      }

      const typed = clean(interaction.options.getString('nomination'));
      const link = clean(interaction.options.getString('link') ?? '');
      if (link && !isHttpUrl(link)) return interaction.reply({ content: 'That link doesn’t look right — it should start with `https://`.', flags: ephemeral });
      const result = await nominateMoment(ctx.db, { categoryId, text: typed, link, user });
      const text = matchChoice(cat, typed) ?? typed; // songs show their official title
      await interaction.reply({
        content: `${result === 'updated' ? '🔁 Updated!' : '✅ Nominated!'} **${text}** for **${cat.title}**.${link ? `\n🔗 <${link}>` : ''}\nThe most-nominated picks move on to final voting! 🗳️`,
        flags: ephemeral,
      });
      return logEntry.moment(interaction.client, { user, category: cat.title, text, link, status: result });
    } catch (err) {
      if (err instanceof UserError) return interaction.reply({ content: err.message, flags: ephemeral });
      throw err;
    }
  },
};

// ── /mynominations ─────────────────────────────────────────────────
const mynominations = {
  data: () => new SlashCommandBuilder().setName('mynominations').setDescription('See your yearbook nominations'),
  async execute(interaction, ctx) {
    const mine = await ctx.db.nominationsByUser(interaction.user.id);
    const sup = config.superlatives();
    const nom = config.nominationCategories();
    const byCat = new Map(mine.map((n) => [n.category_id, n]));
    const line = (c) => {
      const n = byCat.get(c.id);
      return n ? `✅ **${c.title}** — ${n.value}${n.link ? ` · [link](${n.link})` : ''}` : `▫️ ${c.title} — *not yet*`;
    };
    const embed = new EmbedBuilder()
      .setColor(config.event.color)
      .setTitle('📝 Your yearbook nominations')
      .setDescription(`${mine.length}/${sup.length + nom.length} categories nominated.`)
      .addFields(
        { name: '🏆 Member Superlatives', value: truncate(sup.map(line).join('\n'), 1024) },
        { name: '💿 2026 Nominations', value: truncate(nom.map(line).join('\n'), 1024) },
      );
    return interaction.reply({ embeds: [embed], flags: ephemeral });
  },
};

// ── /moment (Week 3) ──────────────────────────────────────────────
function memoryModal(existing) {
  const input = new TextInputBuilder()
    .setCustomId('text')
    .setLabel(truncate(config.event.memories.prompt, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(10)
    .setMaxLength(config.event.memories.maxLength)
    .setPlaceholder('A stage, a song, a concert, a meme… tell us what made your year! It may be featured in the Yearbook.')
    .setRequired(true);
  if (existing) input.setValue(existing.text);
  return new ModalBuilder().setCustomId(MEMORY_MODAL_ID).setTitle('MEOVV 2026 Year in Review').addComponents(new ActionRowBuilder().addComponents(input));
}

async function openMemoryModal(interaction, ctx) {
  if (!memoriesOpen()) {
    const opens = config.at(config.event.phases.review.start);
    const msg = config.now() < opens ? `Year in Review submissions open ${ts(opens, 'F')}! 💌` : 'Submissions are closed — thank you for sharing! 💗 The Yearbook drops soon.';
    return interaction.reply({ content: msg, flags: ephemeral });
  }
  return interaction.showModal(memoryModal(await ctx.db.memoryByUser(interaction.user.id)));
}

async function submitMemory(interaction, ctx) {
  if (!memoriesOpen()) return interaction.reply({ content: 'Sorry — submissions just closed! 💗', flags: ephemeral });
  const text = interaction.fields.getTextInputValue('text').trim();
  const { id, status } = await ctx.db.upsertMemory({ userId: interaction.user.id, userName: displayName(interaction), text });
  await interaction.reply({
    content: `${status === 'updated' ? '🔁 Your response was updated' : '💌 Thank you for sharing'}! Some responses will be featured in the **${config.event.eventName}** on ${ts(config.at(config.event.phases.reveal), 'D')}.`,
    flags: ephemeral,
  });
  return logEntry.memory(interaction.client, { user: interaction.user, id, text, status });
}

const moment = {
  data: () => new SlashCommandBuilder().setName('moment').setDescription(config.event.memories.prompt),
  execute: openMemoryModal,
};

// ── /yearbook (info) ──────────────────────────────────────────────
const info = {
  data: () => new SlashCommandBuilder().setName('yearbook').setDescription(`What's happening in the ${config.event.eventName}?`),
  async execute(interaction, ctx) {
    const p = config.event.phases;
    const phase = (await hasStarted(ctx.db)) ? currentPhase() : 'before';
    const at = (v) => config.at(v);
    const mark = (k) => (phase === k ? '👉 ' : '');
    const embed = new EmbedBuilder()
      .setColor(config.event.color)
      .setTitle(`📸 ${config.event.eventName}`)
      .setDescription(`**Now:** ${PHASE_LABELS[phase]}`)
      .addFields(
        { name: `${mark('nominations')}Week 1 · Nominations`, value: `${ts(at(p.nominations.start), 'D')} – ${ts(at(p.nominations.end), 'D')}\n\`/nominate member\` · \`/nominate moment\` · \`/mynominations\`` },
        { name: `${mark('voting')}Week 2 · Voting`, value: `${ts(at(p.voting.start), 'D')} – ${ts(at(p.voting.end), 'D')}\nNew polls daily in <#${config.env.pollChannelId}>` },
        { name: `${mark('review')}Week 3 · Year in Review`, value: `${ts(at(p.review.start), 'D')} – ${ts(at(p.review.end), 'D')}\n\`/moment\` — ${config.event.memories.prompt}` },
        { name: `${mark('reveal-pending')}${mark('revealed')}📖 Yearbook Reveal`, value: ts(at(p.reveal), 'F') },
      );
    return interaction.reply({ embeds: [embed], flags: ephemeral });
  },
};

module.exports = { nominate, mynominations, moment, info, openMemoryModal, submitMemory, MEMORY_MODAL_ID };
