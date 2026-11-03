# Writing a game module

The site (accounts, profiles, statistics, the game menu, the header) is generic.  A game is a folder in `modules/<id>/`
that plugs into it.  The site starts the module's **server half** on a socket namespace of its own and loads its
**client half** into the central play field.

```
modules/<id>/
  module.json        what the menu shows, and which statistics the game can report
  rules.md           shown by the "Rules" button above the play field (optional; rules.<lang>.md beside it for a language)
  locales/<lang>.json  the game's words in each language (see Languages)
  server.js          export default function (ctx) { ... }      the rules and the socket handlers
  client/index.js    export default <a Vue component>           the screens, drawn inside the play field
  public/            static files served at /assets/<id>/ (optional)
  README.md, tests   whatever the game needs
```

`<id>` is lowercase letters, digits, and dashes, and must match the folder name.

## module.json

```json
{
  "id": "dixnt",
  "name": "Dixnt",
  "description": "One sentence for the menu card.",
  "minPlayers": 3,
  "maxPlayers": 8,
  "category": "party",
  "rules": "rules.md",
  "stats": [{ "key": "imposterRounds", "label": "Rounds as the imposter", "agg": "sum" }]
}
```

`category` groups the menu: `party`, `cards`, `word`, or anything else (shown as "More games").
`stats` declares the game's own numbers (see Statistics below); `agg` is `sum` (default) or `max`; `"hidden": true` keeps a number out of the Statistics page while still recording it (for achievements, or just to have it).

## Server half: `server.js`

```js
export default function (ctx) {
  ctx.io.on('connection', (socket) => {
    const user = socket.data.user; // { id, name, isBot } - always a signed-in account
    socket.on('something', (payload, ack) => { ... });
  });
  return { dispose() {} };        // optional: called when the site shuts down
}
```

`ctx` provides:

| | |
| --- | --- |
| `ctx.id` | the module id |
| `ctx.io` | a Socket.IO namespace (`/<id>`).  Every connection is already authenticated: `socket.data.user` is `{ id, name, isBot }`.  Unauthenticated clients are refused before `connection`. |
| `ctx.stats.record(result)` | report a finished game (below) |
| `ctx.achievements` | save progress towards achievements and read anyone's (see Achievements below) |
| `ctx.users.get(userId)` | `{ id, username, displayName, isBot, background }` or `null` |
| `ctx.codes` | `generate(isTaken)` makes a three-word room code such as `boss-aware-you`; `normalise(raw)` tidies a typed or pasted one (returns `''` if it is not a code) |
| `ctx.dataDir` | a folder this module may save files in (the site creates it) |
| `ctx.mount(subpath, folder, options)` | serve a folder at `/assets/<id><subpath>` (e.g. card images kept elsewhere) |
| `ctx.log(...)` | logging, prefixed with the module id |

Rules of the road:

- **The server is authoritative.** Send each player only what they are allowed to see (hidden hands, secret roles).
- **Identity is the account.** Use `socket.data.user.id` to recognise a player.  A player may have several sockets
  (phone and laptop) and may reconnect at any time, so a game must cope with that.
- Keep game state in memory and save it under `ctx.dataDir` if it should survive a restart.
- Never trust the payload: validate everything a client sends.  Read numbers and text out of it with `numberFrom` and
  `textFrom` from `shared/input.js`: `Number(x)` and `String(x)` throw for some objects, and a handler that throws on
  garbage is a crash where a refusal was due.

### The shared room server (`shared/roomServer.js`)

Every room-based game (all of them except Dixnt, which keeps its own server) writes its `server.js` as a short call to
`createRoomServer(ctx, options)` instead of copying the socket layer.  It keeps the rooms in memory and saves them
atomically under `ctx.dataDir`, sweeps old rooms, tracks each account's sockets, sends every person their own view, and
handles `create`, `join`/`resume`, `leave`, `kick` and the lobby events (`settings`, `addBot`, `removeBot`, `fillBots`,
`start`, `again`).  The game supplies only what is particular to it:

- `game`: the rules module (`createRoom`, `viewFor`, `statsPlayers`, `isLive`, the seat rules and so on; the full list is
  in the header of `createRoomServer`).
- `pickSettings(payload)`: the settings it accepts from a client.
- `nextAction(room, rng, now, { online })`: what the server must do by itself next, as `{ key?, wait, run }` or `null` (a computer
  move, the pause after a trick, the wait for everyone to close the score pop-up).  The same `key` keeps its timer instead
  of restarting it.  A `run` that throws is retried up to three times with a doubling pause.  `online(id)` says who is
  connected, read afresh whenever it is called, for a game that gives up on somebody who has gone (Scribblers ends a turn
  whose drawer has left).  A connection going is not itself a change to a room, so such a check only happens when the
  room next changes or a timer fires.
- `registerEvents({ on, act, userId, socket, rng, now, roomOf, relay })`: the game's own socket events.  `roomOf()` is the room
  this socket is in; `relay(room, event, payload, { except })` sends an event straight to the room's people, for a stream
  no view can carry.  A view is the whole state of a room, sent to everybody on every change, so a game whose data is far
  too large or too frequent for that (the thousands of strokes of a drawing: see `modules/scribblers`) keeps it out of the
  room, relays it as it is made, and hands the lot to anybody who arrives in the middle.

Seat rules are shared too.  Games with numbered seats build theirs with `createSeatRules` (`shared/seats.js`); games that
keep a list of players use `createRosterRules` (`shared/roster.js`).  Both give you `addHuman`, `removeHuman`, `addBot`,
`removeBot`, `fillWithBots` and `kick`, with these conventions: a person is `{ kind: 'human', id, name }` and a computer
player is `{ kind: 'bot', id: 'bot:<n>', name }` (never a `bot: true` flag); names are made unique whatever their
capitals; and `kick` is refused once the game is over.  A person who leaves a *finished* seated game should leave the
`goneSeat` marker (`{ kind: 'gone', name }`, pass it as `finishedSeat`) rather than an empty seat, so the final scores
still name them and the table never meets a missing seat; `playAgain` then calls `freeGoneSeats(room)`.

**Randomness and the clock are injected.** The server creates `rng` (Math.random) and `now` (Date.now) once and hands them
to the rules and the computer players.  Rules and AIs must not default to `Math.random` or `Date.now`: take an `rng` or
`now` argument, so a test can replay a game from a seed.

## Statistics

When a game finishes, call once per game:

```js
ctx.stats.record({
  code: 'boss-aware-you',            // optional room code, kept with the result
  players: [
    { userId: 7, outcome: 'win',  placement: 1, score: 700, extras: { imposterRounds: 1 } },
    { userId: 9, outcome: 'loss', placement: 2, score: 400, extras: {} },
  ],
});
```

- `outcome` is `'win'`, `'loss'` or `'draw'` (several players may win a tied game). `placement` (1 = best) and `score`
  are optional.  Games that were abandoned should not be recorded.
- `extras` holds numbers only.  The profile page sums (or takes the maximum of) each key declared in `module.json`
  and shows it under the game's name, next to the standard games played, wins, losses, win rate, total and best
  score.  Bots count as players, but the leaderboard leaves them out.

## Achievements

The Achievements page lists every achievement by game (the site's global ones first) and shows each player's level and how
far they are towards the next.  An achievement is a number that grows, and the levels it unlocks at:

```json
"achievements": [
  { "key": "moon", "name": "Shot the moon", "text": "Shoot the moon {n} times", "one": "Shoot the moon",
    "levels": [1, 5, 10, 50, 100], "stat": "moonsShot" },
  { "key": "perfect", "name": "Perfect game", "text": "Finish a game with no points", "levels": "unlock", "stat": "perfectGames" }
]
```

- `levels` are the values at which each level unlocks (ascending, whole numbers), or the name of a tier, by how often the thing happens: `"veryEasy"` (many times a game: 100, 500, 1,000, 2,500, 5,000),
  `"easy"` (a few times a game: 10, 50, 100, 250, 500), `"medium"` (about once a game: 1, 10, 25, 50, 150), `"hard"`
  (once every few games: 1, 5, 10, 25, 50), `"veryHard"` (once in many games: 1, 2, 3, 5, 10) or `"unlock"` (a one-off with a single level: 1).  A game's own achievements top out after 100 to 200 games
  of that game, and from medium up the first level is 1, so the first time always counts.  (The site's global achievements use the same tiers
  scaled to 500 to 1,000 games in `GLOBAL_TIERS`.) Use the tiers unless the levels are special (like "have 30 tiles on your rack").  Progress towards the next level is the value as a fraction of its number, so
  600 cards with levels at 500 and 1,000 is level 1 and 60% of the way to level 2. A one-level achievement has one entry, and is shown as just got or not (no levels or progress bar).
- `text` says what a level asks for, with `{n}` replaced by that level's number; `one` is used instead when the number is 1.
- `stat` makes the value come from the game's recorded results, so it also counts games played before it existed: one of the
  game's own `stats` keys (put what you need in `extras` when you call `ctx.stats.record`), or `played`, `wins`, `losses`,
  `draws`, `totalScore` or `bestScore`. **Leave `stat` out** to keep the progress yourself, with `ctx.achievements`:

| | |
| --- | --- |
| `ctx.achievements.add(userId, key, amount = 1)` | adds to your own saved achievement, or to a global one (`'global.cards'`).  Returns `{ before, after, level, unlocked }` (`unlocked`: this call reached a new level), or `null` for a computer player |
| `ctx.achievements.raise(userId, key, value)` | raises it to `value` if that is more than it is now (for "best ever" numbers) |
| `ctx.achievements.collect(userId, key, items)` | for "have had N different ..." achievements: `items` are whole numbers (card ids, say) the player has just had; each different one counts once, ever, across all games, and the achievement's value is how many different ones that is.  Kept as a bit for each number (`server/collections.js`), so thousands of cards cost a few kilobytes.  Needs a definition without a `stat`; returns like `add`, or `null` for a computer player |
| `ctx.achievements.get(userId, key)` | the current value of any achievement: your own, or a global one as `'global.games'`, `'global.wins'`, `'global.cards'` |
| `ctx.achievements.level(userId, key)` | the level reached (0 for none) |

Every game also gets two without asking: **Played the game** (medium) and **Won the game** (hard), from its recorded results
(a module may define its own `played` or `won` key to replace them).

**Rewards.** Every level unlocked pays 100 gold times its level number (100 for level 1, up to 500 for level 5), once; an achievement with only one level pays a flat 250. The player sees a pop-up wherever they are on
the site (`AchievementPopups`, built on the generic `NoticePopup`), and it is queued until they have seen it.  Levels
a player had already earned when achievements began paying out are paid the first time the site works them out (when they open the
Achievements page, finish a game or are told of an unlock).

Only accounts collect achievements (computer players are skipped), and a key that is not defined, or one that has a `stat`,
throws, so a typo is found by the tests.  The global ones are in `shared/achievements.js`: played games and won games (from
the results) and played cards, which every card game adds to by calling `ctx.achievements.add(userId, 'global.cards')` for
each card a person plays.

Two more global ones are worked out from the games' recorded stats with no help from a game: "Played pieces" adds up Azulejo's
`wallTiles`, Gaudi's `dicePlaced`, Rummikub's `tilesPlayed` and Splendour's `cardsBought` (a global definition says
`sum: [[game, stat], ...]`), and `wonEvery: true` is 1 once every game on the site has been won at least once.
"Big spender" (gold spent) and "Customised" (something paid for from every part of the shop; avatar parts count slot by slot, so hair, eyes
and hats are parts of their own, and a part with only free items is not asked for) take their values from `measure` functions the site
gives `createAchievements`; buying in the shop settles them straight away.
"Indecisive" counts every shop item put on (a background, card back, name style or animation, avatar part, site colour, font, or background
animation swapped for another), whether from the shop or the profile page; the server adds to it when a profile change is saved.
"Welcome" (`measure: 'member'`) is 1 for every account and is paid the moment one is made (existing accounts get it the next time their achievements are
settled); "Persistent" counts games lost.

Three more are the site's own doing, and need nothing from a game.  "Fashionable" counts the things an account has bought
that cost gold (`measure: 'purchases'`), so the free starting background and card back are not among them.  "Out in the shed"
counts minutes on the site (`measure: 'onlineMinutes'`): `server/presence.js` runs a clock while somebody has at least one
page open, so two tabs are one person, and banks it when their last page closes or the site shuts down; the same figure is
the Statistics page's "Time on the site".  "Qapla'" is saved progress rather than a measure, written the moment somebody
chooses Klingon, because an unlock is something you did and changing language again does not undo it.

The site also awards the global `global.slow` by itself: `server/turnClock.js` watches the `state` views a
game sends to each connection and, when the scoreboard says it was that player's turn (`isMe` and `current`) for over ten
minutes and the turn then ends with them still connected, raises it.  A game needs to do nothing beyond keeping the
standard scoreboard `current` flag accurate.

## Client half: `client/index.js`

Export a Vue component.  The site passes these props:

| prop | |
| --- | --- |
| `socket` | a connected Socket.IO client for this module's namespace.  Use it instead of calling `io()`.  It reconnects by itself: listen for `connect` and ask the server for your state again. |
| `user` | the signed-in user `{ id, username, displayName, background }` |
| `search` | the page's query string when it loaded (for example `?boss-aware-you` from an invite link) |
| `setSearch(search)` | change the address bar's query string without reloading, e.g. `setSearch(code)` shows `/play/<id>?code` |

Use the shared look: the site's stylesheet (`src/style.css`) defines CSS variables (`--amber`, `--parchment`,
`--bg-raised`, `--muted`, ...) and the classes `.panel`, `.stack`, `.row`, `.muted` and the button styles
`button`, `button.primary`, `button.quiet`.  Your component sits on a calm panel in the play field and must work on
a phone-width screen as well as a desktop one.  Do not set `body` or `html` styles.  Do not draw your own page
header: the site has one.

**The header: title, Rules, and Leave game.** While a game is open, the site header (not the play area) shows the game's
title and a Rules button at the top right, and a "Leave game" button in the menu bar.  Never draw your own title, Rules
or Leave button.  The title and Rules come from `module.json` and `rules.md`; Leave is switched on by the game:

```js
import { useLeave } from '../../../src/playBar.js';
useLeave({
  canLeave: computed(() => Boolean(state.value)),       // boolean, ref or function: false hides the button
  leave: () => send('leave'),                           // the game's own leave logic (may return a promise)
  confirmText: computed(() => (playing.value ? 'A computer player takes your seat if you leave.' : '')),
});
```

Call it once from the game's top component (it unregisters itself on unmount).  A non-empty `confirmText` makes the
header ask first ("Yes, leave" / "Stay"); an empty one leaves at once. `src/playBar.js` is the whole contract
(`playBar`, `useLeave`, `leaveOffer`).

**The standard screen.** Build the table with `GameFrame` (below): the score bar on top, the table, optional slim bars
for the other players, and two boxes along the bottom that are the same in every game: Recent moves (left, a `GameLog`)
and Status (right, a `GameStatus`).  All status, instruction, and turn messages, and game-state facts (round or turn
number, bag/deck counts, first-player marker, target score), go in Status; errors may be toasts.  Nothing may grow or
shrink while the game is played, and the page never scrolls: the frame is sized from the window only.  Azulejo
(`modules/azulejo/client/Table.vue`) is the reference.

Game addresses: the site serves a module at `/play/<id>`.  A game with invite links should use
`/play/<id>?<code>` (so a link shared with a friend signs them in first, then lands in the right place).

## Languages

Everything a player reads comes from a locale file, so that a language is a set of files and nothing else:

```
src/locales/<lang>.json              the site's words (navigation, shared components, shared refusals ...)
modules/<id>/locales/<lang>.json     a game's words, merged under its id ('hearts.lobby.intro')
modules/<id>/rules.<lang>.md         the rules in that language (beside rules.md, which stays the original)
src/help/<lang>/<page>.md            the Help button's text for each page of the site
```

`src/i18n.js` finds every file at build time (`import.meta.glob`), bundles English and fetches another language the
first time someone chooses it; `LANGUAGES` is whatever `src/locales/` holds.  A game without a translation shows English
for its own words.  The language is the profile's `language` setting (null: the browser's languages, matched by tag and
then by primary subtag), applied by `setUser`; the Intl formatters get `intlLocale()` (`en` is British: `en-GB`).

**In a component** call `useGameText()` (`src/useGameText.js`):

```js
const { t, text, error, list } = useGameText();
t('lobby.intro');                      // the game's key, falling back to the site's ('common.close', 'play.loading' ...)
t('table.tricks', { count }, count);   // plural forms: "{count} trick | {count} tricks"
text(state.pass.label);                // a message the server sent (below); a plain string (a name) comes back as it is
list(names);                           // "Ann, Bob and Cat", as the language joins a list
```

The play view provides the game's id (`GAME_ID`), so neither a game's components nor the shared ones name it; in a
test, `src/testSetup.js` provides it from the test file's folder.

A sentence with markup inside it (a bold word, a link) uses `<i18n-t>`.  That component resolves its `keypath` against the
component's own i18n scope, which `useGameText()` does not create, so inside a game it needs `scope="global"` and the full
key from `keyFor('reveal.wordWas', game)` (`src/messageText.js`).  Without `scope="global"` it draws nothing and warns
"Not found parent scope", which `client/render-all.test.js` catches.  Templates may use `$t('common.close')` for a site
key.  Never build a sentence from pieces: give the whole sentence a key with named params (`"{name} takes the trick."`),
so a translator can reorder it. vue-i18n's syntax: `{name}` is a param, `|` separates plural forms, a literal brace is
`{'{'}` and a literal `@` is `{'@'}`.

**On the server** nothing is ever a sentence.  A refusal is `fail(code, params)` (`shared/seats.js`), where `code` is a
key under `errors.` in the game's file first and the site's second; the site's `src/locales/en.json` has the refusals
every game shares (`notYourTurn`, `notInGame`, `hostOnly`, `gameFull`, `settingsBeforeStart`, `needPerson`,
`allSeatsNeedPlayers` with `{ seats }`, `playersRange` with `{ min, max }` ...), and a game's own go in its file.
HTTP routes throw `new AuthError(code, status, params)` the same way.  The room server forwards a refusal's `params`
to the client, so a sentence with a number in it arrives with the number. `createRoom` cannot return a refusal, so it
refuses by throwing `refusal(code, params)` (`shared/messages.js`); anything else it throws is a bug in the rules, and
the player is told only that something went wrong, never the developer's sentence.  Anything else the client will show comes as a
message, `msg(key, params)` from `shared/messages.js`: a scoreboard round's `label` and `notes`, a player's `note`, a log
line, a status hint, the reason a card cannot be played.  A param may itself be a message (`cardMsg('QS')`,
`suitMsg('H')`) or a list of them, and a numeric `count` param picks the plural form.  The client puts a message into
words with `text()`; `ScoreBoard`, `ScoreTable` and `GameLog`'s default slot already do.  Server tests assert on codes
and message shapes, never on English.

**Names the server defines** (a game's `name` and `description` in module.json, its stat labels and achievements, the
site's achievements, shop items, avatar parts, the menu's categories) stay English in their definition and are
translated by key when a language has one (`src/catalogueText.js`): `<game>.meta.name`, `<game>.meta.description`,
`<game>.stats.<key>`, `<game>.achievements.<key>.name` / `.text` (with `{n}`) / `.one`, `siteAchievements.<key>.*`,
`shop.<itemId>`, `avatar.slots.<slot>`, `avatar.options.<slot>.<id>` and `categories.<key>`.  English files do not
repeat them.

`src/i18n.test.js` keeps all this true for the site and for every game: it fails on text written straight into a
template or a script, on a key nobody wrote, and on a key nobody asks for (`vitest run src/i18n.test.js -t hearts`
checks one game).  Hearts (`modules/hearts`) is the reference for a converted game.

## Tests

Put module tests next to the module as `modules/<id>/*.test.js`; `npm test` runs `server/*.test.js`, `shared/*.test.js`
and `modules/*/*.test.js` with Node's test runner, then the vitest component tests (`src/**/*.test.js` and
`modules/*/client/**/*.test.js`).  Test the rules without sockets where possible, and the socket protocol against a real
site with `launchModule(t, { id, moduleDir })` from `shared/testkit.js` (or `startSite({ port: 0, dataDir, modulesDir })`
from `server/index.js`; see `server/hub.test.js`). `launchModule` fails the test if the server logged a failure (a
handler or a scheduled move that threw, a save that failed); a test that provokes one on purpose passes
`allowServerErrors: true`.

Every module keeps a `views.js` that plays whole seeded games with computer players and records every view the rules
send.  Its `view.test.js` checks those views are the same every time for a seed (and whatever else the game promises of
them), and its `client/render-all.test.js` draws every one of them with the real root component through
`walkViews` (`shared/renderWalk.js`), failing on any error or Vue warning: a state the table cannot draw is a crash a
player would meet.  A new game should have both.  The robustness tests (`modules/<id>/robustness.test.js`) throw
garbage at every socket event in every phase; `handledSocketEvents` in the test kit lists the events a server handles so
that a new event cannot go untested.  jsdom has no canvas, so `src/testSetup.js` gives it enough of a 2D context for a
game that draws to run against a buffer of pixels in a test (Scribblers' `client/draw.test.js` tests the drawing itself
on such a buffer, with no canvas at all).

## Card games

Card games share a few pieces so they look and behave alike:

- `shared/cards.js` (import from a module as `../../shared/cards.js`): the 52-card deck as short strings (`"QS"`,
  `"10H"`), `fullDeck()`, `shuffle(cards, rng)`, `rankValue`, `suitOf`, `sortHand`, `cardName`, ...
- `src/components/PlayingCard.vue` (import as `../../../src/components/PlayingCard.vue` from `modules/<id>/client/`):
  a card drawn in CSS. `<PlayingCard card="QS" />` is a face, `<PlayingCard :card="null" />` is a face-down card drawn
  with the viewer's chosen **card back** (Profile > Card back: a preset design or their own uploaded picture, exposed
  as the CSS variable `--card-back`; any element can use it through the global `.card-back` class).  Props: `size`
  (`sm`/`md`/`lg`), `clickable` (renders a button and emits `pick`), `disabled`, `selected`, `dimmed`.
- **Built-in computer players.** A room has a fixed number of seats; the host can add or remove computer players in the
  lobby, and the game starts only when every seat is taken.  Computer players are not accounts: give them ids like
  `bot:1` and `kind: 'bot'`, drive their turns on the server after a short random delay (so people can follow the play), and leave them
  out of `ctx.stats.record` (only accounts are recorded).
- Hidden information stays on the server: send each player their own hand, and only the *count* of everyone else's.
- `src/components/SeatLobby.vue`: the waiting room for fixed-seat games (seats, add/remove/fill computer players,
  remove a human, Start enabled only when every seat is filled).  Pass `seats` (`{ id, name, kind: 'human' | 'bot' |
  'empty', isHost, isMe, away }`), put the game's own options in the `#settings` slot, and handle `addBot`,
  `removeBot`, `fillBots`, `kick` and `start`.
- **The host can remove any other player at any time** (the Remove button of `PlayerPopup`), so every game's server has a
  host-only removal that the table calls with the seat or account id (never the host's own, never garbage): `kick` for a
  person and `removeBot` for a computer player (Dixnt: `removePlayer` for both).  In the lobby the seat is freed.  In a game
  a person's place is taken over by a computer player (as when they leave) in every game, seated or list-based, with
  their score and their place in the turn order, so nobody's turns are lost; a computer player can only be removed in
  the lobby (Dixnt excepted), because the game needs the player, and the pop-up shows the server's refusal.  Once a game
  is over, `kick` is refused (Cribbage marks the seat as left).
- Overlays (`position: fixed`) work inside the play field, but remember that a game can be played on a phone.

## Trivia questions

Quiz games get their questions through `shared/trivia.js` (import from a module as `../../shared/trivia.js`), so no
game talks to a question source itself.  There are two sources: [The Trivia API](https://the-trivia-api.com) and the
site's own question bank in the database (`server/triviaBank.js`).

- `sharedTrivia()` is the site-wide cache: one store, so two games never ask a player the same question.
  `createTriviaStore(options)` makes a private one (`size`, `region`, `categories`, `difficulties`, `tags`, `bank`, and
  `rng` and `fetchImpl` for the tests).
- `await store.take(n)` gives `n` questions, `n` defaulting to 1, and always as an array.  Each is
  `{ id, question, answers, correct, category, difficulty, tags, regions }`: `answers` is already shuffled and
  `correct` is the index of the right one in it, so a view can render `answers` as it stands.
- `await store.take(n, { category })` gives questions of one category instead; `store.categories` lists the ones it
  holds, and asking for any other throws a `TypeError` rather than quietly answering with something else.  With no
  category named, each question is of one drawn **weighed by how many questions there are of it** across both sources
  - the API has six times as many film and television questions as general knowledge ones, and a site with a thousand
  history questions of its own is asked about history more often still.  `sources()` reports the counts it weighs by,
  totals and `byCategory`.
- **A cacheful a category.**  The store keeps 16 ready *of each* category and refills behind the player's back, so a
  round never waits on the network whichever category it wants.  `prime()` fills them ahead of time (do it when a room
  is made, not when the first question is wanted) and costs one request a category; `prime(category)` fills just the
  one.  `ready` says how many are in hand altogether and `held()` how many of each.
- A store defaults to `region: 'GB'`, which lets in questions that only make sense in the UK alongside the rest.
- When the API cannot supply enough questions, `take` rejects with an Error whose `code` is `triviaUnavailable`;
  servers turn that into a `fail('triviaUnavailable')` rather than showing it.
- Server-side only (it needs `fetch`, and the cache is shared between rooms).
- **The two sources.**  The first time a store needs questions it asks both how many they have of each category (one
  small count request a category), and from then on it chooses between them for *each* question at that category's
  ratio: a bank holding a quarter as many history questions as the API answers about a fifth of the history asked for.
  Either source coming up short is made up for by the other, so a game carries on when the API is down or the bank is
  empty.
- **The counts are kept for a day** (`COUNT_GOOD_FOR`).  Once they are stale the next fill asks again, but nothing
  waits for the answer, `sources()` included: the counts in hand are used, and reported, while the new ones are
  fetched behind the caller.  A count that fails keeps the numbers it had rather than falling back to nothing.  There
  is no timer — a store nobody uses never counts again.
- **The bank.**  `createQuestionBank(db)` (`server/triviaBank.js`) is `count(filters)`, `draw(count, filters)`, and
  `add(questions)`; a question goes in as `{ id?, question, correct, wrong[], category?, difficulty?, tags?, regions? }`
  and comes out of `draw` in the API's own shape, so one `prepare` serves both sources.  `server/index.js` makes the
  bank as the site starts and hands it to the store with `setTriviaBank(bank)`, before any game asks for a question.
  The same filters narrow both sources, regions included: a question with no regions suits everywhere.
- **Categories.**  The API has ten (`CATEGORIES` in `shared/trivia.js`), each answering to several names - `movies`,
  `film`, and `film_and_tv` are all Film & TV.  A question reports only the canonical name, so the store puts a filter
  into that form (`canonicalCategory`, `canonicalCategories`) before either source sees it; ask the bank for `movies`
  directly and it will find nothing, because that is not what its rows say.
- The questions are licensed CC BY-NC 4.0: non-commercial use, with a credit.  The site credits the API in
  `src/help/en/games.md`; if the site is ever run commercially, that licence needs a paid plan.

## Computer players (AIs)

Every game with built-in computer players should offer a range of them, from "smart" to "just pick a random legal
move".  A bot is given one for the whole game when the game starts.  The registry lives in `shared/ai.js`
(`defineAIs`, `pickAI`, `assignAIs`, `aiById`, `describeAI`); what an AI actually decides is up to the game.

**Layout.** A module keeps its AIs in `modules/<id>/ai/`: one file per AI, plus `ai/index.js` that lists them:

```js
import { defineAIs } from '../../../shared/ai.js';
import standard from './standard.js';
import sharp from './sharp.js';
export const AIS = defineAIs([standard, sharp /* , ... */]);
```

Adding an AI is dropping a file in that folder and adding it to the list.  Keep the first entry as the fallback (what
the bots did before AIs existed).  Keep the files free of sockets and files, and of `Math.random`: use the `rng` the game
passes in so that seeded games and tests are repeatable.  The test helper `launchModule` copies the whole module folder,
so a new `ai/` folder needs nothing extra there (a hand-written copy list in a test must include it, and `shared/ai.js`).

**An AI** is a plain object:

| | |
| --- | --- |
| `id` | unique within the game, lowercase; stored in saved rooms, so do not rename one casually |
| `name`, `description` | shown to people (name and description only, never the functions) |
| `weight` | optional, default 1: how often the AI is picked at random.  Make the strongest and the "standard" ones the most common. `0` keeps an AI out of the random pool (it can still be set by id in tests) |
| decision functions | game-specific, each taking one plain-data context (e.g. Hearts: `choosePass(ctx)`, `choosePlay(ctx)`, optional `bidsMoon(ctx)`).  The context holds only what that seat is allowed to know, never other players' hidden cards |

Hearts is the worked example (`modules/hearts/ai/`: `standard`, `sharp`, `moon`, `jack`, `avoider`, `random`).  Its
context is built by `aiContext(room, seat, rng)` in `game.js`.

**What an AI may not do** it does not do: anything needing the network, the clock or a file belongs to the game's socket
layer, which runs it after the AI has decided.  Scribblers is the example: its AIs choose which word to draw, and
`server.js` then fetches a picture of that word and puts it on the board (`modules/scribblers/picture.js`), just as a
quiz game's questions come from `shared/trivia.js` and not from its rules.

**Assignment and state.**

- Each bot seat gets its AI id when the game starts, with `assignAIs(AIS, botSeats, rng)` using the game's own seeded
  `rng` (not `Math.random`, wherever the game is seeded or tested).  Do it after the deal if the first hand of a seeded
  test must not change.  Seats that were bots in the lobby are given theirs at start, and a new game (play again) draws again.
- A bot that takes over from a human who leaves mid-game picks an AI at that moment (`pickAI(AIS, rng)`).
- The id is stored in the room state beside the bot seat (`room.seats[i].ai = 'sharp'`), so it survives a restart, a
  reconnection and a human leaving.  It is part of the server's room object, which is never sent as it is: the view is
  built field by field.  The view MAY show `{ id, name }` (use `describeAI`) as `seats[].ai` for bot seats, and nothing
  else about an AI.  Hearts shows it once the game has started.
- Look an AI up with `aiById(AIS, id)`: a room saved before this existed, or with an AI that was renamed or removed,
  falls back to the first AI instead of breaking.
- Anything an AI needs to remember about the hand (such as the tricks played) must be in the room state too, not in
  the AI: AIs are stateless functions of their context, which is what makes restarts safe.

**Tests.** Test the registry in `shared/ai.test.js`.  For a module, test that every AI plays whole games legally and
that they finish (all-bot tables, several seeds, each option on and off), that each AI shows its distinguishing trait
over many seeded games, that the AI choice is assigned, saved, and restored, and that a pre-AI room still plays.
`modules/hearts/arena.js` (`playGame`, `versus`) and `modules/hearts/ai.test.js` are a template.

## Shared components (everything games should reuse)

All in `src/components/`, import from `modules/<id>/client/` as `../../../src/components/<Name>.vue`:

| | |
| --- | --- |
| `ScoreBoard` | always-visible sticky score bar, plus a large pop-up of every round that opens after each round and at the end (shape in `shared/scores.js`; slots `#round`, `#footer`; emits `continue` when the round pop-up is closed by any route, which is how a person says they are ready for the next round; props `waiting`, `awaiting`; `show()`/`close()`; scoreboard players are `{ id, name, score, isMe?, away?, note?, ready?, bot?, current? }`: `bot: true` gets the `BotIcon` on the chip, and `current: true` (whom the game is waiting for right now: whose turn it is, or, in the party games, everybody still to write, pick, guess, or vote in this phase, which is also what the site's ten-minute `global.slow` clock times) gives the chip a bright glow and `aria-current`, set by the server in every game's view; optional per-player details: prop `hasDetails` `(playerId) => boolean` turns those chips into buttons (aria-label "Show NAME's details"), prop `openDetails` is the id whose details are open (aria-pressed), and event `details` carries the clicked id, or `null` when that one was already open; such chips show a pointer and the tooltip "Show details"; every game wires these through `usePlayerPopup`, below) |
| `PlayerPopup` + `usePlayerPopup` | the standard player dialog opened from another player's score-bar chip, in **every** game: `src/usePlayerPopup.js` holds which player is open, the Esc / click-outside / click-the-chip-again closing (clicks inside the dialog do not close it) and the host's removal; `src/components/PlayerPopup.vue` draws the floating dialog (centred at the top of the main area, over the table so nothing moves): name, `BotIcon` for computer players, away / connected, a "host" badge, the host-only button "Remove player" ("Remove computer player" for computers) with an inline confirmation, and the default slot, the game's own panel for that player (their board, cards, tokens, nominations ...; put `<dl class="facts">` in it for the standard dt/dd look).  Use it: `const { openId, scoreProps, popupProps } = usePlayerPopup({ players: () => scoreboard.players, hostId: () => hostIdInTheSameIdSpace, isHost: () => iAmHost, remove: (id, player) => send(player.bot ? 'removeBot' : 'kick', { seat: id }) })`, then `<ScoreBoard v-bind="scoreProps" ...>` and, first in the `#main` slot, `<PlayerPopup v-if="popupProps" v-bind="popupProps">...panel for `openId`...</PlayerPopup>`. `remove` may return the server's reply: `{ ok: false, error }` keeps the dialog open and shows the error under the button.  A game with no per-game data still gets the dialog (empty panel or the score) |
| `BotIcon` | the small robot glyph for a computer player (`size` px, `label` default "Computer player"); reuse it wherever a seat can be a computer |
| `ScoreTable` | the all-rounds table on its own |
| `GameModal` | a general large pop-up (Esc, backdrop click, focus kept inside) |
| `RoomEntry` | "start a new game / join with a code" screen |
| `InviteCode` | the code pill that copies the invite link |
| `SeatLobby` | seats and computer players waiting room |
| `GameFrame` | the standard screen: a 12-column grid sized to the window (`data-fits-window`, no page scroll).  Slots `scorebar`, `main`, `others`, `log`, `status`; `main` and `others` receive `{ width, height, left, right, gap, mainSpan, columns }` (pixels) so a game can size its pieces.  Props `mainSpan` (columns for the left part of the main row, default 7) and `logSpan` (columns for Recent moves, default 6) set each row's split on the shared grid, so outer edges and gutters line up while splits differ; a game's main content may use `grid-template-columns: subgrid` and `grid-column: span N` |
| `NoticePopup` | the generic small pop-up over the top of the page: slot content, `active`, `duration`, `autoHide` (false: stays until OK), OK button, `name` (extra class), `row` (stack two). `YourTurnPopup` and the achievement unlocks are built on it |
| `GameStatus` | the content of the Status box: `headline` (+ `mine` for the accent colour), `lines` (strings or `{ text, tone }`), slot `facts` (the persistent round/bag/lid line) and a default slot; fills its box and scrolls inside |
| `PlayingCard` | a CSS-drawn card, or a face-down card with the viewer's card back |

Two helpers beside them, imported from `modules/<id>/client/` as `../../../src/<name>.js`:

| | |
| --- | --- |
| `useTurnClock(getState)` | counts the seconds down from the `remaining` milliseconds a view carries, re-anchoring to the local clock on every new view, so a game never depends on the server's clock agreeing with the player's (Rummikub, Scribblers) |
| `usePlayerPopup(...)` | which player's details are open, and the host's removal (see `PlayerPopup` above) |

Before writing a new screen for a game, check whether one of these already does the job; if you build something that
two games would want, put it here and add it to this list.
