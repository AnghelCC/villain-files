# Villain Files

A No-Limit Hold'em cash-game study tool with two parts:

1. **Opponent profiles from hand histories.** Import PlayGG / GGPoker (PokerCraft) or PokerStars-format hand histories and every opponent gets about 20 stats (VPIP, PFR, 3-bet, c-bet, fold to c-bet, WTSD and more), a player type (nit, TAG, LAG, loose-passive, calling station, maniac) and specific exploits.
2. **Odds lab.** Monte Carlo equity against opponent ranges, pot odds, the expected value of a call and a verdict, plus a replay that grades every decision in a hand you played.

It's built for studying **after** you play. It never connects to a poker client or reads live tables. Online poker sites restrict third-party software, so check your site's terms before using any tracker.

## Try it

**Public demo (no account needed): https://anghelcc.github.io/villain-files/**

The demo opens with a simulated 700-hand sample session. You can import your own hand histories there too; they stay in your browser tab and are never uploaded or saved.

The owner's saved version runs as a Claude artifact (https://claude.ai/artifact/7zSattLeaeCqisecKR64Ah), where imports and notes are kept in the artifact's own storage. Only people the owner shares it with can open that one.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The app: players, import, imports, my game and odds views |
| `engine.js` | Hand-history parser, stat counters, player types and exploit rules |
| `odds.js` | Hand evaluator, Monte Carlo equity, preflop ranges, range narrowing, pot odds and EV |
| `sample-session.txt` | 700 simulated hands at $0.05/$0.10 (no real players) |
| `tools/make_sample.py` | Generates the simulated session with nine opponents of different styles |
| `tools/rank_hands.js` | Ranks the 169 starting hands by equity against a random hand |
| `tools/test_engine.js` | Parser and stats tests (hand-built edge cases plus the full sample) |
| `tools/test_odds.js` | Evaluator, equity, narrowing and decision-maths tests |
| `tools/build_site.py` | Builds the public website into `docs/` |
| `docs/` | The built website served by GitHub Pages |

## How the numbers are worked out

- **Hand strength:** every 5-to-7-card hand gets one score, its category times 13^5 plus its kickers in base 13, so comparing hands is comparing numbers.
- **Equity:** Monte Carlo simulation with card removal. Each opponent is dealt a hand from their range, the board is completed at random, and wins and split pots are counted. 30,000 trials give about ±0.3 points. Results are checked against exact enumeration of every runout.
- **Ranges:** the 169 starting hands are ordered by all-in equity against a random hand. "Top X%" takes the best hands until X% of the 1,326 combos is reached. A tracked player's range width comes from their VPIP (caller), PFR (raiser) or 3-bet % (3-bettor).
- **Narrowing:** after a postflop bet the range keeps made hands, draws and about 30% bluffs; after a raise it keeps two pair or better, top pair or an overpair, strong draws and about 10% bluffs.
- **Hand probabilities:** exact enumeration of all 19,600 flops, every turn and river card, and all 1,081 turn-and-river pairs from the flop. The preflop-to-river table is simulated with 60,000 boards. A hand counts only if the hole cards make it better than the board alone. Tests check the counts against textbook formulas, for example a pocket pair flopping a set or better 12.0% of the time and a flush draw completing by the river 34.97%.
- **Pot odds:** the equity needed to call is `to call ÷ (pot + to call)`.
- **EV of calling:** `equity × (pot + to call) − to call`.
- **Limits:** equity assumes the hand is checked down. It ignores implied odds, fold equity, position and rake. The narrowing rules are a simple model, not a solver.

## Running the tests

Needs Node.js 18+ and Python 3.

```
node tools/test_engine.js sample-session.txt
node tools/test_odds.js
```

Regenerate the simulated session (the seed makes it repeatable):

```
python tools/make_sample.py --hands 700 --seed 7 --out sample-session.txt
```

## Building the website

`index.html` is written as page content for a Claude artifact, which adds the HTML document wrapper when it's published. `tools/build_site.py` adds that wrapper and copies everything the site needs into `docs/`, which GitHub Pages serves:

```
python tools/build_site.py
```

Run it again after changing `index.html`, `engine.js` or `odds.js`, then commit `docs/`.

To try the site locally, serve `docs/` and open http://localhost:8000:

```
python -m http.server 8000 --directory docs
```
