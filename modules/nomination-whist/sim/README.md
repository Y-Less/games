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
