/**
 * Download MEOVV's official release covers into assets/covers/ for the Fan Favorites page — `npm run covers`
 *
 * Artwork comes from Apple's public iTunes catalogue. Each song in the config's `songs` list is saved under
 * its own name (go-hard.jpg, ddi-ro-ri.jpg, …) using the cover of the release it came out on, plus a file
 * per album title. Files you put there yourself are kept unless you pass --force.
 *
 * The images are the label's artwork, so they are git-ignored and never committed to this (public) repo:
 * run this on the machine that runs the bot, then restart it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const config = require('../config/yearbook.config');
const { normalize } = require('../src/lib/text');

const DIR = path.join(__dirname, '..', 'assets', 'covers');
const SIZE = 600;
const force = process.argv.includes('--force');

// iTunes collection ids of MEOVV's releases (US store), and the songs each one supplies the cover for.
// A song takes the cover of the release it first came out on as a lead or B-side.
const RELEASES = [
  { id: 1765597768, name: 'MEOW', songs: ['MEOW'] },
  { id: 1779250380, name: 'TOXIC', songs: ['TOXIC', 'BODY'] },
  { id: 1808544400, name: 'HANDS UP', songs: ['HANDS UP'] },
  { id: 1810320315, name: 'MY EYES OPEN VVIDE', songs: ['DROP TOP', 'LIT RIGHT NOW'] },
  { id: 1828395481, name: 'ME ME ME', songs: ['ME ME ME'] },
  { id: 1843953409, name: 'BURNING UP', songs: ['BURNING UP'] },
  { id: 1850676824, name: 'BURNING UP (Rush Remix)', songs: ['BURNING UP (Rush Remix)'] },
  { id: 6774033347, name: 'BITE NOW', songs: ['DDI RO RI', "Hit 'Em", 'In my hands', 'Favorite Song', 'Revenge'] },
  { id: 6817645174, name: 'GO HARD', songs: ['GO HARD', 'Indestructible'] },
];

const slug = (t) => normalize(t).replace(/\s+/g, '-');

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const url = `https://itunes.apple.com/lookup?id=${RELEASES.map((r) => r.id).join(',')}&country=us`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes lookup failed: HTTP ${res.status}`);
  const found = new Map((await res.json()).results.map((r) => [r.collectionId, r]));

  const missingSongs = config.songs.filter((s) => !RELEASES.some((r) => r.songs.some((x) => slug(x) === slug(s))));
  if (missingSongs.length) console.warn(`⚠️  No release mapped for: ${missingSongs.join(', ')} (add them to RELEASES in this script)`);

  let saved = 0;
  for (const rel of RELEASES) {
    const info = found.get(rel.id);
    if (!info?.artworkUrl100) { console.warn(`⚠️  ${rel.name}: not found in the iTunes catalogue`); continue; }
    const names = [...new Set([rel.name, ...rel.songs].map(slug))];
    const targets = names.map((n) => path.join(DIR, `${n}.jpg`)).filter((f) => force || !fs.existsSync(f));
    if (!targets.length) { console.log(`·  ${rel.name}: already there`); continue; }

    const big = info.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${SIZE * 2}x${SIZE * 2}bb.jpg`);
    const img = await fetch(big);
    if (!img.ok) { console.warn(`⚠️  ${rel.name}: artwork download failed (HTTP ${img.status})`); continue; }
    const art = await loadImage(Buffer.from(await img.arrayBuffer()));
    const canvas = createCanvas(SIZE, SIZE);
    canvas.getContext('2d').drawImage(art, 0, 0, SIZE, SIZE);
    const jpg = canvas.toBuffer('image/jpeg', 88);
    for (const f of targets) fs.writeFileSync(f, jpg);
    saved += targets.length;
    console.log(`✓  ${rel.name} → ${targets.map((f) => path.basename(f)).join(', ')}`);
  }
  console.log(`\n${saved} cover file(s) written to ${DIR}. Restart the bot to use them.`);
}

main().catch((err) => {
  console.error(`Couldn't fetch covers: ${err.message}`);
  process.exit(1);
});
