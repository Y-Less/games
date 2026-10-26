# Dixnt

A Dixit-style card game with an imposter, ported from the standalone game in `dixit/game` to the game site. The rules
players see are in `rules.md`; the module contract is in `../../MODULES.md`.

## Layout

- `module.json` the menu entry, player limits (3 to 12) and the statistics the game reports.
- `rules.md` the player-facing rules, shown by the site's "Rules" button.
- `game.js` the pure rules and what each player may see (no networking), including the computer-player seats.
- `server.js` the socket half: rooms keyed by three-word codes (`ctx.codes`), one player per account
  (`socket.data.user`, token `user:<id>`), saving to `ctx.dataDir/games.json`, categories, hints and statistics.
- `client/` the Vue half. `index.js` exports `Dixnt.vue`, which builds the store (`store.js`) from the props the site
  passes (`socket`, `user`, `search`, `setSearch`) and shares it with the components through `useDixnt.js`.
- `bots/bot.js` an optional stand-alone bot player that signs in as an account (see below).
- `ai/` the computer players' decision logic: one file per AI and `ai/index.js` exporting `AIS` (see below).
- `hints.txt` the word and phrase suggestions for the chooser.
- `*.test.js` the rules tests (`game`, `judging`, `rounds`, `favourite`, `history`, `bots`) and `e2e.test.js`, `lifecycle.test.js`
  and friends, which run the real site.

## Scoreboard

Every completed round is appended to `history` in the room state (saved in `games.json`):
`{ label: 'Round N', deltas: { playerId: points }, notes: { playerId: 'chooser' | 'imposter, caught' | ... } }`.
Abandoned (skipped) rounds are not recorded and do not use up a number. Every player's view carries the standard
scoreboard (`view.scoreboard`, see `shared/scores.js`: players with `isMe` and `away`, `rounds`, `lowIsBetter: false`,
no target), drawn by the shared `<ScoreBoard>`: a sticky bar, and a pop-up after every round and at the end. Choices:
a player who leaves is removed from every history row (the table always adds up to the scores of the players still
in the game); late joiners appear with 0 and a zero in earlier rounds; returning to the lobby clears scores and
history. A saved room from before the history existed loads with its scores shown as one "Earlier rounds" row.

## Cards

The card images are served at `/assets/dixnt/cards/<small|medium>/card_<id>.jpg`, with `categories.json` beside them.
The folder is, in order of preference:

1. `DIXNT_CARDS_DIR`, if set;
2. `modules/dixnt/cards`, if it exists;
3. `../../../dixit/game/cards` relative to this folder (the standalone game's output).

The server rereads the folder at most every five seconds, so new cards appear without a restart. The cards are made
by the pipeline in the `dixit` folder: `tools/optimise_cards.py` in `dixit/game` builds `cards/` from the judged
winners (see `dixit/STYLE_GUIDE.md` and `dixit/JUDGING.md`).

## Statistics

When a game reaches the finished phase it is reported once with `ctx.stats.record`: winners (everyone tied on the top
score) get `win`, the rest `loss`, placements follow the score (ties share one), and the extras are
`roundsAsImposter`, `timesFooledGroup`, `correctGuesses` and `cardsPlayed`. Games ended early by the host, or
abandoned, are not recorded. The per-round tallies are kept next to each saved game, so a restart does not lose them
or record a game twice.

## Computer players (built in)

Computer players are seats in the room, like in Hearts or Rummikub. They are not accounts: a bot seat is
`{ id, token: 'bot:<n>', name, bot: true, ai, hand, score, ... }` in `players` (saved with the room), and no user token
can match it. Dixnt has no fixed seat count (3 to 12 players), so there are no "empty seats": the lobby's Players panel
has **Add a computer player**, **Remove** beside each computer player and **Fill up to 3 players with computer players**
(socket events `addBot`, `removeBot { targetId }` and `fillBots { count }`; the count defaults to the minimum and is
capped at 12). All three are host-only and lobby-only. People and computer players share the 12 seats. The lobby
controls are Dixnt's own (`LobbyView.vue`) rather than `SeatLobby`, because that component is for a fixed number of
seats, while Dixnt's lobby also has the play style, categories and its own start conditions.

- **AIs.** `start` deals each computer player an AI with `assignAIs(AIS, ids, rng)` using the game's rng and stores its
  id on the seat; they are dealt again at every start (and cleared when the game returns to the lobby). The view has
  `players[].bot` and `players[].ai` (`{ id, name }`, null for people and for bots in the lobby); bots are always shown
  as connected.
- **Playing.** `server.js` plays them after a random wait from `DIXNT_BOT_DELAY` (`min-max` milliseconds, default
  `600-1400`; the tests use `0-3` and the UI tests `0-5`), one move per timer, via `Game.pendingBotAction()` and
  `runBotAction()`: the chooser's word, every card, and every vote the judging style asks for (everyone, the chooser
  only, or the chooser's favourite card). Every decision is made from that seat's own `viewFor`, so a bot sees only
  what a person in the seat would: its hand, the clue unless it is the imposter, the table once cards are in. An AI that
  throws or answers with something illegal is replaced by a random legal choice, and an empty hint list falls back to a
  few built-in words. Timers are rebuilt when the server starts, so saved rooms carry on.
- **Next round.** Bots never press "Next round" or start the game: the host does, as before, so they cannot hold
  anything up.
- **Leaving.** While a round is on (or its results are showing), a person who leaves or is removed by the host is
  replaced by a computer player in the same seat (keeping hand, score, turns, what they played and their scoreboard
  column), if another person is still in the game. The new bot gets a bot name and a random AI, and the host role passes
  to the first remaining person. In the lobby, after the game, for a late joiner who is still waiting, for a computer
  player the host removes mid-game, or when nobody else is left, the seat is simply removed (`Game.removePlayer`, which
  still abandons the round, or returns to the lobby below three players). A game with no people left is dropped, so bots
  alone never keep a room alive. Dixnt allows several rooms per account, so there is no "one live room" rule to exempt
  bots from.
- **Statistics.** Only accounts are recorded: bots have no user id and are left out of `ctx.stats.record` and of the
  tallies, though they do count in the placements.

## External bots (optional)

`bots/bot.js` is kept as an optional extra: a separate process that uses only the site's public API: it registers (or logs in) an account named after
the bot, takes the session cookie, and connects to the `/dixnt` namespace. It can only join an existing game, with
`--join` and the game's code; it never creates one, and it does not start games or press "Next round". It joins as an ordinary account (a person
seat that happens to be played by a program), so it is recorded in the statistics, and it uses the same `ai/` code as the
built-in computer players (telling the server which AI it plays with through `declareAI`, which built-in bots never
need). Use it to put a bot on a remote site or to try an AI over the real API; for ordinary games use the lobby.

```
node modules/dixnt/bots/bot.js --join boss-aware-you --name Robin
node modules/dixnt/bots/bot.js --join boss-aware-you --name Sam --url http://192.168.1.20:3000 --delay 500-2000
node modules/dixnt/bots/bot.js --help
```

The bot's name must be a valid username (3 to 20 letters, numbers, dashes or underscores) and not already taken by
someone else. Its generated password is kept in `bots/.bot-tokens.json` (git-ignored), so a restarted bot signs in to
the same account and rejoins as the same player.

## Tests

From the platform folder, `npm test` runs everything; `node --test modules/dixnt/*.test.js` runs just this module.
The end-to-end tests start the real site on a spare port with a temporary copy of this module, a temporary data
folder, and fake cards (empty `.jpg` files) made in `DIXNT_CARDS_DIR`.
