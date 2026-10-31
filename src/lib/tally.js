/**
 * Group raw nomination rows into ranked nominees.
 *
 * @param {Array<{norm:string,value:string,link?:string|null,created_at:number}>} rows
 * @param {Map<string,{display?:string,link?:string,excluded?:boolean}>} overrides keyed by norm
 * @returns {Array<{norm:string,display:string,link:string|null,count:number,firstAt:number}>}
 */
function rankNominations(rows, overrides = new Map()) {
  const groups = new Map();
  for (const row of rows) {
    let g = groups.get(row.norm);
    if (!g) {
      g = { norm: row.norm, count: 0, firstAt: row.created_at, spellings: new Map(), links: new Map() };
      groups.set(row.norm, g);
    }
    g.count += 1;
    g.firstAt = Math.min(g.firstAt, row.created_at);
    bump(g.spellings, row.value, row.created_at);
    if (row.link) bump(g.links, row.link, row.created_at);
  }

  const ranked = [];
  for (const g of groups.values()) {
    const o = overrides.get(g.norm) ?? {};
    if (o.excluded) continue;
    ranked.push({
      norm: g.norm,
      display: o.display || mostCommon(g.spellings),
      link: o.link || mostCommon(g.links) || null,
      count: g.count,
      firstAt: g.firstAt,
    });
  }
  ranked.sort((a, b) => b.count - a.count || a.firstAt - b.firstAt);
  return ranked;
}

function bump(map, key, at) {
  const cur = map.get(key);
  if (cur) cur.count += 1;
  else map.set(key, { count: 1, at });
}

function mostCommon(map) {
  let best = null;
  for (const [key, v] of map) {
    if (!best || v.count > best.v.count || (v.count === best.v.count && v.at < best.v.at)) best = { key, v };
  }
  return best?.key ?? null;
}

/**
 * Work out the winner(s) of a poll.
 * @param {Array<{text:string,votes:number}>} answers
 * @returns {{winners:Array<{text:string,votes:number}>, totalVotes:number}}
 */
function pickWinners(answers) {
  const totalVotes = answers.reduce((n, a) => n + (a.votes || 0), 0);
  if (totalVotes === 0) return { winners: [], totalVotes };
  const top = Math.max(...answers.map((a) => a.votes || 0));
  return { winners: answers.filter((a) => (a.votes || 0) === top), totalVotes };
}

module.exports = { rankNominations, pickWinners };
