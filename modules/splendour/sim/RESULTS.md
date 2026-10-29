# Engine against Rush: does the best way to play depend on the target score?

Two ways of playing Splendour, played against each other by the game's own rules engine (see `strategies.js`):

- **Engine** builds first. Until it has bought a set number of cards (8 unless stated) it buys the cheapest cards it can, in the colours that will discount the expensive cards it wants later. Then it switches to buying points.
- **Rush** never builds. It spends its gems on cards worth points (any card worth 1+ points unless stated) from the first turn.

They share all of the code for taking gems, reserving, giving tokens back and choosing nobles, and both only aim at cards they could really pay for. The only difference between them is which cards they buy. Every deal was played twice with the players swapping seats, so luck of the deal and the advantage of going first cancel out. Wins that tie count as halves. Run `node modules/splendour/sim/run.js <experiment>` to repeat any of this (`head`, `sizes`, `rushes`, `mirror`, `tables`, `strength`, `scan`).

## The deck matches the real game on average

Compared card by card with the published real card list (two open-source copies of it agree exactly):

| | real game | this version |
| --- | --- | --- |
| Level 1: 40 cards | cost 4.13, points 0.13 | identical |
| Level 2: 30 cards | cost 6.83, points 1.83 | cost 6.67, points 1.83 |
| Level 3: 20 cards | cost 10.75, points 4.00 | identical |
| Whole deck | 585 gems, 140 points | 580 gems, 140 points |

The only difference is that the real level 2 has ten cost-8 cards where this version has five (and more cost-7 ones). The real nobles could not be fetched, so they are unchecked: this version has five 4+4 and five 3+3+3 tiles, all worth 3.

## Main result (two players, 12,000 games per row)

| target | Engine wins | rounds | Engine's average game | Rush's average game |
| ---: | ---: | ---: | --- | --- |
| 10 | **31.4%** | 22.8 | 7.7 pts from 10.8 cards, 6.4 of them worth nothing | 9.6 pts from 5.9 cards |
| 15 | **61.7%** | 28.1 | 14.7 pts from 13.6 cards, 0.31 nobles | 13.0 pts from 7.6 cards |
| 20 | **84.2%** | 31.5 | 20.8 pts from 15.7 cards, 0.74 nobles | 15.7 pts from 8.9 cards |

(95% error bars are under 1 point.) At 10 points the Engine has not built enough when the game ends, and at 20 it buys points about twice as fast as Rush.

## Where the two are even

Win rate of Engine (8 cards first) against Rush, two players, 6,000 games per cell:

| target | vs Rush (1+ point cards) | vs Rush (2+ point cards) |
| ---: | ---: | ---: |
| 10 | 30.8% | 49.7% |
| 11 | 37.8% | 57.4% |
| 12 | 44.1% | 63.9% |
| 13 | **51.0%** | 70.7% |
| 14 | 56.9% | 76.5% |
| 15 | 62.2% | 81.6% |
| 16 | 68.1% | 85.1% |
| 17 | 73.2% | 87.8% |
| 18 | 77.0% | 91.4% |
| 19 | 81.6% | 93.8% |
| 20 | 83.6% | 95.1% |

The Engine gains about 6 points of win rate for every point added to the target. Against a Rush that buys any card with points (including the cheap 1-point cards), they are even at **13 points**. Against a Rush that only buys 2+ point cards they are even at **10**. Rush that buys only 3+ point cards loses at every target (Engine wins 75% at 10, 95% at 15).

## How long to build the engine

Win rate against Rush (1+), two players, 5,000 games per cell. Size 0 is Rush itself.

| cards built first | 10 points | 15 points | 20 points |
| ---: | ---: | ---: | ---: |
| 0 | **48.5%** | 50.1% | 49.2% |
| 2 | 46.9% | 55.3% | 59.8% |
| 4 | 42.5% | 59.9% | 73.2% |
| 6 | 36.1% | 61.8% | 80.2% |
| 8 | 31.5% | **62.5%** | 83.8% |
| 10 | 26.1% | 62.3% | 85.2% |
| 12 | 24.0% | 59.1% | **86.1%** |

The best amount of building rises with the target: none at 10, about 8 at 15, 12 or more at 20. At 15 the curve is flat between 6 and 10 cards.

## Other checks

- **Going first** is worth 51 to 53% (mirror matches, 6,000 games per cell), at every target and for both strategies, so it does not distort the results.
- **More players** (each deal in every seating). Engine and Rush win about the same share at 12 to 13 points; at 15 the Engine side leads clearly:

  | table | target | Engine wins (per player) | Rush wins (per player) |
  | --- | ---: | ---: | ---: |
  | 3 players: 1 Engine, 2 Rush | 10 / 15 / 20 | 26.8% / 61.6% / 84.5% | 36.6% / 19.2% / 7.8% |
  | 3 players: 2 Engine, 1 Rush | 10 / 15 / 20 | 19.8% / 37.5% / 46.4% | 60.4% / 25.1% / 7.3% |
  | 4 players: 2 Engine, 2 Rush | 10 / 15 / 20 | 14.6% / 34.1% / 45.7% | 35.4% / 15.9% / 4.3% |

- **Against the game's strongest computer player** ("sharp", which balances the two and looks one move ahead), 3,000 games per cell: Engine wins 27% / 32% / 26% at 10 / 15 / 20 points and Rush wins 34% / 16% / 6%.

## Limits of this

- Both players are simple rules of thumb, not expert humans. The strongest computer player beats each of them about 70% of the time or more, so the results show how the two *plans* compare, not how the best players would fare. A skilled Rush player who reserves cards to block, times purchases and uses gold well would do better than this one.
- "Rush" has to be defined somehow, and the answer is sensitive to it (see the table above: buying 1+ point cards or 2+ point cards moves the even point from 13 to 10 points).
- The Engine's 8-card switch point is a round number. At 15 points anything from 6 to 10 is about as good.
- Most results are for two players.
