const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const db = require('../src/db').open(':memory:');
const config = require('../src/config');
const { pollOptions, nominateMember, nominateMoment, ranked } = require('../src/services/nominations');
const yearbook = require('../src/services/yearbook');
const { phaseAnnouncement } = require('../src/services/announcements');
const { parseOptions } = require('../src/commands/admin');
const { commands } = require('../src/commands');

const u = (n) => ({ id: `u${n}`, name: `Fan ${n}` });

test('nominations: one per user per category, duplicates group', () => {
  assert.equal(nominateMoment(db, { categoryId: 'song', text: 'TOXIC', link: 'https://youtu.be/a', user: u(1) }), 'created');
  assert.equal(nominateMoment(db, { categoryId: 'song', text: 'toxic!', user: u(2) }), 'created');
  assert.equal(nominateMoment(db, { categoryId: 'song', text: 'Hands Up', user: u(3) }), 'created');
  assert.equal(nominateMoment(db, { categoryId: 'song', text: 'Hands Up', user: u(1) }), 'updated');
  const r = ranked(db, 'song');
  assert.deepEqual(r.map((n) => [n.norm, n.count]), [['hands up', 2], ['toxic', 1]]);
});

test('merge/rename/exclude overrides feed poll options', () => {
  nominateMoment(db, { categoryId: 'mv', text: 'Toxic MV', user: u(1) });
  nominateMoment(db, { categoryId: 'mv', text: 'TOXIC', user: u(2) });
  nominateMoment(db, { categoryId: 'mv', text: 'spam', user: u(3) });
  nominateMoment(db, { categoryId: 'mv', text: 'Hands Up', user: u(4) });
  db.mergeNominees('mv', 'toxic mv', 'toxic');
  db.setOverride('mv', 'spam', { excluded: true });
  db.setOverride('mv', 'toxic', { display: 'TOXIC', link: 'https://youtu.be/toxic' });
  const { options } = pollOptions(db, 'mv');
  assert.deepEqual(options.map((o) => o.text), ['TOXIC', 'Hands Up']);
  assert.equal(options[0].link, 'https://youtu.be/toxic');
  db.setOverride('mv', 'spam', { excluded: false });
  assert.equal(pollOptions(db, 'mv').options.length, 3);
});

test('superlative polls list all members; review polls pool sources', () => {
  nominateMember(db, { categoryId: 'best-dressed', memberId: 'anna', user: u(1) });
  assert.equal(pollOptions(db, 'best-dressed').options.length, config.event.members.length);
  const review = pollOptions(db, 'most-played');
  assert.deepEqual(review.options.map((o) => o.text), ['Hands Up', 'toxic!']);
  assert.ok(review.note);
});

test('memories + yearbook compile', () => {
  const { id } = db.upsertMemory({ userId: 'u1', userName: 'Fan 1', text: 'Seeing them live <3' });
  db.upsertMemory({ userId: 'u2', userName: 'Fan 2', text: 'The GO HARD stage' });
  db.updateMemory(id, { featured: true, anonymous: true });
  db.savePoll({ pollKey: 'best-dressed', kind: 'superlative', question: 'Best Dressed', options: [], channelId: 'c', messageId: 'm', postedAt: 1, endsAt: 2 });
  db.saveResults('best-dressed', [{ text: 'ANNA', votes: 10 }, { text: 'ELLA', votes: 4 }]);
  const book = yearbook.compile(db);
  const bd = book.superlatives.find((e) => e.id === 'best-dressed');
  assert.equal(bd.winners[0].text, 'ANNA');
  assert.equal(book.memories.length, 1);
  assert.equal(book.memories[0].author, 'A MEOVV fan');
  const html = yearbook.toHtml(book);
  assert.ok(html.includes('Seeing them live &lt;3'), 'html escaped');
  assert.ok(yearbook.problems(book).some((p) => p.includes('never posted')));
  const embeds = yearbook.toEmbeds(book);
  assert.ok(embeds.length >= 4);
  for (const e of embeds) e.toJSON();
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
