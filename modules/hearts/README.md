# Hearts

Hearts for three to seven players (four by default) for the game site, with optional computer players. The rules players see are in `rules.md`; the
module contract is in `../../MODULES.md`.

## Layout

```
module.json    menu entry (1 to 7 people), and the statistics this game reports
rules.md       the player-facing rules (shown by the Rules button)
deals.js       the variants: which cards are removed, cards each, passing rotation, pass names (3 to 7 players)
game.js        the rules as pure functions over a plain room object: dealing, passing, legal plays, tricks, scoring,
               the end of the game, computer players and what each player may see (no sockets, no files)
server.js      the socket layer: rooms, saving to ctx.dataDir/rooms.json, timers for computer moves, personalised views,
               statistics
client/        Vue 3: Hearts (root), Lobby, Table (uses the shared ScoreBoard, RoomEntry, InviteCode and PlayingCard)
game.test.js   rules tests, including thousands of random positions for the computer players
e2e.test.js    the real site: whole games, lobby, hidden hands, reconnects, concurrent rooms, leaving, restarts
```

## Rules decisions

- Hearts are broken as soon as any heart or the Queen of Spades is played.
- First trick: following clubs is required; a player with no clubs may not play a heart or the Queen of Spades unless
  every card in their hand is one of those. The Jack of Diamonds is never restricted.
- Shooting the moon means taking all 13 hearts and the Queen of Spades. The Jack of Diamonds (-5, on by default, the host can turn it off) is not
  needed, but it still counts: whoever took it gets its -5 on top of the moon scores (so another player may score
  21).
- The game ends at the end of the hand in which someone reaches the target; the lowest total wins, ties all win.
  Scores can go negative.
- Number of players: 3 to 7, a room setting (`seats`, default 4) that the host changes in the lobby with
  `settings { seats }` (or `create { seats }`); it cannot go below the number of seats already taken, and 2 and 8
  are refused. `room.seats.length` is the seat count; shrinking closes up gaps if it has to.
- The deal (see `deals.js` and `rules.md`): 3 players 17 cards (2C out), 4 players 13, 5 players 10 (2C, 2D out),
  6 players 8 (2C 3C 2D 3D out), 7 players 7 (2C 2D 3D out). Passing 3 cards (2 with 6 or 7 players). The Queen of
  Spades, the Jack of Diamonds and all hearts are always in the deck, so a hand is always 26 points and a moon scores
  26 for each other player (or -26) whatever the count.
- Passing rotation, as offsets to the left, ending with none: 3 players 1, 2, 0; 4 players 1, 3, 2, 0 (left, right,
  across, none); 5 players 1, 2, 3, 4, 0; 6 players 1 to 5, 0; 7 players 1 to 6, 0. `room.passDirection` names the
  pass ('left', 'right', 'across', 'none', or 'left2', 'left3', 'right2'... for further along) and `room.passOffset` is
  the offset to the left.
- The first trick is led by the holder of the lowest club still in the deck (2C, or 3C, or 4C), who must lead it.
- Passing: see above. Each hand's score line is kept as the round history. Each hand's score line is kept as the round history.

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
`create {target?, jackOfDiamonds?, moon?, seats?}`, `leave`, `settings {...}`, `addBot {seat?}`, `removeBot {seat}`, `fillBots`,
`start`, `pass {cards}`, `play {card}`, `claim` (take every remaining trick: refused unless `canClaim`, below), `next` (ready for the next hand: sent when a person closes the score pop-up; the hand is dealt once every person has, or after `HEARTS_NEXT_WAIT` ms), `again` (back to the lobby after a finished game).

Server to client: `state`, a view for that account (or `null`): `seatCount`, `limits { targets, moonModes, minSeats: 3,
maxSeats: 7 }`, `deal { cardsEach, tricks, passCount, removed, openingCard, handPoints, rotation }` (`rotation` is the
pass of each hand of a round as `pass`-style objects, below), `pass { direction, offset, side ('left' | 'right' | 'across' |
'none'), distance, count, label, cards, to, from, toName, fromName, targets, chosen, incomingReady }` (`to`, `from` and the
names only while you are passing, `targets[seat]` is who each seat passes to this hand; `label` is for example "Passing
3 to the left"), `trickNumber` out of `deal.tricks`, and its own hand, the legal plays with a reason for each
illegal card, counts for everyone else's cards, the public table, and `canClaim` (you lead and no unplayed card can beat any card in your hand), `lastClaim { seat, tricks, hand }` (the claim that ended this hand, if any), and `scoreboard` in the standard shape of
`shared/scores.js` (with the whole round history, `lowIsBetter: true` and `target`).

## Statistics

Once per finished game, every person still seated is recorded (winners `win`, others `loss`, placement by lowest score,
score = final points; the number of players is the length of the scoreboard and of `room.scores`) with `handsPlayed`, `moonsShot`, `queensTaken` and `heartsTaken`.
