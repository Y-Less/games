# Hearts

Four-player Hearts for the game site, with optional computer players. The rules players see are in `rules.md`; the
module contract is in `../../MODULES.md`.

## Layout

```
module.json    menu entry (1 to 4 people), and the statistics this game reports
rules.md       the player-facing rules (shown by the Rules button)
game.js        the rules as pure functions over a plain room object: dealing, passing, legal plays, tricks, scoring,
               the end of the game, computer players and what each player may see (no sockets, no files)
server.js      the socket layer: rooms, saving to ctx.dataDir/rooms.json, timers for computer moves, personalised views,
               statistics
client/        Vue 3: Hearts (root), Lobby, Table (uses the shared ScoreBoard, RoomEntry, InviteCode and PlayingCard)
game.test.js   rules tests, including thousands of random positions for the computer players
e2e.test.js    the real site: whole games, lobby, hidden hands, reconnects, concurrent rooms, leaving, restarts
```

## Rules decisions

- The Queen of Spades does not break hearts. Hearts are broken as soon as any heart is played.
- First trick: following clubs is required; a player with no clubs may not play a heart or the Queen of Spades unless
  every card in their hand is one of those. The Jack of Diamonds is never restricted.
- Shooting the moon means taking all 13 hearts and the Queen of Spades. The Jack of Diamonds (optional, -5) is not
  needed, but it still counts: whoever took it gets its -5 on top of the moon scores (so another player may score
  21).
- The game ends at the end of the hand in which someone reaches the target; the lowest total wins, ties all win.
  Scores can go negative.
- Passing: left, right, across, none, repeating. Each hand's score line is kept as the round history.

## Computer players

Seats hold `{ kind: 'human', id: <account id> }` or `{ kind: 'bot', id: 'bot:<n>' }`. Computers pass the Queen of Spades,
high spades and high hearts; lead low (flushing the Queen with low spades); duck tricks with points; dump the Queen and
high hearts when they cannot follow suit; and only chase the moon with an overwhelming hand, giving up as soon as
anyone else takes a point. They act after a random delay, and a finished trick stays on the table for a moment.
Both can be changed through the environment (the tests make them fast):

- `HEARTS_BOT_DELAY` as `min-max` milliseconds (default `600-1400`)
- `HEARTS_TRICK_PAUSE` in milliseconds (default `1500`)

A person who leaves a started game is replaced by a computer player in the same seat; with nobody left the room is
dropped and nothing is recorded. Rooms are saved after every change and the computers' turns resume after a restart.

## Socket protocol

Client to server (each takes a payload and an acknowledgement `{ ok, error? }`): `resume {code?}`, `join {code}`,
`create {target?, jackOfDiamonds?, moon?}`, `leave`, `settings {...}`, `addBot {seat?}`, `removeBot {seat}`, `fillBots`,
`start`, `pass {cards}`, `play {card}`, `next` (ready for the next hand: sent when a person closes the score pop-up; the hand is dealt once every person has, or after `HEARTS_NEXT_WAIT` ms), `again` (back to the lobby after a finished game).

Server to client: `state`, a view for that account (or `null`): its own hand, the legal plays with a reason for each
illegal card, counts for everyone else's cards, the public table, and `scoreboard` in the standard shape of
`shared/scores.js` (with the whole round history, `lowIsBetter: true` and `target`).

## Statistics

Once per finished game, every person still seated is recorded (winners `win`, others `loss`, placement by lowest score,
score = final points) with `handsPlayed`, `moonsShot`, `queensTaken` and `heartsTaken`.
