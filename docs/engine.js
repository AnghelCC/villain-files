/*
 * Villain Files engine.
 * Parses No-Limit Hold'em cash hand histories (GGPoker / PlayGG via PokerCraft,
 * and PokerStars-style text), turns every hand into per-player stat counters,
 * and derives stats, player types and exploit advice from those counters.
 * Runs in the browser (window.VF) and in Node (module.exports) for testing.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Counter layout. Stored in the database as plain arrays in this order.
  // APPEND ONLY: older saved arrays are shorter and read missing keys as 0.
  // ---------------------------------------------------------------------------
  const KEYS = [
    'hands', 'vpip', 'pfr', 'limp',
    'rfiOpp', 'rfi', 'stealOpp', 'steal', 'fvsOpp', 'fvs',
    'tbOpp', 'tb', 'ccOpp', 'cc',
    'f3Opp', 'f3', 'fb',
    'sawFlop',
    'cbOpp', 'cb', 'fcbOpp', 'fcb', 'rcb',
    'cb2Opp', 'cb2', 'fcb2Opp', 'fcb2',
    'xrOpp', 'xr',
    'pBet', 'pRaise', 'pCall', 'pCheck', 'pFold',
    'wtsd', 'wsd', 'wwsf',
    'netBB',
    'h_EP', 'v_EP', 'p_EP', 'h_MP', 'v_MP', 'p_MP', 'h_CO', 'v_CO', 'p_CO',
    'h_BTN', 'v_BTN', 'p_BTN', 'h_SB', 'v_SB', 'p_SB', 'h_BB', 'v_BB', 'p_BB'
  ];
  const POS_GROUPS = ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB'];
  const GROUP_OF = {
    'UTG': 'EP', 'UTG+1': 'EP', 'UTG+2': 'EP', 'LJ': 'MP', 'HJ': 'MP',
    'CO': 'CO', 'BTN': 'BTN', 'SB': 'SB', 'BB': 'BB'
  };
  const STEAL_POS = { CO: 1, BTN: 1, SB: 1 };

  function blank() {
    const c = {};
    for (const k of KEYS) c[k] = 0;
    return c;
  }
  function addInto(target, src) {
    for (const k of KEYS) target[k] += src[k] || 0;
    return target;
  }
  function toArr(c) {
    return KEYS.map(k => (k === 'netBB' ? Math.round((c[k] || 0) * 100) / 100 : (c[k] || 0)));
  }
  function fromArr(a) {
    const c = blank();
    if (!Array.isArray(a)) return c;
    KEYS.forEach((k, i) => { const v = Number(a[i]); c[k] = isFinite(v) ? v : 0; });
    return c;
  }

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------
  const AMT = '\\D{0,5}?(\\d[\\d.,]*)';

  function num(s) {
    if (s == null) return 0;
    s = String(s).replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/,/g, '');
    else if (s.indexOf(',') >= 0) {
      if (/,\d{3}$/.test(s) && !/^0,/.test(s)) s = s.replace(/,/g, '');
      else s = s.replace(',', '.');
    }
    const v = parseFloat(s);
    return isFinite(v) ? v : 0;
  }

  function cardsIn(str) {
    const out = [];
    const re = /\[([^\]]*)\]/g;
    let m;
    while ((m = re.exec(str || ''))) {
      m[1].trim().split(/\s+/).forEach(c => { if (/^[2-9TJQKA][shdc]$/i.test(c)) out.push(c); });
    }
    return out;
  }

  const HAND_START = /^(?:Poker Hand|PokerStars (?:Zoom |Home Game |Hold'em )?Hand|PokerStars Game|Game Hand|Hand) #/;

  function splitHands(text) {
    const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    const hands = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (HAND_START.test(line)) {
        if (cur) hands.push(cur);
        cur = [line];
      } else if (cur) {
        cur.push(line);
      }
    }
    if (cur) hands.push(cur);
    return hands;
  }

  function parseHand(lines) {
    const head = lines[0] || '';
    const hm = head.match(/Hand #([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!hm) return { skip: 'unreadable' };
    const id = hm[1];
    const rest = hm[2];
    if (/Tournament|\bLevel\s+[IVXLC\d]+|\bT\d{3,}\b/i.test(rest)) return { skip: 'tournament', id };
    if (!/Hold'?em No Limit|No Limit Hold'?em|\bNLH[E]?\b/i.test(rest)) return { skip: 'other', id };
    const bl = rest.match(/\(([^)]*)\)/);
    let sb = 0, bb = 0, cur = '';
    if (bl) {
      const nums = bl[1].match(/\d[\d.,]*/g);
      if (nums && nums.length >= 2) { sb = num(nums[0]); bb = num(nums[1]); }
      const cm = bl[1].match(/[$€£₹]|USD|EUR|RON|GBP|CNY|INR|CAD/);
      if (cm) cur = cm[0];
    }
    if (!bb) return { skip: 'unreadable', id };
    const tm = rest.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    const pad = n => String(n).padStart(2, '0');
    const time = tm ? `${tm[1]}-${pad(tm[2])}-${pad(tm[3])}T${pad(tm[4])}:${tm[5]}:${tm[6]}` : null;

    const h = {
      id, sb, bb, cur, time, table: '', max: 0, button: 0,
      seats: [], acts: [], board: [], shows: {}, won: {}, back: {},
      hero: null, heroCards: null, flop: false
    };
    let street = 'pre';
    let names = [];
    let sorted = [];
    const bySeat = {};

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      if (line.startsWith('***')) {
        const sm = line.match(/^\*{3}\s*([A-Z' -]+?)\s*\*{3}(.*)$/i);
        if (sm) {
          const tag = sm[1].toUpperCase();
          const second = /SECOND|2ND/.test(tag);
          if (/HOLE CARDS|PRE-?FLOP|DEALING/.test(tag)) street = 'pre';
          else if (/FLOP/.test(tag)) { if (!second) { street = 'flop'; h.flop = true; h.board = cardsIn(sm[2]); } }
          else if (/TURN/.test(tag)) { if (!second) { street = 'turn'; h.board = cardsIn(sm[2]); } }
          else if (/RIVER/.test(tag)) { if (!second) { street = 'river'; h.board = cardsIn(sm[2]); } }
          else if (/SHOW ?DOWN/.test(tag)) street = 'show';
          else if (/SUMMARY/.test(tag)) street = 'summary';
          continue;
        }
      }

      if (street === 'summary') {
        const sm = line.match(/^Seat (\d+):/);
        if (sm) {
          const nm = bySeat[sm[1]];
          const cm = line.match(/(?:showed|mucked|shows) \[([^\]]+)\]/);
          if (nm && cm && !h.shows[nm]) h.shows[nm] = cardsIn('[' + cm[1] + ']').join(' ');
        }
        continue;
      }

      let m;
      if (!h.table && (m = line.match(/^Table '([^']*)'\s*(?:(\d+)-max)?.*?Seat #(\d+) is the button/i))) {
        h.table = m[1]; h.max = +(m[2] || 0); h.button = +m[3];
        continue;
      }
      if (street === 'pre' && !h.acts.some(a => a.t !== 'post') &&
          (m = line.match(/^Seat (\d+):\s*(.+?)\s*\(\D{0,5}?(\d[\d.,]*)[^)]*\)\s*(.*)$/))) {
        const out = /sitting out|is out|out of hand/i.test(m[4]);
        const seat = { seat: +m[1], name: m[2], stack: num(m[3]), out };
        h.seats.push(seat);
        bySeat[m[1]] = m[2];
        names.push(m[2]);
        sorted = names.slice().sort((a, b) => b.length - a.length);
        continue;
      }
      if ((m = line.match(/^Dealt to (.+?)\s*\[([^\]]+)\]/))) {
        h.hero = m[1];
        h.heroCards = cardsIn('[' + m[2] + ']').join(' ');
        continue;
      }
      if ((m = line.match(new RegExp('^Uncalled bet \\(' + AMT + '\\) returned to (.+)$')))) {
        const nm = m[2].trim();
        h.back[nm] = (h.back[nm] || 0) + num(m[1]);
        continue;
      }

      let who = null;
      for (const n of sorted) {
        if (line.startsWith(n + ':') || line.startsWith(n + ' ')) { who = n; break; }
      }
      if (!who) continue;
      const tail = line.slice(who.length);

      if (tail.startsWith(':')) {
        const s = tail.slice(1).trim();
        const allin = /all-in/i.test(s);
        let a = null;
        if (/^folds/i.test(s)) a = { t: 'fold' };
        else if (/^checks/i.test(s)) a = { t: 'check' };
        else if ((m = s.match(new RegExp('^calls ' + AMT, 'i')))) a = { t: 'call', a: num(m[1]) };
        else if ((m = s.match(new RegExp('^bets ' + AMT, 'i')))) a = { t: 'bet', a: num(m[1]) };
        else if ((m = s.match(new RegExp('^raises ' + AMT + ' to ' + AMT, 'i')))) a = { t: 'raise', a: num(m[1]), to: num(m[2]) };
        else if ((m = s.match(new RegExp('^posts (?:the )?(small & big blinds|small blind|big blind|straddle|ante|missed blind|dead blind)' + AMT, 'i')))) {
          a = { t: 'post', kind: m[1].toLowerCase(), a: num(m[2]) };
        } else if ((m = s.match(/^shows \[([^\]]+)\]/i))) {
          h.shows[who] = cardsIn('[' + m[1] + ']').join(' ');
        } else if ((m = s.match(new RegExp('Receives Cashout \\(' + AMT + '\\)', 'i')))) {
          h.won[who] = (h.won[who] || 0) + num(m[1]);
        } else if ((m = s.match(new RegExp('Pays Cashout Risk \\(' + AMT + '\\)', 'i')))) {
          h.won[who] = (h.won[who] || 0) - num(m[1]);
        }
        if (a && street !== 'show') {
          a.s = street; a.n = who; a.allin = allin;
          h.acts.push(a);
        }
        continue;
      }
      if ((m = tail.match(new RegExp('^ collected ' + AMT, 'i')))) {
        h.won[who] = (h.won[who] || 0) + num(m[1]);
        continue;
      }
      if ((m = tail.match(new RegExp('^ (?:cashed out|wins|won) ' + AMT, 'i')))) {
        h.won[who] = (h.won[who] || 0) + num(m[1]);
      }
    }
    if (!h.seats.length) return { skip: 'unreadable', id };
    return h;
  }

  // Seat -> position label, using the button seat and the blind posts.
  function positions(h, players) {
    const seats = h.seats.filter(s => players.indexOf(s.name) >= 0).sort((a, b) => a.seat - b.seat);
    const n = seats.length;
    const map = {};
    if (n < 2) { if (n === 1) map[seats[0].name] = 'BTN'; return map; }
    let bi = seats.findIndex(s => s.seat === h.button);
    if (bi < 0) {
      bi = -1;
      for (let i = 0; i < n; i++) if (seats[i].seat < h.button) bi = i;
      if (bi < 0) bi = n - 1;
    }
    const order = [];
    for (let i = 1; i <= n; i++) order.push(seats[(bi + i) % n].name);
    const btn = order[n - 1];
    if (n === 2) { map[btn] = 'BTN'; map[order[0]] = 'BB'; return map; }

    const bbPost = h.acts.find(a => a.t === 'post' && a.kind === 'big blind');
    let start = 0;
    if (bbPost && order[0] === bbPost.n) {
      map[order[0]] = 'BB';      // dead small blind
      start = 1;
    } else {
      map[order[0]] = 'SB';
      map[order[1]] = 'BB';
      start = 2;
    }
    map[btn] = 'BTN';
    const middle = order.slice(start, n - 1);
    const m = middle.length;
    const tail = ['HJ', 'CO'].slice(Math.max(0, 2 - m));
    const headCount = Math.max(0, m - tail.length);
    const headNames = ['UTG', 'UTG+1', 'UTG+2', 'LJ'];
    const head = [];
    for (let i = 0; i < headCount; i++) {
      head.push(i === headCount - 1 && headCount >= 2 ? 'LJ' : headNames[Math.min(i, 2)]);
    }
    const labels = head.concat(tail);
    middle.forEach((nm, i) => { map[nm] = labels[i]; });
    return map;
  }

  // One parsed hand -> per-player counters + shown hands.
  function handStats(h) {
    const out = {};
    const C = n => out[n] || (out[n] = blank());
    const players = h.seats.filter(s => !s.out).map(s => s.name);
    const pos = positions(h, players);
    for (const n of players) {
      const c = C(n);
      c.hands++;
      const g = GROUP_OF[pos[n]];
      if (g) c['h_' + g]++;
    }

    // Money
    const inv = {}, comm = { pre: {}, flop: {}, turn: {}, river: {} };
    const put = (n, x) => { inv[n] = (inv[n] || 0) + x; };
    for (const a of h.acts) {
      const st = comm[a.s] || comm.pre;
      if (a.t === 'post') {
        put(a.n, a.a);
        if (a.kind === 'ante') continue;
        const live = a.kind === 'small & big blinds' ? Math.min(a.a, h.bb) : a.a;
        st[a.n] = (st[a.n] || 0) + live;
      } else if (a.t === 'call' || a.t === 'bet') {
        put(a.n, a.a);
        st[a.n] = (st[a.n] || 0) + a.a;
      } else if (a.t === 'raise') {
        const prev = st[a.n] || 0;
        put(a.n, Math.max(0, a.to - prev));
        st[a.n] = a.to;
      }
    }

    const folded = {};
    const line = {};
    const addLine = (n, s) => { (line[n] || (line[n] = [])).push(s); };

    // Preflop
    let rc = 0, lastRaiser = null, opener = null, vol = false, stealOn = false, callersAfterSteal = 0;
    const acted = {}, isV = {}, isP = {}, f3done = {};
    const pre = h.acts.filter(a => a.s === 'pre' && a.t !== 'post');
    for (const a of pre) {
      const c = C(a.n), p = pos[a.n], first = !acted[a.n];
      if (rc === 0) {
        if (!vol && first && p !== 'BB') {
          c.rfiOpp++;
          if (STEAL_POS[p]) c.stealOpp++;
        }
        if (a.t === 'raise') {
          if (!vol && first && p !== 'BB') {
            c.rfi++;
            if (STEAL_POS[p]) { c.steal++; stealOn = true; }
          }
          opener = a.n;
          addLine(a.n, vol ? 'iso-raise' : 'open');
        } else if (a.t === 'call') {
          if (!isV[a.n]) c.limp++;
          addLine(a.n, 'limp');
        } else if (a.t === 'check') {
          addLine(a.n, 'check');
        }
      } else if (rc === 1) {
        if (a.n !== lastRaiser) {
          c.tbOpp++;
          if (a.t === 'raise') c.tb++;
          if (p !== 'BB' && !isV[a.n]) { c.ccOpp++; if (a.t === 'call') c.cc++; }
          if (stealOn && callersAfterSteal === 0 && (p === 'SB' || p === 'BB')) {
            c.fvsOpp++;
            if (a.t === 'fold') c.fvs++;
          }
        }
        if (a.t === 'raise') addLine(a.n, '3-bet');
        else if (a.t === 'call') addLine(a.n, 'call');
      } else if (rc === 2) {
        if (a.n === opener && !f3done[a.n]) {
          f3done[a.n] = true;
          c.f3Opp++;
          if (a.t === 'fold') c.f3++;
          if (a.t === 'raise') c.fb++;
        }
        if (a.t === 'raise') addLine(a.n, '4-bet');
        else if (a.t === 'call') addLine(a.n, 'call 3-bet');
      } else {
        if (a.t === 'raise') addLine(a.n, (rc + 2) + '-bet');
        else if (a.t === 'call') addLine(a.n, 'call ' + (rc + 1) + '-bet');
      }
      if (a.t === 'call') {
        isV[a.n] = true; vol = true;
        if (stealOn && rc === 1) callersAfterSteal++;
      } else if (a.t === 'raise') {
        isV[a.n] = true; isP[a.n] = true; vol = true;
        rc++; lastRaiser = a.n;
      } else if (a.t === 'fold') {
        folded[a.n] = true;
      }
      acted[a.n] = true;
    }
    for (const n of Object.keys(isV)) {
      const c = C(n), g = GROUP_OF[pos[n]];
      c.vpip++;
      if (g) c['v_' + g]++;
    }
    for (const n of Object.keys(isP)) {
      const c = C(n), g = GROUP_OF[pos[n]];
      c.pfr++;
      if (g) c['p_' + g]++;
    }
    const pfa = lastRaiser;

    // Flop seen
    const saw = {};
    if (h.flop) {
      for (const n of players) if (!folded[n]) { saw[n] = true; C(n).sawFlop++; }
    }

    // Postflop
    let flopCbet = false, turnCbet = false;
    for (const sName of ['flop', 'turn', 'river']) {
      const acts = h.acts.filter(a => a.s === sName && a.t !== 'post');
      let bets = 0, pfaChecked = false;
      const checked = {}, xrDone = {}, faced = {};
      for (const a of acts) {
        const c = C(a.n);
        if (sName === 'flop') {
          if (a.n === pfa && bets === 0 && !pfaChecked) {
            pfaChecked = true;
            c.cbOpp++;
            if (a.t === 'bet') { c.cb++; flopCbet = true; }
          } else if (flopCbet && bets === 1 && a.n !== pfa && !faced[a.n]) {
            faced[a.n] = true;
            c.fcbOpp++;
            if (a.t === 'fold') c.fcb++;
            if (a.t === 'raise') c.rcb++;
          }
          if (checked[a.n] && bets >= 1 && !xrDone[a.n]) {
            xrDone[a.n] = true;
            c.xrOpp++;
            if (a.t === 'raise') c.xr++;
          }
        } else if (sName === 'turn') {
          if (flopCbet && a.n === pfa && bets === 0 && !pfaChecked) {
            pfaChecked = true;
            c.cb2Opp++;
            if (a.t === 'bet') { c.cb2++; turnCbet = true; }
          } else if (turnCbet && bets === 1 && a.n !== pfa && !faced[a.n]) {
            faced[a.n] = true;
            c.fcb2Opp++;
            if (a.t === 'fold') c.fcb2++;
          }
        }
        if (a.t === 'bet') { c.pBet++; bets = 1; }
        else if (a.t === 'raise') { c.pRaise++; bets++; }
        else if (a.t === 'call') c.pCall++;
        else if (a.t === 'check') { c.pCheck++; checked[a.n] = true; }
        else if (a.t === 'fold') { c.pFold++; folded[a.n] = true; }
      }
    }

    // Showdown and results
    const active = players.filter(n => !folded[n]);
    const showdown = active.length >= 2;
    for (const n of players) {
      const c = C(n);
      const won = (h.won[n] || 0) > 0;
      if (saw[n]) {
        if (won) c.wwsf++;
        if (showdown && !folded[n]) { c.wtsd++; if (won) c.wsd++; }
      }
      const net = (h.won[n] || 0) + (h.back[n] || 0) - (inv[n] || 0);
      c.netBB += h.bb ? net / h.bb : 0;
    }

    const shown = {};
    const board = h.board.join(' ');
    for (const n of Object.keys(h.shows)) {
      if (players.indexOf(n) < 0) continue;
      const won = (h.won[n] || 0) > 0 ? 1 : 0;
      shown[n] = [h.shows[n], pos[n] || '', (line[n] || ['blind']).join(' · '), board, won,
        Math.round(out[n].netBB * 10) / 10, h.time || ''];
    }
    return { players: out, shown, pos };
  }

  // ---------------------------------------------------------------------------
  // Import: many files -> one aggregate, skipping hands already saved.
  // ---------------------------------------------------------------------------
  function analyze(texts, knownIds) {
    const known = knownIds || new Set();
    const agg = {
      found: 0, hands: 0, dup: 0, errors: 0,
      skipped: { tournament: 0, other: 0, unreadable: 0 },
      handIds: [], players: {}, shown: {}, heroes: [], stakes: [], tables: [],
      firstAt: null, lastAt: null
    };
    const seen = new Set();
    const heroes = new Set(), stakes = new Set(), tables = new Set();
    for (const text of [].concat(texts || [])) {
      for (const lines of splitHands(text)) {
        agg.found++;
        let h;
        try { h = parseHand(lines); } catch (e) { agg.errors++; continue; }
        if (h.skip) { agg.skipped[h.skip] = (agg.skipped[h.skip] || 0) + 1; continue; }
        if (known.has(h.id) || seen.has(h.id)) { agg.dup++; continue; }
        let r;
        try { r = handStats(h); } catch (e) { agg.errors++; continue; }
        seen.add(h.id);
        agg.hands++;
        agg.handIds.push(h.id);
        if (h.hero) heroes.add(h.hero);
        stakes.add((h.cur || '') + fmtMoney(h.sb) + '/' + (h.cur || '') + fmtMoney(h.bb));
        if (h.table) tables.add(h.table);
        if (h.time) {
          if (!agg.firstAt || h.time < agg.firstAt) agg.firstAt = h.time;
          if (!agg.lastAt || h.time > agg.lastAt) agg.lastAt = h.time;
        }
        for (const n of Object.keys(r.players)) {
          addInto(agg.players[n] || (agg.players[n] = blank()), r.players[n]);
        }
        for (const n of Object.keys(r.shown)) {
          const list = agg.shown[n] || (agg.shown[n] = []);
          list.push(r.shown[n]);
          if (list.length > 12) list.shift();
        }
      }
    }
    agg.heroes = Array.from(heroes);
    agg.stakes = Array.from(stakes);
    agg.tables = Array.from(tables);
    return agg;
  }

  function fmtMoney(v) {
    return (Math.round(v * 100) / 100).toString();
  }

  // Aggregate -> database documents, split so no document nears the 256 KiB cap.
  function buildDocs(agg, meta) {
    meta = meta || {};
    const group = meta.group || ('i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const names = Object.keys(agg.players);
    let pSize = 400, hSize = 4000;
    for (let attempt = 0; attempt < 8; attempt++) {
      const parts = Math.max(1, Math.ceil(names.length / pSize), Math.ceil(agg.handIds.length / hSize));
      const docs = [];
      for (let i = 0; i < parts; i++) {
        const pn = names.slice(i * pSize, (i + 1) * pSize);
        const players = {}, shown = {};
        for (const n of pn) {
          players[n] = toArr(agg.players[n]);
          if (agg.shown[n]) shown[n] = agg.shown[n];
        }
        docs.push({
          id: group + '-' + i,
          data: {
            v: 1, group, part: i, parts,
            createdAt: meta.createdAt || new Date().toISOString(),
            label: meta.label || '',
            sample: !!meta.sample,
            hands: i === 0 ? agg.hands : 0,
            firstAt: agg.firstAt, lastAt: agg.lastAt,
            stakes: agg.stakes, heroes: agg.heroes, tables: agg.tables.length,
            handIds: agg.handIds.slice(i * hSize, (i + 1) * hSize),
            players, shown
          }
        });
      }
      const tooBig = docs.some(d => JSON.stringify(d.data).length > 200000);
      if (!tooBig) return docs;
      pSize = Math.max(20, Math.floor(pSize / 2));
      hSize = Math.max(500, Math.floor(hSize / 2));
    }
    throw new Error('This import is too large to save in one go. Split it into smaller files.');
  }

  // Saved documents -> everything the page shows.
  function aggregateDocs(docs) {
    const groups = {};
    for (const d of docs) {
      if (!d || typeof d !== 'object' || !d.group) continue;
      (groups[d.group] || (groups[d.group] = [])).push(d);
    }
    const players = {};
    const imports = [];
    const knownIds = new Set();
    const heroes = new Set();
    let totalHands = 0;
    for (const g of Object.keys(groups)) {
      const parts = groups[g].sort((a, b) => (a.part || 0) - (b.part || 0));
      const head = parts[0];
      const expected = Number(head.parts) || 1;
      const complete = parts.length >= expected;
      let playerCount = 0;
      const hands = parts.reduce((s, p) => s + (Number(p.hands) || 0), 0);
      for (const p of parts) {
        (p.heroes || []).forEach(x => heroes.add(String(x)));
        (p.handIds || []).forEach(id => knownIds.add(String(id)));
        const pl = p.players || {};
        for (const n of Object.keys(pl)) {
          playerCount++;
          const rec = players[n] || (players[n] = {
            name: n, c: blank(), sessions: 0, firstSeen: null, lastSeen: null, shown: []
          });
          addInto(rec.c, fromArr(pl[n]));
          rec.sessions++;
          if (p.firstAt && (!rec.firstSeen || p.firstAt < rec.firstSeen)) rec.firstSeen = p.firstAt;
          if (p.lastAt && (!rec.lastSeen || p.lastAt > rec.lastSeen)) rec.lastSeen = p.lastAt;
          const sh = (p.shown || {})[n];
          if (Array.isArray(sh)) for (const s of sh) if (Array.isArray(s)) rec.shown.push(s);
        }
      }
      totalHands += hands;
      imports.push({
        group: g, ids: parts.map(p => p._id).filter(Boolean),
        label: head.label || '', createdAt: head.createdAt || '', sample: !!head.sample,
        hands, firstAt: head.firstAt || null, lastAt: head.lastAt || null,
        stakes: head.stakes || [], players: playerCount, complete, parts: expected
      });
    }
    for (const n of Object.keys(players)) {
      const rec = players[n];
      rec.shown.sort((a, b) => String(b[6] || '').localeCompare(String(a[6] || '')));
      rec.shown = rec.shown.slice(0, 30);
    }
    imports.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { players, imports, knownIds, heroes, totalHands };
  }

  // ---------------------------------------------------------------------------
  // Derived stats. Typical ranges are for a winning 6-max NL cash regular.
  // ---------------------------------------------------------------------------
  const STATS = [
    { k: 'vpip', label: 'VPIP', grp: 'Preflop', num: 'vpip', den: 'hands', lo: 20, hi: 27, max: 70, minN: 30, unit: '%',
      tip: 'How often they put money in voluntarily before the flop.' },
    { k: 'pfr', label: 'PFR', grp: 'Preflop', num: 'pfr', den: 'hands', lo: 16, hi: 22, max: 50, minN: 30, unit: '%',
      tip: 'How often they raise before the flop.' },
    { k: 'tb', label: '3-Bet', grp: 'Preflop', num: 'tb', den: 'tbOpp', lo: 6, hi: 10, max: 25, minN: 40, unit: '%',
      tip: 'How often they re-raise when someone has opened.' },
    { k: 'f3', label: 'Fold to 3-Bet', grp: 'Preflop', num: 'f3', den: 'f3Opp', lo: 45, hi: 60, max: 100, minN: 12, unit: '%',
      tip: 'After opening, how often they fold to a re-raise.' },
    { k: 'fb', label: '4-Bet', grp: 'Preflop', num: 'fb', den: 'f3Opp', lo: 10, hi: 20, max: 50, minN: 12, unit: '%',
      tip: 'After opening, how often they re-raise a 3-bet.' },
    { k: 'steal', label: 'Steal', grp: 'Preflop', num: 'steal', den: 'stealOpp', lo: 35, hi: 48, max: 100, minN: 15, unit: '%',
      tip: 'How often they open from the cutoff, button or small blind when folded to.' },
    { k: 'fvs', label: 'Fold to Steal', grp: 'Preflop', num: 'fvs', den: 'fvsOpp', lo: 55, hi: 75, max: 100, minN: 12, unit: '%',
      tip: 'In the blinds, how often they fold to a late-position open.' },
    { k: 'limp', label: 'Limp', grp: 'Preflop', num: 'limp', den: 'hands', lo: 0, hi: 3, max: 40, minN: 30, unit: '%',
      tip: 'How often they just call the big blind instead of raising first in.' },
    { k: 'cc', label: 'Cold Call', grp: 'Preflop', num: 'cc', den: 'ccOpp', lo: 6, hi: 14, max: 50, minN: 20, unit: '%',
      tip: 'Outside the big blind, how often they flat-call an open.' },

    { k: 'cb', label: 'Flop C-Bet', grp: 'Postflop', num: 'cb', den: 'cbOpp', lo: 50, hi: 70, max: 100, minN: 15, unit: '%',
      tip: 'As the preflop raiser, how often they bet the flop.' },
    { k: 'cb2', label: 'Turn C-Bet', grp: 'Postflop', num: 'cb2', den: 'cb2Opp', lo: 40, hi: 55, max: 100, minN: 10, unit: '%',
      tip: 'After betting the flop, how often they bet the turn again.' },
    { k: 'fcb', label: 'Fold to Flop C-Bet', grp: 'Postflop', num: 'fcb', den: 'fcbOpp', lo: 40, hi: 55, max: 100, minN: 15, unit: '%',
      tip: 'How often they fold when the preflop raiser bets the flop.' },
    { k: 'rcb', label: 'Raise Flop C-Bet', grp: 'Postflop', num: 'rcb', den: 'fcbOpp', lo: 6, hi: 12, max: 40, minN: 15, unit: '%',
      tip: 'How often they raise a flop c-bet.' },
    { k: 'fcb2', label: 'Fold to Turn C-Bet', grp: 'Postflop', num: 'fcb2', den: 'fcb2Opp', lo: 40, hi: 55, max: 100, minN: 10, unit: '%',
      tip: 'How often they fold to a second barrel on the turn.' },
    { k: 'xr', label: 'Flop Check-Raise', grp: 'Postflop', num: 'xr', den: 'xrOpp', lo: 8, hi: 14, max: 40, minN: 15, unit: '%',
      tip: 'After checking the flop and facing a bet, how often they raise.' },
    { k: 'af', label: 'Aggression Factor', grp: 'Postflop', kind: 'af', lo: 2, hi: 3.5, max: 8, minN: 40, unit: '',
      tip: 'Bets plus raises divided by calls, after the flop.' },
    { k: 'afq', label: 'Aggression Freq', grp: 'Postflop', kind: 'afq', lo: 35, hi: 50, max: 100, minN: 40, unit: '%',
      tip: 'Share of their postflop actions (excluding checks) that are bets or raises.' },

    { k: 'wtsd', label: 'Went to Showdown', grp: 'Showdown', num: 'wtsd', den: 'sawFlop', lo: 25, hi: 31, max: 60, minN: 30, unit: '%',
      tip: 'After seeing the flop, how often they reach showdown.' },
    { k: 'wsd', label: 'Won at Showdown', grp: 'Showdown', num: 'wsd', den: 'wtsd', lo: 49, hi: 56, max: 100, minN: 15, unit: '%',
      tip: 'How often they win when they reach showdown.' },
    { k: 'wwsf', label: 'Won When Saw Flop', grp: 'Showdown', num: 'wwsf', den: 'sawFlop', lo: 44, hi: 52, max: 100, minN: 30, unit: '%',
      tip: 'How often they win the pot after seeing the flop.' }
  ];
  const STAT_BY_KEY = {};
  STATS.forEach(s => { STAT_BY_KEY[s.k] = s; });

  function derive(c) {
    const d = {};
    for (const s of STATS) {
      let v = null, n = 0;
      if (s.kind === 'af') {
        const agg = c.pBet + c.pRaise;
        n = agg + c.pCall;
        if (n) v = c.pCall ? agg / c.pCall : Math.min(agg, 10);
      } else if (s.kind === 'afq') {
        const agg = c.pBet + c.pRaise;
        n = agg + c.pCall + c.pFold;
        if (n) v = agg / n * 100;
      } else {
        n = c[s.den] || 0;
        if (n) v = (c[s.num] || 0) / n * 100;
      }
      const conf = n >= s.minN * 3 ? 'high' : n >= s.minN ? 'ok' : 'low';
      d[s.k] = { v, n, conf };
    }
    d.bb100 = { v: c.hands ? c.netBB / c.hands * 100 : null, n: c.hands, conf: c.hands >= 1000 ? 'high' : c.hands >= 300 ? 'ok' : 'low' };
    d.hands = c.hands;
    d.positions = POS_GROUPS.map(g => ({
      g, hands: c['h_' + g] || 0,
      vpip: c['h_' + g] ? c['v_' + g] / c['h_' + g] * 100 : null,
      pfr: c['h_' + g] ? c['p_' + g] / c['h_' + g] * 100 : null
    }));
    return d;
  }

  const TYPES = {
    unknown: { label: 'Unknown', blurb: 'Not enough hands for a read yet.' },
    nit: { label: 'Nit', blurb: 'Plays very few hands. When they put money in, they usually have it.' },
    rock: { label: 'Tight-passive', blurb: 'Plays few hands and rarely raises. Their bets and raises mean strength.' },
    tag: { label: 'TAG / Regular', blurb: 'Solid preflop numbers. Probably a thinking regular.' },
    lag: { label: 'LAG', blurb: 'Loose and aggressive. Puts you under pressure with a wide range.' },
    fish: { label: 'Loose-passive', blurb: 'Plays too many hands and mostly calls instead of raising.' },
    station: { label: 'Calling station', blurb: 'Calls far too much and rarely folds once in the pot.' },
    maniac: { label: 'Maniac', blurb: 'Plays a huge range and bets and raises constantly.' }
  };

  function classify(d) {
    const hands = d.hands || 0;
    if (hands < 15 || d.vpip.v == null) return 'unknown';
    const v = d.vpip.v, p = d.pfr.v || 0;
    const ratio = v > 0 ? p / v : 0;
    const af = d.af.n >= 20 ? d.af.v : null;
    const wtsd = d.wtsd.n >= 15 ? d.wtsd.v : null;
    const fcb = d.fcb.n >= 10 ? d.fcb.v : null;
    if (v >= 40 && (p >= 28 || (af != null && af >= 4 && p >= 18))) return 'maniac';
    if (v >= 38 && ratio < 0.5) return 'station';
    if (v >= 28 && ratio < 0.55) {
      if ((wtsd != null && wtsd >= 33) || (fcb != null && fcb <= 33)) return 'station';
      return 'fish';
    }
    if (v >= 28) return 'lag';
    if (v < 14) return 'nit';
    if (ratio < 0.55) return 'rock';
    return 'tag';
  }

  // t: full advice for the player page. a: short action for lists.
  const RULES = [
    { s: 'vpip', pr: 10, when: (v, d) => v >= 35 && d.pfr.v != null && v - d.pfr.v >= 18,
      a: 'Isolate them preflop and value bet relentlessly.',
      t: 'Plays far too many hands passively. Raise to isolate them preflop and value bet relentlessly.' },
    { s: 'fcb', pr: 9, when: v => v >= 60, a: 'C-bet the flop with almost any two cards.',
      t: 'C-bet the flop against them with almost any two cards. They fold too often.' },
    { s: 'wtsd', pr: 9, when: v => v >= 34, a: 'Value bet thinner and stop bluffing.',
      t: 'They go to showdown too much. Value bet thinner on every street and cut your bluffs.' },
    { s: 'fcb', pr: 8, when: v => v <= 32, a: 'Don’t bluff flops; bet your value hands.',
      t: 'Stop bluffing flops into them. Bet your value hands and check your air.' },
    { s: 'limp', pr: 8, when: v => v >= 10, a: 'Raise to isolate their limps.',
      t: 'Limps often. Raise to isolate them with a wide range, about 4bb plus 1bb per limper.' },
    { s: 'f3', pr: 8, when: v => v >= 65, a: '3-bet their opens light.',
      t: 'Opens, then folds to 3-bets. 3-bet them light, especially in position.' },
    { s: 'fvs', pr: 8, when: v => v >= 78, a: 'Steal whenever they’re in the blinds.',
      t: 'Folds the blinds too often. Open any reasonable hand when they are in the blinds.' },
    { s: 'wtsd', pr: 7, when: v => v <= 21, a: 'Keep barrelling turns and rivers.',
      t: 'Gives up before showdown. Keep barrelling turns and rivers when you have equity or good blockers.' },
    { s: 'af', pr: 7, when: v => v <= 1.2, a: 'Fold medium hands when they bet or raise.',
      t: 'Passive after the flop, so their bets and raises mean a real hand. Fold medium hands to their aggression.' },
    { s: 'af', pr: 7, when: v => v >= 4, a: 'Check-call more and let them bluff.',
      t: 'Very aggressive after the flop. Check-call more with medium hands and let them bluff into you.' },
    { s: 'tb', pr: 7, when: v => v <= 3, a: 'Respect their 3-bets; fold all but premiums.',
      t: 'Their 3-bet is very strong (think QQ+ and AK). Fold everything but premium hands to it.' },
    { s: 'cb', pr: 7, when: v => v >= 78, a: 'Float their c-bets and check-raise flops.',
      t: 'C-bets almost every flop. Float in position and check-raise flops as bluffs.' },
    { s: 'cb2', pr: 7, when: v => v <= 32, a: 'Float the flop, bet when they check the turn.',
      t: 'Gives up on the turn after a c-bet. Call the flop in position and bet when they check the turn.' },
    { s: 'fcb2', pr: 7, when: v => v >= 58, a: 'Double-barrel them on good turns.',
      t: 'Folds to turn barrels. Double-barrel them on good turn cards.' },
    { s: 'tb', pr: 6, when: v => v >= 11, a: '4-bet bluff more; call 3-bets in position.',
      t: '3-bets light. 4-bet bluff with hands like A5s and call more 3-bets in position.' },
    { s: 'f3', pr: 6, when: v => v <= 35, a: '3-bet them for value only, and bigger.',
      t: 'Rarely folds to a 3-bet. 3-bet them for value only, with a tighter range and bigger sizing.' },
    { s: 'steal', pr: 6, when: v => v >= 50, a: 'Defend wider and 3-bet their steals.',
      t: 'Steals very wide from late position. Defend your blinds wider and 3-bet them more.' },
    { s: 'cb', pr: 6, when: v => v <= 40, a: 'Respect their flop bets; stab when they check.',
      t: 'Rarely c-bets without a hand. Respect their flop bets and stab when they check to you.' },
    { s: 'xr', pr: 6, when: v => v >= 18, a: 'Bet big for value, check back weak hands.',
      t: 'Check-raises flops often. Bet bigger with value hands and check back your weak ones.' },
    { s: 'cc', pr: 6, when: v => v >= 20, a: 'Value bet big; their calling range is capped.',
      t: 'Flat-calls opens a lot instead of 3-betting, so their range is capped. Value bet big on later streets.' },
    { s: 'wsd', pr: 6, when: (v, d) => v >= 58 && d.wtsd.v != null && d.wtsd.v <= 27,
      a: 'Respect their river calls and raises.',
      t: 'When they reach showdown they usually win. Respect their river calls and raises.' },
    { s: 'vpip', pr: 6, when: v => v <= 13, a: 'Steal their blinds; fold to their aggression.',
      t: 'Very tight. Steal their blinds, and fold marginal hands when they show aggression.' },
    { s: 'fvs', pr: 5, when: v => v <= 45, a: 'Steal tighter and value-raise bigger.',
      t: 'Defends the blinds a lot. Steal tighter against them and value-raise bigger.' },
    { s: 'rcb', pr: 5, when: v => v >= 18, a: 'C-bet less; call down with strong hands.',
      t: 'Raises c-bets a lot. C-bet less with weak hands and be ready to call down with strong ones.' }
  ];

  const FALLBACK = {
    unknown: ['Keep importing hands. The first reliable reads appear after about 30 hands.', 'Too few hands for a read yet.'],
    nit: ['Steal their blinds and give up quickly when they fight back.', 'Steal their blinds; give up when they fight back.'],
    rock: ['Bet for value often; they call with medium hands but rarely bluff.', 'Value bet often; they rarely bluff.'],
    tag: ['No clear leak yet. Avoid marginal spots against them and focus on weaker players.', 'No clear leak yet; avoid marginal spots.'],
    lag: ['Tighten up against their opens and let them bluff into your strong hands.', 'Tighten up and let them bluff into you.'],
    fish: ['Value bet them hard and avoid fancy bluffs.', 'Value bet hard; skip fancy bluffs.'],
    station: ['Value bet every street and never bluff them.', 'Value bet every street; never bluff.'],
    maniac: ['Tighten up, play big pots only with strong hands, and let them hang themselves.', 'Tighten up and play big pots only with strong hands.']
  };

  function fmtStat(s, v) {
    if (v == null) return '–';
    if (s.unit === '%') return Math.round(v) + '%';
    return v >= 10 ? '10+' : v.toFixed(1);
  }

  function exploits(d, type) {
    const out = [];
    const used = {};
    for (const r of RULES) {
      const s = STAT_BY_KEY[r.s];
      const x = d[r.s];
      if (!x || x.v == null || x.n < s.minN || used[r.s]) continue;
      if (r.when(x.v, d)) {
        used[r.s] = true;
        out.push({ text: r.t, short: r.a, pr: r.pr + (x.conf === 'high' ? 0.5 : 0),
          evidence: `${s.label} ${fmtStat(s, x.v)} over ${x.n} ${x.n === 1 ? 'spot' : 'spots'}` });
      }
    }
    out.sort((a, b) => b.pr - a.pr);
    if (!out.length) {
      const f = FALLBACK[type] || FALLBACK.unknown;
      out.push({ text: f[0], short: f[1], pr: 0, evidence: '' });
    }
    return out.slice(0, 5);
  }

  function targetScore(d) {
    if ((d.hands || 0) < 30 || d.vpip.v == null) return null;
    let s = 0;
    s += Math.max(0, d.vpip.v - 28);
    s += Math.max(0, (d.vpip.v - (d.pfr.v || 0)) - 8) * 1.2;
    if (d.wtsd.n >= 15) s += Math.max(0, d.wtsd.v - 30) * 0.8;
    if (d.fcb.n >= 10) s += Math.max(0, d.fcb.v - 55) * 0.5;
    if (d.f3.n >= 10) s += Math.max(0, d.f3.v - 62) * 0.3;
    if (d.limp.n >= 30) s += Math.max(0, d.limp.v - 5) * 0.6;
    return Math.round(s);
  }

  function heroLeaks(d) {
    const out = [];
    for (const s of STATS) {
      const x = d[s.k];
      if (!x || x.v == null || x.n < s.minN) continue;
      if (x.v > s.hi || x.v < s.lo) {
        const dir = x.v > s.hi ? 'above' : 'below';
        const range = s.unit === '%' ? `${s.lo}–${s.hi}%` : `${s.lo}–${s.hi}`;
        const gap = x.v > s.hi ? x.v - s.hi : s.lo - x.v;
        out.push({ k: s.k, gap: gap / (s.max || 100), text: `Your ${s.label} is ${fmtStat(s, x.v)}, ${dir} the usual regular range of ${range}.`, n: x.n });
      }
    }
    out.sort((a, b) => b.gap - a.gap);
    return out;
  }

  function readStrength(hands) {
    if (hands >= 300) return 'Strong read';
    if (hands >= 100) return 'Solid read';
    if (hands >= 30) return 'Developing read';
    return 'Early read';
  }

  // Player name -> safe database document id.
  function keyFor(name) {
    let out = '';
    for (const ch of String(name)) {
      if (/[A-Za-z0-9_-]/.test(ch)) out += ch;
      else out += '~' + ch.codePointAt(0).toString(16) + '.';
    }
    return ('p' + out).slice(0, 190);
  }

  const VF = {
    KEYS, POS_GROUPS, STATS, STAT_BY_KEY, TYPES,
    blank, addInto, toArr, fromArr, num, splitHands, parseHand, positions, handStats,
    analyze, buildDocs, aggregateDocs, derive, classify, exploits, targetScore, heroLeaks,
    readStrength, keyFor, fmtStat
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = VF;
  else root.VF = VF;
})(typeof window !== 'undefined' ? window : this);
