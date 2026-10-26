# Gaudi

An original dice-drafting stained-glass puzzle for two to five players, in the family of "draft dice, fill a
window" games. The names, window patterns, tool cards and objectives are this site's own designs.

## Rules in brief

See `rules.md` (shown by the Rules button). Ten rounds; each round the first player rolls 2n + 1 dice from the bag
(the pool), and everyone takes two turns in snake order (A B C C B A). On a turn a player may place one die and use
one tool card, in either order. Windows have colour and shade restrictions; dice must touch, and may not sit
orthogonally beside a die of the same colour or shade. Score: public objectives + private objective + favour tokens
- empty spaces.

## Dice bag

One formula for every player count: the bag holds exactly `10 x (2n + 1)` dice, shared evenly over the five colours
(`2 x (2n + 1)` of each): 50, 70, 90 and 110 dice for 2, 3, 4 and 5 players. It is used up exactly by the end of round
10. No tool draws from the bag or discards a die, so `bag + pool + round track + windows` is always that total.

## Optional rule: bad private scoring

A host option in the lobby (off by default, shown to everybody, saved with the room). Off: the private objective is
the sum of the shades of the dice of your secret colour. On: each such die is worth a flat 3.

## Files

- `rules.js` pure rules shared with the client: window patterns (12 double-sided cards, 24 windows), placement rules,
  the ten public objectives, scoring.
- `game.js` the room, seats, windows phase, rounds and turns, the twelve tools, final scoring, views and statistics.
- `bot.js` the computer players (window choice, placement scoring, rare tool use).
- `server.js` the thin socket layer: rooms and invite codes, persistence in `ctx.dataDir`, timers for the computers,
  statistics. `GAUDI_BOT_DELAY=min-max` (milliseconds, default `600-1400`) changes how long computers wait.
- `client/` the Vue screens: `Gaudi.vue` (connection), `Lobby.vue`, `Table.vue` (the game), `WindowGrid.vue`,
  `Die.vue` (a die with pips and a per-colour shape), `toolkit.js` (how each tool is guided), `glyphs.js`.
- `testing.js`, `e2e-support.js` helpers for the tests.

## Design notes

- Colours are Ruby, Topaz, Jade, Sapphire and Amethyst, each with its own shape (diamond, circle, triangle, square,
  star) drawn on every die and on colour-restricted spaces, so colour is never the only clue.
- Windows: each card's two faces are a light one (difficulty 3 or 4) and a heavy one (5 or 6). Every window is proved
  completable by `rules.test.js` with a search.
- Tools (twelve, three per game): Lathe, Exchange, Re-fire, Great Kiln, Mirror, Slide Rule, Twin Slide, Tint Shifter,
  Gauge Breaker, Track Echo, Free Pane, Swift Hand (an extra full turn straight after the current one; the later second turn is skipped). A tool is one request with all its parameters; the server checks
  everything first and only then charges the tokens and applies it. The first use of a card costs 1 favour token
  (anyone's use counts), every later use 2. The tokens stay on the card.
- Objectives (ten, three per game): Rainbow rows and columns, Tonal rows and columns, Pale, Middle and Deep pairs, Full
  spectrum, Full palette and Colour chains.
- Hidden information: the bag, other players' unchosen windows (and, until everybody has chosen, their choice) and
  private objectives never leave the server until the game is over.
- Scoreboard: the bar shows provisional scores (no private objective). The history has one `Round N` entry per round
  (the change in provisional score; round 1 includes the starting tokens less 20 empty spaces) and a last
  `Private objectives` entry that makes the totals the true final scores.

## Tests

`npm run test:server` runs `rules.test.js` (patterns, bag formula, placement, objectives), `game.test.js` (lobby,
turns, every tool, scoring, tie-breaks, views), `invariants.test.js` (computer players, hundreds of whole games with
invariants after every action), `e2e.test.js` (the real site: whole games with 2-5 seats, statistics, lobby,
reconnects, restarts) and `robustness.test.js` (garbage for every socket event).
