const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../src/services/review');
const config = require('../src/config');

test('review button ids round-trip and fit Discord’s 100-character limit', () => {
  const view = { status: 'rejected', offset: 7 };
  const id = review.buttonId('approve', { id: '1234' }, view);
  assert.ok(id.length <= 100, id);
  assert.ok(review.isReviewButton(id));
  assert.deepEqual(review.parseButtonId(id), { action: 'approve', id: '1234', view });
  assert.equal(review.parseButtonId('memory:submit'), null);
  assert.equal(review.parseButtonId(review.buttonId('done', null, view)).id, null);
});

test('inside pages pair up into spreads; the cover stays single', () => {
  const { renderAll } = require('../src/services/pages');
  const e = (id) => ({ id, title: id, winners: [{ text: 'GO HARD', votes: 3 }], totalVotes: 5 });
  const book = { title: 'x', superlatives: [e('a')], favorites: [e('b')], moments: [e('c')], memories: [{ text: 'Seeing them live!' }] };
  const spreads = renderAll(book);
  assert.equal(spreads.length, 3, 'cover + 2 spreads');
  const width = (buf) => buf.readUInt32BE(16);
  assert.equal(width(spreads[0].buffer), 1080);
  assert.equal(width(spreads[1].buffer), 2160);
  assert.match(spreads[1].name, /-02-03-superlatives--fan-favorites\.png$/);
  const single = renderAll(book, { spreads: false });
  assert.equal(single.length, 5);
  assert.ok(single.every((p) => width(p.buffer) === 1080));
});

test('every member has a heart and a colour', () => {
  for (const m of config.event.members) {
    assert.ok(m.emoji, m.id);
    assert.match(m.color, /^#[0-9A-F]{6}$/i, m.id);
  }
});

test('fan favorites print as one page of album sleeves, however many categories', () => {
  const { renderAlbums } = require('../src/services/pages');
  const fav = (i) => ({ id: `c${i}`, title: `Category ${i}`, winners: [{ text: `A rather long winning title number ${i}`, votes: 5 }], totalVotes: 9 });
  for (const n of [3, 12, 16]) {
    const pages = renderAlbums('💿 Fan favorites', '2026 FAN FAVORITES', Array.from({ length: n }, (_, i) => fav(i)), 5);
    assert.equal(pages.length, 1, `${n} favorites`);
  }
});

test('fan favorites: songs keep the record design and their official spelling; other winners are Polaroids', () => {
  const { renderAlbums, isMusic, winnerTitle } = require('../src/services/pages');
  const fav = (t) => ({ id: t, title: t, winners: [{ text: t, votes: 3 }], totalVotes: 5 });
  assert.equal(isMusic(fav('hit em')), true);
  assert.equal(winnerTitle(fav('hit em')), "Hit 'Em");
  assert.equal(isMusic(fav('Red hair Narin')), false);
  assert.equal(winnerTitle(fav('Red hair Narin')), 'Red hair Narin');
  assert.equal(renderAlbums('k', 't', [fav('hit em'), fav("Hit 'Em"), fav('Red hair Narin'), fav('Gawon F1')], 3).length, 1);
});
