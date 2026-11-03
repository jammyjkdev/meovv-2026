const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { byName } = require('./commands');
const { openMemoryModal, submitMemory, MEMORY_MODAL_ID } = require('./commands/fan');
const { MEMORY_BUTTON_ID } = require('./services/announcements');
const scheduler = require('./services/scheduler');
const log = require('./lib/log')('bot');

const required = ['token', 'guildId', 'mongoUri', 'announceChannelId', 'pollChannelId', 'yearbookChannelId'];
const missing = required.filter((k) => !config.env[k]);
if (missing.length) {
  log.error(`Missing required settings: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ctx = { client, db: null };
const commands = byName();

/** "/yb schedule run key:x" style description of a command interaction, for the log. */
function describe(interaction) {
  if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
    const parts = [`/${interaction.commandName}`];
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    if (group) parts.push(group);
    if (sub) parts.push(sub);
    const opts = interaction.options.data.flatMap((o) => (o.options ? o.options.flatMap((p) => p.options ?? p) : o));
    for (const o of opts) if ('value' in o) parts.push(`${o.name}:${String(o.value).slice(0, 60)}`);
    return parts.join(' ');
  }
  return interaction.customId ?? interaction.type;
}

client.once(Events.ClientReady, (c) => {
  log.info(`Logged in as ${c.user.tag}`, { guilds: c.guilds.cache.size, clock: config.now().toFormat('ff'), zone: config.event.timezone, rehearsal: config.env.rehearsal || undefined });
  scheduler.start(ctx);
});

client.on(Events.Error, (err) => log.error('Discord client error', err));
client.on(Events.Warn, (message) => log.warn(message));
client.on(Events.ShardDisconnect, (event) => log.warn('Disconnected from Discord', { code: event.code }));
client.on(Events.ShardReconnecting, () => log.info('Reconnecting to Discord…'));
client.on(Events.ShardResume, () => log.info('Connection to Discord resumed'));

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.guildId && interaction.guildId !== config.env.guildId) return;
  const what = describe(interaction);
  const who = `${interaction.user.tag} (${interaction.user.id})`;
  const started = Date.now();
  try {
    if (interaction.isAutocomplete()) {
      return await commands.get(interaction.commandName)?.autocomplete?.(interaction, ctx);
    }
    if (interaction.isChatInputCommand()) {
      log.info(what, { user: who });
      return await commands.get(interaction.commandName)?.execute(interaction, ctx);
    }
    if (interaction.isButton() && interaction.customId === MEMORY_BUTTON_ID) {
      log.info('button: share your moment', { user: who });
      return await openMemoryModal(interaction, ctx);
    }
    if (interaction.isModalSubmit() && interaction.customId === MEMORY_MODAL_ID) {
      log.info('modal: moment submitted', { user: who });
      return await submitMemory(interaction, ctx);
    }
  } catch (err) {
    log.error(`${what} failed`, { user: who, ms: Date.now() - started, err });
    if (!interaction.isRepliable()) return;
    const content = '😿 Something went wrong — please try again in a moment.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch {
      /* interaction expired */
    }
  }
});

process.on('unhandledRejection', (err) => log.error('Unhandled promise rejection', err));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    log.info(`Received ${sig}, shutting down`);
    await client.destroy();
    await ctx.db?.close();
    log.info('Bye');
    process.exit(0);
  });
}

(async () => {
  log.info('Starting MEOVV 2026 Yearbook bot', { node: process.version, logLevel: process.env.LOG_LEVEL ?? 'info' });
  log.info('Connecting to MongoDB…');
  ctx.db = await db.open(config.env.mongoUri);
  log.info('Logging in to Discord…');
  await client.login(config.env.token);
})().catch((err) => {
  log.error('Failed to start', err);
  process.exit(1);
});
