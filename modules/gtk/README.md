# GTK (Getting To Know)

A party game for 3 to 8 players.  Each round is about one player: they answer two questions about themselves truthfully,
everybody else invents an answer to the same two, and then everybody but the subject tries to spot the true one.  Points
go to whoever finds the truth, and to whoever's invention is mistaken for it.

The player's rules are in `rules.md`; this file is for whoever is working on the module.

## The files

| | |
| --- | --- |
| `module.json` | the menu card, the statistics the game records, and its achievements |
| `questions.js` | the 265 questions (each in a "your" and a "{name}'s" form) and the answer pools the computer players write from; this is content, so it is left out of the i18n checks like Just One's `words.js`.  They run from the everyday (food, holidays, school) through the daft (aliens, desert islands, spies, your porn star name) to two dozen about other people ("Who would you trust with a secret?"), whose answers are deliberately open: the people at the table are only some of the answers anybody might give |
| `game.js` | the rules: a room is a plain object, every action returns `{ ok }` or `{ ok: false, error }`, nothing here knows about sockets or files |
| `server.js` | a short call to `createRoomServer` (`shared/roomServer.js`): the settings it accepts, its three own socket events, and what the server does by itself |
| `tally.js` | the per-player counters behind the statistics and achievements |
| `ai/` | the computer players (`standard`, `sharp`, `random`) |
| `client/` | the Vue half: `Gtk.vue` (the screens), `Lobby.vue`, `Table.vue`, `moveLog.js` (Recent moves, worked out from the views) |
| `views.js` | plays whole seeded games and records every view, for `view.test.js` and `client/render-all.test.js` |

## The shape of a round

`phase` runs `lobby` → (`writing` → then a `picking`/`reveal` pair for each question) per round → `finished`.  Every
question of the round is answered in one `writing` phase; the `picking`/`reveal` pairs then work through them, which is
why the room carries `question` (0-based, below `room.questionsPerRound`) beside `round`.

The host sets three things, all of them in `pickSettings` and all refused once the game has started: `roundsEach`,
`questionsPerRound` (1 to 4, default 2) and `seconds` (15 to 180 in steps of 15, default 60).

Three things about the rules are worth knowing before changing them:

- **Answers that come to the same thing are one option.**  `normal()` in `questions.js` compares them (capitals,
  punctuation, a leading article and a plural "s" are ignored), so two players who write "Carrots" share an option and
  both score when somebody falls for it.
- **A made-up answer that matches the truth joins the true option.**  Its author scores `POINTS.matched` and is not
  asked to pick that question (`toPick` leaves them out).  That is what keeps a question from deadlocking when
  everybody happens to write the true answer: `openPicking` scores it the moment it opens if nobody is left to pick.
- **You can never pick an answer you wrote**, which the server enforces (`mayPick`) as well as the table.
- **Writing and picking are on a clock.**  `room.deadline` is an absolute time set by `startRound` and `openPicking`
  and cleared by `scoreQuestion`; the view turns it into `remaining` milliseconds and the table counts it down with
  `useTurnClock`.  When it passes, `server.js` calls `fillTimedOut`, which writes from the question's pool or picks at
  random for whoever is left, exactly as a computer player would.  **Every path that opens a timed phase must be handed
  the clock** — `start`, `submitAnswers`, `runBotAction`, `ready`, `forceNext` and the roster's `takeOver` all take a
  `now`, because a deadline left at the default of 0 is one that passed in 1970 and the phase times out the instant it
  begins.  `game.test.js` pins each of those paths.
- **"Drive-by"** is the one achievement that is about somebody other than the player who earns it, and it is meant to
  be very rare: `namedBy()` finds the players whom *every other player in the room* answered with — the subject's true
  answer is their name and so is every made-up one — and bumps `namedAsTruth` for them.  Names are compared as plain
  text with capitals and surrounding spaces ignored and nothing else (deliberately not `normal()`: this is a name, not
  an answer being matched with another).  It is worked out in `scoreQuestion`, never earlier: a note or a counter
  moving while a question was still open would tell somebody the answer.  Naming yourself does not count, so the
  subject is left out.

## Tests

`npm test` runs them all; the module's own are:

| | |
| --- | --- |
| `game.test.js` | the rules, phase by phase |
| `tally.test.js` | the counters |
| `questions.test.js` | the content: unique ids, every pool present, both forms of every question |
| `invariants.test.js` | hundreds of seeded games of random legal and illegal play; every room and view must stay sound and leak nothing |
| `view.test.js` | the views of whole seeded games are the same every time, and say whom the game waits for |
| `ai.test.js` | every AI plays whole games legally, each shows its trait, and the choice is saved and restored |
| `server.test.js` | a whole game over real sockets against the real site, and the statistics it records |
| `lifecycle.test.js` | restarts, two sockets for one account, people going away, the host leaving |
| `robustness.test.js` | garbage on every socket event in every phase |
| `client/Table.test.js` | what each player sees and what the controls send |
| `client/render-all.test.js` | every view of whole games drawn by the real table |

Timing is read from the environment, so the tests make it fast: `GTK_BOT_DELAY` ("min-max" ms before a computer player
acts) and `GTK_NEXT_WAIT` (ms the reveal waits for everybody to close the scores).
