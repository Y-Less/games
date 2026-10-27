# Cribbage

Cribbage for two to five players (everyone for themselves), played to 61 or 121, with built-in computer players.
The rules players see are in `rules.md`; the module contract is in `../../MODULES.md`.

## Layout

- `module.json` the menu entry and the statistics the game reports.
- `scoring.js` pure counting: `scoreHand` (the show, itemised) and `scorePlay` (pegging).
- `ai/` the computer players' AIs (`ai/index.js` exports `AIS`): `standard` (the original: expected hand value over every starter, adjusted for the box, and a pegging rule of thumb), `random`, `greedy`, `balanced`, `pegger` and `sharp`. Each has `discard(ctx)` and `play(ctx)` over plain data. Each computer seat picks one by weight when the game starts (`seats[].ai`, saved with the room; a replacement for a person who leaves picks at that moment; rooms saved earlier fall back to `standard`). `bot.js` re-exports the standard AI's functions.
- `game.js` the rules as pure functions over a plain room object: lobby, dealing for 2 to 5 players, discards, the play with go and last card, the show, ready-up, leaving, the history of hands, personalised views and the statistics result.
- `server.js` the socket layer: rooms keyed by three-word codes, saved to `ctx.dataDir/rooms.json`, a timer that makes computer players move, statistics.
- `client/` the Vue half: `Cribbage.vue` (root), `Lobby.vue`, `Table.vue` (discard and play), `ShowHands.vue`, `Board.vue` (the SVG peg board), `CardRow.vue`. It uses the shared `ScoreBoard`, `RoomEntry`, `InviteCode` and `PlayingCard` components.
- `*.test.js` rules tests and `e2e.test.js`, which runs the real site.

## Decisions

- Seats are numbered clockwise; a player's public id is the seat number. Seat order is the order of joining; the first dealer is random.
- The starter is cut automatically at random once everyone has discarded.
- An account can be in one unfinished game at a time.
- Each hand is one entry in `history` (`{ label, deltas }`, sent as the standard `scoreboard` shape): pegging, heels, hands and box; the entries add up to the final scores.
- A human who leaves a game under way is replaced by a computer player and is not recorded; if no human remains, the room is dropped. The host can replace an absent player the same way ("Remove").
- Statistics: winner is the first to the target, placements by final score (ties share), `score` is capped at the target. `handsPlayed` counts hands dealt, `bestHand` the best of a player's own four-card hands (not boxes), `pegPoints` points scored in the play (not heels), `skunks` wins with an opponent below 91 (31 for 61).

## Configuration

`CRIBBAGE_BOT_DELAY` sets the computer players' thinking time in milliseconds as `min-max` (default `600-1400`); the tests use `0-3`.

## Socket protocol

Client to server (each takes a payload and an acknowledgement `{ ok, error? }`): `resume {code?}`, `join {code}`, `create {target?, seats?}`, `leave`, `kick {seat}`, `settings {target?, seats?}`, `addBot`, `fillBots`, `removeBot {seat}`, `start`, `discard {cards}`, `play {card}`, `ready`, `rematch`.

Server to client: `state`, a view personalised for that account (or `null`). Only your own hand is included; opponents' cards are counts, and discards stay hidden until the show.
