// Tests for engine.js: hand-built edge cases with expected counters, then a
// full generated session to check that player styles are told apart.
// Usage: node test_engine.js [path-to-sample-session.txt] [styles-file]
'use strict';
const fs = require('fs');
const path = require('path');
const VF = require(path.join(__dirname, '..', 'engine.js'));

const SEATS6 = (btn) => `Table 'NLHGold7' 6-max Seat #${btn} is the button
Seat 1: aaaa0001 ($10 in chips)
Seat 2: aaaa0002 ($10 in chips)
Seat 3: aaaa0003 ($10 in chips)
Seat 4: Hero ($10 in chips)
Seat 5: aaaa0005 ($10 in chips)
Seat 6: aaaa0006 ($10 in chips)`;
const DEALT = `*** HOLE CARDS ***
Dealt to aaaa0001
Dealt to aaaa0002
Dealt to aaaa0003
Dealt to Hero [Ah Kd]
Dealt to aaaa0005
Dealt to aaaa0006 `;

const CASES = [
  {
    name: 'A: UTG opens, BTN 3-bets, UTG folds',
    text: `Poker Hand #HD100000001: Hold'em No Limit ($0.05/$0.1) - 2026/11/20 21:00:00
${SEATS6(6)}
aaaa0001: posts small blind $0.05
aaaa0002: posts big blind $0.1
${DEALT}
aaaa0003: raises $0.15 to $0.25
Hero: folds
aaaa0005: folds
aaaa0006: raises $0.55 to $0.8
aaaa0001: folds
aaaa0002: folds
aaaa0003: folds
Uncalled bet ($0.55) returned to aaaa0006
*** SHOWDOWN ***
aaaa0006 collected $0.65 from pot
*** SUMMARY ***
Total pot $0.65 | Rake $0 | Jackpot $0 | Bingo $0 | Fortune $0 | Tax $0
Seat 6: aaaa0006 (button) won ($0.65)`,
    expect: {
      aaaa0003: { hands: 1, vpip: 1, pfr: 1, rfiOpp: 1, rfi: 1, stealOpp: 0, f3Opp: 1, f3: 1, netBB: -2.5, h_EP: 1 },
      Hero: { rfiOpp: 0, tbOpp: 1, ccOpp: 1, cc: 0, vpip: 0, h_MP: 1 },
      aaaa0005: { tbOpp: 1, ccOpp: 1 },
      aaaa0006: { tbOpp: 1, tb: 1, vpip: 1, pfr: 1, netBB: 4 },
      aaaa0001: { tbOpp: 0, netBB: -0.5 },
      aaaa0002: { tbOpp: 0, netBB: -1 }
    }
  },
  {
    name: 'B: BTN steals, both blinds fold',
    text: `Poker Hand #HD100000002: Hold'em No Limit ($0.05/$0.1) - 2026/11/20 21:01:00
${SEATS6(1)}
aaaa0002: posts small blind $0.05
aaaa0003: posts big blind $0.1
${DEALT}
Hero: folds
aaaa0005: folds
aaaa0006: folds
aaaa0001: raises $0.15 to $0.25
aaaa0002: folds
aaaa0003: folds
Uncalled bet ($0.15) returned to aaaa0001
*** SHOWDOWN ***
aaaa0001 collected $0.25 from pot
*** SUMMARY ***
Total pot $0.25 | Rake $0`,
    expect: {
      aaaa0001: { rfiOpp: 1, rfi: 1, stealOpp: 1, steal: 1, netBB: 1.5, h_BTN: 1, p_BTN: 1 },
      aaaa0006: { rfiOpp: 1, stealOpp: 1, steal: 0 },
      Hero: { rfiOpp: 1, stealOpp: 0 },
      aaaa0002: { tbOpp: 1, fvsOpp: 1, fvs: 1, ccOpp: 1 },
      aaaa0003: { tbOpp: 1, fvsOpp: 1, fvs: 1, ccOpp: 0, netBB: -1 }
    }
  },
  {
    name: 'C: CO c-bets, BB check-raises, CO folds turn',
    text: `Poker Hand #HD100000003: Hold'em No Limit ($0.05/$0.1) - 2026/11/20 21:02:00
${SEATS6(2)}
aaaa0003: posts small blind $0.05
Hero: posts big blind $0.1
${DEALT}
aaaa0005: folds
aaaa0006: folds
aaaa0001: raises $0.15 to $0.25
aaaa0002: folds
aaaa0003: folds
Hero: calls $0.15
*** FLOP *** [Ks 7h 2d]
Hero: checks
aaaa0001: bets $0.3
Hero: raises $0.6 to $0.9
aaaa0001: calls $0.6
*** TURN *** [Ks 7h 2d] [9c]
Hero: bets $1.5
aaaa0001: folds
Uncalled bet ($1.5) returned to Hero
*** SHOWDOWN ***
Hero collected $2.25 from pot
*** SUMMARY ***
Total pot $2.35 | Rake $0.1`,
    expect: {
      aaaa0001: { steal: 1, stealOpp: 1, cbOpp: 1, cb: 1, sawFlop: 1, pBet: 1, pCall: 1, pFold: 1, cb2Opp: 0, netBB: -11.5, wtsd: 0 },
      Hero: { tbOpp: 1, fvsOpp: 1, fvs: 0, vpip: 1, sawFlop: 1, fcbOpp: 1, fcb: 0, rcb: 1, xrOpp: 1, xr: 1, pCheck: 1, pRaise: 1, pBet: 1, wwsf: 1, wtsd: 0, netBB: 11 },
      aaaa0003: { tbOpp: 1, fvsOpp: 1, fvs: 1, ccOpp: 1 }
    }
  },
  {
    name: 'D: UTG limps, SB completes, showdown on the river',
    text: `Poker Hand #HD100000004: Hold'em No Limit ($0.05/$0.1) - 2026/11/20 21:03:00
${SEATS6(3)}
Hero: posts small blind $0.05
aaaa0005: posts big blind $0.1
${DEALT}
aaaa0006: calls $0.1
aaaa0001: folds
aaaa0002: folds
aaaa0003: folds
Hero: calls $0.05
aaaa0005: checks
*** FLOP *** [Qh 8s 3c]
Hero: checks
aaaa0005: checks
aaaa0006: checks
*** TURN *** [Qh 8s 3c] [Jd]
Hero: checks
aaaa0005: bets $0.2
aaaa0006: calls $0.2
Hero: folds
*** RIVER *** [Qh 8s 3c Jd] [2s]
aaaa0005: checks
aaaa0006: checks
*** SHOWDOWN ***
aaaa0005: shows [Qd Tc] (a Pair)
aaaa0006: shows [8h 8d] (Three of a Kind)
aaaa0006 collected $0.68 from pot
*** SUMMARY ***
Total pot $0.7 | Rake $0.02 | Jackpot $0 | Bingo $0 | Fortune $0 | Tax $0
Board [Qh 8s 3c Jd 2s]
Seat 5: aaaa0005 (big blind) showed [Qd Tc] and lost with a Pair
Seat 6: aaaa0006 showed [8h 8d] and won ($0.68) with Three of a Kind`,
    expect: {
      aaaa0006: { rfiOpp: 1, rfi: 0, limp: 1, vpip: 1, sawFlop: 1, wtsd: 1, wsd: 1, wwsf: 1, pCheck: 2, pCall: 1, netBB: 3.8 },
      aaaa0005: { vpip: 0, sawFlop: 1, wtsd: 1, wsd: 0, pBet: 1, pCheck: 2, netBB: -3 },
      Hero: { rfiOpp: 0, limp: 1, vpip: 1, sawFlop: 1, pCheck: 2, pFold: 1, wtsd: 0, netBB: -1 },
      aaaa0001: { rfiOpp: 0 }
    },
    shown: { aaaa0006: ['8h 8d', 'UTG', 'limp', 'Qh 8s 3c Jd 2s', 1, 3.8] }
  },
  {
    name: 'E: 4-bet jam, called, run it twice',
    text: `Poker Hand #HD100000005: Hold'em No Limit ($0.05/$0.1) - 2026/11/20 21:05:00
${SEATS6(4)}
aaaa0005: posts small blind $0.05
aaaa0006: posts big blind $0.1
${DEALT}
aaaa0001: raises $0.15 to $0.25
aaaa0002: raises $0.6 to $0.85
aaaa0003: folds
Hero: folds
aaaa0005: folds
aaaa0006: folds
aaaa0001: raises $9.15 to $10 and is all-in
aaaa0002: calls $9.15 and is all-in
*** FIRST FLOP *** [2c 5d 9h]
*** FIRST TURN *** [2c 5d 9h] [Tc]
*** FIRST RIVER *** [2c 5d 9h Tc] [Kd]
*** SECOND FLOP *** [3s 4s Js]
*** SECOND TURN *** [3s 4s Js] [6h]
*** SECOND RIVER *** [3s 4s Js 6h] [7c]
*** FIRST SHOWDOWN ***
aaaa0001: shows [Ac Ad]
aaaa0002: shows [Kh Ks]
aaaa0002 collected $9.92 from pot
*** SECOND SHOWDOWN ***
aaaa0001: shows [Ac Ad]
aaaa0002: shows [Kh Ks]
aaaa0001 collected $9.93 from pot
*** SUMMARY ***
Total pot $20.15 | Rake $0.3`,
    expect: {
      aaaa0001: { rfi: 1, pfr: 1, f3Opp: 1, f3: 0, fb: 1, sawFlop: 1, wtsd: 1, wsd: 1, wwsf: 1, netBB: -0.7 },
      aaaa0002: { tbOpp: 1, tb: 1, ccOpp: 1, cc: 0, sawFlop: 1, wtsd: 1, netBB: -0.8 },
      aaaa0005: { sawFlop: 0 }
    },
    shown: { aaaa0001: ['Ac Ad', 'UTG', 'open · 4-bet', '2c 5d 9h Tc Kd', 1, -0.7] }
  },
  {
    name: 'F: tournament hand is skipped',
    text: `Poker Hand #TM5000001: Tournament #12345, Bounty Hunters $5.25 Hold'em No Limit - Level3(25/50(6)) - 2026/11/20 21:06:00
${SEATS6(1)}
aaaa0002: posts small blind 25
aaaa0003: posts big blind 50`,
    skipped: 'tournament'
  },
  {
    name: 'G: PokerStars format, names with spaces, iso-raise pot',
    text: `PokerStars Hand #250000000001:  Hold'em No Limit ($0.05/$0.10 USD) - 2026/11/20 21:07:00 CET [2026/11/20 15:07:00 ET]
Table 'Aludra V' 6-max Seat #1 is the button
Seat 1: Big Fish 77 ($10.00 in chips)
Seat 2: the rock ($12.50 in chips)
Seat 3: Hero ($10.00 in chips)
the rock: posts small blind $0.05
Hero: posts big blind $0.10
*** HOLE CARDS ***
Dealt to Hero [7c 7d]
Big Fish 77: calls $0.10
the rock: calls $0.05
Hero: raises $0.40 to $0.50
Big Fish 77: calls $0.40
the rock: folds
*** FLOP *** [Ah 7s 2c]
Hero: bets $0.60
Big Fish 77: calls $0.60
*** TURN *** [Ah 7s 2c] [3d]
Hero: bets $1.50
Big Fish 77: calls $1.50
*** RIVER *** [Ah 7s 2c 3d] [Kc]
Hero: bets $3
Big Fish 77: folds
Uncalled bet ($3) returned to Hero
Hero collected $5.20 from pot
Hero: doesn't show hand
*** SUMMARY ***
Total pot $5.30 | Rake $0.10`,
    expect: {
      'Big Fish 77': { rfiOpp: 1, stealOpp: 1, steal: 0, limp: 1, vpip: 1, tbOpp: 1, ccOpp: 0, sawFlop: 1, fcbOpp: 1, fcb: 0, fcb2Opp: 1, fcb2: 0, pCall: 2, pFold: 1, netBB: -26 },
      'the rock': { limp: 1, vpip: 1, tbOpp: 1, netBB: -1 },
      Hero: { rfi: 0, pfr: 1, vpip: 1, cbOpp: 1, cb: 1, cb2Opp: 1, cb2: 1, pBet: 3, wwsf: 1, netBB: 26 }
    }
  }
];

let failures = 0;
function check(label, got, want) {
  const ok = typeof want === 'number' ? Math.abs(got - want) < 1e-6 : got === want;
  if (!ok) { failures++; console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

for (const tc of CASES) {
  console.log(tc.name);
  const agg = VF.analyze([tc.text]);
  if (tc.skipped) {
    check('skipped.' + tc.skipped, agg.skipped[tc.skipped], 1);
    check('hands', agg.hands, 0);
    continue;
  }
  check('hands parsed', agg.hands, 1);
  for (const [player, want] of Object.entries(tc.expect)) {
    const got = agg.players[player];
    if (!got) { failures++; console.log(`  FAIL missing player ${player}`); continue; }
    for (const [k, v] of Object.entries(want)) {
      check(`${player}.${k}`, k === 'netBB' ? Math.round(got[k] * 100) / 100 : got[k], v);
    }
  }
  for (const [player, want] of Object.entries(tc.shown || {})) {
    const got = (agg.shown[player] || [])[0] || [];
    want.forEach((v, i) => check(`${player}.shown[${i}]`, got[i], v));
  }
  // Every hand's net results should add up to minus the rake.
  const net = Object.values(agg.players).reduce((s, c) => s + c.netBB, 0);
  console.log(`  ok (sum of net = ${net.toFixed(2)} bb)`);
}

// Round trip through database documents.
{
  const agg = VF.analyze(CASES.map(c => c.text));
  const docs = VF.buildDocs(agg, { label: 'test', group: 'gtest' });
  const back = VF.aggregateDocs(docs.map(d => Object.assign({ _id: d.id }, d.data)));
  check('round trip hands', back.totalHands, agg.hands);
  check('round trip players', Object.keys(back.players).length, Object.keys(agg.players).length);
  for (const n of Object.keys(agg.players)) {
    const a = VF.toArr(agg.players[n]).join(',');
    const b = VF.toArr(back.players[n].c).join(',');
    check('round trip counters ' + n, b, a);
  }
  // Re-importing the same text finds only duplicates.
  const again = VF.analyze(CASES.map(c => c.text), back.knownIds);
  check('dedupe hands', again.hands, 0);
  check('dedupe dup count', again.dup, agg.hands);
  console.log('Round trip and dedupe checked');
}

// Full generated session.
const samplePath = process.argv[2];
if (samplePath && fs.existsSync(samplePath)) {
  const styles = {};
  const stylesPath = process.argv[3];
  if (stylesPath && fs.existsSync(stylesPath)) {
    fs.readFileSync(stylesPath, 'utf8').trim().split(/\r?\n/).forEach(l => {
      const [id, arch] = l.trim().split(/\s+/);
      styles[id] = arch;
    });
  }
  const text = fs.readFileSync(samplePath, 'utf8');
  const t0 = Date.now();
  const agg = VF.analyze([text]);
  const ms = Date.now() - t0;
  console.log(`\nSample: ${agg.found} found, ${agg.hands} parsed, ${agg.errors} errors, skipped ${JSON.stringify(agg.skipped)}, ${ms} ms`);
  if (agg.errors) failures++;
  const net = Object.values(agg.players).reduce((s, c) => s + c.netBB, 0);
  console.log(`Total net across players: ${net.toFixed(1)} bb (should be minus the total rake)`);
  const rows = Object.entries(agg.players).map(([n, c]) => {
    const d = VF.derive(c);
    const type = VF.classify(d);
    const f = k => d[k].v == null ? '  -' : String(Math.round(d[k].v)).padStart(3);
    return `${n.padEnd(9)} ${String(styles[n] || (n === 'Hero' ? 'hero' : '?')).padEnd(8)} -> ${type.padEnd(8)} ` +
      `hands ${String(c.hands).padStart(4)}  VPIP ${f('vpip')} PFR ${f('pfr')} 3B ${f('tb')} F3B ${f('f3')} ` +
      `ST ${f('steal')} FvST ${f('fvs')} LMP ${f('limp')} CB ${f('cb')} FCB ${f('fcb')} WTSD ${f('wtsd')} ` +
      `AF ${d.af.v == null ? '-' : d.af.v.toFixed(1)} bb/100 ${d.bb100.v.toFixed(1)}  target ${VF.targetScore(d)}`;
  });
  rows.forEach(r => console.log(r));
  const docs = VF.buildDocs(agg, { label: 'Sample session' });
  console.log(`Docs: ${docs.length}, sizes ${docs.map(d => JSON.stringify(d.data).length).join(', ')} bytes`);
}

console.log(failures ? `\n${failures} FAILURES` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
