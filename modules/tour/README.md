# Tour

A module that plays nothing.  It gathers people into a room once, and then decides by vote which *other* game they
play next, opening it for them and bringing them back when it ends.

`rules.md` is what a player reads.  This is what the module does.

## Why it is unusual

Every other module is sealed inside itself: its own socket namespace, its own rooms, its own saved file, its own
codes.  A tour is the one thing that cannot be written under that rule, so the site opens a narrow door for it
(`ctx.games` and `ctx.tell`, both described in MODULES.md) and this is the only module that goes through it:

| | |
| --- | --- |
| `ctx.games.list()` | what else is playable, and for how many: the vote is drawn from this |
| `ctx.games.open(id, …)` | a started room in that module, with these people in it, and its invite code |
| `ctx.games.onFinished(fn)` | that a game somewhere has ended — how a tour knows to vote again |
| `ctx.tell(userId, …)` | reaches a person on the site's own socket, so they hear the tour while inside another game |

Nothing was asked of the other sixteen modules to make this work.  `openFor` is on the handle `createRoomServer`
already returns, and the site supplies `ctx.onGameFinished`, so every room-based game is openable and reports its
finished games without a word in its own `server.js`.

## The rules (`game.js`)

Pure, and told nothing about other modules at import time: everything about them arrives as a `catalogue` argument,
`[{ id, name, minPlayers, maxPlayers }]`, which `server.js` reads from `ctx.games.list()`.  That is what lets the
tests hand it any catalogue they like.

Phases: `lobby` → `voting` → `opening` → `playing` → `voting` → … → `finished`.

`opening` lasts only as long as it takes the server to open the game, but it is a real phase on the room, and the
choice that won is kept as `room.chosen`, so a restart in that moment knows what it was about to do.

The three on offer are drawn by `drawChoices` with the injected `rng`, afresh every vote, from `playable(catalogue,
players)`.  Nothing is remembered between votes — see `drawChoices` for why that is deliberate rather than lazy.

## The server (`server.js`)

`nextAction` does the work a tour owes itself: a computer player's vote, closing the vote when everybody has voted or
the minute is up, opening what won, and a long stop for a game that never reports itself finished because everybody
walked out of it.

Two things are worth knowing before changing it:

- **The settle timer's key carries the number of votes cast.**  The scheduler keeps a timer whose key has not changed,
  and the last vote in turns a minute's wait into none, so a fixed key would leave the table sitting out the full
  minute after everybody had voted.  There is a test for exactly that.
- **`afterChange` nudges, but only when the tour has actually moved.**  People are told on the site's socket, which
  reaches them inside whatever game they are playing, so nudging on every change would interrupt them each time
  somebody joined the lobby.

Timing can be changed through the environment (the tests make it fast):

- `TOUR_BOT_DELAY` as `min-max` milliseconds (default `600-1400`)

## Tests

- `game.test.js` — the rules: the lobby, the draw, the vote, the cycle, and what a saved tour looks like.
- `e2e.test.js` — the crossing, which no unit test can reach: a tour against the real site, opening a room in another
  module and hearing it finish.  The other module is a stand-in written in the test, so a whole cycle takes
  milliseconds and nothing depends on how a real game happens to deal.

## Still to come

The client half (`client/`) and the band that brings people back from a game they were sent to.  Until those land the
tour runs, but only a test can see it.
