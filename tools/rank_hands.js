// Orders the 169 starting hands by all-in equity against one random hand and
// writes that order into odds.js (replacing the __ORDER__ placeholder).
// Usage: node rank_hands.js [trialsPerHand=40000]
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'odds.js');
const ODDS = require(file);

const trials = +(process.argv[2] || 40000);
const R = ODDS.RANKS;
const all = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) all.push([a, b]);
const random = { combos: all };

const classes = [];
for (let i = 12; i >= 0; i--) {
  for (let j = i; j >= 0; j--) {
    if (i === j) classes.push(R[i] + R[j]);
    else { classes.push(R[i] + R[j] + 's'); classes.push(R[i] + R[j] + 'o'); }
  }
}
const rng = ODDS.mulberry32(20261125);
const t0 = Date.now();
const rows = classes.map(cls => {
  const hero = ODDS.classCombos(cls)[0];
  const r = ODDS.equity({ hero, board: [], ranges: [random], trials, rng });
  return { cls, eq: r.equity };
});
rows.sort((a, b) => b.eq - a.eq);
const order = rows.map(r => r.cls).join(' ');
const src = fs.readFileSync(file, 'utf8');
if (!src.includes('__ORDER__')) {
  console.log('odds.js already has an order; printing the new one instead.');
} else {
  fs.writeFileSync(file, src.replace('__ORDER__', order));
  console.log('Wrote order into odds.js');
}
console.log(`${classes.length} hands, ${trials} trials each, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('Top 12:', rows.slice(0, 12).map(r => `${r.cls} ${(r.eq * 100).toFixed(1)}`).join(', '));
console.log('Bottom 5:', rows.slice(-5).map(r => `${r.cls} ${(r.eq * 100).toFixed(1)}`).join(', '));
