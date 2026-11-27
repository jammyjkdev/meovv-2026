/**
 * Staff review queue for fan writing that can go in the yearbook:
 *   💌 moments: /moment responses ("What MEOVV moment made your 2026?")
 *   🏆 notes:   the "why" fans wrote with /nominate member
 * `/yb review` shows one entry at a time with Approve / Approve anonymously / Reject / Skip buttons.
 * Only approved entries are printed in the yearbook.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { truncate } = require('../lib/text');
const { findCategory, findMember } = require('./event');

const MOMENT_COLOR = 0xffb3d9; // 💌 soft pink for fan moments
const hex = (c) => (c ? parseInt(String(c).replace('#', ''), 16) : config.event.color);

const PREFIX = 'ybr';
const TYPES = { all: ['memory', 'reason'], moments: ['memory'], notes: ['reason'] };
const STATUSES = ['pending', 'approved', 'rejected'];
const TYPE_CODE = { all: 'a', moments: 'm', notes: 'n' };
const STATUS_CODE = { pending: 'p', approved: 'y', rejected: 'x' };
const decode = (map, code) => Object.keys(map).find((k) => map[k] === code);

/**
 * Button ids carry the whole view state, so the queue needs no server-side session:
 *   ybr:<action>:<kind>:<id>:<type>:<status>:<offset>
 */
function buttonId(action, item, view) {
  return [PREFIX, action, item ? (item.kind === 'memory' ? 'm' : 'r') : '-', item?.id ?? '-', TYPE_CODE[view.type], STATUS_CODE[view.status], view.offset].join(':');
}

function parseButtonId(customId) {
  const [prefix, action, kind, id, type, status, offset] = customId.split(':');
  if (prefix !== PREFIX) return null;
  return {
    action,
    kind: kind === 'm' ? 'memory' : kind === 'r' ? 'reason' : null,
    id,
    view: { type: decode(TYPE_CODE, type) ?? 'all', status: decode(STATUS_CODE, status) ?? 'pending', offset: Math.max(0, Number(offset) || 0) },
  };
}

const isReviewButton = (customId) => customId?.startsWith(`${PREFIX}:`);

/** The entry at `view.offset` across the selected kinds (moments first, then notes), and the total. */
async function locate(db, view) {
  const kinds = TYPES[view.type];
  const counts = await Promise.all(kinds.map((k) => db.countReview(k, view.status)));
  const total = counts.reduce((a, b) => a + b, 0);
  let offset = view.offset;
  for (let i = 0; i < kinds.length; i++) {
    if (offset < counts[i]) {
      const doc = await db.reviewItem(kinds[i], view.status, offset);
      return { item: doc && toItem(kinds[i], doc), total };
    }
    offset -= counts[i];
  }
  return { item: null, total };
}

function toItem(kind, doc) {
  if (kind === 'memory') {
    return { kind, id: String(doc.id), userId: doc.user_id, userName: doc.user_name, text: doc.text, anonymous: Boolean(doc.anonymous), approved: Boolean(doc.featured), reviewed: Boolean(doc.reviewed || doc.featured) };
  }
  return {
    kind,
    id: String(doc._id),
    userId: doc.user_id,
    userName: doc.user_name,
    text: doc.reason,
    anonymous: Boolean(doc.reason_anonymous),
    approved: doc.reason_status === 'approved',
    reviewed: Boolean(doc.reason_status),
    category: findCategory(doc.category_id)?.title ?? doc.category_id,
    member: doc.value,
  };
}

const statusLabel = (item) => (!item.reviewed ? '🕒 Pending' : item.approved ? `✅ Approved${item.anonymous ? ' (anonymous)' : ''}` : '❌ Rejected');

/** Counts for every kind and status, for the footer and `/yb status`. */
async function counts(db) {
  const out = {};
  for (const kind of ['memory', 'reason']) {
    out[kind] = {};
    for (const s of STATUSES) out[kind][s] = await db.countReview(kind, s);
  }
  return out;
}

/** The message showing one queue entry, with its buttons. `notice` is a line about the last action. */
async function render(db, view, notice = '') {
  let { item, total } = await locate(db, view);
  if (!item && view.offset > 0 && total > 0) {
    // ran off the end after skipping: wrap to the start
    view = { ...view, offset: 0 };
    ({ item, total } = await locate(db, view));
  }
  const c = await counts(db);
  const footer = `💌 Moments: ${c.memory.pending} pending · ${c.memory.approved} approved · ${c.memory.rejected} rejected   |   🏆 Notes: ${c.reason.pending} pending · ${c.reason.approved} approved · ${c.reason.rejected} rejected`;
  const what = { all: 'fan entries', moments: 'fan moments', notes: 'nomination notes' }[view.type];

  if (!item) {
    const embed = new EmbedBuilder()
      .setColor(config.event.color)
      .setTitle(view.status === 'pending' ? '🏁 All caught up' : `Nothing ${view.status}`)
      .setDescription(view.status === 'pending' ? `No ${what} left to review. Approved entries will be in the yearbook.` : `No ${view.status} ${what}.`)
      .setFooter({ text: footer });
    return { content: notice || undefined, embeds: [embed], components: [], allowedMentions: { parse: [] } };
  }

  const embed = new EmbedBuilder().setColor(config.event.color).setFooter({ text: footer });
  if (item.kind === 'memory') {
    embed.setColor(MOMENT_COLOR).setTitle(`💌 Fan moment #${item.id}`).setDescription(truncate(item.text, 4000));
  } else {
    const m = findMember(item.member);
    embed
      .setColor(hex(m?.color))
      .setTitle(`🏆 ${truncate(item.category, 200)}`)
      .setDescription(`${m?.emoji ?? '⭐'} **For ${item.member}**\n> ${truncate(item.text, 3900).replace(/\n/g, '\n> ')}`);
  }
  embed.addFields(
    { name: 'From', value: `<@${item.userId}> · ${truncate(item.userName ?? '', 100)}`, inline: true },
    { name: 'Status', value: statusLabel(item), inline: true },
    { name: 'Queue', value: `${view.offset + 1} of ${total} ${view.status}`, inline: true },
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(buttonId('approve', item, view)).setStyle(ButtonStyle.Success).setLabel('Approve').setEmoji('✅'),
    new ButtonBuilder().setCustomId(buttonId('anon', item, view)).setStyle(ButtonStyle.Primary).setLabel('Approve anonymously').setEmoji('🕶️'),
    new ButtonBuilder().setCustomId(buttonId('reject', item, view)).setStyle(ButtonStyle.Danger).setLabel('Reject').setEmoji('❌'),
    new ButtonBuilder().setCustomId(buttonId('skip', item, view)).setStyle(ButtonStyle.Secondary).setLabel('Skip').setEmoji('⏭️'),
    new ButtonBuilder().setCustomId(buttonId('done', null, view)).setStyle(ButtonStyle.Secondary).setLabel('Done'),
  );
  return { content: notice || undefined, embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

/**
 * Apply a button press. Returns the next message to show and, for decisions, an audit line.
 * @returns {Promise<{message:object, audit?:string}>}
 */
async function handle(db, customId) {
  const parsed = parseButtonId(customId);
  if (!parsed) return { message: { content: 'Unknown review button.', embeds: [], components: [] } };
  const { action, kind, id, view } = parsed;

  if (action === 'done') {
    const c = await counts(db);
    const left = c.memory.pending + c.reason.pending;
    return { message: { content: `👋 Review closed. ${left ? `${left} entr${left === 1 ? 'y' : 'ies'} still pending.` : 'Nothing left pending.'} Run \`/yb review\` to pick up again.`, embeds: [], components: [] } };
  }
  if (action === 'skip') return { message: await render(db, { ...view, offset: view.offset + 1 }) };

  const approved = action !== 'reject';
  const anonymous = action === 'anon';
  const matched = await db.setReview(kind, id, { approved, anonymous });
  if (!matched) return { message: await render(db, view, '⚠️ That entry was deleted or withdrawn in the meantime.') };

  // If the entry still belongs to the list being viewed (e.g. re-approving an approved one), move past it;
  // otherwise it has left the list and the next entry slides into the same position.
  const newStatus = approved ? 'approved' : 'rejected';
  const next = { ...view, offset: newStatus === view.status ? view.offset + 1 : view.offset };
  const label = kind === 'memory' ? `fan moment #${id}` : 'a nomination note';
  const verdict = approved ? '✅ Approved' : '❌ Rejected';
  const doc = kind === 'memory' ? await db.getMemory(Number(id)) : await db.getReason(id);
  const detail = kind === 'reason' && doc ? ` (${findCategory(doc.category_id)?.title ?? doc.category_id} → ${doc.value})` : '';
  return {
    message: await render(db, next, `${verdict} ${label}${anonymous ? ' (credited as “A MEOVV fan”)' : ''}.`),
    audit: `${approved ? `approved${anonymous ? ' (anonymous)' : ''}` : 'rejected'} ${label}${detail} by <@${doc?.user_id}> for the yearbook`,
  };
}

module.exports = { render, handle, counts, isReviewButton, parseButtonId, buttonId, TYPES, STATUSES };
