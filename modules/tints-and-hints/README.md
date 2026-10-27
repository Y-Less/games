# Tints and Hints

A port of the author's standalone "Tints and Hints" (an Express server with one global game, plus a SvelteKit client) to a platform module. Several games can run at once, each with a three-word invite code.

## Layout

```
module.json        menu entry, player limits and the statistics this game reports
rules.md           the player-facing rules (shown by the Rules button)
grid.js            the 52 x 24 colour grid: square names, colours, "close" test (shared by server and client)
                   (names: columns A..Z, AA..AZ, rows 1..24; columns are equal steps round the wheel and the rows are spread evenly over the old levels,
                   are linear blends in HSL; rooms saved with the old grid are renamed by `migrate`, marked by `room.grid = 5`)
game.js            the rules as pure functions over a plain room object (no sockets, no files)
server.js          the socket layer: rooms, saving to ctx.dataDir/rooms.json, personalised views, statistics
ai/                the computer players (registry, the random AI, README)
bots.test.js       computer-player tests
client/            Vue 3 components: TintsAndHints (root), Entry, Lobby, Round, Board, Scores, Final
game.test.js       rules tests
server.test.js     end-to-end tests against the real site (whole game, abandonment, restart)
```

## Rules in brief

- 2 to 8 players, one hinter per turn, in joining order, starting with a random player.
- Round one: guessers each pick a square (hidden from one another); the hinter continues; round two: guess again, now seeing the first guesses; the hinter continues and the target is revealed.
- Score: exact 5 / close 2 in round one, exact 4 / close 1 in round two; the hinter gets 3 for each player who found the exact square. Close means within one square, diagonals included, with no wrap-around from AZ to A.
- The original is endless; here a game lasts `turnsEach x players` turns (host's choice, 1 to 5, default 2).
- Finished games are reported once: tied leaders all `win`, the rest `loss`, with placement, score and the extras `exactGuesses`, `closeGuesses` and `hintsGiven`. Abandoned games (fewer than two players left) are not recorded.

## Socket protocol

Client to server (each takes a payload and an acknowledgement `{ ok, error? }`): `resume {code?}`, `join {code}`, `create {turnsEach?}`, `leave`, `kick {userId}`, `addBot`, `removeBot {seat}`, `fillBots {count?}`, `colour {colour}`, `settings {turnsEach}`, `start`, `hint {text}`, `guess {cell}`, `advance` (the hinter closing a round of guessing), `ready` (at the reveal: this person closed the scores pop-up).

Server to client: `state`, a view personalised for that account (or `null` when not in a game). The hidden target is only in the hinter's view until the reveal.

## Computer players

Built-in computer players exist **for testing only** and have no logic. The host adds, removes and fills them in the lobby (`addBot`, `removeBot {seat}`, `fillBots {count?}`); they are seats in the room (`bot: true`, id `bot:<n>`, a name), not accounts, so they have no token and are never recorded in the statistics (people only: `statsPlayers`). The table still holds 2 to 8 seats, computers included.

- **What they do.** The grid is cut into 4 x 4 blocks with a description each, by an object of a similar colour (not a colour name) (`grid.js`); a computer hinter gives the description of the block holding its square, and a computer guesser picks a random square of the block the hint describes (any square if the hint is not a description). They are always ready at the reveal, so the next turn starts once every person has closed the scores pop-up (or after `TINTS_NEXT_WAIT`, default 60 s, for people who are away). The server plays them after a short random wait (`TINTS_BOT_DELAY`, "min-max" ms, default 600-1400), one move at a time, using `pendingBotAction(room)` and `runBotAction(room, rng)` in `game.js`. Each decision is built from that seat's own `viewFor`, so a guesser never sees the tint.
- **AIs.** `ai/` holds the AI registry (`ai/index.js`, built with `defineAIs` from `shared/ai.js`) and `ai/README.md`. There is one AI, `random` ("Random"). Its id is stored on the seat at game start (`assignAIs` with the game's rng) and views show `players[].ai` as `{ id, name, description }` for computer seats once the game has started.
- **Leaving and removal.** The host can remove any player in the pop-up of the score bar (`kick` for a person, `removeBot` for a computer). A person who leaves mid-game is not replaced: the game carries on with fewer players as before, and is abandoned when fewer than two seats or no people are left (a room with only computers is dropped).

## Tests

`npm test` from the platform folder runs them with the rest.
