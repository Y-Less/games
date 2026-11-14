# Draw!

A competitive draw-and-guess game: **two** players draw at once and everybody else races to name either drawing.
`rules.md` is what the players read; this file is what a developer needs.  The module contract is in `../../MODULES.md`
and the walkthrough for a first module is in `../../TUTORIAL.md`.

The module's id is `draw`, which is also the name of one of its socket events.  They are different layers — a
namespace, and an event within it — and never meet, so neither needs renaming.

## What makes it different from Scribblers

Scribblers is one drawer and a room full of guessers.  Draw! is a race between two drawings, which changes four
things, and those four are most of what this module is:

| | Scribblers | Draw! |
| --- | --- | --- |
| drawers a turn | one | **two**, each with their own word |
| what a guesser sees | one board | **both boards, the same size**, and one box to type in |
| scoring | everybody who guesses scores, and the drawer gets a share | **only** the drawer whose drawing was named and the guesser who named it, a point each |
| the length of a game | rounds × players | **every pair of players**, `cycles` times over |

It is also meant to be quick, which is why there are no letters revealed, ten seconds to pick a word (the first pick
of a game alone is untimed, and waits for both drawers), and no scores to close between turns: `<ScoreBoard>` is given `round-popups="false"`, so the only pop-up is the final one and the
one the "All rounds" button opens.  What a guesser does get is the shape of each word — one blank per letter, and the
spaces and hyphens — over the board it belongs to, in both the drawer's view and the guesser's.

## The parts

| | |
| --- | --- |
| `pairings.js` | who draws against whom, and in what order (below) |
| `game.js` | the rules: rooms, turns, choosing, guessing, scoring, the views.  No sockets, no files, no canvas |
| `tally.js` | the counters kept for each player, for the statistics and achievements |
| `ai.js` | the one computer player: which word to draw, and what to guess |
| `server.js` | the socket layer: the shared room server, the clock work of a turn, and the two stroke relays |
| `client/` | the table: the two boards, the toolbox, the guesses panel |

The drawing itself is not here.  It is the site's, shared with Scribblers:

- `shared/drawing.js` — what a drawing is made of, and what the server will accept into one
- `shared/picture.js` — a word turned into something a computer player can draw
- `shared/words.js`, `shared/words/en.txt` — the word list, and comparing a typed guess with a word
- `src/components/DrawingBoard.vue`, `src/drawBoard.js` — the canvas, the brush and the flood fill

The interface is translated (`locales/en.json` and the three beside it), but that word list is not: whatever language
the screen is in, the words drawn and guessed are English ones, as they are in Scribblers.

## Who draws against whom

Every pair of players draws together once, or `cycles` times over, and **nobody draws three turns running** — drawing
is work, and three in a row is a chore rather than a game.

`pairings.js` gets that from the circle method, the usual way of scheduling a round-robin tournament: the players
stand in a circle, one is held still and the rest rotate, and each pass of the circle pairs everybody off at once.
Emitting the pairs a pass at a time is what keeps the rule, and it keeps it for free rather than by searching: three
consecutive turns can only ever reach into two passes of the circle, and a player is in each pass exactly once.

A table of three is the one exception, because its passes are a single pair each and so give no separation at all.
There the circle's own order is kept — rotated to a random starting point, and then repeated — which is a cycle in
which everybody sits out every third turn.  `restful()` is the rule written down, and the tests check it over every
table size, every number of cycles and forty seeds each.

## Two boards, and why they are known by their place

The drawings are not in the view, for the same reason as in Scribblers: a view is the whole state of a room, sent to
everybody on every change, and a drawing is thousands of instructions.  The strokes are `shared/strokeRelay.js` —
literally the same code Scribblers runs — and are relayed as they are made.  Draw! has a board for each of the pair
drawing rather than one, so it is the game, not the relay, that adds a field saying which:

```
client -> server   line | fill | draw { ops } | clear | undo      (on your own board; the server knows which)
server -> client   draw { board, ops }                            more strokes for one of the boards
                   canvas { board, ops, first, done }             a board as it stands, in chunks
```

**A board is known by its place (`board`: its index in the view's `boards`, so 0 or 1), not by who is drawing it.**
That matters when somebody walks out mid-turn: a computer player takes their place under a new id, and a board keyed
by drawer would leave their strokes orphaned under the old one and hand the computer player a blank canvas beside
them.  Keyed by place, a takeover changes nothing about the drawing at all, which is what `server.test.js` checks.

The field is `board` and not `slot` on purpose: a slot on this site is a member's place in a room (`"s0"`, and the
field `kick` and `removeBot` take), and two different numberings of two different things should not share a word on
one wire.

## The clock

Everything is run off the one timer the room server gives a game (`nextAction`): a word picked for a drawer who
dithered, the end of the drawing, the next turn, a computer player's move, and the picture a computer player paints.
Whichever is due soonest is the one scheduled.

Draw! has no letters to reveal, so unlike Scribblers it has no intermediate timer ticking through a turn.  That is
why `shared/roomServer.js` now works out the next action when a socket **disconnects** as well as when the room
changes: without it, a turn whose drawers had both shut the tab would sit there until the drawing time ran out.

Timings come from the environment, and the tests turn them right down: `DRAW_CHOOSE_WAIT`, `DRAW_BETWEEN_WAIT`,
`DRAW_AWAY_WAIT`, `DRAW_BOT_DELAY`, `DRAW_BOT_DRAW`, `DRAW_BOT_RATE` and `DRAW_PICTURES` (see the header of
`server.js`).

## Computer players

One behaviour rather than a cast of them: a round is over in a few seconds and there are no letters to be clever
about, so `ai.js` picks the shortest word it is offered and guesses words that are the right shape and that nobody has
tried yet.  With two drawings to fit, it has two shapes to aim at.

What it *draws* is not an AI decision — that needs the web.  `server.js` asks `shared/picture.js` for a picture of the
word and paints it on that player's board a few strokes at a time, as Scribblers does, keyed by place so that two
computer players drawing at once never write to each other's board.

## Tests

| | |
| --- | --- |
| `pairings.test.js` | the drawing order, over every table size, every number of cycles, and many seeds |
| `game.test.js` | the rules with no sockets: two drawers, one guess panel aimed at both, the first one named winning |
| `server.test.js` | whole games over real sockets, the two boards and who may draw on which, and a drawer walking out |
| `robustness.test.js` | malformed payloads at every event in every phase, and that neither word ever reaches a guesser |
| `client/render.test.js` | every view of whole games drawn by the real client, both as a drawer and as a guesser |
