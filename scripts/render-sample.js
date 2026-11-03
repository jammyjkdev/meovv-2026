/** Render the yearbook pages with sample data to data/previews/ — `npm run render` */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { renderAll } = require('../src/services/pages');

const members = config.event.members;
const entry = (c, i, extra = {}) => ({ id: c.id, title: c.title, type: c.type, status: 'decided', totalVotes: 120 + i * 7, winners: [{ text: members[i % members.length].name, votes: 60 + i * 3 }], ...extra });

const book = {
  title: config.event.eventName,
  superlatives: config.superlatives().map((c, i) => entry(c, i)),
  favorites: [
    { title: 'Favorite MEOVV Song', winners: [{ text: 'GO HARD', votes: 71 }], totalVotes: 140 },
    { title: 'Favorite Music Video', winners: [{ text: 'DDI RO RI', votes: 58 }], totalVotes: 131 },
    { title: 'Favorite Performance', winners: [{ text: 'GO HARD at Music Bank', votes: 44 }], totalVotes: 120 },
    { title: 'Favorite Choreography', winners: [{ text: 'TOXIC', votes: 40 }, { text: 'DROP TOP', votes: 40 }], totalVotes: 118 },
    { title: 'Favorite Member Look', winners: [{ text: 'Narin’s airport fit, October', votes: 52 }], totalVotes: 110 },
    { title: 'Favorite Fashion Moment', winners: [{ text: 'The all-black GO HARD showcase outfits', votes: 61 }], totalVotes: 125 },
    { title: 'Favorite Performance (Year in Review)', winners: [{ text: 'GO HARD at Music Bank', votes: 70 }], totalVotes: 130 },
    { title: 'Favorite Music Video (Year in Review)', winners: [{ text: 'GO HARD', votes: 65 }], totalVotes: 130 },
    { title: 'Favorite Choreography (Year in Review)', winners: [{ text: 'DDI RO RI', votes: 60 }], totalVotes: 130 },
    { title: 'Favorite Styling Moment', winners: [], totalVotes: 0 },
    { title: 'Song You Played the Most', winners: [{ text: 'BURNING UP', votes: 66 }], totalVotes: 133 },
    { title: 'Song You’re Bringing Into 2027', winners: [{ text: 'Indestructible', votes: 70 }], totalVotes: 135 },
  ],
  moments: [
    { title: 'Favorite Variety/Interview Moment', winners: [{ text: 'Sooin losing it on the radio show', votes: 50 }], totalVotes: 100 },
    { title: 'Favorite Funny/Chaotic Moment', winners: [{ text: 'The ramen challenge live', votes: 55 }], totalVotes: 100 },
    { title: 'Favorite “GO HARD” Moment', winners: [{ text: 'The first teaser drop', votes: 60 }], totalVotes: 100 },
    { title: 'Favorite MEOVV Moment of 2026', winners: [{ text: 'GO HARD comeback stage', votes: 80 }], totalVotes: 150 },
    { title: 'Most Unexpected MEOVV Moment', winners: [{ text: 'The surprise busking set in Hongdae that nobody saw coming', votes: 70 }], totalVotes: 140 },
  ],
  memories: [
    { author: 'Fan 1', text: 'Seeing them live for the first time at the GO HARD showcase. I cried the whole way through TOXIC and I’m not even sorry.' },
    { author: 'A MEOVV fan', text: 'DROP TOP got me through exams. That’s it, that’s the memory.' },
    { author: 'jk', text: 'Finding this server. Honestly, the group chat during the comeback week was the most fun I’ve had online all year. Every teaser, every theory, every 3am stream party. ' + 'You all made 2026 feel like a shared thing instead of something I watched alone. '.repeat(4) },
    { author: 'Fan 4', text: 'When Ella waved at my sign during the fan meet. Ten seconds that I will think about forever.' },
    { author: 'Fan 5', text: 'Learning the DDI RO RI choreo with my little sister in the kitchen. We still can’t do the bridge part.' },
  ],
};

const dir = path.join(config.env.dataDir, 'previews');
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(dir, f));
for (const p of renderAll(book)) {
  fs.writeFileSync(path.join(dir, p.name), p.buffer);
  console.log(`${p.name}  ${(p.buffer.length / 1024).toFixed(0)} KB`);
}
console.log(`\nWritten to ${dir}`);
