# Gaudi computer players (AIs)

## Purpose and how bots get an AI

Computer players in Gaudi come in several styles, from a careful points-counter to one that places dice at random. The
registry is `ai/index.js` (built with `defineAIs` from `shared/ai.js`); the first entry, `standard`, is the original bot and
the fallback.

- When a game starts, every bot seat is given an AI by a weighted random pick (`assignAIs` in `shared/ai.js`), using the
  game's own seeded `rng`. It is done last, so the deal is unchanged. Playing again clears the AIs and the next game picks
  afresh.
- The choice is stored on the seat as `seat.ai`, so it survives a save, a restart and a reconnection.
- A bot that takes over from a human who leaves mid-game picks its AI at that moment (`newBot` is given the rng). Bots
  added in the lobby have none until the game starts.
- A seat with no `ai` (a room saved before AIs existed) or an unknown id plays as `standard` (`aiById`, via `aiOf` in
  `game.js`).
- The view shows `seats[].ai = { id, name }` for bot seats once the game is out of the lobby, and nothing else about the AI.

## The AIs

| id | Name | Weight | Summary |
| --- | --- | --- | --- |
| `standard` | Standard | 4 | The classic: likes hard windows, fills restricted spaces first, chases the objectives, uses a tool only when stuck or clearly worth it. |
| `sharp` | Sharp | 3 | Values every placement in expected points, including the cost of spaces it might leave empty. |
| `private-chaser` | Private chaser | 1.5 | Hunts its secret colour at high shades, spending tokens to raise them. |
| `public-hunter` | Public hunter | 1.5 | Builds for the shared objectives and mostly ignores its secret colour. |
| `tidy` | Tidy | 1.5 | Plays for a full window: never boxes in a space, takes the easiest window. |
| `tool-user` | Tool user | 1.5 | Takes the hardest window and spends favour tokens freely. |
| `random` | Random | 0.5 | A random legal placement, no tools, random window. |

## How each one thinks

An AI supplies `chooseWindow(options, rng)` (which of the offered windows to take) and `chooseStep(state, seat, rng)` (one
step of a turn: place a die, use a tool, or end the turn). All but `standard` and `random` share a scoring skeleton in
`ai/common.js` (`chooseStep`): each AI supplies a score for every legal (die, cell), plus a tool policy (`never`, `stuck` or
`eager`, with how much a token is worth and how big an improvement it needs). Jitter is added to every score.

**Standard.** Takes the window with the highest difficulty plus a little randomness (more restrictions give more favour
tokens). Each placement scores one point for filling a space, plus the change in public-objective points, plus 0.8 times
the change in private-objective points, plus 2.5 for filling a restricted space, minus 7 per newly dead space (a space
nothing could ever fill), minus a penalty for repeating a colour or shade in a row or column when a rainbow or tonal
objective is on show, and a small bonus for starting in a corner. It uses a tool only when it has nothing to place, or
when a tool beats the best plain placement by at least 5 points and it holds at least 3 tokens. When stuck it can use the
lathe, mirror, free pane or exchange, and as a last resort re-fire or the Great Kiln. Limits: it counts only finished
objective points (not progress), and uses few tools.

**Sharp.** Values each placement as expected points: the change in private points, plus the change in public-objective
potential (finished sets exactly, unfinished lines and sets by progress), plus a reward for filling a space that was hard to
fill and a charge for making a neighbouring space harder (using a model of how likely each space is to be filled by some die
in about six chances), minus 4 per dead space, plus a small bonus for each other pool die that still has somewhere to go
(capped at three). A favour token is treated as worth one point, so it uses the lathe or mirror when the result beats the
best plain placement by more than 0.6 plus the cost, and may spend down to its last token. It chooses the window by
difficulty minus the empty spaces its restrictions are expected to leave. Tools: it uses the lathe and mirror whenever they
pay. Exchange and Free Pane are used only when it has no legal placement, and re-fire and the Great Kiln only if nothing else
works. It never uses the Slide Rule, Twin Slide, Tint Shifter, Gauge Breaker or Track Echo, and no AI in this folder does.
Limits: its look-ahead is shallow (only whether the other dice in the pool can still be placed), and it does not model what
other players want from the pool or the track.

**Private chaser.** Picks its window at random. Weights its private-objective gain at three times and public points at 0.4,
so it takes dice of its secret colour at high shades. It is willing to use tools (lathe, mirror, exchange) when they improve
a placement by 1.5 or more beyond cost, keeping at least one token. Limits: it undervalues the shared objectives and still
avoids dead spaces only by a flat penalty.

**Public hunter.** Picks the window with the fewest restricted spaces (plus randomness), then scores public-objective
progress at three times, private at 0.3, and penalises dead spaces. It uses tools only for a gain of 2 or more beyond cost,
and keeps two tokens in reserve. Limits: it gives its secret colour little thought, and an easy window yields fewer tokens.

**Tidy.** Picks the easiest window. Scores each placement only on keeping the window fillable: a bonus for filling a hard
space, a charge for each neighbour whose chance of being filled falls, and a heavy penalty (25) per dead space. It ignores
objectives entirely and uses a tool only with no legal placement at all. Limits: it gives up the objectives and so scores
poorly.

**Tool user.** Takes the hardest window for the most favour tokens. It scores placements with the standard player's
measure, but treats a token as worth only 0.7, so it uses the lathe, mirror, exchange or free pane whenever one improves on
the best plain placement by 0.5 or more beyond cost, down to its last token. Limits: it has no sense of when a token would
be better saved.

**Random.** Picks a random window, then a uniformly random legal placement of a random pool die. It never uses a tool, even
when stuck, and ends its turn when nothing can be placed.

## How strong are they?

These are results of seeded tournaments (all-bot games), as mean score and win rate.

- 3 players: sharp 55.3 points and 80% wins, standard 46.5 and 21%, random 23.9 and 0%.
- 2 players: sharp 51.8 and 83% against standard 40.5 and 17%.
- 5 players: sharp 58.5 and 56%, standard 50.5 and 15%, public hunter 53.3 and 20%, private chaser 45.9 and 8%, tidy 36.7
  and 2%.

`ai.test.js` asserts the ordering rather
than the numbers: with 3 players (200 games) sharp beats standard beats random on both mean score and win rate; with 2
players sharp has the better mean and wins more than 60%; with 5 players (120 games) sharp beats standard on mean and win
rate, and standard beats tidy on mean score, because tidy gives up the objectives.

## Adding an AI

1. Add `modules/gaudi/ai/<id>.js` whose default export is `{ id, name, description, weight, chooseWindow(options, rng),
   chooseStep(state, seat, rng) }`. `id` is lowercase and unique (it is saved on seats, so do not rename it later); the
   test requires a description of more than 20 characters and a weight above 0.
2. Add it to the list in `ai/index.js`. Keep `standard` first.
3. `chooseWindow` returns one of the pattern ids in `options`. `chooseStep` returns one of `{ type: 'place', die, cell }`,
   `{ type: 'tool', tool, params }` or `{ type: 'end' }`, and must end the turn once `state.turn.placements` reaches its
   limit (one, or two when `state.turn.extra`). Every step must be a legal move: the game rejects an illegal one and the bot
   throws.
4. `state` is the snapshot built by `snapshot()` in `bot.js` (described at the top of `ai/common.js`): `seat`, `size`,
   `settings`, `round`, `order`, `turnIndex`, `turn`, `pool`, `track`, `tools`, `spent`, `tokens`, `grids`, `patterns`,
   `publicIds` and `privateColour`. It holds no bag, no other seat's secret colour or window choices, and the tests check
   this. Use plain data only; do not reach for the room.
5. Use only the `rng` you are given, never `Math.random`, so seeded games and tests repeat.
6. The quickest route is `chooseStep(state, seat, rng, policy)` from `ai/common.js`: give it a `score(state, seat, die,
   cell, options, context)` and a tool policy, and it handles placing, ending and tool candidates. `legalCells`,
   `fillChance`, `newDeadSpaces`, `publicPotential` and the other helpers there are available.
7. Add the id to `ai.test.js`: legality over many positions, whole games at every player count, and a test of its
   distinguishing trait. `ai-support.js` has `playBotGame` and `tournament`.
