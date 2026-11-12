# Dixnt

A Dixit-style card game with an imposter, ported from the standalone game in `dixit/game` to the game site.  The rules
players see are in `rules.md`; the module contract is in `../../MODULES.md`.

## Layout

- `module.json` the menu entry, player limits (3 to 12), and the statistics the game reports.
- `rules.md` the player-facing rules, shown by the site's "Rules" button.
- `game.js` the pure rules and what each player may see (no networking), including the computer players.
  `createRules({ getCategories, hints })` builds the rules object `shared/roomServer.js` drives; the lobby itself
  (joining, leaving, removing, the computer players) is the shared player-list code of `shared/roster.js`.
- `server.js` the socket half, a short call to `createRoomServer` (`shared/roomServer.js`): where the cards and the
  hints come from, the settings it accepts, its own events, the computer players' timer, and the `art` achievement.
  Rooms are saved to `ctx.dataDir/rooms.json`; a `games.json` from before this is brought over once (see
  `importOldSave`) and kept as `games.json.imported`.
- `client/` the Vue half. `index.js` exports `Dixnt.vue`, which builds the store (`store.js`) from the props the site
  passes (`socket`, `user`, `search`, `setSearch`) and shares it with the components through `useDixnt.js`.  The store
  is the site's own plumbing (`src/useGameSocket.js`: the socket, the room's state, the refusal notice and the
  header's Leave button) with the game's view state beside it: the Recent moves, the two word pop-ups and the lightbox.
- `ai/` the computer players' decision logic: one file per AI and `ai/index.js` exporting `AIS` (see below).
- `hints.txt` the word and phrase suggestions for the chooser (content, not interface: they are not translated).
- `locales/en.json` every word a player reads, merged under `dixnt.` (see "Languages" in `../../MODULES.md`).
- `*.test.js` the rules tests (`game`, `judging`, `rounds`, `favourite`, `history`, `bots`) and `e2e.test.js`, `lifecycle.test.js`
  and friends, which run the real site.

## Scoreboard

Every completed round is appended to `history` in the room state (saved in `rooms.json`):
`{ label, deltas: { playerId: points }, notes: { playerId: note } }`, where `label` and each `note` are **messages**
(`{ key, params? }`, see `shared/messages.js`), never English: `msg('round.label', { n })` or `msg('round.earlier')`
for the label, and one of `notes.chooser`, `notes.cardPicked`, `notes.chooserCardPicked`, `notes.imposterCaught`,
`notes.imposterFooledAll`, `notes.chooserSpotted`, `notes.chooserFooled` for a note. `ScoreBoard` and `ScoreTable`
put them into the player's language.
Abandoned (skipped) rounds are not recorded and do not use up a number.  Every player's view carries the standard
scoreboard (`view.scoreboard`, see `shared/scores.js`: players with `isMe` and `away`, `rounds`, `lowIsBetter: false`,
no target), drawn by the shared `<ScoreBoard>`: a sticky bar, and a pop-up after every round and at the end.  Choices:
a player who leaves is removed from every history row (the table always adds up to the scores of the players still
in the game); late joiners appear with 0 and a zero in earlier rounds; returning to the lobby clears scores and
history.  A saved room from before the history existed loads with its scores shown as one `round.earlier` row.  A room saved
before the labels and notes became messages holds English strings there; the client shows a plain string as it is, so
those rows keep their original wording.

## Languages

Every word a player sees comes from `locales/en.json` (`../../MODULES.md`, "Languages").  Nothing the server sends is a
sentence:

- **Refusals.** Every rule returns `{ ok: false, error: <code>, params? }`, where the code is a refusal **code** and
  `params` are the values that text needs.  A code is looked up under `errors.` in `locales/en.json` first and
  `src/locales/en.json` second, so Dixnt's own (`typeWord`, `chooserOnlyVotes`, `handSizeRange`, `notEnoughCards`
  ...) sit beside the shared ones (`notInGame`, `hostOnlyStart`, `notInHand`, `turnsEach`, `noGameWithCode` ...).
  An unexpected throw becomes `serverError`.
- **Text in a view.** The scoreboard's round labels and notes are messages (above), and so is the label of the
  made-up "all cards" category (`lobby.allCards`) used when there is no `categories.json`.  The labels and
  descriptions *in* `categories.json`, the hints in `hints.txt`, the chooser's word, the card pictures, and the
  computer players' names are content and stay as they are.
- **On the client.** Every component calls `useGameText()`. `status.js` and `moveLog.js` build messages rather than
  words (the root component draws them with `text()`), and `createStore` is given the game's `error` helper so a
  refusal reaches the toast in the player's language.

## Cards

The card images are served at `/assets/dixnt/cards/<small|medium>/card_<id>.jpg`, with `categories.json` beside them.
The folder is, in order of preference:

1. `DIXNT_CARDS_DIR`, if set;
2. `modules/dixnt/cards`, if it exists;
3. `../../../dixit/game/cards` relative to this folder (the standalone game's output).

The server rereads the folder at most every five seconds, so new cards appear without a restart.  The cards are made
by the pipeline in the `dixit` folder: `tools/optimise_cards.py` in `dixit/game` builds `cards/` from the judged
winners (see `dixit/STYLE_GUIDE.md` and `dixit/JUDGING.md`).

## Statistics

When a game reaches the finished phase it is reported once with `ctx.stats.record`: winners (everyone tied on the top
score) get `win`, the rest `loss`, placements follow the score (ties share one), and the extras are
`roundsAsImposter`, `timesFooledGroup`, `correctGuesses` and `cardsPlayed`.  Games ended early by the host, or
abandoned, are not recorded.  The per-round counters live on the player in the room (as their score does), so they
survive a restart, follow a place when it changes hands, and never record a game twice.

## Computer players (built in)

Computer players are places in the room, like in Just One or Wavelength.  They are not accounts: a person's id in a
room **is** their account id, and a computer player's is `'bot:<n>'`, so no account can ever match one.  Dixnt has no
fixed seat count (3 to 12 players), so there are no "empty seats": the lobby's players panel is the shared
`PlayerListPanel`, with **Add a computer player**, **Remove** beside each one, and **Fill up to 3 players with
computer players** (socket events `addBot`, `removeBot { seat }` and `fillBots { count }`; the count defaults to the
minimum and is capped at 12).  All three are host-only and lobby-only.  People and computer players share the 12
places.  The rest of the lobby (the play style, the categories, the hand size and the length) is Dixnt's own, in
`LobbyView.vue`, and the host changes any of it with one `settings` message.

- **AIs.** `start` deals each computer player an AI with `assignAIs(AIS, ids, rng)` using the game's rng and stores its
  id on the seat; they are dealt again at every start (and cleared when the game returns to the lobby).  The view has
  `players[].bot` and `players[].ai` (`{ id, name }`, null for people and for bots in the lobby); bots are always shown
  as connected.
- **Playing.** `server.js` plays them after a random wait from `DIXNT_BOT_DELAY` (`min-max` milliseconds, default
  `600-1400`; the tests use `0-3` and the UI tests `0-5`), one move per timer, via `Game.pendingBotAction()` and
  `runBotAction()`: the chooser's word, every card, and every vote the judging style asks for (everyone, the chooser
  only, or the chooser's favourite card).  Every decision is made from that seat's own `viewFor`, so a bot sees only
  what a person in the seat would: its hand, the clue unless it is the imposter, the table once cards are in.  An AI that
  throws or answers with something illegal is replaced by a random legal choice, and an empty hint list falls back to a
  few built-in words.  Timers are rebuilt when the server starts, so saved rooms carry on.
- **Next round.** Bots never press "Next round" or start the game: the host does, as before, so they cannot hold
  anything up.
- **Leaving and arriving.** This is the shared behaviour of `shared/roster.js`, and nothing about it is Dixnt's own.
  While a game is on, a person who leaves or is removed by the host is replaced by a computer player in their place,
  keeping their hand, score, turns, the card they played, the vote they cast and their scoreboard column; the new
  computer player gets a name and a random AI, remembers whose place it is keeping warm (`stoodInFor`), and the host
  role passes to the first remaining person.  So a round is never abandoned for somebody leaving, whoever they were.
  Somebody arriving at a game under way takes a computer player's place the same way round — their own first, if it is
  still being kept for them — so a game of nothing but people answers `gameFull`.  In the lobby a place is simply given
  up, and a finished game keeps its final standings for everybody who played.  A game with no people left is dropped,
  so computer players alone never keep a room alive.  Somebody the host removes, or the table votes out, is barred
  (`room.barred`), so the invitation does not let them back in.
- **Statistics.** Only accounts are recorded: bots have no user id and are left out of `ctx.stats.record` and of the
  tallies, though they do count in the placements.

## Tests

From the platform folder, `npm test` runs everything; `node --test modules/dixnt/*.test.js` runs just this module.
The end-to-end tests start the real site on a spare port with a temporary copy of this module, a temporary data
folder, and fake cards (empty `.jpg` files) made in `DIXNT_CARDS_DIR`.
