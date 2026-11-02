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
| the palette of 26 colours | `drawing.js` (`PALETTE`), beside the instructions that name a colour by its place in it |
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
| `bots/` | a stand-alone bot that signs in as an account and plays, so there is somebody to play against (below) |
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

## Players to play against

Two different things are called a computer player here.

**The lobby's computer players** (Add a computer player) are seats in the room, played by the server.  They cannot draw:
a turn that falls to one is given up (`skipTurn`), and they do not guess.  They are only of use as stand-ins for
somebody who leaves mid-game, which is what the shared roster rules do with them.

**The stand-alone bot** (`bots/bot.js`) is a separate process that signs in as an account and plays over the same HTTP
and Socket.IO API as the browser, so it is a person as far as the game is concerned - and it can draw.  Run one per
terminal, as many as you like:

```
node modules/scribblers/bots/bot.js --join boss-aware-you --name Painter
node modules/scribblers/bots/bot.js --join boss-aware-you --name Scribbler --guess-every 1500
```

- **Drawing.** It chooses one of the words it is offered, searches Wikimedia Commons for a picture of it (no key
  needed, and a thumbnail rather than the original), brings it down to 256 x 256, and paints it on the board.  The
  board's thinnest brush is 8 of its 1600 x 900 units, so the square is drawn as blocks of that size, in rows a little
  closer together than the brush is wide (it is round: rows a brush apart leave white between them), and each run of
  neighbouring blocks of one colour becomes a single line.  A photograph comes out as two to seven thousand
  instructions, sent a message-full at a time so the others watch it appear.  White is never drawn: the board is
  already white.
- **Guessing.** Once a second it tries a word from the game's own list that still fits the hints - the right number of
  characters, the shown letters in the right places, the spaces and hyphens where the hints have them - and never the
  same word twice in a turn.
- It joins an existing game and never starts one or moves a round on; a person does that.  If it is still in an earlier
  game it leaves that one first.
- `bots/picture.js` and `bots/guessing.js` hold the thinking and are tested in `../bots.test.js` with a made-up `fetch`
  and hand-made pictures, so the tests need no network.

Reading a downloaded photograph needs a decoder, which is what `jpeg-js` and `pngjs` are for.  They are **dev**
dependencies: the site itself never loads them, because the bot is a tool for working on the game.
