# Tints and Hints

A port of the author's standalone "Tints and Hints" (an Express server with one global game, plus a SvelteKit client) to a platform module. Several games can run at once, each with a three-word invite code.

## Layout

```
module.json        menu entry, player limits and the statistics this game reports
rules.md           the player-facing rules (shown by the Rules button)
grid.js            the 24 x 10 colour grid: square names, colours, "close" test (shared by server and client)
game.js            the rules as pure functions over a plain room object (no sockets, no files)
server.js          the socket layer: rooms, saving to ctx.dataDir/rooms.json, personalised views, statistics
client/            Vue 3 components: TintsAndHints (root), Entry, Lobby, Round, Board, Scores, Final
game.test.js       rules tests
server.test.js     end-to-end tests against the real site (whole game, abandonment, restart)
```

## Rules in brief

- 2 to 8 players, one hinter per turn, in joining order, starting with a random player.
- Round one: guessers each pick a square (hidden from one another); the hinter continues; round two: guess again, now seeing the first guesses; the hinter continues and the target is revealed.
- Score: exact 5 / close 2 in round one, exact 4 / close 1 in round two; the hinter gets 3 for each player who found the exact square. Close means within one square, diagonals included, with no wrap-around from X to A.
- The original is endless; here a game lasts `turnsEach x players` turns (host's choice, 1 to 5, default 2).
- Finished games are reported once: tied leaders all `win`, the rest `loss`, with placement, score and the extras `exactGuesses`, `closeGuesses` and `hintsGiven`. Abandoned games (fewer than two players left) are not recorded.

## Socket protocol

Client to server (each takes a payload and an acknowledgement `{ ok, error? }`): `resume {code?}`, `join {code}`, `create {turnsEach?}`, `leave`, `kick {userId}`, `colour {colour}`, `settings {turnsEach}`, `start`, `hint {text}`, `guess {cell}`, `advance`.

Server to client: `state`, a view personalised for that account (or `null` when not in a game). The hidden target is only in the hinter's view until the reveal.

## Computer players

This game has no computer players. The hinter types a free-text hint for a colour, so a bot would need to understand colour words to guess, and a way to describe a colour to give hints. That would be a new feature with its own bot process, not a small addition; see `MODULES.md` (Computer players) for how other games add AIs.

## Tests

`npm test` from the platform folder runs them with the rest.
