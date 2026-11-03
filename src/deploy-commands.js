/**
 * Registers slash commands to your server. Run after changing commands, members or categories:
 *   npm run deploy
 */
const { REST, Routes } = require('discord.js');
const { env } = require('./config');
const { commands } = require('./commands');
const log = require('./lib/log')('deploy');

(async () => {
  for (const k of ['token', 'guildId']) {
    if (!env[k]) throw new Error(`Missing ${k} — check your .env (BOT_TOKEN, GUILD_ID)`);
  }
  const body = commands.map((c) => c.data().toJSON());
  const rest = new REST().setToken(env.token);
  const application = await rest.get(Routes.currentApplication());
  log.info(`Registering ${body.length} commands`, { bot: application.name, guild: env.guildId });
  const res = await rest.put(Routes.applicationGuildCommands(application.id, env.guildId), { body });
  log.info(`Registered ${res.length} commands: ${res.map((c) => `/${c.name}`).join(', ')}`);
})().catch((err) => {
  log.error('Deploy failed', err);
  process.exit(1);
});
