# Nomination Whist simulations

Run everything from the `platform` folder. Both runners use every core but one and are seeded: the same seed and options
give the same results.

## Whole games between AIs: `tourney.js`

```
node modules/nomination-whist/sim/tourney.js --games 100000 --ai standard,counter,cautious,optimist
```

`--ai` has one entry per seat (3 to 7 seats; AI ids are listed by `--help`). Seats are rotated from game to game and the
first dealer is random, so position favours nobody. It plays the full 7..1,1..7 game (`--short` for 7..1), with 10 for
making a nomination plus the nomination, one point per trick on a miss, and the instant win (nominate 7 and take all 7
tricks in the first or last round wins the game on the spot; `--no-instant-win` turns it off). The table shows each AI's
mean score, win share (ties split), nomination hit rate, average nomination and tricks, and instant wins.

`--jokers` shuffles the two Jokers in (see `rules.md`; the rules live in `../trick.js`).

About 4,000 games a second with the quick AIs on a 24-thread machine; `sharp` is far slower.

- `game.js` plays a round or a whole game with any AIs and an optional `observe` callback for every decision. AI contexts
  are those of the live game plus `scores`, `round` and `rounds`.
- `tournament.js` totals a range of games per AI (what the workers run, and what the tests call).

## Single deals and tables: `run.js`

Plays single deals for any players x cards x trump combination and counts card win rates, hand estimates against tricks
taken, and nomination hit rates (`--help` for the options; `--dump` writes every hand for training a model).

## The bidding table: `train-bids.js` and `models/bidding.json`

```
node modules/nomination-whist/sim/run.js --deals 20_000_000 --players 3-7 --out sim-out/whist      # about two minutes
node modules/nomination-whist/sim/train-bids.js --players 3-7 --in sim-out/whist                  # writes models/bidding.json
```

For each player count (3 to 7), number of cards and trump suit, the table holds the chance of taking each number of tricks
for a hand of a given estimated worth (the Standard AI's `estimateTricks`, in quarters of a trick), smoothed over
neighbouring estimates where the data is thin. The `lut` AI (`ai/lut.js`) nominates the allowed number with the best expected
score from that row, so the dealer's forbidden number and the scoring options are applied when it plays. `lut` is in the
simulation AI list (`ais.js`) but not in the live game's (`ai/index.js`) yet.

`tourney.js --ai lut,standard,lut,standard` compares it with Standard; with the 20 million deals it beats Standard at every
player count, by more as players are added (7 players, 100,000 games: 110 against 101 mean score).

## The play table: `train-play.js` (experimental, no table shipped)

```
node modules/nomination-whist/sim/train-play.js --players 3-7 --iterations 3 --deals 20_000_000 --fresh
```

Self-play learning of a card-play lookup table. Every seat plays the current table (Standard's play to start with), a few
plays are replaced by a random legal card (`--epsilon`), and only those random plays are recorded, with the points the round
turned out to be worth to the player (a random card is the only unbiased way to measure what a play is worth). Averaging
gives a value for each key from `play-features.js`: my need and slack, players after me, trumps or not, who is winning the
trick and whether they want it, how many players after me want a trick or have made their number, and the card's role,
whether it beats the table, whether it is a trump and how many unseen cards outrank it. The table (`models/play.json` and
`play.bin`, 3.8 MB, a fine and a coarse level) is read by `ai/lut.js`; without the files the AI plays as Standard does.

**Result so far:** it does not help. After 20 million deals per iteration, with 30% and then 3% random plays, the table
plays no better than Standard's rules, and worse than Lookup's bidding table with Standard play (4 players: 94.3 against
Standard's 95.0, where bidding alone scores 97.1 against 95.7), and extra iterations do not change that. So no `play.*`
files are committed. Likely reasons: the keys do not say which cards the hand keeps for later (so a "good" play now may
wreck the rest of the hand), they ignore the scores, and Standard's rules already play these situations well. Next steps
worth trying are a richer hand description in the key, or a play AI that targets rivals directly using the scores.

## The bidding table with table state: `train-bids-context.js` and `models/bidding-context.json`

```
node modules/nomination-whist/sim/train-bids-context.js --players 3-7 --deals 100_000_000      # about 8 minutes
```

The same idea as the plain bidding table, but each cell also knows where you sit and what the players before you did:

- **key**: Standard's estimate of the hand in quarters of a trick; in a one-card round the card itself.
- **unclaimed**: the cards dealt minus the tricks the players before have already nominated (clamped to -2): a hand is worth
  more when they nominated low.
- **after**: exactly how many players still nominate after you (0 is the dealer). The first to nominate leads the first
  trick, and the dealer plays last, so this is your table position.

Why the card itself in a one-card round: with 3 players and no trumps, whoever leads wins unless one of the two other cards is
a higher card of the same suit, which for even a deuce is only 42% likely. So the leader should nominate 1 whatever the card
(winning 58% or more beats the 50% break-even); `sim.test.js` checks the table says so for all 52 cards. It does not hold with
trumps: a low side card leading in a 3-player trump round wins about 26% of the time.

The `lutc` AI reads the table (falling back to the plain one for cells nobody reached), and the suggested nomination shown to
people on their turn comes from it. Over 10 million games of `lutc` against `lut` (standard card play, 2 million per player
count, odd counts split between both seat mixes), `lutc` wins at every count; its mean score is higher by about 3.5 at 3
players, 4.0 at 4, 2.7 at 5, 1.6 at 6 and 1.2 at 7 (for example, 4 players: 99.9 against 95.9, win share 28.7% against 21.3%).

Games with the strongest card player, `lutc-sharp` against `lut-sharp` in `tourney.js`, run at only about 38 games a second
(Sharp simulates inside every card it plays), roughly 500 times slower than the others, so those comparisons use thousands of
games, not millions. With Sharp's card play on every seat (20,000 games at 3 and 4 players, 10,000 at 5 to 7), `lutc-sharp`
still beats `lut-sharp` at every count, by about the same margins: 3.0 at 3 players, 3.5 at 4, 2.4 at 5, 1.3 at 6 and 1.0 at 7
(4 players: 100.9 against 97.4, win share 28.2% against 21.8%), so the table trained on Standard's play carries over to strong play.

### With the Jokers

A Joker is worth most of a trick and changes what every other hand is worth, so games with Jokers have their own table:

```
node modules/nomination-whist/sim/train-bids-context.js --players 3-7 --deals 100_000_000 --jokers      # models/bidding-context-jokers.json
```

`lutc` (and the suggested nomination) read `bidding-context-jokers.json` when the game has Jokers and `bidding-context.json`
when it does not; the two files are trained separately and neither affects the other. In a one-card round the key can be a
Joker, whose chance of taking the trick leading is far above a deuce's. `lutc-plain` is `lutc` held to the no-Jokers table even
in a Jokers game, the baseline for the Jokers table. Without a Jokers table file the suggestion is simply not offered in a Jokers game.

## The bid-value table: `train-values.js` and `models/bidding-values.json`

```
node modules/nomination-whist/sim/train-values.js --players 3-7 --deals 200_000_000 --iterations 2 --min-n 100     # about 35 minutes
node modules/nomination-whist/sim/train-values.js --players 3-7 --deals 200_000_000 --iterations 1 --min-n 100 --jokers   # bidding-values-jokers.json
```

The earlier tables estimate how many tricks a hand tends to take if it nominates the usual number and plays to it, then score
each nomination against that one distribution. That is wrong whenever the nomination changes how you play: nominating 1 with the
queen of trumps and a deuce, and nominating 0 and trying to duck, are different games. This table learns what **each nomination is
worth**: every deal is played with the table's best nomination by all the seats but one, which nominates a random allowed number
instead, then everybody plays to what they nominated (Standard's card play), and for every nomination of every seat the cell of
the decision, the number nominated and the tricks taken are counted. A nomination made by the table depends only on its cell and
the others are random, so the average for a nomination in a cell is what it is worth there.

The cell (`value-features.js`):

- **hand**: for one or two cards the exact cards, each as its rank and whether it is a trump (the suit itself does not matter, and
  neither does which suit is trumps), plus whether a pair share a suit; from three cards the Standard estimate in quarters of a trick.
  (The estimate rounds a queen of trumps and a low trump with a lucky side card to the same half-trick, which is how the older
  table came to advise nominating 0 with the queen of trumps.)
- **unclaimed** and **after**: as in the table-aware table (tricks the earlier players left unclaimed, and your exact position).
- **regime**: trumps or no trumps.

Each entry is the chance of hitting the nomination and the tricks taken on a miss, so the AI (`lutv`) scores a nomination as
`pHit x (10 + n) + tricks on a miss` (or without the last part if a miss scores nothing) and nominates the best allowed number;
it falls back to `lutc` where the table has no entry. Two iterations (the second playing the first's table) gave the same result.

Over 200,000 games per player count against `lutc` (standard card play): 3 players 92.3 against 90.0, 4 players 98.7 against 96.5,
5 players 103.6 against 100.1, 6 players 107.2 against 104.5, 7 players 109.9 against 107.5. For the queen of trumps with a
low card on a 2-card round (7 players, first to nominate) it values nominating 1 at 8.9 points and nominating 0 at 2.8; with the
queen and a low heart, nominating 2 (6.2) beats 1 (5.1).

## The last chance (`ai/endgame.js`)

In the last round with the instant win on, a player who cannot win on points (even 17, the most a round gives, leaves them behind
the best of the others) can only win by nominating 7 and taking all 7 tricks, so there is nothing to lose. This is not a rule that
forces a nomination: every card's weight in the hand estimate is turned up (`LAST_CHANCE_BOOST`, added in `estimateTricks`, and
`countTricks`), so even a mediocre hand reads as very strong. **If those boosted weights give a nomination of 7, the player nominates
7 and then plays for every trick; if they do not (a dealer who may not nominate 7, say) the boost is dropped and the player nominates
as usual**, because a 6 can no more win the game than a 0. `withLastChance(ctx, decide)` does this for every AI (the table-based
AIs read the boosted hand straight from its weights rather than from their tables, which are about points); Random ignores it.
The person is told in their Status box, only when 7 really is what is suggested.
