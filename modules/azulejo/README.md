# Azulejo

An original tile-drafting and wall-building game for two to five players, in the family of "draft tiles from display
plates, build a wall" games. The names, colours, tile patterns and artwork (all drawn in CSS/SVG) are this site's own.

## Rules in brief

See `rules.md` (shown by the Rules button). 100 tiles (20 of each of five colours); `2n + 1` factory displays of four
tiles each round; take all of one colour from one display or the centre; fill a pattern line (1 to 5 tiles) and spill
the rest onto the floor line (-1, -1, -2, -2, -2, -3, -3); full lines move one tile to the wall and score by adjacency;
the game ends after the round in which a row is completed, with bonuses for rows (+2), columns (+7) and colours (+10).

## Optional rule: free wall

A host option in the lobby (off by default, saved with the room). The wall starts blank and the player chooses the
column for each scored tile (no colour twice in a row or column). A tile with one possible place is placed for the player;
choices are made at the same time by everyone in a `tiling` phase and computer players choose by a heuristic. If a full
line has no legal column left (an earlier tile of the same phase took it) its tiles go to the lid and score nothing.

## Files

- `rules.js` pure rules shared with the client: the fixed wall, line legality, floor penalties, scoring, bonuses.
- `game.js` the room, seats, rounds and turns, the tiling phase, final scoring, views and statistics.
- `bot.js` the computer players (value of every legal move, column choice).
- `server.js` the socket layer: rooms, codes, persistence, bot timers, statistics.
- `client/` the Vue screens (lobby, table, tiles drawn in SVG).
- tests: `rules.test.js`, `game.test.js`, `bot.test.js`, `invariants.test.js`, `e2e.test.js`, `robustness.test.js`,
  `lifecycle.test.js`; helpers `testing.js` and `e2e-support.js`.

## Notes

- The wall-tiling phase happens instantly on the server (a `tiling` phase exists only while a free-wall player must
  choose a column). The view carries `lastTiling`, a per-player summary of the round, so the client can show it.
- Statistics: `floorPenalties` is the points actually lost to the floor (a score cannot go below 0, so that can be less
  than the penalty shown). `rowsCompleted`, `columnsCompleted` and `colourSetsCompleted` are counted on the final wall.
- Environment: `AZULEJO_BOT_DELAY=min-max` (milliseconds) changes the computer players' thinking time.
