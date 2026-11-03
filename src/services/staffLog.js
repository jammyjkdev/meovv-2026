const config = require('../config');
const console_ = require('../lib/log')('staff-log');

/**
 * Post to the private staff log channel (LOG_CHANNEL_ID). Never throws and never pings:
 * user mentions render as clickable names without notifying anyone.
 */
async function staffLog(client, content) {
  console_.info(content.replace(/\n/g, ' | '));
  if (!config.env.logChannelId) return;
  try {
    const ch = await client.channels.fetch(config.env.logChannelId);
    for (let i = 0; i < content.length; i += 1900) {
      await ch.send({ content: content.slice(i, i + 1900), allowedMentions: { parse: [] } });
    }
  } catch (err) {
    console_.error('failed to post to the staff log channel', { channel: config.env.logChannelId, err });
  }
}

/** `<@id>` renders as the fan's name in the log; `(id)` stays searchable. */
const fanRef = (user) => `<@${user.id}> (${user.id})`;

/** One line per fan entry, so staff see everything as it comes in. */
const entries = {
  member: (client, { user, category, member, reason, status }) =>
    staffLog(client, `${status === 'updated' ? '🔁' : '🏆'} ${fanRef(user)} nominated **${member}** for **${category}**${reason ? `\n> ${reason}` : ''}`),
  moment: (client, { user, category, text, link, status }) =>
    staffLog(client, `${status === 'updated' ? '🔁' : '💿'} ${fanRef(user)} nominated **${text}** for **${category}**${link ? `\n🔗 <${link}>` : ''}`),
  withdraw: (client, { user, category }) =>
    staffLog(client, `🗑️ ${fanRef(user)} withdrew their **${category}** nomination`),
  memory: (client, { user, id, text, status }) =>
    staffLog(client, `${status === 'updated' ? '🔁' : '💌'} ${fanRef(user)} shared their moment (#${id}):\n> ${text.replace(/\n/g, '\n> ')}`),
  /** A staff action, so the channel is a full audit trail of who changed what. */
  staff: (client, { user, action }) => staffLog(client, `🛠️ ${fanRef(user)} ${action}`),
};

module.exports = { staffLog, entries };
