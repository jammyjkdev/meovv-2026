/** Render the yearbook pages with sample data to data/previews/ — `npm run render` */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { renderAll, assetsReady } = require('../src/services/pages');

const members = config.event.members;
const entry = (c, i, extra = {}) => ({ id: c.id, title: c.title, type: c.type, emoji: c.emoji, status: 'decided', totalVotes: 120 + i * 7, winners: [{ text: members[i % members.length].name, votes: 60 + i * 3 }], ...extra });

const superlatives = config.superlatives().map((c, i) => entry(c, i));
const book = {
  title: config.event.eventName,
  superlatives,
  favorites: [
    { title: 'Favorite MEOVV Song', winners: [{ text: "Hit 'Em", votes: 131 }], totalVotes: 485 },
    { title: 'Favorite Music Video', winners: [{ text: 'DDI RO RI', votes: 241 }], totalVotes: 493 },
    { title: 'Favorite Performance', winners: [{ text: 'DDI RO RI', votes: 195 }], totalVotes: 475 },
    { title: 'Favorite Choreography', winners: [{ text: 'hit em', votes: 289 }], totalVotes: 458 },
    { title: 'Favorite Member Look', winners: [{ text: 'Red hair Narin', votes: 186 }], totalVotes: 433 },
    { title: 'Favorite Fashion Moment', winners: [{ text: 'Gawon F1', votes: 141 }], totalVotes: 372 },
    { title: 'Favorite Performance (Year in Review)', winners: [{ text: 'DDI RO RI', votes: 183 }], totalVotes: 398 },
    { title: 'Favorite Music Video (Year in Review)', winners: [{ text: 'DDI RO RI', votes: 201 }], totalVotes: 372 },
    { title: 'Favorite Choreography (Year in Review)', winners: [{ text: 'hit em', votes: 237 }], totalVotes: 353 },
    { title: 'Favorite Styling Moment', winners: [{ text: 'Red hair Narin', votes: 160 }], totalVotes: 356 },
    { title: 'Song You Played the Most', winners: [{ text: "Hit 'Em", votes: 127 }], totalVotes: 397 },
    { title: 'Song You’re Bringing Into 2027', winners: [{ text: "Hit 'Em", votes: 110 }], totalVotes: 365 },
  ],
  moments: [
    { title: 'Favorite Variety/Interview Moment', winners: [{ text: 'Sooin losing it on the radio show', votes: 50 }], totalVotes: 100 },
    { title: 'Favorite Funny/Chaotic Moment', winners: [{ text: 'The ramen challenge live', votes: 55 }], totalVotes: 100 },
    { title: 'Favorite “GO HARD” Moment', winners: [{ text: 'The first teaser drop', votes: 60 }], totalVotes: 100 },
    { title: 'Favorite MEOVV Moment of 2026', winners: [{ text: 'GO HARD comeback stage', votes: 80 }], totalVotes: 150 },
    { title: 'Most Unexpected MEOVV Moment', winners: [{ text: 'The surprise busking set in Hongdae that nobody saw coming', votes: 70 }], totalVotes: 140 },
  ],
  memories: [
    { text: 'Seeing them live for the first time at the GO HARD showcase. I cried the whole way through TOXIC and I’m not even sorry.' },
    { text: 'DROP TOP got me through exams. That’s it, that’s the memory.' },
    { text: 'Finding this server. Honestly, the group chat during comeback week was the most fun I’ve had online all year. Every teaser, every theory, every 3am stream party. You all made 2026 feel like a shared thing instead of something I watched alone.' },
    { text: 'When Ella waved at my sign during the fan meet. Ten seconds I will think about forever.' },
    { text: 'Learning the DDI RO RI choreo with my little sister in the kitchen. We still can’t do the bridge part.' },
    { text: 'Gawon in the F1 fit.' },
    { text: 'The ramen challenge live. I have never laughed that hard at 2am.' },
    { text: 'Red hair Narin era 🩷' },
    { text: 'Streaming GO HARD on repeat on the bus every morning until the driver knew the words.' },
    { text: 'Sooin’s radio laugh. Iconic.' },
  ],
};

assetsReady.then(() => {
  const dir = path.join(config.env.dataDir, 'previews');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(dir, f));
  for (const p of renderAll(book)) {
    fs.writeFileSync(path.join(dir, p.name), p.buffer);
    console.log(`${p.name}  ${(p.buffer.length / 1024).toFixed(0)} KB`);
  }
  console.log(`\nWritten to ${dir}`);
});
