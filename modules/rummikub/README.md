# Rummikub

A tile-rummy game for two to six players with computer players to fill the seats, in the family of the classic
"build runs and groups, rearrange the table" game. The tiles, colours and shapes are this site's own (CSS/SVG).

See `rules.md` (shown by the Rules button) for the rules. Decisions worth knowing:

- Tiles are integer ids (numbered tiles first, then wildcards; see `rules.js`), so a tile can be tracked anywhere.
- A turn is one request: `play` sends the complete table the player wants and the server judges it
  (`rules.checkPlay`): all old tiles remain, only rack tiles were added, every set is valid, and before the first meld the
  old sets are untouched and the new sets (rack tiles only) are worth the threshold. The client's rack is not trusted or needed
  (the rack is the server's); an invalid layout is refused with no change, and "Reset turn" is local to the client.
- Set order is irrelevant. `rules.resolveSet` decides what each wildcard stands for and the server keeps sets in that order.
- Deal: 14 each, or `floor(tiles / (players + 1))` when that is smaller; fewer than 6 each is refused when starting.
- Rounds: the lowest rack wins; losers lose the difference to the winner's rack (equal to their rack when someone goes out).
- Rounds after the first wait for every person to close the scores pop-up (or 60 s, `RUMMIKUB_ROUND_WAIT`).
- Turn timer (host option, off by default): when it runs out the player draws (or passes). The server enforces it.

## Files

- `rules.js` pure rules shared with the client: tiles, set resolving, settings, `checkPlay`.
- `game.js` the room, seats, rounds and turns, scoring, views and statistics.
- `bot.js` the computer players: a capped search over the whole table (new sets, extensions, rearrangements, jokers).
- `server.js` the socket layer: rooms, codes, persistence, bot / timer / round timers, statistics.
- `client/` the Vue screens (lobby, play field with drag-and-drop and click-to-move).
- tests: `rules.test.js`, `game.test.js`, `bot.test.js`, `simulation.test.js`, `robustness.test.js`, `lifecycle.test.js`;
  helpers `testing.js`; client tests in `client/`.

## Environment

- `RUMMIKUB_BOT_DELAY=min-max` (milliseconds) changes the computer players' thinking time (default 900-1800).
- `RUMMIKUB_ROUND_WAIT=ms` how long to wait for the scores pop-up to be closed between rounds.
