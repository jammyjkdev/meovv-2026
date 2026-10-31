/** Print the automatic schedule from config/yearbook.config.js — `npm run schedule` */
const { buildPlan } = require('../src/lib/plan');
const cfg = require('../config/yearbook.config.js');

for (const j of buildPlan(cfg)) {
  const what = j.type === 'poll' ? `${j.payload.kind.padEnd(11)} ${j.payload.pollKey}` : j.type;
  console.log(`${j.at.toFormat('ccc LLL dd HH:mm')}  ${j.key.padEnd(28)} ${what}`);
}
console.log(`\nTimes in ${cfg.timezone}`);
