const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { open, resolveDbName, DEFAULT_DB_NAME } = require('../src/db');
const config = require('../src/config');
const { pollOptions, nominateMember, nominateMoment, ranked } = require('../src/services/nominations');
const yearbook = require('../src/services/yearbook');
const scheduler = require('../src/services/scheduler');
const { phaseAnnouncement } = require('../src/services/announcements');
const { parseOptions, yb } = require('../src/commands/admin');
const { nominate } = require('../src/commands/fan');
const { START_JOB } = require('../src/services/event');
const { commands } = require('../src/commands');

const u = (n) => ({ id: `u${n}`, name: `Fan ${n}` });

// Tests only ever use this in-memory server, never MONGO_URI from .env.
let server;
let db;
test.before(async () => {
  server = await MongoMemoryServer.create();
  db = await open(server.getUri(), { dbName: 'services' });
});
test.after(async () => {
  await db?.close();
  await server?.stop();
});

test('database name comes from the URI, with a safe default', () => {
  assert.equal(resolveDbName('mongodb+srv://u:p@cluster.example.net/?retryWrites=true'), DEFAULT_DB_NAME);
  assert.equal(resolveDbName('mongodb+srv://u:p@cluster.example.net'), DEFAULT_DB_NAME);
  assert.equal(resolveDbName('mongodb://a:1,b:2/mine?replicaSet=x'), 'mine');
});

test('nominations: one per user per category, duplicates group', async () => {
  assert.equal(await nominateMoment(db, { categoryId: 'song', text: 'TOXIC', link: 'https://youtu.be/a', user: u(1) }), 'created');
  assert.equal(await nominateMoment(db, { categoryId: 'song', text: 'toxic!', user: u(2) }), 'created');
  assert.equal(await nominateMoment(db, { categoryId: 'song', text: 'Hands Up', user: u(3) }), 'created');
  assert.equal(await nominateMoment(db, { categoryId: 'song', text: 'Hands Up', user: u(1) }), 'updated');
  const r = await ranked(db, 'song');
  assert.deepEqual(r.map((n) => [n.norm, n.count]), [['hands up', 2], ['toxic', 1]]);
});

test('song nominations must come from the fixed list and are normalised to it', async () => {
  await assert.rejects(nominateMoment(db, { categoryId: 'song', text: 'Some Other Song', user: u(7) }), /from the list/);
  await nominateMoment(db, { categoryId: 'song', text: 'drop top!', user: u(7) });
  const mine = await db.nominationsByUser('u7');
  assert.equal(mine[0].value, 'DROP TOP');
  assert.equal(config.event.songs.length, 16);
  await db.deleteNomination('song', 'u7');
});

test('staff can wipe one fan', async () => {
  await nominateMoment(db, { categoryId: 'mv', text: 'spam spam', user: u(8) });
  await nominateMember(db, { categoryId: 'best-dressed', memberId: 'ella', user: u(8) });
  assert.equal(await db.deleteNominationsByUser('u8'), 2);
  assert.equal((await db.nominationsByUser('u8')).length, 0);
});

test('simultaneous nominations from one fan leave a single nomination', async () => {
  await Promise.all(Array.from({ length: 8 }, () => nominateMoment(db, { categoryId: 'choreo', text: 'TOXIC', user: u(9) })));
  assert.equal((await db.nominationsFor('choreo')).length, 1);
});

test('merge/rename/exclude overrides feed poll options', async () => {
  await nominateMoment(db, { categoryId: 'mv', text: 'Toxic MV', user: u(1) });
  await nominateMoment(db, { categoryId: 'mv', text: 'TOXIC', user: u(2) });
  await nominateMoment(db, { categoryId: 'mv', text: 'spam', user: u(3) });
  await nominateMoment(db, { categoryId: 'mv', text: 'Hands Up', user: u(4) });
  await db.mergeNominees('mv', 'toxic mv', 'toxic');
  await db.setOverride('mv', 'spam', { excluded: true });
  await db.setOverride('mv', 'toxic', { display: 'TOXIC' });
  await db.setOverride('mv', 'toxic', { link: 'https://youtu.be/toxic' });
  const { options } = await pollOptions(db, 'mv');
  assert.deepEqual(options.map((o) => o.text), ['TOXIC', 'Hands Up']);
  assert.equal(options[0].link, 'https://youtu.be/toxic');
  await db.setOverride('mv', 'spam', { excluded: false });
  assert.equal((await pollOptions(db, 'mv')).options.length, 3);
});

test('superlative polls shortlist the most-nominated members; review polls pool sources', async () => {
  await nominateMember(db, { categoryId: 'best-dressed', memberId: 'anna', user: u(1) });
  await nominateMember(db, { categoryId: 'best-dressed', memberId: 'anna', user: u(2) });
  await nominateMember(db, { categoryId: 'best-dressed', memberId: 'ella', user: u(3) });
  await nominateMember(db, { categoryId: 'best-dressed', memberId: 'narin', user: u(4) });
  await new Promise((r) => setTimeout(r, 5)); // so NARIN is clearly nominated before SOOIN
  await nominateMember(db, { categoryId: 'best-dressed', memberId: 'sooin', user: u(5) });
  await nominateMember(db, { categoryId: 'best-dressed', memberId: 'ella', user: u(6) });
  const { options } = await pollOptions(db, 'best-dressed');
  assert.equal(options.length, config.event.polls.superlativeFinalists);
  assert.deepEqual(options.map((o) => o.text), ['ANNA', 'NARIN', 'ELLA'], 'top 3 by nominations in member order (NARIN and SOOIN tie at 1; NARIN was nominated first)');
  const review = await pollOptions(db, 'most-played');
  assert.deepEqual(review.options.map((o) => o.text), ['HANDS UP', 'TOXIC']);
  assert.ok(review.note);
});

test('withdrawing a nomination and the staff counts', async () => {
  await nominateMoment(db, { categoryId: 'looks', text: 'Red carpet', user: u(5) });
  assert.equal(await db.deleteNomination('looks', u(5).id), 1);
  assert.equal(await db.deleteNomination('looks', u(5).id), 0);
  const song = (await db.nominationCounts()).find((c) => c.category_id === 'song');
  assert.deepEqual([song.n, song.nominees], [3, 2]);
  assert.ok((await db.nominatorCount()) >= 4);
});

test('memories + yearbook compile', async () => {
  const { id } = await db.upsertMemory({ userId: 'u1', userName: 'Fan 1', text: 'Seeing them live <3' });
  const second = await db.upsertMemory({ userId: 'u2', userName: 'Fan 2', text: 'The GO HARD stage' });
  assert.equal(second.id, id + 1, 'response numbers are sequential');
  await db.updateMemory(id, { featured: true, anonymous: true });
  assert.deepEqual(await db.countMemories(), { total: 2, featured: 1 });
  const edited = await db.upsertMemory({ userId: 'u2', userName: 'Fan 2', text: 'Edited' });
  assert.deepEqual(edited, { id: second.id, status: 'updated' });
  await db.savePoll({ pollKey: 'best-dressed', kind: 'superlative', question: 'Best Dressed', options: [], channelId: 'c', messageId: 'm', postedAt: 1, endsAt: 2 });
  await db.saveResults('best-dressed', [{ text: 'ANNA', votes: 10 }, { text: 'ELLA', votes: 4 }]);
  const book = await yearbook.compile(db);
  const bd = book.superlatives.find((e) => e.id === 'best-dressed');
  assert.equal(bd.winners[0].text, 'ANNA');
  assert.equal(book.memories.length, 1);
  assert.equal(book.memories[0].author, 'A MEOVV fan');
  assert.ok(yearbook.problems(book).some((p) => p.includes('never posted')));
  const pages = yearbook.pageFiles(book);
  assert.ok(pages.length >= 5, 'cover + three sections + memories');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  for (const p of pages) {
    assert.ok(p.name.endsWith('.png'), p.name);
    assert.ok(p.attachment.subarray(0, 4).equals(PNG), `${p.name} is a PNG`);
  }
});

test('the event waits for the staff command, then runs from that point', async () => {
  const eventDb = await open(server.getUri(), { dbName: 'manual-start' });
  try {
    const sent = [];
    const channel = {
      id: 'c',
      async send(message) {
        sent.push(message);
        return { id: `m${sent.length}`, url: `https://discord.test/${sent.length}`, poll: null };
      },
    };
    const client = { channels: { fetch: async () => channel } };
    const ctx = { db: eventDb, client };
    const log = async () => {};
    const replies = [];
    const record = async (r) => { replies.push(typeof r === 'string' ? r : r.content); };
    const interaction = (options) => ({
      client,
      user: { id: 'fan', username: 'fan' },
      memberPermissions: { has: () => true },
      options: {
        getSubcommandGroup: () => options.group ?? null,
        getSubcommand: () => options.sub,
        getString: (name) => options[name] ?? null,
      },
      reply: record,
      editReply: record,
      deferReply: async () => {},
    });
    const nominateFan = () => nominate.execute(interaction({ sub: 'moment', category: 'song', nomination: 'TOXIC' }), ctx);
    const runStart = () => yb.execute(interaction({ group: 'schedule', sub: 'run', key: START_JOB }), ctx);

    // Before the command: nothing posts, nothing is recorded, fans can't nominate.
    await scheduler.tick(ctx, log);
    assert.equal(sent.length, 0);
    assert.equal((await eventDb.allJobs()).size, 0);
    await nominateFan();
    assert.match(replies.at(-1), /haven’t opened/);
    assert.equal((await eventDb.nominationsFor('song')).length, 0);

    // The command posts the announcement once, logs it, and opens nominations.
    const announcements = () => sent.filter((m) => m.embeds?.[0]?.data.title?.startsWith('📸'));
    await runStart();
    assert.equal(announcements().length, 1);
    assert.ok(sent.some((m) => /ran `announce:nominations` by hand/.test(m.content)), 'staff log records who started the event');
    assert.ok(sent.some((m) => /Posted the \*\*nominations\*\* announcement/.test(m.content)), 'staff log records the announcement');
    assert.equal((await eventDb.jobStatus(START_JOB)).status, 'done');
    await nominateFan();
    assert.match(replies.at(-1), /Nominated/);
    assert.equal((await eventDb.nominationsFor('song')).length, 1);
    // every entry is reported to the staff log channel, tagging the fan without pinging
    const entry = sent.find((m) => /nominated \*\*TOXIC\*\* for \*\*Favorite MEOVV Song\*\*/.test(m.content));
    assert.ok(entry, 'staff log received the nomination');
    assert.match(entry.content, /<@fan>/);
    assert.deepEqual(entry.allowedMentions, { parse: [] });

    // Later passes and a second command don't repeat the announcement.
    await scheduler.tick(ctx, log);
    const afterTick = sent.length;
    await scheduler.tick(ctx, log);
    await runStart();
    assert.match(replies.at(-1), /already started/);
    assert.equal(sent.length, afterTick);
    assert.equal(announcements().length, 1);
  } finally {
    await eventDb.close();
  }
});

test('the yearbook cannot be published until an admin approves it', async () => {
  const gateDb = await open(server.getUri(), { dbName: 'approval' });
  try {
    const sent = [];
    const channel = { id: 'c', async send(m) { sent.push(m); return { id: `m${sent.length}`, url: `https://discord.test/${sent.length}` }; } };
    const ctx = { db: gateDb, client: { channels: { fetch: async () => channel } } };
    await assert.rejects(yearbook.publish(ctx), /not been approved/);
    assert.equal(sent.length, 0, 'nothing posted while locked');
    await yearbook.approve(gateDb, { id: 'admin' });
    assert.equal((await yearbook.approval(gateDb)).by, 'admin');
    const { url } = await yearbook.publish(ctx);
    assert.ok(url);
    assert.ok(sent.length >= 4, 'cover + section pages posted');
    assert.ok(sent[0].files?.length === 1 && sent[0].content.includes('is here'));
    await yearbook.lock(gateDb);
    await assert.rejects(yearbook.publish(ctx), /not been approved/);
  } finally {
    await gateDb.close();
  }
});

test('announcements and command definitions are valid', () => {
  for (const p of ['nominations', 'voting', 'review']) {
    const m = phaseAnnouncement(p);
    for (const e of m.embeds) {
      const j = e.toJSON();
      assert.ok((j.description ?? '').length <= 4096);
      for (const f of j.fields ?? []) assert.ok(f.value.length <= 1024, `${p}: ${f.name}`);
    }
  }
  for (const c of commands) c.data().toJSON(); // throws if invalid
});

test('admin parseOptions', () => {
  assert.deepEqual(parseOptions('A | B=https://x.com/1 | C=D'), [
    { text: 'A', link: null, emoji: null },
    { text: 'B', link: 'https://x.com/1', emoji: null },
    { text: 'C=D', link: null, emoji: null },
  ]);
});
