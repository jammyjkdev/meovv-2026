const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../src/services/review');
const { groupNotes } = require('../src/services/yearbook');
const { renderNotes } = require('../src/services/pages');
const config = require('../src/config');

test('review button ids round-trip and fit Discord’s 100-character limit', () => {
  const view = { type: 'notes', status: 'rejected', offset: 7 };
  const item = { kind: 'reason', id: '65f0c0ffee0123456789abcd' };
  const id = review.buttonId('anon', item, view);
  assert.ok(id.length <= 100, id);
  assert.ok(review.isReviewButton(id));
  assert.deepEqual(review.parseButtonId(id), { action: 'anon', kind: 'reason', id: item.id, view });
  assert.equal(review.parseButtonId('memory:submit'), null);
  assert.equal(review.parseButtonId(review.buttonId('done', null, view)).kind, null);
});

test('approved notes group by superlative, winner first, in member colours', () => {
  const [a, b] = config.superlatives();
  const cats = [
    { id: a.id, title: a.title, winners: [{ text: 'NARIN' }] },
    { id: b.id, title: b.title, winners: [] },
  ];
  const reasons = [
    { category_id: a.id, norm: 'sooin', user_name: 'Fan 1', reason: 'so stylish', reason_anonymous: false },
    { category_id: a.id, norm: 'narin', user_name: 'Fan 2', reason: 'red hair era', reason_anonymous: true },
    { category_id: a.id, norm: 'narin', user_name: 'Fan 3', reason: 'always', reason_anonymous: false },
  ];
  const notes = groupNotes(cats, reasons);
  assert.equal(notes.length, 1, 'categories without notes are left out');
  assert.deepEqual(notes[0].groups.map((g) => [g.member, g.winner, g.notes.length]), [['NARIN', true, 2], ['SOOIN', false, 1]]);
  assert.equal(notes[0].groups[0].notes[0].author, 'A MEOVV fan');
  assert.equal(notes[0].groups[0].emoji, '🩷');
  assert.match(notes[0].groups[0].color, /^#[0-9A-F]{6}$/i);
  const pages = renderNotes({ notes }, 3);
  assert.equal(pages.length, 1);
  assert.ok(pages[0].subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
});

test('every member has a heart and a colour', () => {
  for (const m of config.event.members) {
    assert.ok(m.emoji, m.id);
    assert.match(m.color, /^#[0-9A-F]{6}$/i, m.id);
  }
});
