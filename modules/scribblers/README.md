# Scribblers

A draw-and-guess game for the hub: one player draws a secret word while everybody else races to guess it.
`rules.md` is what the players read; this file is what a developer needs.

## Where it came from

The word list, the drawing protocol, and the drawing code are taken from
[scribble.rs](https://github.com/scribble-rs/scribble.rs) (BSD 3-Clause, Copyright (c) 2019 scribble-rs), which is
itself an open reimplementation of skribbl.io.  What was reused, and what was not:

| from scribble.rs | here |
| --- | --- |
| `internal/game/words/en_gb` | `words/en.txt`: the one self-referential entry and the ten words it listed twice taken out, and fifteen everyday nouns added, which makes it a round 5,000 |
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
| `ai/` | the computer players' decision logic: one file per AI and `ai/index.js` exporting `AIS` (below) |
| `picture.js` | a word turned into something to draw: the search, the decoders, and the strokes (the socket layer's, not the rules') |
| `game.js` | the rules: rooms, turns, choosing a word, letters, guesses, scoring, the views.  No sockets, no files, no canvas |
| `drawing.js` | what a drawing is made of and what the server will accept into one (and the grouping that undo works on) |
| `tally.js` | the counters kept for each player, for the statistics and achievements |
| `server.js` | the socket layer: the shared room server, the clock work of a turn, and the stroke relay |
| `client/` | the table: the board (`Board.vue`, `draw.js`), the toolbox, the guesses panel, the word bar, the thumbs |

## Words of your own

Anybody in a lobby may add words (`addWord`), which are kept on the room *and* saved under the module's data folder
(`added-words.json`, the newest 500), so a word added once is offered in later games as well.  The rules never touch a
file, so `server.js` hands the saved words to `createRoom`, which keeps them on the room as `added`.  One of the words
the drawer is offered each turn comes from them while any are left unplayed: a word added to a game is a word somebody
wants to see drawn, and among five thousand others it would never come up.

Ten of the words in `words/en.txt` are the juvenile ones of the "Had to be done" achievement (`JUVENILE` in
`words.js`).  They are in the list like any other word, so a drawer may simply be offered one; the achievement is for
the drawer who *picks* it, which `chooseWord` tells apart from the clock choosing for them (`manual`).

## Thumbs up and thumbs down

While a drawing is going on, everybody but the drawer may give it one thumb (`vote`), which they can take back or turn
around until the turn ends.  The thumbs are kept on the room for the turn only (`room.votes`, cleared by `beginTurn`),
and `endTurn` turns them into the drawer's score: the average the guessers earned them, moved by `VOTE_STEP` (5%) for
each thumb either way, never below nothing.  A share rather than a flat figure, so the thumbs flatter a good drawing
rather than becoming a way of scoring without drawing at all.

The computer players neither press a thumb nor care about them: an AI decides from plain data (see below), and what the
table makes of a drawing is not something the rules ask it.

## Why the drawing is not in the view

Every other game in the hub sends each player the whole state of the room on every change.  A drawing is thousands of
instructions a turn, so it would be sent again on every guess.  Instead:

- the strokes of the turn being drawn live in memory in `server.js` (never in the room, so they are never saved);
- the drawer's strokes are relayed to the other players as they are made (`draw`);
- anybody who arrives, or comes back, in the middle of a turn asks for the board and is sent it in chunks (`canvas`);
- `undo` and `clear` send the board again, as scribble.rs does, because a client cannot be trusted to unpick a stroke.

The instructions are in the board's own 1600 x 900 space, whatever size the canvas is on the screen.

## Achievements

Most of them are worked out from the recorded results, so they count games played before they existed: the counters are
in `tally.js` and declared in `module.json`.  Two are not plain counters:

- **Had to be done** counts `juvenilePicks`, which only a drawer choosing one of the juvenile ten raises (not the clock
  choosing it for them).
- **Arrgh!** is saved progress rather than a stat (`ctx.achievements.add(userId, 'arrgh')` in `server.js`), because what
  it watches - a flood fill undone within five seconds - happens on the canvas, which the rules never see.

## Playing with the timings

The tests make a turn short through the environment (see the header of `server.js`): `SCRIBBLERS_CHOOSE_WAIT`,
`SCRIBBLERS_BETWEEN_WAIT`, `SCRIBBLERS_SCORES_WAIT`, `SCRIBBLERS_AWAY_WAIT`, `SCRIBBLERS_BOT_DELAY` (a "min-max"
range) and `SCRIBBLERS_BOT_DRAW`, all in milliseconds.

All of them are clocks run off the one timer a game gets from the room server: `nextAction` works out which of them -
a letter, the end of the drawing, the next turn, a computer player's move - is due soonest, and that is the one
scheduled.

## Computer players

The lobby's **Add a computer player** gives the table a player the server plays, as in every other game here: it is a
seat in the room (`{ kind: 'bot', id: 'bot:<n>' }`), not an account, so it is never recorded in anybody's statistics.
It chooses a word when it is drawing, draws a picture of it, and guesses when somebody else is.

- **The AIs** (`ai/`) decide only what can be decided from plain data: which of the words offered to draw
  (`chooseWord`), and what to guess (`guess`).  `standard` guesses words that fit the letters shown; `sharp` draws the
  shortest word it is offered and never guesses a word anybody at the table has tried; `hopeful` counts the letters but
  ignores which ones are shown; `random` shouts out any word in the book.  Each is given one for the whole game
  (`assignAIs`), the id is kept on the seat so it survives a restart, and the table can see it in a player's pop-up.
- **The drawing is not an AI decision**, because it needs the web: once the AI has chosen a word, `server.js` asks
  `picture.js` for a picture of it and paints it on the board a message-full of strokes at a time, so the others watch
  it appear.  An AI never touches the network, the clock, or `Math.random`.
- **The picture.**  The first image a Wikimedia Commons search finds for the word (no key needed, and a thumbnail
  rather than the original), brought down to 256 x 256, then painted as blocks of the board's thinnest brush (8 of its
  1600 x 900 units, so 112 fill its height) in rows a little closer together than the brush is wide - it is round, so
  rows a brush apart leave white between them.  Each run of neighbouring blocks of one colour is a single line: a
  photograph is two to seven thousand instructions rather than sixty-five thousand.  White is never drawn, since the
  board is already white.
- **Where the pictures come from** is `SCRIBBLERS_PICTURES`: `web` (the default), `test` (bands worked out from the
  word, needing no network, which every test of this game uses) or `off` (draw nothing).
- A computer player standing in for somebody who left plays on in their place, but it does not paint over a board that
  already has strokes on it: it draws only when the board it inherits is empty.

Reading a downloaded photograph needs a decoder, which is what `jpeg-js` and `pngjs` are for.  They are loaded the
first time a picture is actually read, not when the module starts, because the test kit copies a module without
`node_modules` and a game must still start there.
