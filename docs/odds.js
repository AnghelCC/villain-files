/*
 * Villain Files odds engine.
 * Hand evaluation, Monte Carlo equity against ranges, pot odds and expected value.
 * Runs in the browser (window.ODDS) and in Node (module.exports) for testing.
 *
 * Cards are integers 0..51: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3 (s, h, d, c).
 */
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const B5 = 371293; // 13^5, the size of one hand category in the score
  const CATS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

  function card(str) {
    const r = RANKS.indexOf(String(str)[0].toUpperCase());
    const s = SUITS.indexOf(String(str)[1].toLowerCase());
    if (r < 0 || s < 0) return -1;
    return r * 4 + s;
  }
  function cardStr(c) { return RANKS[c >> 2] + SUITS[c & 3]; }
  function parseCards(str) {
    return String(str || '').trim().split(/[\s,]+/).filter(Boolean).map(card).filter(c => c >= 0);
  }

  // ---------------------------------------------------------------------------
  // Evaluator: best five-card hand from 5 to 7 cards, as one comparable integer.
  // ---------------------------------------------------------------------------
  const RC = new Int8Array(13);
  const SM = new Int32Array(4);
  const SC = new Int8Array(4);

  function straightHigh(m) {
    for (let hi = 12; hi >= 4; hi--) {
      const need = 0x1F << (hi - 4);
      if ((m & need) === need) return hi;
    }
    if ((m & 0x100F) === 0x100F) return 3; // A-2-3-4-5
    return -1;
  }
  function topBits(m, k) {
    let v = 0, n = 0;
    for (let r = 12; r >= 0 && n < k; r--) if (m & (1 << r)) { v = v * 13 + r; n++; }
    while (n < k) { v *= 13; n++; }
    return v;
  }

  function score(cards, len) {
    if (len == null) len = cards.length;
    RC.fill(0);
    SM[0] = SM[1] = SM[2] = SM[3] = 0;
    SC[0] = SC[1] = SC[2] = SC[3] = 0;
    let rmask = 0;
    for (let i = 0; i < len; i++) {
      const c = cards[i], r = c >> 2, s = c & 3;
      RC[r]++; SM[s] |= 1 << r; SC[s]++; rmask |= 1 << r;
    }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (SC[s] >= 5) fs = s;
    if (fs >= 0) {
      const sf = straightHigh(SM[fs]);
      if (sf >= 0) return 8 * B5 + sf;
    }
    let q = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
    for (let r = 12; r >= 0; r--) {
      const n = RC[r];
      if (n === 4) q = r;
      else if (n === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
      else if (n === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
    }
    if (q >= 0) return 7 * B5 + q * 13 + topBits(rmask & ~(1 << q), 1);
    if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return 6 * B5 + t1 * 13 + Math.max(t2, p1);
    if (fs >= 0) return 5 * B5 + topBits(SM[fs], 5);
    const st = straightHigh(rmask);
    if (st >= 0) return 4 * B5 + st;
    if (t1 >= 0) return 3 * B5 + t1 * 169 + topBits(rmask & ~(1 << t1), 2);
    if (p1 >= 0 && p2 >= 0) return 2 * B5 + p1 * 169 + p2 * 13 + topBits(rmask & ~(1 << p1) & ~(1 << p2), 1);
    if (p1 >= 0) return 1 * B5 + p1 * 2197 + topBits(rmask & ~(1 << p1), 3);
    return topBits(rmask, 5);
  }
  function category(sc) { return Math.floor(sc / B5); }

  // ---------------------------------------------------------------------------
  // Preflop ranges. The 169 starting hands ordered by all-in equity against one
  // random hand (computed with 40,000 trials per hand; see tools/rank_hands.js).
  // ---------------------------------------------------------------------------
  const ORDER = 'AA KK QQ JJ TT 99 88 AKs 77 AQs AJs AKo ATs AQo 66 KQs AJo A9s KJs ATo KTs A8s A7s KQo 55 A9o KJo QJs K9s KTo A5s A8o QTs A6s A4s A7o A3s A6o K8s QJo Q9s A5o K9o A2s JTs K7s QTo K6s A4o 44 Q8s A3o K8o K5s J9s Q9o K7o JTo A2o K4s K6o Q7s J8s Q6s 33 T9s K3s K2s K5o Q8o J9o Q5s J7s K4o T8s Q7o K3o T9o Q4s J8o Q6o Q3s J6s K2o 22 T7s 98s Q2s Q5o J5s J4s T8o J7o Q4o 97s Q3o T6s 98o J3s 87s J6o T7o J5o T5s Q2o J2s 96s T4s J4o 97o 95s 86s T6o T3s 87o 76s J3o T2s 96o J2o 85s 75s T5o 94s T4o 93s 65s 86o 76o 95o T3o 84s 92s T2o 54s 64s 74s 85o 83s 94o 75o 93o 82s 73s 65o 53s 63s 84o 43s 92o 64o 74o 72s 54o 62s 52s 83o 82o 42s 53o 73o 63o 32s 43o 52o 72o 62o 42o 32o'.split(' ');

  function classCombos(cls) {
    const r1 = RANKS.indexOf(cls[0]), r2 = RANKS.indexOf(cls[1]);
    const out = [];
    if (cls.length === 2) {
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) out.push([r1 * 4 + a, r1 * 4 + b]);
    } else if (cls[2] === 's') {
      for (let s = 0; s < 4; s++) out.push([r1 * 4 + s, r2 * 4 + s]);
    } else {
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) out.push([r1 * 4 + a, r2 * 4 + b]);
    }
    return out;
  }
  function classOf(c1, c2) {
    let r1 = c1 >> 2, r2 = c2 >> 2;
    if (r1 < r2) { const t = r1; r1 = r2; r2 = t; }
    if (r1 === r2) return RANKS[r1] + RANKS[r2];
    return RANKS[r1] + RANKS[r2] + ((c1 & 3) === (c2 & 3) ? 's' : 'o');
  }
  const RANGE_CACHE = {};
  // Top `pct` percent of all 1,326 starting combos.
  function topRange(pct) {
    pct = Math.max(0.5, Math.min(100, Number(pct) || 100));
    const key = pct.toFixed(1);
    if (RANGE_CACHE[key]) return RANGE_CACHE[key];
    const target = pct / 100 * 1326;
    const combos = [], classes = [];
    for (const cls of ORDER) {
      if (combos.length >= target - 0.5) break;
      classes.push(cls);
      for (const c of classCombos(cls)) combos.push(c);
    }
    const r = { pct, combos, classes };
    RANGE_CACHE[key] = r;
    return r;
  }
  function percentile(c1, c2) {
    const cls = classOf(c1, c2);
    let seen = 0;
    for (const k of ORDER) {
      const n = k.length === 2 ? 6 : k[2] === 's' ? 4 : 12;
      if (k === cls) return (seen + n / 2) / 1326 * 100;
      seen += n;
    }
    return 100;
  }

  // ---------------------------------------------------------------------------
  // Equity: Monte Carlo with card removal.
  // opts: { hero: [c1, c2], board: [..0-5], ranges: [range, ...] (one per opponent),
  //         trials, rng }
  // ---------------------------------------------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRunner(opts) {
    const hero = opts.hero, board = opts.board || [], ranges = opts.ranges;
    const rng = opts.rng || Math.random;
    const nOpp = ranges.length;
    const used = new Uint8Array(52);
    const fixed = hero.concat(board);
    const all = new Int32Array(7);
    const opp = new Int32Array(nOpp * 2);
    const runout = new Int32Array(5);
    const res = { trials: 0, win: 0, tie: 0, eq: 0, skipped: 0, cats: new Float64Array(9) };
    const need = 5 - board.length;

    function one() {
      used.fill(0);
      for (const c of fixed) used[c] = 1;
      for (let i = 0; i < nOpp; i++) {
        const combos = ranges[i].combos;
        let ok = false;
        for (let tries = 0; tries < 60; tries++) {
          const cb = combos[(rng() * combos.length) | 0];
          if (!used[cb[0]] && !used[cb[1]]) {
            used[cb[0]] = used[cb[1]] = 1;
            opp[i * 2] = cb[0]; opp[i * 2 + 1] = cb[1];
            ok = true;
            break;
          }
        }
        if (!ok) { res.skipped++; return; }
      }
      for (let k = 0; k < need; k++) {
        let c;
        do { c = (rng() * 52) | 0; } while (used[c]);
        used[c] = 1;
        runout[k] = c;
      }
      for (let i = 0; i < board.length; i++) all[2 + i] = board[i];
      for (let k = 0; k < need; k++) all[2 + board.length + k] = runout[k];
      all[0] = hero[0]; all[1] = hero[1];
      const hs = score(all, 7);
      res.cats[category(hs)]++;
      let best = hs, nBest = 1, heroBest = true;
      for (let i = 0; i < nOpp; i++) {
        all[0] = opp[i * 2]; all[1] = opp[i * 2 + 1];
        const s = score(all, 7);
        if (s > best) { best = s; nBest = 1; heroBest = false; }
        else if (s === best) nBest++;
      }
      res.trials++;
      if (heroBest) {
        if (nBest === 1) { res.win++; res.eq += 1; }
        else { res.tie++; res.eq += 1 / nBest; }
      }
    }
    return {
      run(n) { for (let i = 0; i < n; i++) one(); return res; },
      result() {
        const t = res.trials || 1;
        const cats = Array.from(res.cats, v => v / t);
        return { trials: res.trials, equity: res.eq / t, win: res.win / t, tie: res.tie / t, skipped: res.skipped, cats,
          stderr: Math.sqrt((res.eq / t) * (1 - res.eq / t) / t) };
      }
    };
  }

  function equity(opts) {
    const r = makeRunner(opts);
    r.run(opts.trials || 20000);
    return r.result();
  }

  // Same, in slices so the page stays responsive.
  function equityAsync(opts, onProgress) {
    const total = opts.trials || 20000;
    const slice = 2500;
    const r = makeRunner(opts);
    let done = 0, cancelled = false;
    const p = new Promise(resolve => {
      function step() {
        if (cancelled) return resolve(null);
        const n = Math.min(slice, total - done);
        r.run(n);
        done += n;
        if (onProgress) onProgress(r.result(), done / total);
        if (done >= total) resolve(r.result());
        else setTimeout(step, 0);
      }
      step();
    });
    p.cancel = () => { cancelled = true; };
    return p;
  }

  // ---------------------------------------------------------------------------
  // Decision maths
  // ---------------------------------------------------------------------------
  // pot: chips in the middle including the bet you face; toCall: what you must add.
  function potOdds(pot, toCall) {
    if (!(toCall > 0)) return { needed: 0, ratio: null };
    return { needed: toCall / (pot + toCall), ratio: pot / toCall };
  }
  function evCall(eq, pot, toCall) { return eq * (pot + toCall) - toCall; }

  function verdict(eq, pot, toCall, nOpp) {
    if (toCall > 0) {
      const need = toCall / (pot + toCall);
      const ev = evCall(eq, pot, toCall);
      const edge = eq - need;
      if (edge >= 0.03) {
        const raise = eq >= (nOpp > 1 ? 0.5 : 0.62);
        return { key: raise ? 'raise' : 'call', label: raise ? 'Raise for value' : 'Call', ev, need, edge,
          why: raise
            ? `You are well ahead of the price. Raising builds a pot you win ${pctStr(eq)} of the time.`
            : `You need ${pctStr(need)} and have ${pctStr(eq)}, so calling wins about ${fmtBB(ev)} on average.` };
      }
      if (edge > -0.03) {
        return { key: 'close', label: 'Close spot', ev, need, edge,
          why: `Your equity (${pctStr(eq)}) is within 3 points of the ${pctStr(need)} you need. Position, stack depth and what you win on later streets decide it.` };
      }
      return { key: 'fold', label: 'Fold', ev, need, edge,
        why: `You need ${pctStr(need)} but have ${pctStr(eq)}. Calling loses about ${fmtBB(-ev)} on average unless you expect to win a lot more later.` };
    }
    const fair = 1 / (nOpp + 1);
    if (eq >= Math.max(0.55, fair + 0.2)) {
      return { key: 'bet', label: 'Bet for value', ev: null, need: 0, edge: eq - fair,
        why: `You win ${pctStr(eq)} against ${nOpp === 1 ? 'this range' : 'these ranges'}, well above an even share (${pctStr(fair)}). Bet to get paid by worse hands.` };
    }
    return { key: 'check', label: 'Check', ev: null, need: 0, edge: eq - fair,
      why: `With ${pctStr(eq)} equity against an even share of ${pctStr(fair)}, betting mostly gets called by better hands. Check unless you have a strong reason to bluff.` };
  }
  function pctStr(x) { return (Math.round(x * 1000) / 10).toFixed(1) + '%'; }
  function fmtBB(x) { return (Math.round(x * 10) / 10).toFixed(1) + ' bb'; }

  // Cards that improve your hand to a better category, using at least one of your hole cards.
  function outs(hero, board) {
    if (board.length < 3 || board.length > 4) return null;
    const used = new Set(hero.concat(board));
    const cur = category(score(hero.concat(board)));
    let n = 0;
    const list = [];
    for (let c = 0; c < 52; c++) {
      if (used.has(c)) continue;
      const withCard = category(score(hero.concat(board, [c])));
      const boardOnly = board.length + 1 >= 5 ? category(score(board.concat([c]))) : boardCat(board.concat([c]));
      if (withCard > cur && withCard > boardOnly) { n++; list.push(c); }
    }
    const unseen = 52 - used.size;
    const exact = board.length === 3
      ? 1 - ((unseen - n) / unseen) * ((unseen - 1 - n) / (unseen - 1))
      : n / unseen;
    return { n, cards: list, rule: board.length === 3 ? n * 4 : n * 2, exact, current: CATS[cur] };
  }
  function boardCat(cards) {
    const cnt = {};
    for (const c of cards) cnt[c >> 2] = (cnt[c >> 2] || 0) + 1;
    const v = Object.values(cnt).sort((a, b) => b - a);
    if (v[0] >= 4) return 7;
    if (v[0] === 3) return v[1] >= 2 ? 6 : 3;
    if (v[0] === 2) return v[1] === 2 ? 2 : 1;
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Narrowing a range after postflop aggression.
  // A bet keeps made hands (using a hole card), draws and about 30% of the rest as bluffs.
  // A raise keeps two pair or better, top pair or an overpair, strong draws and about 10% bluffs.
  // ---------------------------------------------------------------------------
  function handShape(hole, board) {
    const all = hole.concat(board);
    const cat = category(score(all));
    const bcat = board.length >= 5 ? category(score(board)) : boardCat(board);
    const made = cat > bcat ? cat : 0;
    let topPair = false;
    if (made === 1) {
      const hr = [hole[0] >> 2, hole[1] >> 2];
      const br = board.map(c => c >> 2);
      const top = Math.max.apply(null, br);
      const p = hr[0] === hr[1] ? hr[0] : (br.indexOf(hr[0]) >= 0 ? hr[0] : hr[1]);
      topPair = p >= top;
    }
    let flushDraw = false, straightOuts = 0;
    if (board.length < 5) {
      for (let s = 0; s < 4; s++) {
        const inHole = hole.filter(c => (c & 3) === s).length;
        const onBoard = board.filter(c => (c & 3) === s).length;
        if (inHole >= 1 && inHole + onBoard === 4) flushDraw = true;
      }
      let mask = 0, bmask = 0;
      for (const c of all) mask |= 1 << (c >> 2);
      for (const c of board) bmask |= 1 << (c >> 2);
      if (straightHigh(mask) < 0) {
        for (let r = 0; r < 13; r++) {
          if (mask & (1 << r)) continue;
          if (straightHigh(mask | (1 << r)) >= 0 && straightHigh(bmask | (1 << r)) < 0) straightOuts++;
        }
      }
    }
    return { made, topPair, flushDraw, straightOuts,
      strongDraw: flushDraw || straightOuts >= 2, draw: flushDraw || straightOuts >= 1 };
  }

  function narrowRange(range, board, kind) {
    if (!board || board.length < 3) return range;
    const onBoard = new Set(board);
    const keep = [];
    for (const cb of range.combos) {
      if (onBoard.has(cb[0]) || onBoard.has(cb[1])) continue;
      const k = handShape(cb, board);
      const h = (Math.imul(cb[0] * 53 + cb[1] + board.length * 7919, 2654435761) >>> 0) % 100;
      const ok = kind === 'raise'
        ? (k.made >= 2 || k.topPair || k.strongDraw || h < 10)
        : (k.made >= 1 || k.draw || h < 30);
      if (ok) keep.push(cb);
    }
    if (!keep.length) return range;
    return { pct: range.pct, combos: keep, classes: range.classes, narrowed: (range.narrowed || []).concat([kind]) };
  }

  // ---------------------------------------------------------------------------
  // Probabilities for your own hand. A hand counts as "made with your cards"
  // only if your hole cards make it better than the board alone.
  // ---------------------------------------------------------------------------
  function madeCat(hero, board) {
    const s = score(hero.concat(board));
    const cat = category(s);
    if (board.length >= 5) return s > score(board) ? cat : 0;
    return cat > boardCat(board) ? cat : 0;
  }

  function startingInfo(c1, c2) {
    const cls = classOf(c1, c2);
    const size = k => (k.length === 2 ? 6 : k[2] === 's' ? 4 : 12);
    let atLeast = 0;
    for (const k of ORDER) { atLeast += size(k); if (k === cls) break; }
    return { cls, combos: size(cls), dealt: size(cls) / 1326, rank: ORDER.indexOf(cls) + 1, atLeast: atLeast / 1326,
      kind: cls.length === 2 ? 'pocket pair' : cls[2] === 's' ? 'suited' : 'offsuit' };
  }

  function deckWithout(cards) {
    const used = new Set(cards);
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    return deck;
  }

  // Every possible flop (19,600 of them): made-hand categories and draws.
  function flopOdds(hero) {
    const deck = deckWithout(hero);
    const cats = new Float64Array(9);
    let fd = 0, oe = 0, gs = 0, n = 0;
    const b = [0, 0, 0];
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        for (let k = j + 1; k < deck.length; k++) {
          b[0] = deck[i]; b[1] = deck[j]; b[2] = deck[k];
          cats[madeCat(hero, b)]++;
          const sh = handShape(hero, b);
          if (sh.flushDraw) fd++;
          if (sh.straightOuts >= 2) oe++; else if (sh.straightOuts === 1) gs++;
          n++;
        }
      }
    }
    return { n, cats: Array.from(cats, v => v / n), flushDraw: fd / n, straightDraw: oe / n, gutshot: gs / n };
  }

  // Made-hand categories by the river from the current board.
  // Exact when two or fewer cards are to come, simulated otherwise.
  function riverOdds(hero, board, trials) {
    const deck = deckWithout(hero.concat(board));
    const need = 5 - board.length;
    const cats = new Float64Array(9);
    let n = 0;
    if (need <= 2) {
      if (need === 0) { cats[madeCat(hero, board)]++; n = 1; }
      else if (need === 1) { for (const c of deck) { cats[madeCat(hero, board.concat([c]))]++; n++; } }
      else {
        for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) {
          cats[madeCat(hero, board.concat([deck[i], deck[j]]))]++; n++;
        }
      }
      return { exact: true, n, cats: Array.from(cats, v => v / n) };
    }
    const rng = mulberry32(hero[0] * 131 + hero[1] * 7 + board.length);
    trials = trials || 60000;
    const pick = new Int32Array(need);
    for (let t = 0; t < trials; t++) {
      for (let k = 0; k < need; k++) {
        let c, dup;
        do {
          c = deck[(rng() * deck.length) | 0];
          dup = false;
          for (let m = 0; m < k; m++) if (pick[m] === c) { dup = true; break; }
        } while (dup);
        pick[k] = c;
      }
      cats[madeCat(hero, board.concat(Array.from(pick)))]++;
      n++;
    }
    return { exact: false, n, cats: Array.from(cats, v => v / n) };
  }

  // The next card: what it gives you, and how often it improves your hand.
  function nextCardOdds(hero, board) {
    if (board.length < 3 || board.length > 4) return null;
    const deck = deckWithout(hero.concat(board));
    const now = madeCat(hero, board);
    const cats = new Float64Array(9);
    let improve = 0;
    for (const c of deck) {
      const m = madeCat(hero, board.concat([c]));
      cats[m]++;
      if (m > now) improve++;
    }
    return { now, cards: deck.length, improveCount: improve, improve: improve / deck.length, cats: Array.from(cats, v => v / deck.length) };
  }

  // Against a range, right now: how many of their hands you beat, tie and lose to.
  function aheadNow(hero, board, range) {
    if (board.length < 3) return null;
    const used = new Set(hero.concat(board));
    const hs = score(hero.concat(board));
    let a = 0, t = 0, b = 0;
    for (const cb of range.combos) {
      if (used.has(cb[0]) || used.has(cb[1])) continue;
      const s = score([cb[0], cb[1]].concat(board));
      if (hs > s) a++; else if (hs === s) t++; else b++;
    }
    const n = a + t + b;
    return n ? { ahead: a / n, tie: t / n, behind: b / n, n } : null;
  }

  // Plain-English description of what you hold.
  function describeHand(hero, board) {
    if (board.length < 3) {
      const info = startingInfo(hero[0], hero[1]);
      return `${info.cls}, ${info.kind}`;
    }
    const m = madeCat(hero, board);
    const sh = handShape(hero, board);
    const hr = hero.map(c => c >> 2);
    const br = Array.from(new Set(board.map(c => c >> 2))).sort((x, y) => y - x);
    const top = br[0];
    let made;
    if (m === 0) {
      const over = hr.filter(r => r > top).length;
      made = over === 2 ? 'Two overcards' : over === 1 ? 'One overcard' : 'No pair of your own';
    } else if (m === 1) {
      if (hr[0] === hr[1]) made = hr[0] > top ? 'Overpair' : 'Pocket pair under the top card';
      else {
        const p = br.indexOf(hr[0]) >= 0 ? hr[0] : hr[1];
        made = p === top ? 'Top pair' : p === br[1] ? 'Middle pair' : 'Bottom pair';
      }
    } else if (m === 3) made = hr[0] === hr[1] ? 'Set' : 'Trips';
    else made = CATS[m];
    const draws = [];
    if (board.length < 5) {
      if (sh.flushDraw) draws.push('flush draw');
      if (sh.straightOuts >= 2) draws.push('open-ended straight draw');
      else if (sh.straightOuts === 1) draws.push('gutshot straight draw');
    }
    return made + (draws.length ? ' + ' + draws.join(' + ') : '');
  }

  const ODDS = {
    RANKS, SUITS, CATS, ORDER, card, cardStr, parseCards, score, category, classOf, classCombos,
    topRange, percentile, mulberry32, equity, equityAsync, potOdds, evCall, verdict, outs, pctStr,
    handShape, narrowRange, madeCat, startingInfo, flopOdds, riverOdds, nextCardOdds, aheadNow, describeHand
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ODDS;
  else root.ODDS = ODDS;
})(typeof window !== 'undefined' ? window : this);
