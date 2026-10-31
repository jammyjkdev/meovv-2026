const fan = require('./fan');
const admin = require('./admin');

/** All slash commands, keyed by name. */
const commands = [fan.nominate, fan.mynominations, fan.moment, fan.info, admin.yb];

function byName() {
  const map = new Map();
  for (const c of commands) map.set(c.data().name, c);
  return map;
}

module.exports = { commands, byName };
