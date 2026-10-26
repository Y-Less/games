# Azulejo computer players (AIs)

## Purpose and how bots get an AI

Computer players in Azulejo come in several styles, from one that plays out whole rounds in its head to one that takes any
legal move. The registry is `ai/index.js` (built with `defineAIs` from `shared/ai.js`); the first entry, `standard`, is the
original bot and the fallback.

- When a game starts, every bot seat is given an AI by a weighted random pick (`assignAIs` in `shared/ai.js`), using the
  game's own seeded `rng`. The deal is unchanged by it. Playing again clears the AIs and the next game picks afresh.
- The choice is stored on the seat as `seat.ai`, so it survives a save, a restart and a reconnection.
- A bot that takes over from a human who leaves mid-game picks its AI at that moment. Bots added in the lobby have none
  until the game starts.
- A seat with no `ai` (a room saved before AIs existed) or an unknown id plays as `standard` (`aiById`, via `aiOf` in
  `game.js`).
- The view shows `seats[].ai = { id, name }` for bot seats once the game has started, and nothing else about the AI.

## The AIs

| id | Name | Weight | Summary |
| --- | --- | --- | --- |
| `standard` | Standard | 4 | The classic: scores each move by wall points earned, floor risked and tiles kept from opponents. |
| `sharp` | Sharp | 3 | Plays its best few moves out to the end of the round and decides when the game should end. |
| `greedy` | Greedy | 2 | Takes whatever scores the most wall points right now. |
| `row-finisher` | Row finisher | 1.5 | Races to complete a row and end the game early. |
| `colour-collector` | Colour collector | 1.5 | Builds for colour sets and full columns. |
| `denier` | Denier | 1.5 | Takes the tiles its opponents are waiting for. |
| `random` | Random | 0.5 | Any legal move, floor included. |

## How each one thinks

An AI supplies `chooseMove(state, seat, moves, rng)`, which returns one of the legal `{ source, colour, line }` moves (the
line may be `'floor'`), and `chooseColumn(state, seat, pending, rng)`, which picks the wall column for a tile when the
choice is the player's (a free wall). Every move scores with a little random jitter.

**Standard.** For each legal move it works out what the tile would score on the wall (the placement score, plus small
credits for a fuller row, column and colour set, and bonuses for completing a row, column or set), taking a share of that for
a line that is only part-built, scaled by how likely it is that enough tiles of that colour remain to finish it. It subtracts
the extra floor penalty, adds a small credit for taking the first-player marker, and adds a little for denying colours that
an opponent is partway through a line of. Limits: it never considers when the game ends, which is why standard-only games
always last exactly five rounds, and it looks only at the move in front of it, not at what the table will look like when
the round is over.

**Sharp.** Values a whole position: the points its full pattern lines will score when the wall is tiled in row order, minus the
real floor penalty, plus a discounted share for part-built lines that can still be finished (or a small deduction for tiles
stuck on a line that can never finish), plus progress towards the end-of-game bonuses, weighted down while the game may go
on. It ranks every move this way, then plays the best six out to the end of the round twice each (everyone else taking a
quick sensible move), and picks the one that leaves it best placed against the average of the others, counting an
opponent's gain at half weight. It also decides when the game should end: completing a row ends the game, so it goes for one
if that leaves it ahead after the bonuses and declines when it would be behind, building columns and sets instead. Limits:
the play-outs assume the other players follow a simple policy, it does not know what the refill of the factories will hold,
and it only looks to the end of the current round. Two sharp players deny each other.

**Greedy.** Scores a move only by the wall points it earns now if it completes a line (less the floor penalty), and a token
amount otherwise. It never plans for bonuses and never blocks anyone.

**Row finisher.** Favours the rows that are fullest and the short pattern lines that fill fast, with a heavy bonus for
completing the last place in a row, and puts up with some floor (0.6 times the penalty). Limits: it ignores columns and
sets, and ends the game whether or not it is ahead.

**Colour collector.** Weights the colour-set and column progress (and their big bonuses) heavily and the immediate wall
score at 0.4. Feeds colours it already has most of and the fullest columns. Limits: slower points, and no interest in
blocking.

**Denier.** Values taking tiles an opponent needs to finish a pattern line, especially the last of a colour they are
building, so that they overflow on to their floor. Its own board comes second (floor at 0.8 times, wall at a reduced
weight). Limits: it gives up too many points of its own to deny others.

**Random.** Picks any legal move uniformly, floor included, and any legal column. It often fills its own floor.

## How strong are they?

These are results of seeded tournaments (all-bot games), as mean score and win rate.

- 3 players, 240 games: sharp 65.2 points and 67% wins, standard 58.5 and 33%, random 0.8 and 0%.
- 2 players: sharp 59.5 and 89% against standard 41.3 and 11%.
- 4 players: sharp 55.4 and 49%, standard 51.8 and 28%, greedy 49.0 and 21%, denier 34.1 and 3%.
- Standard-only games always last exactly five rounds. In sharp-only 2-player games, roughly 12 to 20% run past five
  rounds (the longest is seven).
- Two sharp players score less each (about 35) than two standard players (about 54), because they deny each other.

`ai.test.js` asserts the ordering rather than the numbers: with 3 players (240 games) sharp beats standard beats random on
both mean score and win rate; with 2 players (200 games) sharp wins more than 60% and has the better mean; with 4 players
(120 games) sharp beats standard on mean and win rate, and standard beats denier on mean score. It also checks that over 60
sharp-only 2-player games none ends before five rounds and some run longer, and that all 30 standard-only games last exactly
five.

## Adding an AI

1. Add `modules/azulejo/ai/<id>.js` whose default export is `{ id, name, description, weight, chooseMove(state, seat,
   moves, rng), chooseColumn(state, seat, pending, rng) }`. `id` is lowercase and unique (it is saved on seats, so do not
   rename it later). `weight` is optional and defaults to 1; `0` keeps an AI out of the random pool.
2. Add it to the list in `ai/index.js`. Keep `standard` first.
3. `chooseMove` returns `{ source, colour, line }` taken from one of `moves` (`source` is a factory index or `'centre'`,
   `line` a pattern line index or `'floor'`), or `null` if there are none. `chooseColumn` returns one of `pending.columns`.
   Every move must be legal; the game rejects an illegal one.
4. `state` is the snapshot built by `snapshot()` in `bot.js` (described at the top of `ai/common.js`): `size`, `settings`
   (`freeWall`), `round`, `first`, `scores`, `factories`, `centre`, `markerInCentre`, `lines`, `walls`, `floors`, `lid` and
   `bagCount` (a count only). It never includes the bag's contents, and the tests check this. Use plain data only; do not
   reach for the room. A pending column choice is `{ row, colour, columns }`.
5. Use only the `rng` you are given, never `Math.random`, so seeded games and tests repeat.
6. `ai/common.js` has helpers (`takeOf`, `tableAfter`, `bestColumnBy`, `chooseColumnBy`, `tilesLeft`, `newDeadCells` and others),
   and `standard.js` exports `columnValue` and `moveValue` for AIs that build on it.
7. Add the id to `ai.test.js`: whole games at every player count, legality over many positions, and a test of its
   distinguishing trait. `ai-support.js` has `playBotGame` and `tournament`.
