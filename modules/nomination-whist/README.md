# Nomination Whist

An Oh Hell-style trick-taking game for 3 to 7 players, with built-in computer players. Several rooms can run at once, each with a three-word invite code (`/play/nomination-whist?<code>`).

## Layout

```
module.json        menu entry and the statistics this game reports
rules.md           the player-facing rules (shown by the Rules button)
game.js            the rules as pure functions over a plain room object (no sockets, no files)
ai/                the computer players' AIs (ai/index.js exports AIS): standard (the original), random, cautious, optimist, counter, sharp; each has nominate(ctx) and play(ctx) over plain data. Each computer seat picks one by weight at game start (seats[].ai, saved with the room; a replacement picks when it joins; older rooms fall back to standard)
bot.js             re-exports the standard AI's functions (the original judgement)
server.js          the socket layer: rooms, saving to ctx.dataDir/rooms.json, bot timers, personalised views, statistics
client/            Vue 3 components: NominationWhist (root), Lobby, Table, TrickTable, RoundResult, Final
game.test.js       rules and computer-player tests
e2e.test.js        end-to-end tests against the real site
```

## Rules as implemented

- Hand sizes `7,6,5,4,3,2,1,1,2,3,4,5,6,7` (or `7..1` with the "7 down to 1 only" option). Trumps by round: hearts, clubs, diamonds, spades, none, repeating. The dealer is random in round 1 and then rotates clockwise (increasing seat number).
- Nominations run from the dealer's left to the dealer; the dealer may not make the total equal the number of tricks (screw the dealer). The server enforces it and sends the forbidden number in `forbidden` on the dealer's turn.
- Follow suit if possible; highest trump wins, otherwise the highest card of the suit led (no trumps: only the suit led counts).
- Scoring: exactly right is 10 plus the nomination. A miss scores the tricks actually taken, by default (host option `missPoints`, on by default; off means a miss scores 0). Highest total after the last round wins and ties share the win.
- Instant win (host option `instantWin`, on by default; a saved room without the key counts as on): in a 7-card first round or a 7-card last round (so round 1 and round 14 of the full game, round 1 only of the short game), a seat that nominated 7 and took all 7 tricks wins at once. The round is scored and recorded in the history (with `instantWin: <seat>`), then the phase becomes `finished`, `winners` is that one seat and `instantWin` in the view names it. A failed 7 scores normally; the last round of a short game has 1 card, so it never applies. Computer players nominate 7 for an instant win only when the option is on, the round qualifies and the hand has a run of the top trumps (see `canTakeAllSeven` in bot.js).
- Decisions the brief left open: closing the round-end score pop-up marks that person ready (`next`), and the next round is dealt once every person is (computer players count as ready), or after `NOMINATION_WHIST_NEXT_WAIT` ms; a finished trick stays on the table for 1.5 seconds; one live room per account.

## Seats and computer players

The host chooses 3 to 7 seats (lobby option `seats`), adds or removes computer players (ids `bot:<n>`) or fills every empty seat with one button, and can start only when all seats are filled with at least one person. Computer players are not accounts and are never recorded. They act after a random 600 to 1400 ms. The environment variables `NOMINATION_WHIST_BOT_DELAY` (`min-max`, milliseconds) and `NOMINATION_WHIST_TRICK_PAUSE` (milliseconds) shorten that for tests.

A person who leaves mid-game is replaced by a computer player. When no person is left the room is discarded and nothing is recorded. After a restart, saved rooms are reloaded and computer turns resume.

## Statistics

When the last round ends the game is recorded once, for every person still seated: win for the highest total (ties all win), loss for the rest, with `placement` from `placements()` and `score` the final total. Extras: `roundsPlayed`, `bidsMade` (rounds where the nomination was hit exactly), `tricksWon`, `perfectGames` (1 if every nomination was hit), `instantWins` (1 for the winner of an instant win). After an instant win the winner is placed first, win; everyone else is a loss, placed by their totals below the winner.

## Socket protocol

Client to server (each takes a payload and an acknowledgement `{ ok, error? }`): `resume {code?}`, `join {code}`, `create {seats?, length?, missPoints?, instantWin?}`, `leave`, `settings {seats?, length?, missPoints?, instantWin?}`, `addBot {seat?}`, `removeBot {seat}`, `fillBots`, `start`, `nominate {number}`, `play {card}`, `next`, `again`.

Server to client: `state`, a view personalised for that account (or `null` when not in a game). It holds your own hand, only card counts for everyone else, the standard scoreboard rounds (`rounds`: `label`, `deltas`, `notes`, plus `bids`, `taken`) and, when it is your turn to play, `legal` (each card in your hand with the reason it cannot be played, or `null`).

## Reusable parts

`client/TrickTable.vue` is a generic card table for trick-taking games: opponents round an oval (a wrapped row on a phone), the trick in the middle with who played each card, and the viewer's seat in a slot. Other card games could use it as it is.

## Tests

`npm test` from the platform folder runs them with the rest.
