const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const config = require('../config');
const { buildPlan } = require('../lib/plan');
const { truncate, isHttpUrl, clean } = require('../lib/text');
const { allCategories, findCategory, currentPhase, PHASE_LABELS, ts, START_JOB } = require('../services/event');
const { ranked, pollOptions } = require('../services/nominations');
const polls = require('../services/polls');
const yearbook = require('../services/yearbook');
const scheduler = require('../services/scheduler');

const ephemeral = MessageFlags.Ephemeral;

function isStaff(interaction) {
  if (config.env.ownerId && interaction.user.id === config.env.ownerId) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  if (!config.env.adminRoleId || !roles) return false;
  return Array.isArray(roles) ? roles.includes(config.env.adminRoleId) : roles.cache.has(config.env.adminRoleId);
}

const categoryOpt = (o, desc = 'Category') => o.setName('category').setDescription(desc).setRequired(true).setAutocomplete(true);
const nomineeOpt = (o, name, desc) => o.setName(name).setDescription(desc).setRequired(true).setAutocomplete(true);

const data = () =>
  new SlashCommandBuilder()
    .setName('yb')
    .setDescription('Yearbook staff tools')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('status').setDescription('Event status overview'))
    .addSubcommandGroup((g) =>
      g.setName('nominations').setDescription('Review and clean up nominations')
        .addSubcommand((s) => s.setName('view').setDescription('Ranked nominees for a category').addStringOption((o) => categoryOpt(o)))
        .addSubcommand((s) =>
          s.setName('merge').setDescription('Merge a duplicate nominee into another (e.g. "toxic mv" → "TOXIC")')
            .addStringOption((o) => categoryOpt(o))
            .addStringOption((o) => nomineeOpt(o, 'from', 'Duplicate to merge away'))
            .addStringOption((o) => nomineeOpt(o, 'into', 'Nominee to keep')),
        )
        .addSubcommand((s) =>
          s.setName('rename').setDescription('Set how a nominee is displayed in polls/yearbook')
            .addStringOption((o) => categoryOpt(o))
            .addStringOption((o) => nomineeOpt(o, 'nominee', 'Nominee'))
            .addStringOption((o) => o.setName('name').setDescription('Display name (max 55 chars for polls)').setRequired(true).setMaxLength(55)),
        )
        .addSubcommand((s) =>
          s.setName('link').setDescription('Set the official link shown for a nominee')
            .addStringOption((o) => categoryOpt(o))
            .addStringOption((o) => nomineeOpt(o, 'nominee', 'Nominee'))
            .addStringOption((o) => o.setName('url').setDescription('https://… (leave empty to clear)')),
        )
        .addSubcommand((s) =>
          s.setName('exclude').setDescription('Keep a nominee out of the finals (spam, off-topic, ineligible)')
            .addStringOption((o) => categoryOpt(o))
            .addStringOption((o) => nomineeOpt(o, 'nominee', 'Nominee'))
            .addBooleanOption((o) => o.setName('restore').setDescription('Undo a previous exclusion')),
        ),
    )
    .addSubcommandGroup((g) =>
      g.setName('user').setDescription('Look up or clean up one fan (@mention, username or ID)')
        .addSubcommand((s) =>
          s.setName('view').setDescription("Everything a fan has nominated and shared")
            .addUserOption((o) => o.setName('user').setDescription('@mention, or type their username or ID').setRequired(true)),
        )
        .addSubcommand((s) =>
          s.setName('remove').setDescription('Delete all of a fan’s nominations and hide their response (spam / ineligible)')
            .addUserOption((o) => o.setName('user').setDescription('@mention, or type their username or ID').setRequired(true))
            .addBooleanOption((o) => o.setName('confirm').setDescription('Yes, remove everything from this fan').setRequired(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g.setName('poll').setDescription('Yearbook polls')
        .addSubcommand((s) =>
          s.setName('preview').setDescription('Show which options a poll would use right now')
            .addStringOption((o) => categoryOpt(o)),
        )
        .addSubcommand((s) =>
          s.setName('post').setDescription('Post a poll now (instead of waiting for the schedule)')
            .addStringOption((o) => categoryOpt(o))
            .addStringOption((o) => o.setName('options').setDescription('Custom answers: "A | B | C" — add links as "A=https://… | B"'))
            .addBooleanOption((o) => o.setName('force').setDescription('Replace an already-posted poll for this category')),
        )
        .addSubcommand((s) => s.setName('end').setDescription('End a poll early').addStringOption((o) => categoryOpt(o)))
        .addSubcommand((s) => s.setName('results').setDescription('Live/final results (staff only)').addStringOption((o) => categoryOpt(o))),
    )
    .addSubcommandGroup((g) =>
      g.setName('memories').setDescription('"What MEOVV moment made your 2026?" responses')
        .addSubcommand((s) =>
          s.setName('list').setDescription('Browse responses')
            .addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1))
            .addBooleanOption((o) => o.setName('featured').setDescription('Only featured')),
        )
        .addSubcommand((s) =>
          s.setName('feature').setDescription('Feature a response in the yearbook')
            .addIntegerOption((o) => o.setName('id').setDescription('Response #').setRequired(true))
            .addBooleanOption((o) => o.setName('anonymous').setDescription('Credit as "A MEOVV fan" instead of their name')),
        )
        .addSubcommand((s) => s.setName('unfeature').setDescription('Un-feature a response').addIntegerOption((o) => o.setName('id').setDescription('Response #').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Hide a response (spam/inappropriate)').addIntegerOption((o) => o.setName('id').setDescription('Response #').setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('yearbook').setDescription('Final yearbook')
        .addSubcommand((s) => s.setName('preview').setDescription('Preview the yearbook privately + get the HTML/JSON export'))
        .addSubcommand((s) =>
          s.setName('publish').setDescription('Publish the yearbook to the yearbook channel')
            .addBooleanOption((o) => o.setName('confirm').setDescription('Yes, publish it publicly').setRequired(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g.setName('schedule').setDescription('Automatic schedule')
        .addSubcommand((s) => s.setName('list').setDescription('Show the full schedule and what has run'))
        .addSubcommand((s) =>
          s.setName('run').setDescription('Run a scheduled item right now (announcement, reminder, poll, reveal)')
            .addStringOption((o) => o.setName('key').setDescription('Schedule key').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((s) =>
          s.setName('retry').setDescription('Mark a failed/skipped item as pending so the scheduler runs it again')
            .addStringOption((o) => o.setName('key').setDescription('Schedule key').setRequired(true).setAutocomplete(true)),
        ),
    );

// ── autocomplete ──────────────────────────────────────────────────
async function autocomplete(interaction, ctx) {
  const focused = interaction.options.getFocused(true);
  const q = focused.value.toLowerCase();
  const group = interaction.options.getSubcommandGroup(false);

  if (focused.name === 'category') {
    let cats = allCategories();
    if (group === 'nominations') cats = cats.filter((c) => c.type !== 'review');
    return interaction.respond(
      cats.filter((c) => !q || c.title.toLowerCase().includes(q) || c.id.includes(q)).slice(0, 25)
        .map((c) => ({ name: truncate(`${c.title} (${c.type})`, 100), value: c.id })),
    );
  }
  if (['from', 'into', 'nominee'].includes(focused.name)) {
    const categoryId = interaction.options.getString('category');
    if (!categoryId) return interaction.respond([]);
    const [overrides, rows] = await Promise.all([ctx.db.overridesFor(categoryId), ranked(ctx.db, categoryId)]);
    // include excluded nominees too so they can be restored
    const excluded = [...overrides.entries()].filter(([, o]) => o.excluded).map(([norm]) => ({ norm, display: `${norm} [excluded]`, count: 0 }));
    return interaction.respond(
      [...rows, ...excluded].filter((n) => !q || n.display.toLowerCase().includes(q) || n.norm.includes(q)).slice(0, 25)
        .map((n) => ({ name: truncate(`${n.display} · ${n.count}`, 100), value: n.norm.slice(0, 100) })),
    );
  }
  if (focused.name === 'key') {
    return interaction.respond(
      buildPlan(config.event).filter((j) => !q || j.key.includes(q)).slice(0, 25).map((j) => ({ name: `${j.key} · ${j.at.toFormat('LLL d HH:mm')}`, value: j.key })),
    );
  }
  return interaction.respond([]);
}

// ── handlers ──────────────────────────────────────────────────────
function parseOptions(raw) {
  return raw.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 10).map((part) => {
    const eq = part.lastIndexOf('=');
    const maybeUrl = eq > 0 ? part.slice(eq + 1).trim() : '';
    if (maybeUrl && isHttpUrl(maybeUrl)) return { text: truncate(part.slice(0, eq).trim(), 55), link: maybeUrl, emoji: null };
    return { text: truncate(part, 55), link: null, emoji: null };
  });
}

async function status(interaction, ctx) {
  const phase = currentPhase();
  const [counts, nominators, mem, allPolls, done] = await Promise.all([
    ctx.db.nominationCounts(),
    ctx.db.nominatorCount(),
    ctx.db.countMemories(),
    ctx.db.allPolls(),
    ctx.db.allJobs(),
  ]);
  const totalNoms = counts.reduce((n, c) => n + c.n, 0);
  const now = config.now();
  const upcoming = buildPlan(config.event).filter((j) => !done.has(j.key) && j.at > now).slice(0, 5);
  const embed = new EmbedBuilder()
    .setColor(config.event.color)
    .setTitle(`📊 ${config.event.eventName} — staff status`)
    .setDescription(`**Phase:** ${done.get(START_JOB)?.status === 'done' ? PHASE_LABELS[phase] : `Not started — run \`/yb schedule run key:${START_JOB}\``}${config.env.rehearsal ? `\n🧪 **Rehearsal clock** — bot thinks it is ${now.toFormat('ff')}` : ''}`)
    .addFields(
      { name: 'Nominations', value: `${totalNoms} from ${nominators} fans`, inline: true },
      { name: 'Polls', value: `${allPolls.filter((p) => p.status === 'open').length} open · ${allPolls.filter((p) => p.status === 'closed').length} closed`, inline: true },
      { name: 'Fan responses', value: `${mem.total ?? 0} (${mem.featured ?? 0} featured)`, inline: true },
      { name: 'Next up', value: upcoming.map((j) => `${ts(j.at, 'f')} · \`${j.key}\``).join('\n') || '—' },
    );
  const failed = [...done.values()].filter((j) => j.status !== 'done');
  if (failed.length) embed.addFields({ name: '⚠️ Needs attention', value: truncate(failed.map((j) => `\`${j.key}\` ${j.status}: ${j.detail ?? ''}`).join('\n'), 1024) });
  return interaction.reply({ embeds: [embed], flags: ephemeral });
}

async function nominationsGroup(sub, interaction, ctx) {
  const categoryId = interaction.options.getString('category');
  const cat = findCategory(categoryId);
  if (!cat || cat.type === 'review') return interaction.reply({ content: 'Unknown category.', flags: ephemeral });

  if (sub === 'view') {
    const rows = await ranked(ctx.db, categoryId);
    const finalists = cat.type === 'nomination' ? config.event.polls.finalistsPerPoll : rows.length;
    const lines = rows.slice(0, 30).map((n, i) => `${i < finalists ? '⭐' : '▫️'} **${n.count}** · ${n.display}${n.link ? ` · [link](${n.link})` : ' · *no link*'} \`${truncate(n.norm, 40)}\``);
    const embed = new EmbedBuilder()
      .setColor(config.event.color)
      .setTitle(`${cat.title} — ${rows.length} nominees`)
      .setDescription(truncate(lines.join('\n') || '*No nominations yet*', 4000))
      .setFooter({ text: '⭐ = currently in the finals. Merge duplicates so their counts combine.' });
    return interaction.reply({ embeds: [embed], flags: ephemeral });
  }
  if (sub === 'merge') {
    const from = interaction.options.getString('from');
    const into = interaction.options.getString('into');
    if (from === into) return interaction.reply({ content: 'Pick two different nominees.', flags: ephemeral });
    const n = await ctx.db.mergeNominees(categoryId, from, into);
    return interaction.reply({ content: `🔗 Merged ${n} nomination(s) from \`${from}\` into \`${into}\`.`, flags: ephemeral });
  }
  if (sub === 'rename') {
    await ctx.db.setOverride(categoryId, interaction.options.getString('nominee'), { display: clean(interaction.options.getString('name')) });
    return interaction.reply({ content: '✏️ Display name updated.', flags: ephemeral });
  }
  if (sub === 'link') {
    const url = clean(interaction.options.getString('url') ?? '');
    if (url && !isHttpUrl(url)) return interaction.reply({ content: 'That isn’t a valid http(s) link.', flags: ephemeral });
    await ctx.db.setOverride(categoryId, interaction.options.getString('nominee'), { link: url || null });
    return interaction.reply({ content: url ? `🔗 Link set: <${url}>` : 'Link cleared (falls back to the most-submitted link).', flags: ephemeral });
  }
  if (sub === 'exclude') {
    const restore = interaction.options.getBoolean('restore') ?? false;
    await ctx.db.setOverride(categoryId, interaction.options.getString('nominee'), { excluded: !restore });
    return interaction.reply({ content: restore ? '↩️ Nominee restored.' : '🚫 Nominee excluded from the finals.', flags: ephemeral });
  }
}

async function userGroup(sub, interaction, ctx) {
  const target = interaction.options.getUser('user');
  const [noms, memory] = await Promise.all([ctx.db.nominationsByUser(target.id), ctx.db.memoryByUser(target.id)]);

  if (sub === 'view') {
    const lines = noms.map((n) => `• **${findCategory(n.category_id)?.title ?? n.category_id}** — ${n.value}${n.link ? ` · [link](${n.link})` : ''}${n.reason ? `\n  > ${truncate(n.reason, 120)}` : ''}`);
    const embed = new EmbedBuilder()
      .setColor(config.event.color)
      .setAuthor({ name: `${target.tag} · ${target.id}`, iconURL: target.displayAvatarURL() })
      .setTitle(`<@${target.id}>'s yearbook activity`.replace(/^<@\d+>/, target.displayName ?? target.username))
      .setDescription(`${target}\n\n**Nominations (${noms.length})**\n${truncate(lines.join('\n') || '*none*', 3500)}`)
      .addFields({ name: memory ? `💌 Response #${memory.id}${memory.featured ? ' ⭐' : ''}` : '💌 Response', value: memory ? truncate(memory.text, 1024) : '*none*' });
    return interaction.reply({ embeds: [embed], flags: ephemeral, allowedMentions: { parse: [] } });
  }
  if (sub === 'remove') {
    if (!interaction.options.getBoolean('confirm')) return interaction.reply({ content: 'Nothing removed.', flags: ephemeral });
    const removed = await ctx.db.deleteNominationsByUser(target.id);
    if (memory) await ctx.db.updateMemory(memory.id, { removed: true, featured: false });
    return interaction.reply({
      content: `🗑️ Removed ${removed} nomination(s)${memory ? ' and hid their response' : ''} from ${target} (${target.id}).`,
      flags: ephemeral,
      allowedMentions: { parse: [] },
    });
  }
}

async function pollGroup(sub, interaction, ctx) {
  const categoryId = interaction.options.getString('category');
  const cat = findCategory(categoryId);
  if (!cat) return interaction.reply({ content: 'Unknown category.', flags: ephemeral });

  if (sub === 'preview') {
    const { options, note } = await pollOptions(ctx.db, categoryId);
    const lines = options.map((o, i) => `${i + 1}. ${o.emoji ?? ''} **${o.text}**${o.nominations ? ` (${o.nominations} noms)` : ''}${o.link ? ` · <${o.link}>` : ''}`);
    return interaction.reply({ content: truncate(`**${cat.title}** would post with:\n${lines.join('\n') || '*no options*'}${note ? `\n\nℹ️ ${note}` : ''}`, 2000), flags: ephemeral });
  }
  if (sub === 'post') {
    await interaction.deferReply({ flags: ephemeral });
    const raw = interaction.options.getString('options');
    const res = await polls.postPoll(ctx, categoryId, { options: raw ? parseOptions(raw) : undefined, force: interaction.options.getBoolean('force') ?? false });
    if (res.posted) await ctx.db.markJob(`poll:${categoryId}`, 'done', `${res.url} (manual)`);
    return interaction.editReply(res.posted ? `✅ Posted → ${res.url}${res.note ? `\nℹ️ ${res.note}` : ''}` : `❌ ${res.reason}`);
  }
  if (sub === 'end') {
    await interaction.deferReply({ flags: ephemeral });
    const res = await polls.endPoll(ctx, categoryId);
    return interaction.editReply(res.ok ? '⏹️ Poll ended. Results will be saved within a couple of minutes.' : `❌ ${res.reason}`);
  }
  if (sub === 'results') {
    await interaction.deferReply({ flags: ephemeral });
    const poll = await ctx.db.getPoll(categoryId);
    if (!poll) return interaction.editReply('No poll posted for that category yet.');
    if (poll.status === 'closed' && poll.results) return interaction.editReply(`🔒 Final\n${polls.formatResults(poll.question, poll.results)}`);
    const { answers } = await polls.fetchResults(ctx, poll);
    return interaction.editReply(`🟢 Live (closes ${ts(require('luxon').DateTime.fromMillis(poll.ends_at), 'R')})\n${polls.formatResults(poll.question, answers)}`);
  }
}

async function memoriesGroup(sub, interaction, ctx) {
  if (sub === 'list') {
    const page = interaction.options.getInteger('page') ?? 1;
    const featuredOnly = interaction.options.getBoolean('featured') ?? false;
    const per = 8;
    const rows = await ctx.db.listMemories({ featuredOnly, limit: per, offset: (page - 1) * per });
    const { total, featured } = await ctx.db.countMemories();
    const embed = new EmbedBuilder()
      .setColor(config.event.color)
      .setTitle(`💌 Responses — page ${page}`)
      .setFooter({ text: `${total ?? 0} total · ${featured ?? 0} featured · /yb memories feature id:<#>` });
    for (const m of rows) {
      embed.addFields({ name: `#${m.id} ${m.featured ? '⭐ ' : ''}${truncate(m.user_name, 80)}${m.anonymous ? ' (anon)' : ''}`, value: truncate(m.text, 1000) });
    }
    if (!rows.length) embed.setDescription('*Nothing here.*');
    return interaction.reply({ embeds: [embed], flags: ephemeral });
  }
  const id = interaction.options.getInteger('id');
  const memory = await ctx.db.getMemory(id);
  if (!memory || memory.removed) return interaction.reply({ content: `No response #${id}.`, flags: ephemeral });
  if (sub === 'feature') {
    await ctx.db.updateMemory(id, { featured: true, anonymous: interaction.options.getBoolean('anonymous') ?? false });
    return interaction.reply({ content: `⭐ Featured #${id}.`, flags: ephemeral });
  }
  if (sub === 'unfeature') {
    await ctx.db.updateMemory(id, { featured: false });
    return interaction.reply({ content: `Un-featured #${id}.`, flags: ephemeral });
  }
  if (sub === 'remove') {
    await ctx.db.updateMemory(id, { removed: true, featured: false });
    return interaction.reply({ content: `🗑️ Hidden #${id}.`, flags: ephemeral });
  }
}

async function yearbookGroup(sub, interaction, ctx) {
  await interaction.deferReply({ flags: ephemeral });
  const book = await yearbook.compile(ctx.db);
  const issues = yearbook.problems(book);
  if (sub === 'preview') {
    const embeds = yearbook.toEmbeds(book).slice(0, 9);
    return interaction.editReply({
      content: issues.length ? `⚠️ **Before publishing:**\n• ${truncate(issues.join('\n• '), 1700)}` : '✅ Looks complete!',
      embeds,
      files: yearbook.exportFiles(book),
    });
  }
  if (sub === 'publish') {
    if (!interaction.options.getBoolean('confirm')) return interaction.editReply('Publishing cancelled.');
    const { url } = await yearbook.publish(ctx);
    await ctx.db.markJob('reveal', 'done', `${url} (manual)`);
    return interaction.editReply(`📖 Published → ${url}${issues.length ? `\n(Published with ${issues.length} open item(s).)` : ''}`);
  }
}

async function scheduleGroup(sub, interaction, ctx) {
  const done = await ctx.db.allJobs();
  if (sub === 'list') {
    const icon = { done: '✅', skipped: '⏭️', failed: '❌' };
    const lines = buildPlan(config.event).map((j) => `${icon[done.get(j.key)?.status] ?? '🕒'} ${ts(j.at, 'f')} \`${j.key}\``);
    const chunks = [];
    let cur = '';
    for (const l of lines) {
      if (cur.length + l.length > 3900) { chunks.push(cur); cur = ''; }
      cur += `${l}\n`;
    }
    chunks.push(cur);
    const embeds = chunks.slice(0, 5).map((c, i) => new EmbedBuilder().setColor(config.event.color).setTitle(i ? '(cont.)' : `🗓️ Schedule (${config.event.timezone})`).setDescription(c));
    return interaction.reply({ embeds, flags: ephemeral });
  }
  const key = interaction.options.getString('key');
  const job = buildPlan(config.event).find((j) => j.key === key);
  if (!job) return interaction.reply({ content: 'Unknown schedule key.', flags: ephemeral });
  if (key === START_JOB) {
    if (done.get(key)?.status === 'done') return interaction.reply({ content: '✅ The event has already started, so nothing was posted.', flags: ephemeral });
    if (sub === 'retry') return interaction.reply({ content: `This item only runs by hand. Use \`/yb schedule run key:${START_JOB}\` to start the event.`, flags: ephemeral });
  }
  if (sub === 'retry') {
    await ctx.db.resetJob(key);
    return interaction.reply({ content: `🔁 \`${key}\` reset — it will run on the next scheduler pass if its time has come (and its window hasn’t passed). Use \`/yb schedule run\` to run it immediately.`, flags: ephemeral });
  }
  if (sub === 'run') {
    await interaction.deferReply({ flags: ephemeral });
    const log = scheduler.makeLogger(interaction.client);
    const { status: st, detail } = await scheduler.runJob(ctx, job, log);
    await ctx.db.markJob(key, st, detail);
    return interaction.editReply(`${st === 'done' ? '✅' : '⚠️'} \`${key}\` → ${st}${detail ? `: ${detail}` : ''}`);
  }
}

async function execute(interaction, ctx) {
  if (!isStaff(interaction)) return interaction.reply({ content: 'Staff only.', flags: ephemeral });
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  if (!group && sub === 'status') return status(interaction, ctx);
  const handlers = { nominations: nominationsGroup, user: userGroup, poll: pollGroup, memories: memoriesGroup, yearbook: yearbookGroup, schedule: scheduleGroup };
  return handlers[group](sub, interaction, ctx);
}

module.exports = { yb: { data, execute, autocomplete: (i, ctx) => (isStaff(i) ? autocomplete(i, ctx) : i.respond([])) }, parseOptions };
