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
