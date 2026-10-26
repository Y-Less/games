# Rummikub computer players (AIs)

## Purpose and how bots get an AI

A Rummikub computer player is not a single fixed program: each one plays with an AI, a named way of choosing its turn.
The shared registry helpers live in `shared/ai.js`; this folder holds the Rummikub AIs and `ai/index.js` lists them in
the exported `AIS` array. The search they use is in `search.js`, and `bot.js` picks the seat's AI, asks it for a play
and sends it through the same rules check (`rules.checkPlay`) a person's move goes through. If a plan is ever refused,
or an AI has no plan, the computer simply draws, so a game always goes on.

- **At game start.** `game.start` deals, then calls `assignAIs(AIS, botSeats, rng)` with the game's own seeded `rng`.
  Every bot seat gets one AI by weighted random pick (`shared/ai.js`), and keeps it for the whole game. The id is
  stored on the seat (`room.seats[i].ai`), so it survives a restart. A new game draws again.
- **Replacement bots.** When a person leaves a game in progress, the bot that takes the seat picks with
  `pickAI(AIS, rng)` at that moment. In the lobby nothing is chosen.
- **Old rooms.** A seat with no `ai`, or one naming an AI that no longer exists, falls back to the first AI in the list
  (`standard`, via `aiById`). That is why `standard` must stay first.
- **View.** Once the game has started, the view gives each bot seat `seats[].ai = { id, name, description }` (from
  `describeAI`). People's seats have none, and the decision functions are never sent.

## The AIs

| id | name | weight | summary |
| --- | --- | --- | --- |
| `standard` | Classic | 1 | The original bot: may take the whole table apart and rebuild it, playing whatever uses the most points. |
| `shuffler-5` | Tidy (moves up to 5 table tiles) | 1 | Adds to sets and makes new ones; moves at most five tiles already on the table per turn. |
| `shuffler-10` | Rearranger (10) | 1 | The same, with a budget of ten table tiles. |
| `shuffler-20` | Juggler (20) | 1 | The same, with a budget of twenty table tiles. |
| `sharp` | Sharp | 1 | Plays as many tiles as it can, holds jokers back, and races when someone is nearly out. |
| `random` | Random | 0.5 | Plays one random legal move, or draws. |

## How each one decides

**Classic (`standard`).** Before its first meld it looks for new sets from its own rack that together reach the meld
threshold. After that it considers two things: taking every tile on the table plus its rack and rebuilding the whole
table to use as many rack points as possible (a joker counts as 30), and making new sets from the rack alone. It tries
the best-scoring candidates in order and plays the first one the rules accept. It values points, not tile count, so it
will happily leave small tiles in its rack. Its search stops at 6000 nodes (`SEARCH_BUDGET`); on a big table that cap is
hit and the answer may be poor. That behaviour is kept as the original bot's.

**Tidy, Rearranger and Juggler (`shuffler-5`, `-10`, `-20`).** These share one implementation (`shuffler.js`) and
differ only in the table-tile budget (`tableTiles`). Before melding they behave like Classic. Afterwards they choose
which table tiles to free (taking a tile out of its set, or taking a whole set apart), solve for the freed tiles plus
the rack, add leftover rack tiles to the sets left in place, and keep the best legal result. They try the cheapest
choices first, in an order that does not depend on the budget, so a bigger budget only ever looks at more choices after
the same ones a smaller budget looked at. A tile counts as moved when it is taken out of its set or its whole set is
taken apart, so the budget slightly over-charges, but consistently. Limitations: they cannot find a play that needs
more table tiles moved than the budget, and the search is bounded (see below), so a huge table may be only partly
explored. They value points like Classic.

**Sharp (`sharp`).** It uses the unlimited search of Classic and also every way of moving up to 20 table tiles, but it
scores differently. Every tile played is worth the same large amount, so it plays the most tiles it can and goes out
when it can. Among equal plays it prefers to get rid of awkward tiles near the ends of the number range and keep the
flexible middle ones. A joker is held back unless it is part of a play of at least four tiles, lets it go out, or is
the only way to make its first meld. If an opponent has three tiles or fewer left, or the pool is empty, it stops
holding jokers back and plays high tiles first. Limitations: it still draws when only a joker would make a small play
possible, and it is only as thorough as the search limits allow.

**Random (`random`).** Before its first meld it picks random disjoint three-tile sets from its rack until they reach
the meld threshold, and draws if it cannot. After that it lists every new three-tile set from its rack and every single
rack tile that can be added to a set on the table, and plays one of them at random, so it plays at most one set or one
tile per turn. It never rearranges the table. If it has no legal move it draws. When no `rng` is supplied it uses a
small seeded generator, so a game stays repeatable.

## How strong are they?

A tournament of 60 six-player games, rotating every AI through every seat:

| AI | win rate | tiles per game | score |
| --- | --- | --- | --- |
| standard | 0.133 | 11.18 | -8.3 |
| shuffler-5 | 0.133 | 10.1 | -7 |
| shuffler-10 | 0.2 | 11.77 | 14.5 |
| shuffler-20 | 0.2 | 11.33 | 18.2 |
| sharp | 0.317 | 11.7 | 38.5 |
| random | 0.017 | 6.58 | -56 |

A separate 180-game offline run gave: sharp 0.267 win rate with a score of 34.2, random 0.002 with -61.4, and Classic
0.117 with -11.1.

- Sharp is the clear winner and Random is clearly last. `ai.test.js` asserts that every other AI beats Random on tiles
  played, score and win rate, and that Random wins under 10% of games.
- Full games are too noisy to show a clean 5 < 10 < 20 ordering. The budget shows up more clearly on single positions.
  On 210 real-game positions the points played at budgets 5, 10 and 20 were 2759, 2782 and 2798, so a bigger budget is
  never worse (the test asserts this position by position). On a constructed position that needs 8 table tiles moved,
  budget 5 draws while 10 and 20 play (so does Classic).
- Classic scores low because its search hits the 6000-node cap on big tables; that is kept as the original behaviour.
- Search is bounded by node counts, not the clock: 800 nodes per solve, 20,000 per turn and 120 choices considered
  (`SHUFFLE_LIMITS`), so a turn is quick and repeatable for a given position.

## Adding an AI

1. Create `ai/<id>.js` with a default export `{ id, name, description, weight, plan }`. The `id` is lowercase and
   unique, and is saved in rooms, so do not rename it casually. `weight` defaults to 1; `0` keeps it out of the random
   pool (it can still be set by id in tests).
2. `plan(room, seat, options)` returns `{ table, added, value }` (the whole proposed table as arrays of tile ids, and
   how many rack tiles it plays) or `null` to draw. `options` may carry `rng` (a `() => number` in [0, 1)) and
   `budget`. Use the supplied `rng`, never `Math.random`, so seeded games and tests repeat. Keep the file free of
   sockets and files, and make `plan` a pure function of its arguments: anything to remember must be in the room.
3. Use only what the seat may know: `room.settings`, `room.table`, its own rack `room.racks[seat]`, the other racks
   only by length, the length of `room.pool`, `room.melded` and so on. Do not read other players' tiles. The plan is
   checked by `rules.checkPlay` anyway, but peeking would still be cheating.
4. Reuse `search.js` (`standardAttempts`, `shuffleAttempts`, `meldAttempts`, `firstLegal`) and the helpers in `rules.js`
   rather than writing a new search, and bound any work by node counts, not the clock. To add another budget level,
   call `makeShuffler({ id, name, description, tableTiles })` from `shuffler.js`.
5. Add it to the list in `ai/index.js`, keeping `standard` first (the fallback for old rooms).
6. Update `ai.test.js`: the `IDS` list and the registry test, so the new AI is also played in the whole-game and
   tournament tests, and add a test for whatever makes it distinctive.
