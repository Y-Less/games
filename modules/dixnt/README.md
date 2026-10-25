# Dixnt

A Dixit-style card game with an imposter, ported from the standalone game in `dixit/game` to the game site. The rules
players see are in `rules.md`; the module contract is in `../../MODULES.md`.

## Layout

- `module.json` the menu entry, player limits (3 to 12) and the statistics the game reports.
- `rules.md` the player-facing rules, shown by the site's "Rules" button.
- `game.js` the pure rules and what each player may see (no networking). Copied unchanged from the standalone game.
- `server.js` the socket half: rooms keyed by three-word codes (`ctx.codes`), one player per account
  (`socket.data.user`, token `user:<id>`), saving to `ctx.dataDir/games.json`, categories, hints and statistics.
- `client/` the Vue half. `index.js` exports `Dixnt.vue`, which builds the store (`store.js`) from the props the site
  passes (`socket`, `user`, `search`, `setSearch`) and shares it with the components through `useDixnt.js`.
- `bots/bot.js` a stand-alone bot player (see below).
- `hints.txt` the word and phrase suggestions for the chooser.
- `*.test.js` the rules tests (`game`, `judging`, `rounds`, `favourite`, `history`) and `e2e.test.js`, which runs the real site.

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

## Bots

A bot is a separate process that uses only the site's public API: it registers (or logs in) an account named after
the bot, takes the session cookie, and connects to the `/dixnt` namespace. It can only join an existing game, with
`--join` and the game's code; it never creates one, and it does not start games or press "Next round".

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
