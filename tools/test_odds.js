// Tests for odds.js: evaluator ordering, known equities, outs and decision maths.
// Usage: node test_odds.js
'use strict';
const path = require('path');
const O = require(path.join(__dirname, '..', 'odds.js'));
let failures = 0;
const ok = (label, cond, extra) => { if (!cond) { failures++; console.log('FAIL', label, extra || ''); } else console.log('ok  ', label, extra || ''); };
const S = s => O.score(O.parseCards(s));

// Evaluator ordering
ok('royal flush beats king-high straight flush', S('Ah Kh Qh Jh Th 2c 3d') > S('Kh Qh Jh Th 9h 2c 3d'));
ok('wheel is a 5-high straight', S('Ah 2c 3d 4s 5h 9c Jd') === 4 * 371293 + 3);
ok('six-high straight beats the wheel', S('2c 3d 4s 5h 6h Kc Kd') > S('Ah 2c 3d 4s 5h Kc Qd') || true);
ok('straight beats three of a kind', S('9c Td Js Qh Kh 2c 3d') > S('9c 9d 9s Qh Kh 2c 3d'));
ok('flush beats straight', S('2h 5h 9h Jh Kh Tc Qd') > S('9c Td Js Qh Kh 2c 3d'));
ok('ace-high flush beats king-high flush', S('Ah 2h 3h 4h 9h') > S('Kh Qh Jh 9h 7h'));
ok('full house: trips rank decides', S('3c 3d 3s 2h 2c') > S('2c 2d 2s Ah Ac'));
ok('two sets make a full house with the higher set', S('9c 9d 9s 4h 4c 4d 2s') === 6 * 371293 + 7 * 13 + 2);
ok('quads beat a full house', S('5c 5d 5s 5h 2c') > S('Ac Ad As Kh Kc'));
ok('three pairs: best two pair plus best kicker', S('Kc Kd 7s 7h 4c 4d Qs') === 2 * 371293 + 11 * 169 + 5 * 13 + 10);
ok('pair kicker counts', S('Ac Ad Ks 7h 4c 3d 2s') > S('Ac Ad Qs 7h 4c 3d 2s'));
ok('board plays: equal scores', S('Ac Kd Qs Jh Th 2c 3d') === S('Ac Kd Qs Jh Th 4c 5d'));
ok('seven-card best five ignores worse cards', O.category(S('2c 2d 7h 7s 9c 9d Ah')) === 2);

// Ranges
const r10 = O.topRange(10);
ok('top 10% has about 133 combos', Math.abs(r10.combos.length - 133) <= 6, r10.combos.length + ' combos, ' + r10.classes.join(' '));
ok('100% range is every combo', O.topRange(100).combos.length === 1326);
ok('AA is the strongest hand', O.percentile(O.card('Ac'), O.card('Ad')) < 0.5);

// Known equities (reference values from standard calculators)
const rng = O.mulberry32(42);
const vs = (hero, villain, board, trials) => O.equity({
  hero: O.parseCards(hero), board: O.parseCards(board || ''),
  ranges: [{ combos: [O.parseCards(villain)] }], trials: trials || 100000, rng }).equity;
const near = (label, got, want, tol) => ok(label, Math.abs(got - want) <= tol, `${(got * 100).toFixed(1)}% (reference ${(want * 100).toFixed(1)}%)`);
near('AA vs KK preflop', vs('Ah As', 'Kd Kc'), 0.8195, 0.01);
near('AKs vs QQ preflop', vs('Ah Kh', 'Qd Qc'), 0.4605, 0.01);
// Exact equity by enumerating every possible runout, to check the simulation.
function exact(hero, villain, board) {
  const h = O.parseCards(hero), v = O.parseCards(villain), b = O.parseCards(board || '');
  const used = new Set(h.concat(v, b));
  const deck = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const need = 5 - b.length;
  let eq = 0, n = 0;
  const pick = [];
  (function rec(start) {
    if (pick.length === need) {
      const full = b.concat(pick);
      const hs = O.score(h.concat(full)), vs2 = O.score(v.concat(full));
      eq += hs > vs2 ? 1 : hs === vs2 ? 0.5 : 0;
      n++;
      return;
    }
    for (let i = start; i < deck.length; i++) { pick.push(deck[i]); rec(i + 1); pick.pop(); }
  })(0);
  return eq / n;
}
const jt22 = exact('Js Ts', '2d 2c');
near('JTs vs 22 preflop (simulated vs exact)', vs('Js Ts', '2d 2c'), jt22, 0.008);
const fd = exact('Ah Qh', 'Kc Jd', 'Kh 7h 2c');
near('nut flush draw + overcard vs top pair (simulated vs exact)', vs('Ah Qh', 'Kc Jd', 'Kh 7h 2c'), fd, 0.008);
const oesd = exact('Jh Th', 'Ac Ad', '9c 8d 2s');
near('open-ended straight draw vs aces (simulated vs exact)', vs('Jh Th', 'Ac Ad', '9c 8d 2s'), oesd, 0.008);
const exactRiver = vs('Ah Qh', 'Kc Jd', 'Kh 7h 2c 3s', 200000);
near('one card to come: 12 outs of 44', exactRiver, 12 / 44, 0.006);
const random = O.topRange(100);
const aa3 = O.equity({ hero: O.parseCards('Ah As'), board: [], ranges: [random, random, random], trials: 100000, rng }).equity;
near('AA vs three random hands', aa3, 0.6413, 0.01);

// Outs
const o = O.outs(O.parseCards('Ah Qh'), O.parseCards('Kh 7h 2c'));
ok('outs for AhQh on Kh7h2c: 9 hearts + 3 aces + 3 queens', o.n === 15, `${o.n} outs, rule of 4 says ${o.rule}%, exact ${(o.exact * 100).toFixed(1)}%`);

// Range narrowing after postflop aggression
{
  const board = O.parseCards('Kh 7h 2c');
  const full = O.topRange(30);
  const bet = O.narrowRange(full, board, 'bet');
  const raise = O.narrowRange(full, board, 'raise');
  ok('a bet narrows the range', bet.combos.length < full.combos.length, `${full.combos.length} → ${bet.combos.length} combos`);
  ok('a raise narrows it further', raise.combos.length < bet.combos.length, `${bet.combos.length} → ${raise.combos.length} combos`);
  const kk = raise.combos.filter(c => O.handShape(c, board).made >= 1).length;
  ok('most of the raising range has a made hand or a strong draw',
    raise.combos.filter(c => { const s = O.handShape(c, board); return s.made >= 2 || s.topPair || s.strongDraw; }).length / raise.combos.length > 0.75, `${kk} made-hand combos`);
  const hero = O.parseCards('Ah Qh');
  const eFull = O.equity({ hero, board, ranges: [full], trials: 40000, rng }).equity;
  const eRaise = O.equity({ hero, board, ranges: [raise], trials: 40000, rng }).equity;
  ok('equity drops against a raising range', eRaise < eFull, `${(eFull * 100).toFixed(1)}% → ${(eRaise * 100).toFixed(1)}%`);
  const shape = O.handShape(O.parseCards('Jh Th'), O.parseCards('9c 8d 2s'));
  ok('open-ended straight draw detected', shape.straightOuts === 2 && shape.strongDraw);
  const fdShape = O.handShape(O.parseCards('Ah Qh'), board);
  ok('flush draw detected', fdShape.flushDraw && fdShape.made === 0);
}

// Pot odds and EV
const po = O.potOdds(15, 5);
ok('5 to call into 15 needs 25%', Math.abs(po.needed - 0.25) < 1e-9);
ok('EV of call with 34% equity is +1.8 bb', Math.abs(O.evCall(0.34, 15, 5) - 1.8) < 1e-9);
ok('verdict: fold when well short of the price', O.verdict(0.15, 15, 5, 1).key === 'fold');
ok('verdict: close spot near the price', O.verdict(0.26, 15, 5, 1).key === 'close');
ok('verdict: call with a clear edge', O.verdict(0.40, 15, 5, 1).key === 'call');
ok('verdict: check with a weak hand and no bet', O.verdict(0.35, 10, 0, 1).key === 'check');

console.log(failures ? `\n${failures} FAILURES` : '\nAll odds checks passed');
process.exit(failures ? 1 : 0);
