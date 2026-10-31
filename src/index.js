const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { byName } = require('./commands');
const { openMemoryModal, submitMemory, MEMORY_MODAL_ID } = require('./commands/fan');
const { MEMORY_BUTTON_ID } = require('./services/announcements');
const scheduler = require('./services/scheduler');

const required = ['token', 'guildId', 'announceChannelId', 'pollChannelId', 'yearbookChannelId'];
const missing = required.filter((k) => !config.env[k]);
if (missing.length) {
  console.error(`Missing required settings: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ctx = { client, db: db.open(config.env.databasePath) };
const commands = byName();

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}. Event clock: ${config.now().toFormat('ff')} (${config.event.timezone})${config.env.rehearsal ? ' [REHEARSAL]' : ''}`);
  scheduler.start(ctx);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.guildId && interaction.guildId !== config.env.guildId) return;
  try {
    if (interaction.isAutocomplete()) {
      return await commands.get(interaction.commandName)?.autocomplete?.(interaction, ctx);
    }
    if (interaction.isChatInputCommand()) {
      return await commands.get(interaction.commandName)?.execute(interaction, ctx);
    }
    if (interaction.isButton() && interaction.customId === MEMORY_BUTTON_ID) {
      return await openMemoryModal(interaction, ctx);
    }
    if (interaction.isModalSubmit() && interaction.customId === MEMORY_MODAL_ID) {
      return await submitMemory(interaction, ctx);
    }
  } catch (err) {
    console.error(`[interaction] ${interaction.commandName ?? interaction.customId}`, err);
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

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    client.destroy();
    ctx.db.raw.close();
    process.exit(0);
  });
}

client.login(config.env.token);
