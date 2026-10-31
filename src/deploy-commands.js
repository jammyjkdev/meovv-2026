/**
 * Registers slash commands to your server. Run after changing commands, members or categories:
 *   npm run deploy
 */
const { REST, Routes } = require('discord.js');
const { env } = require('./config');
const { commands } = require('./commands');

(async () => {
  for (const k of ['token', 'clientId', 'guildId']) {
    if (!env[k]) throw new Error(`Missing ${k} — check your .env (DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID)`);
  }
  const body = commands.map((c) => c.data().toJSON());
  const rest = new REST().setToken(env.token);
  const res = await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body });
  console.log(`Registered ${res.length} commands: ${res.map((c) => `/${c.name}`).join(', ')}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
