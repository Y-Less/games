# Scribblers

A draw-and-guess game for the hub: one player draws a secret word while everybody else races to guess it.
`rules.md` is what the players read; this file is what a developer needs.

## Where it came from

The word list, the drawing protocol, and the drawing code are taken from
[scribble.rs](https://github.com/scribble-rs/scribble.rs) (BSD 3-Clause, Copyright (c) 2019 scribble-rs), which is
itself an open reimplementation of skribbl.io.  What was reused, and what was not:

| from scribble.rs | here |
| --- | --- |
| `internal/game/words/en_gb` | `words/en.txt`, with the one self-referential entry taken out |
| `internal/frontend/resources/draw.js` (the flood fill and the brush) | `client/draw.js`, as ES modules |
| the palette of 26 colours | `client/draw.js` (`PALETTE`) |
| the real-time sketch events (`line`, `fill`, `clear-drawing-board`, `undo`, `request-drawing`) | the same events on Socket.IO: `line`, `fill`, `draw`, `clear`, `undo`, `canvas` (see `server.js`) |
| the turn rules: the scoring curve, how many letters are revealed and when, what counts as a close guess, the 150 ms stroke grouping behind undo | `game.js` and `drawing.js` |
| its lobby, accounts, chat, kick votes, spectators, HTTP API, Go server, and page | **not used**: the hub already has accounts, invite codes, a waiting room, a score bar and a player pop-up |

The flood fill in `client/draw.js` came to scribble.rs from
[floodfill.js](https://github.com/binarymax/floodfill.js) (MIT, Copyright (c) Max Irwin 2011-2016) and has been
rewritten again here.  No artwork was copied: the toolbox uses the player's own emoji font rather than scribble.rs's
icons, whose artwork has a licence of its own.

## The parts

| | |
| --- | --- |
| `words.js`, `words/en.txt` | the word list, drawing words for a turn, and comparing a guess with the word |
| `game.js` | the rules: rooms, turns, choosing a word, letters, guesses, scoring, the views.  No sockets, no files, no canvas |
| `drawing.js` | what a drawing is made of and what the server will accept into one (and the grouping that undo works on) |
| `tally.js` | the counters kept for each player, for the statistics and achievements |
| `server.js` | the socket layer: the shared room server, the clock work of a turn, and the stroke relay |
| `client/` | the table: the board (`Board.vue`, `draw.js`), the toolbox, the guesses panel, the word bar |

## Why the drawing is not in the view

Every other game in the hub sends each player the whole state of the room on every change.  A drawing is thousands of
instructions a turn, so it would be sent again on every guess.  Instead:

- the strokes of the turn being drawn live in memory in `server.js` (never in the room, so they are never saved);
- the drawer's strokes are relayed to the other players as they are made (`draw`);
- anybody who arrives, or comes back, in the middle of a turn asks for the board and is sent it in chunks (`canvas`);
- `undo` and `clear` send the board again, as scribble.rs does, because a client cannot be trusted to unpick a stroke.

The instructions are in the board's own 1600 x 900 space, whatever size the canvas is on the screen.

## Playing with the timings

The tests make a turn short through the environment (see the header of `server.js`): `SCRIBBLERS_CHOOSE_WAIT`,
`SCRIBBLERS_BETWEEN_WAIT`, `SCRIBBLERS_SCORES_WAIT` and `SCRIBBLERS_AWAY_WAIT`, all in milliseconds.

## Computer players

A computer player can join, but cannot yet draw: a turn that falls to one is given up (`skipTurn`), and they do not
guess.  Giving them a drawing to make is the next piece of work.
