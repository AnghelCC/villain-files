#!/usr/bin/env python3
"""Generate a realistic GGPoker-format NLHE 6-max cash session ($0.05/$0.10).

Nine opponents with different styles rotate through one table with Hero, so the
tracker has real differences to find. Decisions follow hand strength (Chen
preflop score, made-hand category postflop) shaped by each style's tendencies.

Usage: python make_sample.py [--hands 700] [--seed 7] [--out ../sample-session.txt]
"""
import argparse
import datetime
import itertools
import random
from collections import Counter

RANKS = '23456789TJQKA'
SUITS = 'shdc'
DECK = [r + s for r in RANKS for s in SUITS]
SB, BB = 5, 10  # cents

ARCH = {
    'nit':     dict(open=0.11, limp=0.0,  call=0.05, tb=0.025, f3=0.70, fb=0.06, cb=0.55, cb2=0.40, fcb=0.62, rcb=0.04, fcb2=0.60, xr=0.04, stab=0.15, rivercall=0.30, bluff=0.05),
    'rock':    dict(open=0.13, limp=0.04, call=0.12, tb=0.02,  f3=0.62, fb=0.05, cb=0.45, cb2=0.35, fcb=0.55, rcb=0.04, fcb2=0.55, xr=0.04, stab=0.15, rivercall=0.40, bluff=0.05),
    'tag':     dict(open=0.22, limp=0.005, call=0.08, tb=0.08, f3=0.55, fb=0.14, cb=0.64, cb2=0.50, fcb=0.46, rcb=0.09, fcb2=0.48, xr=0.10, stab=0.35, rivercall=0.45, bluff=0.30),
    'lag':     dict(open=0.32, limp=0.01, call=0.10, tb=0.12,  f3=0.45, fb=0.20, cb=0.75, cb2=0.60, fcb=0.40, rcb=0.14, fcb2=0.42, xr=0.14, stab=0.50, rivercall=0.50, bluff=0.45),
    'fish':    dict(open=0.10, limp=0.20, call=0.24, tb=0.03,  f3=0.45, fb=0.04, cb=0.45, cb2=0.40, fcb=0.38, rcb=0.05, fcb2=0.40, xr=0.05, stab=0.25, rivercall=0.60, bluff=0.15),
    'station': dict(open=0.08, limp=0.30, call=0.38, tb=0.02,  f3=0.30, fb=0.03, cb=0.35, cb2=0.30, fcb=0.18, rcb=0.03, fcb2=0.22, xr=0.03, stab=0.20, rivercall=0.80, bluff=0.10),
    'maniac':  dict(open=0.48, limp=0.05, call=0.12, tb=0.22,  f3=0.25, fb=0.28, cb=0.88, cb2=0.75, fcb=0.25, rcb=0.25, fcb2=0.30, xr=0.22, stab=0.65, rivercall=0.55, bluff=0.65),
    # Hero: a decent regular with two leaks (over-c-betting, over-folding to 3-bets)
    'hero':    dict(open=0.22, limp=0.0,  call=0.06, tb=0.05,  f3=0.68, fb=0.08, cb=0.82, cb2=0.45, fcb=0.45, rcb=0.07, fcb2=0.50, xr=0.06, stab=0.35, rivercall=0.50, bluff=0.30),
}
POOL = ['tag', 'tag', 'lag', 'nit', 'rock', 'fish', 'fish', 'station', 'maniac']
POSF = {'UTG': 0.6, 'HJ': 0.8, 'CO': 1.1, 'BTN': 1.6, 'SB': 1.2, 'BB': 1.0}
LABELS = {6: ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'], 5: ['SB', 'BB', 'HJ', 'CO', 'BTN'],
          4: ['SB', 'BB', 'CO', 'BTN'], 3: ['SB', 'BB', 'BTN']}
CAT_NAMES = ['High Card', 'a Pair', 'Two Pair', 'Three of a Kind', 'a Straight',
             'a Flush', 'a Full House', 'Four of a Kind', 'a Straight Flush']


def chen(a, b):
    r1, r2 = RANKS.index(a[0]), RANKS.index(b[0])
    hi, lo = max(r1, r2), min(r1, r2)
    base = {12: 10, 11: 8, 10: 7, 9: 6}.get(hi, (hi + 2) / 2)
    if r1 == r2:
        return max(base * 2, 5)
    s = base + (2 if a[1] == b[1] else 0)
    gap = hi - lo - 1
    s -= {0: 0, 1: 1, 2: 2, 3: 4}.get(gap, 5)
    if gap <= 1 and hi < 10:
        s += 1
    return s


def build_pct():
    cnt = Counter(chen(a, b) for a, b in itertools.combinations(DECK, 2))
    total = sum(cnt.values())
    pct, better = {}, 0
    for sc in sorted(cnt, reverse=True):
        pct[sc] = (better + cnt[sc] / 2) / total
        better += cnt[sc]
    return pct


PCT = build_pct()


def hand_pct(cards):
    return PCT[chen(cards[0], cards[1])]


def rank5(cards):
    rs = sorted((RANKS.index(c[0]) for c in cards), reverse=True)
    flush = len({c[1] for c in cards}) == 1
    uniq = sorted(set(rs), reverse=True)
    straight = None
    if len(uniq) == 5:
        if uniq[0] - uniq[4] == 4:
            straight = uniq[0]
        elif uniq == [12, 3, 2, 1, 0]:
            straight = 3
    counts = sorted(((rs.count(r), r) for r in uniq), reverse=True)
    if straight is not None and flush:
        return (8, straight)
    if counts[0][0] == 4:
        return (7, counts[0][1], counts[1][1])
    if counts[0][0] == 3 and counts[1][0] == 2:
        return (6, counts[0][1], counts[1][1])
    if flush:
        return (5,) + tuple(rs)
    if straight is not None:
        return (4, straight)
    if counts[0][0] == 3:
        return (3, counts[0][1]) + tuple(r for _, r in counts[1:])
    if counts[0][0] == 2 and counts[1][0] == 2:
        return (2, counts[0][1], counts[1][1], counts[2][1])
    if counts[0][0] == 2:
        return (1, counts[0][1]) + tuple(r for _, r in counts[1:])
    return (0,) + tuple(rs)


def board_cat(board):
    counts = sorted(Counter(c[0] for c in board).values(), reverse=True)
    if counts[0] >= 4:
        return 7
    if counts[0] == 3:
        return 6 if len(counts) > 1 and counts[1] >= 2 else 3
    if counts[0] == 2:
        return 2 if len(counts) > 1 and counts[1] == 2 else 1
    return 0


def best(cards):
    if len(cards) <= 5:
        return rank5(cards)
    return max(rank5(list(c)) for c in itertools.combinations(cards, 5))


def money(c):
    return '$' + f"{c / 100:.2f}".rstrip('0').rstrip('.')


class Player:
    def __init__(self, name, arch, stack):
        self.name, self.arch, self.stack = name, arch, stack


def play_hand(rng, seats, button, hid, when):
    n = len(seats)
    seat_nums = [s for s, _ in seats]
    bi = seat_nums.index(button)
    order = [seats[(bi + 1 + i) % n][1] for i in range(n)]  # SB, BB, ..., BTN
    sbp, bbp, btn = order[0], order[1], order[-1]
    pre_order = order[2:] + order[:2]
    pos = {p.name: lab for p, lab in zip(order, LABELS[n])}
    by_name = {p.name: p for p in order}

    deck = DECK[:]
    rng.shuffle(deck)
    hole = {p.name: [deck.pop(), deck.pop()] for p in order}
    board = [deck.pop() for _ in range(5)]

    L = [f"Poker Hand #HD{hid}: Hold'em No Limit ($0.05/$0.1) - {when:%Y/%m/%d %H:%M:%S}",
         f"Table 'NLHGold17' 6-max Seat #{button} is the button"]
    for s, p in seats:
        L.append(f"Seat {s}: {p.name} ({money(p.stack)} in chips)")

    inv = {p.name: 0 for p in order}
    comm = {p.name: 0 for p in order}
    folded, allin, fold_street = set(), set(), {}
    ctx = {'rc': 0, 'opener': None, 'last': None, 'tb': None, 'limpers': 0, 'pfa': None,
           'cb_flop': False, 'cb_turn': False, 'bets': 0, 'bettor': None, 'checked': set(),
           'pfa_flop': False, 'pfa_turn': False}

    def commit(p, amt):
        amt = max(0, min(amt, p.stack))
        p.stack -= amt
        inv[p.name] += amt
        comm[p.name] += amt
        if p.stack == 0:
            allin.add(p.name)
        return amt

    def alive():
        return [p for p in order if p.name not in folded]

    def board_now(street):
        return board[:{'flop': 3, 'turn': 4, 'river': 5}[street]]

    def size(frac):
        pot = sum(inv.values())
        return max(BB, int(round(pot * frac)))

    def decide(p, street, current, to_call):
        A = ARCH[p.arch]
        me, ps = p.name, pos[p.name]
        r = rng.random()
        if street == 'pre':
            pct = hand_pct(hole[me])
            rc = ctx['rc']
            open_t = min(0.95, A['open'] * POSF[ps])
            if rc == 0:
                limpers = ctx['limpers']
                if ps == 'BB':
                    if pct < A['open'] * 0.5:
                        return 'raise', BB * (4 + limpers)
                    return 'check', 0
                if limpers == 0:
                    if pct < open_t:
                        return 'raise', (BB * 3 if ps == 'SB' else int(BB * 2.5))
                    if pct < open_t + A['limp'] * POSF[ps]:
                        ctx['limpers'] += 1
                        return 'call', 0
                    return 'fold', 0
                if pct < open_t * 0.75:
                    return 'raise', BB * (4 + limpers)
                if pct < open_t + A['limp'] * 1.5:
                    ctx['limpers'] += 1
                    return 'call', 0
                return 'fold', 0
            if rc == 1:
                steal = pos.get(ctx['opener']) in ('CO', 'BTN', 'SB') and ps in ('SB', 'BB')
                mult = 2.2 if ps == 'BB' else (1.4 if ps == 'SB' else 1.0)
                if steal:
                    mult *= 1.5
                tb = A['tb'] * (1.3 if steal else 1.0)
                if pct < tb:
                    return 'raise', current * (4 if ps in ('SB', 'BB') else 3)
                if pct < tb + A['call'] * mult:
                    return 'call', 0
                return 'fold', 0
            if rc == 2:
                if me == ctx['opener']:
                    rel = pct / max(0.01, open_t)
                    if rel < A['fb']:
                        return 'raise', int(current * 2.3)
                    if rel < 1 - A['f3']:
                        return 'call', 0
                    return 'fold', 0
                return ('call', 0) if pct < 0.015 else ('fold', 0)
            if rc == 3:
                if me == ctx['tb']:
                    rel = pct / max(0.01, A['tb'])
                    if rel < 0.3:
                        return 'raise', p.stack + comm[me]
                    if rel < 0.55:
                        return 'call', 0
                    return 'fold', 0
                return ('call', 0) if pct < 0.01 else ('fold', 0)
            return ('call', 0) if pct < 0.03 else ('fold', 0)

        cat = best(hole[me] + board_now(street))[0]
        if cat <= board_cat(board_now(street)):
            cat = 0  # the board makes the hand, not our cards
        made = 2 if cat >= 2 else (1 if cat == 1 else 0)
        bets = ctx['bets']
        if to_call <= 0:
            if street == 'flop' and me == ctx['pfa'] and bets == 0 and not ctx['pfa_flop']:
                ctx['pfa_flop'] = True
                if r < A['cb'] + (0.08 if made else -0.05):
                    ctx['cb_flop'] = True
                    return 'bet', size(rng.choice([0.33, 0.5, 0.66]))
                return 'check', 0
            if street == 'turn' and me == ctx['pfa'] and ctx['cb_flop'] and bets == 0 and not ctx['pfa_turn']:
                ctx['pfa_turn'] = True
                if r < A['cb2'] + (0.15 if made == 2 else (0.0 if made else -0.1)):
                    ctx['cb_turn'] = True
                    return 'bet', size(0.66)
                return 'check', 0
            if made == 2:
                prob = 0.65 + A['stab'] * 0.3
            elif made == 1:
                prob = 0.25 + A['stab'] * 0.5
            else:
                prob = A['stab'] * 0.5 if street != 'river' else A['bluff'] * 0.6
            if r < prob:
                return 'bet', size(0.6 if street != 'river' else 0.75)
            return 'check', 0

        checked_before = me in ctx['checked']
        if bets >= 2:
            if made == 2:
                return ('raise', current * 3) if r < 0.2 else ('call', 0)
            if made == 1:
                return ('call', 0) if r < 0.4 + (0.3 if p.arch in ('station', 'fish') else 0) else ('fold', 0)
            return ('fold', 0) if r < 0.9 else ('call', 0)
        facing_cb = street == 'flop' and ctx['cb_flop'] and ctx['bettor'] == ctx['pfa'] and me != ctx['pfa']
        facing_cb2 = street == 'turn' and ctx['cb_turn'] and ctx['bettor'] == ctx['pfa'] and me != ctx['pfa']
        if facing_cb:
            fold_p = {0: min(0.97, A['fcb'] * 1.7), 1: A['fcb'] * 0.45, 2: 0.02}[made]
            raise_p = {0: A['rcb'] * 0.8, 1: A['rcb'] * 0.6, 2: A['rcb'] * 2.5}[made]
        elif facing_cb2:
            fold_p = {0: min(0.97, A['fcb2'] * 1.7), 1: A['fcb2'] * 0.5, 2: 0.02}[made]
            raise_p = {0: 0.03, 1: 0.03, 2: 0.2}[made]
        elif street == 'river':
            cp = A['rivercall']
            fold_p = {0: 1 - cp * 0.15, 1: 1 - cp * 0.85, 2: 0.03}[made]
            raise_p = {0: A['bluff'] * 0.1, 1: 0.02, 2: 0.25}[made]
        else:
            fold_p = {0: 0.82 * (1 - A['stab'] * 0.3), 1: 0.3, 2: 0.02}[made]
            if p.arch == 'station':
                fold_p *= 0.6
            raise_p = {0: A['bluff'] * 0.12, 1: 0.04, 2: 0.25}[made]
        if checked_before and street == 'flop':
            raise_p = max(raise_p, A['xr'] * (2.0 if made == 2 else 0.7))
        if r < raise_p:
            return 'raise', current * 3
        if r < raise_p + fold_p:
            return 'fold', 0
        return 'call', 0

    def betting(seq, street):
        ctx['bets'], ctx['bettor'], ctx['checked'] = 0, None, set()
        current = max(comm.values()) if street == 'pre' else 0
        need = {p.name for p in seq if p.name not in folded and p.name not in allin}
        i = 0
        while need and len(alive()) > 1:
            p = seq[i % len(seq)]
            i += 1
            if p.name not in need:
                continue
            need.discard(p.name)
            if p.name in folded or p.name in allin:
                continue
            to_call = current - comm[p.name]
            others = [q for q in alive() if q.name != p.name and q.name not in allin]
            if to_call <= 0 and not others:
                continue
            act, to = decide(p, street, current, to_call)
            if act == 'check' and to_call > 0:
                act = 'fold'
            if act == 'call' and to_call <= 0:
                act = 'check'
            if act in ('bet', 'raise') and not others:
                act = 'call' if to_call > 0 else 'check'
            if act == 'fold':
                folded.add(p.name)
                fold_street[p.name] = street
                L.append(f"{p.name}: folds")
            elif act == 'check':
                ctx['checked'].add(p.name)
                L.append(f"{p.name}: checks")
            elif act == 'call':
                amt = commit(p, to_call)
                L.append(f"{p.name}: calls {money(amt)}" + (" and is all-in" if p.name in allin else ""))
            else:
                target = min(to, comm[p.name] + p.stack)
                if target <= current:
                    amt = commit(p, to_call)
                    L.append(f"{p.name}: calls {money(amt)}" + (" and is all-in" if p.name in allin else ""))
                    continue
                inc = target - current
                commit(p, target - comm[p.name])
                ai = " and is all-in" if p.name in allin else ""
                if current == 0:
                    L.append(f"{p.name}: bets {money(target)}{ai}")
                else:
                    L.append(f"{p.name}: raises {money(inc)} to {money(target)}{ai}")
                current = target
                ctx['bets'] += 1
                ctx['bettor'] = p.name
                if street == 'pre':
                    ctx['rc'] += 1
                    ctx['last'] = p.name
                    if ctx['rc'] == 1:
                        ctx['opener'] = p.name
                    if ctx['rc'] == 2:
                        ctx['tb'] = p.name
                need = {q.name for q in seq if q.name != p.name and q.name not in folded and q.name not in allin}
        # Return any uncalled part of the biggest bet
        if comm:
            top = max(order, key=lambda q: comm[q.name])
            second = max([comm[q.name] for q in order if q is not top] + [0])
            if comm[top.name] > second:
                ret = comm[top.name] - second
                top.stack += ret
                inv[top.name] -= ret
                comm[top.name] -= ret
                allin.discard(top.name)
                L.append(f"Uncalled bet ({money(ret)}) returned to {top.name}")
        for q in order:
            comm[q.name] = 0

    commit(sbp, SB)
    L.append(f"{sbp.name}: posts small blind {money(SB)}")
    commit(bbp, BB)
    L.append(f"{bbp.name}: posts big blind {money(BB)}")
    L.append("*** HOLE CARDS ***")
    for _, p in seats:
        L.append(f"Dealt to {p.name} [{' '.join(hole[p.name])}]" if p.name == 'Hero' else f"Dealt to {p.name} ")

    betting(pre_order, 'pre')
    ctx['pfa'] = ctx['last']
    dealt = 0
    for street, k in (('flop', 3), ('turn', 4), ('river', 5)):
        if len(alive()) <= 1:
            break
        dealt = k
        if street == 'flop':
            L.append(f"*** FLOP *** [{' '.join(board[:3])}]")
        elif street == 'turn':
            L.append(f"*** TURN *** [{' '.join(board[:3])}] [{board[3]}]")
        else:
            L.append(f"*** RIVER *** [{' '.join(board[:4])}] [{board[4]}]")
        if len([p for p in alive() if p.name not in allin]) >= 2:
            betting(order, street)

    L.append("*** SHOWDOWN ***")
    remaining = alive()
    pot = sum(inv.values())
    rake = min(int(pot * 0.05), 3 * BB) if dealt else 0
    winnings = {}
    showdown = len(remaining) > 1
    if not showdown:
        winnings[remaining[0].name] = pot - rake
    else:
        for p in remaining:
            L.append(f"{p.name}: shows [{' '.join(hole[p.name])}] ({CAT_NAMES[best(hole[p.name] + board)[0]]})")
        names_left = {p.name for p in remaining}
        levels = sorted({inv[nm] for nm in names_left if inv[nm] > 0})
        prev = 0
        for idx, lv in enumerate(levels):
            amount = sum(min(v, lv) - min(v, prev) for v in inv.values())
            if idx == 0:
                amount -= rake
            elig = [nm for nm in names_left if inv[nm] >= lv]
            ranks = {nm: best(hole[nm] + board) for nm in elig}
            top = max(ranks.values())
            ws = [nm for nm in elig if ranks[nm] == top]
            share = amount // len(ws)
            for j, nm in enumerate(ws):
                winnings[nm] = winnings.get(nm, 0) + share + (amount - share * len(ws) if j == 0 else 0)
            prev = lv
    for nm, amt in winnings.items():
        by_name[nm].stack += amt
        L.append(f"{nm} collected {money(amt)} from pot")

    L.append("*** SUMMARY ***")
    L.append(f"Total pot {money(pot)} | Rake {money(rake)} | Jackpot $0 | Bingo $0 | Fortune $0 | Tax $0")
    if dealt:
        L.append(f"Board [{' '.join(board[:dealt])}]")
    where = {'pre': 'before Flop', 'flop': 'on the Flop', 'turn': 'on the Turn', 'river': 'on the River'}
    for s, p in seats:
        tag = ' (button)' if p is btn else (' (small blind)' if p is sbp else (' (big blind)' if p is bbp else ''))
        if p.name in folded:
            L.append(f"Seat {s}: {p.name}{tag} folded {where[fold_street[p.name]]}")
        elif showdown:
            desc = CAT_NAMES[best(hole[p.name] + board)[0]]
            if p.name in winnings:
                L.append(f"Seat {s}: {p.name}{tag} showed [{' '.join(hole[p.name])}] and won ({money(winnings[p.name])}) with {desc}")
            else:
                L.append(f"Seat {s}: {p.name}{tag} showed [{' '.join(hole[p.name])}] and lost with {desc}")
        else:
            L.append(f"Seat {s}: {p.name}{tag} won ({money(winnings.get(p.name, 0))})")
    return L


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hands', type=int, default=700)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--out', default='sample-session.txt')
    ap.add_argument('--start', default='2026-11-24 20:05:00')
    ap.add_argument('--show-styles', action='store_true')
    args = ap.parse_args()

    rng = random.Random(args.seed)
    used = set()

    def new_id():
        while True:
            x = '%08x' % rng.getrandbits(32)
            if x not in used:
                used.add(x)
                return x

    pool = [Player(new_id(), a, 1000) for a in POOL]
    hero = Player('Hero', 'hero', 1000)
    seats = {4: hero}
    free = [1, 2, 3, 5, 6]
    bench = pool[:]
    rng.shuffle(bench)
    for s in free:
        seats[s] = bench.pop()
    button = 1
    hid = 2048000000 + rng.randint(0, 900000)
    t = datetime.datetime.strptime(args.start, '%Y-%m-%d %H:%M:%S')
    out = []
    for h in range(args.hands):
        for p in seats.values():
            if p.stack < 500:
                p.stack = 1000
        if h and bench and rng.random() < 1 / 40:
            s = rng.choice([x for x in seats if seats[x] is not hero])
            leaving = seats[s]
            seats[s] = bench.pop(rng.randrange(len(bench)))
            bench.append(leaving)
        ordered = sorted(seats.items())
        if button not in seats:
            button = ordered[0][0]
        out.append('\n'.join(play_hand(rng, ordered, button, hid, t)))
        nums = [s for s, _ in ordered]
        button = nums[(nums.index(button) + 1) % len(nums)]
        hid += rng.randint(1, 4000)
        t += datetime.timedelta(seconds=rng.randint(35, 95))
    with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n\n\n'.join(out) + '\n')
    if args.show_styles:
        for p in pool:
            print(p.name, p.arch)


if __name__ == '__main__':
    main()
