# Trivium

A fast multiple-choice quiz for two to eight players.  The rules players see are in `rules.md`; the module contract is
in `../../MODULES.md`.  Two things make it unlike the other games on the site:

1. **It is all clock.**  There is no "ready", no "continue", and no pop-up between rounds.  A question is up for a
   fixed time and then closes, the reveal plays itself out, and the next wheel spins by itself.  Everything is one of
   the room server's scheduled actions (`nextAction` in `server.js`), soonest first.
2. **Every answer carries where and when.**  The server records which button, *whereabouts on that button* the finger
   landed (`x` and `y`, as fractions of it), and how long the player took.  The time decides the speed bonus and the
   order of the reveal; the spot decides where that player's marker comes to rest.

The game defines no achievements of its own yet, so it has the two every game gets without asking (played, won).  It
does keep twelve counters (`tally.js`, declared in `module.json`), most of them hidden, so that whatever achievements
are chosen later already have a history behind them.

## Layout

- `module.json` the menu entry, player limits (2 to 8), and the statistics it reports.
- `rules.md` the player-facing rules, shown by the site's Help button.
- `game.js` the pure rules and what each player may see: no sockets, no files, no network.
- `wheel.js` the spinner: wedges weighed by how many questions each category holds, and where the wheel stops.  Both
  the rules (which choose) and the table (which draws) read it, so the wedge under the pointer is always the category
  the server picked.
- `scoring.js` what a question is worth, and what counts as a snap answer, a dead-centre tap and an edge tap.
- `tally.js` the per-player counters behind the statistics, and behind any achievement added later.
- `server.js` the socket half: the room server, the clock work, and the questions.
- `testing.js` a bank of made-up questions for the tests (`TRIVIUM_TRIVIA=test`), so no test touches the web.
- `ai/` the computer players, one file each plus `ai/index.js`; `ai/judgement.js` is the thinking they share.
- `client/` the Vue half; `client/index.js` exports `Trivium.vue`.
- `locales/en.json` every word a player reads, merged under `trivium.` (see "Languages" in `../../MODULES.md`).
- `views.js` plays whole seeded games and records every view, for `view.test.js` and `client/render-all.test.js`.

## The phases of a room

```
lobby  ->  spin  ->  question  ->  reveal  ->  (next question of the round, or the next spin, or finished)
```

- **spin** the wheel turns for `spinMs`.  `server.js` asks `shared/trivia.js` for the round's questions of the
  category it stopped on the moment it starts turning, so they are in hand long before it stops.
- **question** up for `answerMs`, or until everybody who is going to answer has.  A player's *first* press is their
  answer.  "Going to answer" leaves out a computer player whose plan is `null` — it chose to pass when the question
  went up, so waiting for it would sit the table out the rest of the clock for nothing.  A person is always waited
  for, connected or not: the deadline is what they are up against.
- **reveal** `revealStep` milliseconds per answer while the markers travel, one more step before the right answer
  lights up, then `revealHold`.
- A round that cannot be dealt at all (the API down and the bank empty) ends the quiz on the scores it has, or
  abandons it if it had not asked anything yet (`giveUp`).

## Where the questions come from

`shared/trivia.js` only: The Trivia API and the site's own bank, mixed by how many each holds.  `game.js` never
fetches anything — `server.js` hands a round's questions to `game.deal(room, questions)`, exactly as Scribblers'
`server.js` fetches a picture for its computer players to draw.  The same counts, read once through `store.sources()`,
are what `wheel.js` cuts the wedges by; they are refreshed in the background and a room still in its lobby takes the
newest ones (`game.setWheel`).

The rest of a round's questions live in `room.deck` and are never sent to anybody; the one that is up is sent without
its `correct` field until the question has closed.  `view.test.js` and `robustness.test.js` both check that.

## Computer players

An AI is asked `answer(context, rng)` and replies with plain data: `{ choice, x, y, speed }`, or `null` to let the
question go by.  `speed` is a fraction of the time allowed, which `game.js` turns into the moment that player's answer
arrives; every bot's answer is decided the instant the question goes up (`planBots`) and stored on the player, so a
restart changes nothing and a seeded game replays exactly.

The context includes which answer is right.  That is deliberate: there is no hidden hand here, and an AI that had to
work a trivia answer out from the words would know everything or nothing.  Each AI rolls against its own confidence,
by difficulty, and picks a wrong answer when it loses the roll — see the head of `ai/judgement.js`.

## Scoreboard

Every question is appended to `room.history` as `{ label, deltas, notes }` (the shape in `shared/scores.js`), where
the label and the notes are **messages** (`{ key, params? }`, `shared/messages.js`), never English.  The pop-up
between rounds is switched off (`:round-popups="false"` on `ScoreBoard`): this game never stops for one.  The full
table is still there behind "All rounds", and opens by itself at the end.

## The board

`client/layout.js` places every rectangle from the pixels the frame gives the table, and nothing from the game, so
nothing moves while it is played.  That is what lets a marker be animated from a name chip to a point inside a
button: both ends are numbers the table already knows.  `client/useReveal.js` turns the server's "how far into the
reveal this room is" into how many markers have landed, re-anchored to the local clock on every view, so somebody who
arrives in the middle of a reveal joins it where everybody else is.

## Timing

All of it can be changed through the environment, which is how the tests make a quiz take a second:
`TRIVIUM_ANSWER_MS`, `TRIVIUM_SPIN_MS`, `TRIVIUM_REVEAL_STEP`, `TRIVIUM_REVEAL_HOLD`, `TRIVIUM_GRACE_MS`, and
`TRIVIUM_TRIVIA=test` for the made-up questions.  The values are copied into the room when it is made, so a room
keeps the timing it was started with.

## Tests

`game.test.js`, `wheel.test.js`, `tally.test.js` and `view.test.js` need nothing but the rules.  `server.test.js`,
`lifecycle.test.js` and `robustness.test.js` run the real site through `shared/testkit.js`.  `client/Table.test.js`
mounts the table on a fake socket, and `client/render-all.test.js` draws every view of whole seeded games.

A note on the socket tests: `server.js` reads its timings as the site loads it, so a test sets them just before
`launchModule`.  A phase being attacked must not move on halfway through, which is why `robustness.test.js` starts a
site per group of scenes rather than one for all of them.
