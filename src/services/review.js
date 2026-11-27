/**
 * Staff review queue for the fan moments that can go in the yearbook: the /moment responses
 * ("What MEOVV moment made your 2026?").
 * `/yb review` shows one at a time with Approve / Reject / Skip / Edit buttons. Fans aren't named in the book.
 * ✏️ Edit saves a cut-down "book version" that the yearbook prints instead; the fan's original is kept.
 * Only approved moments are printed in the yearbook.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { truncate } = require('../lib/text');

const MOMENT_COLOR = 0xe9d9a6; // 💌 sticky-note yellow, like the yearbook pages
const DONE_COLOR = 0x2b2b2b;

const PREFIX = 'ybr';
const STATUSES = ['pending', 'approved', 'rejected'];
const STATUS_CODE = { pending: 'p', approved: 'y', rejected: 'x' };
const decode = (code) => Object.keys(STATUS_CODE).find((k) => STATUS_CODE[k] === code);

/**
 * Button ids carry the whole view state, so the queue needs no server-side session:
 *   ybr:<action>:<moment #>:<status>:<offset>
 */
function buttonId(action, item, view) {
  return [PREFIX, action, item?.id ?? '-', STATUS_CODE[view.status], view.offset].join(':');
}

function parseButtonId(customId) {
  const [prefix, action, id, status, offset] = String(customId).split(':');
  if (prefix !== PREFIX) return null;
  return {
    action,
    id: id === '-' ? null : id,
    view: { status: decode(status) ?? 'pending', offset: Math.max(0, Number(offset) || 0) },
  };
}

const isReviewButton = (customId) => customId?.startsWith(`${PREFIX}:`);

function toItem(doc) {
  return { id: String(doc.id), userId: doc.user_id, userName: doc.user_name, text: doc.text, bookText: doc.book_text || null, approved: Boolean(doc.featured), reviewed: Boolean(doc.reviewed || doc.featured) };
}

const statusLabel = (item) => (!item.reviewed ? '🕒 Pending' : item.approved ? '✅ Approved' : '❌ Rejected');

/** How many moments are pending / approved / rejected, for the footer, `/yb status` and the reveal checklist. */
async function counts(db) {
  const out = {};
  for (const s of STATUSES) out[s] = await db.countReview(s);
  return out;
}

/** The message showing one moment, with its buttons. `notice` is a line about the last action. */
async function render(db, view, notice = '') {
  let doc = await db.reviewItem(view.status, view.offset);
  if (!doc && view.offset > 0) {
    // ran off the end after skipping: wrap to the start
    view = { ...view, offset: 0 };
    doc = await db.reviewItem(view.status, 0);
  }
  const c = await counts(db);
  const total = c[view.status];
  const footer = `💌 ${c.pending} pending · ${c.approved} approved · ${c.rejected} rejected`;

  if (!doc) {
    const embed = new EmbedBuilder()
      .setColor(DONE_COLOR)
      .setTitle(view.status === 'pending' ? '🏁 All caught up' : `Nothing ${view.status}`)
      .setDescription(view.status === 'pending' ? 'No fan moments left to review. Approved ones will be in the yearbook.' : `No ${view.status} fan moments.`)
      .setFooter({ text: footer });
    return { content: notice || undefined, embeds: [embed], components: [], allowedMentions: { parse: [] } };
  }

  const item = toItem(doc);
  const quote = (t, max) => `> ${truncate(t, max).replace(/\n/g, '\n> ')}`;
  // the card shows what will be printed; an edited moment also shows the fan's original
  const embed = new EmbedBuilder()
    .setColor(MOMENT_COLOR)
    .setTitle(`💌 Fan moment #${item.id}`)
    .setDescription(truncate(item.bookText ?? item.text, 4000))
    .setFooter({ text: footer });
  if (item.bookText) embed.addFields({ name: '✏️ Edited for the book · fan’s original:', value: quote(item.text, 1000) });
  embed.addFields(
    { name: 'From', value: `<@${item.userId}> · ${truncate(item.userName ?? '', 100)}`, inline: true },
    { name: 'Status', value: statusLabel(item), inline: true },
    { name: 'Queue', value: `${view.offset + 1} of ${total} ${view.status}`, inline: true },
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buttonId('approve', item, view)).setStyle(ButtonStyle.Success).setLabel('Approve').setEmoji('✅'),
    new ButtonBuilder().setCustomId(buttonId('reject', item, view)).setStyle(ButtonStyle.Danger).setLabel('Reject').setEmoji('❌'),
    new ButtonBuilder().setCustomId(buttonId('skip', item, view)).setStyle(ButtonStyle.Secondary).setLabel('Skip').setEmoji('⏭️'),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buttonId('edit', item, view)).setStyle(ButtonStyle.Secondary).setLabel(item.bookText ? 'Edit book version' : 'Edit / cut down').setEmoji('✏️'),
    new ButtonBuilder().setCustomId(buttonId('done', null, view)).setStyle(ButtonStyle.Secondary).setLabel('Done'),
  );
  return { content: notice || undefined, embeds: [embed], components: [row, row2], allowedMentions: { parse: [] } };
}

/** The ✏️ Edit form, prefilled with the current book version (or the original). Null if the moment is gone. */
async function editModal(db, customId) {
  const { id, view } = parseButtonId(customId);
  const doc = await db.getMemory(Number(id));
  if (!doc || doc.removed) return null;
  const item = toItem(doc);
  const input = new TextInputBuilder()
    .setCustomId('text')
    .setLabel('Version printed in the yearbook')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(4000)
    .setRequired(false)
    .setPlaceholder('Clear this box to print the fan’s original again')
    .setValue(truncate(item.bookText ?? item.text, 4000));
  return new ModalBuilder()
    .setCustomId(buttonId('save', item, view))
    .setTitle(`Edit fan moment #${id}`)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

/** Save the ✏️ Edit form and show the same card again. */
async function saveEdit(db, customId, text) {
  const { id, view } = parseButtonId(customId);
  const doc = await db.getMemory(Number(id));
  const value = text?.trim() && text.trim() !== doc?.text?.trim() ? text.trim() : null;
  if (!doc || doc.removed || !(await db.setBookText(id, value))) return { message: await render(db, view, '⚠️ That moment was removed in the meantime.') };
  return {
    message: await render(db, view, value ? '✏️ Saved the book version. Approve it to put it in the yearbook.' : '↩️ Back to the fan’s original.'),
    audit: value ? `edited the book version of fan moment #${id} by <@${doc.user_id}>:\n> ${truncate(value, 1500).replace(/\n/g, '\n> ')}` : `reset fan moment #${id} by <@${doc.user_id}> to the fan’s original`,
  };
}

/**
 * Apply a button press. Returns the next message to show and, for decisions, an audit line.
 * @returns {Promise<{message:object, audit?:string}>}
 */
async function handle(db, customId) {
  const parsed = parseButtonId(customId);
  if (!parsed) return { message: { content: 'Unknown review button.', embeds: [], components: [] } };
  const { action, id, view } = parsed;

  if (action === 'done') {
    const left = (await counts(db)).pending;
    return { message: { content: `👋 Review closed. ${left ? `${left} moment${left === 1 ? '' : 's'} still pending.` : 'Nothing left pending.'} Run \`/yb review\` to pick up again.`, embeds: [], components: [] } };
  }
  if (action === 'skip') return { message: await render(db, { ...view, offset: view.offset + 1 }) };

  const approved = action === 'approve';
  if (!(await db.setReview(id, approved))) return { message: await render(db, view, '⚠️ That moment was removed in the meantime.') };

  // If the moment still belongs to the list being viewed (e.g. re-approving an approved one), move past it;
  // otherwise it has left the list and the next one slides into the same position.
  const newStatus = approved ? 'approved' : 'rejected';
  const next = { ...view, offset: newStatus === view.status ? view.offset + 1 : view.offset };
  const doc = await db.getMemory(Number(id));
  return {
    message: await render(db, next, `${approved ? '✅ Approved' : '❌ Rejected'} fan moment #${id}.`),
    audit: `${approved ? 'approved' : 'rejected'} fan moment #${id} by <@${doc?.user_id}> for the yearbook`,
  };
}

module.exports = { render, handle, editModal, saveEdit, counts, isReviewButton, parseButtonId, buttonId, STATUSES };
