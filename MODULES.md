# Writing a game module

The site (accounts, profiles, statistics, the game menu, the header) is generic. A game is a folder in `modules/<id>/`
that plugs into it. The site starts the module's **server half** on a socket namespace of its own and loads its
**client half** into the central play field.

```
modules/<id>/
  module.json        what the menu shows, and which statistics the game can report
  rules.md           shown by the "Rules" button above the play field (optional)
  server.js          export default function (ctx) { ... }      the rules and the socket handlers
  client/index.js    export default <a Vue component>           the screens, drawn inside the play field
  public/            static files served at /assets/<id>/ (optional)
  README.md, tests   whatever the game needs
```

`<id>` is lowercase letters, digits and dashes, and must match the folder name.

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
`stats` declares the game's own numbers (see Statistics below); `agg` is `sum` (default) or `max`.

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
| `ctx.io` | a Socket.IO namespace (`/<id>`). Every connection is already authenticated: `socket.data.user` is `{ id, name, isBot }`. Unauthenticated clients are refused before `connection`. |
| `ctx.stats.record(result)` | report a finished game (below) |
| `ctx.users.get(userId)` | `{ id, username, displayName, isBot, background }` or `null` |
| `ctx.codes` | `generate(isTaken)` makes a three-word room code such as `boss-aware-you`; `normalise(raw)` tidies a typed or pasted one (returns `''` if it is not a code) |
| `ctx.dataDir` | a folder this module may save files in (the site creates it) |
| `ctx.mount(subpath, folder, options)` | serve a folder at `/assets/<id><subpath>` (e.g. card images kept elsewhere) |
| `ctx.log(...)` | logging, prefixed with the module id |

Rules of the road:

- **The server is authoritative.** Send each player only what they are allowed to see (hidden hands, secret roles).
- **Identity is the account.** Use `socket.data.user.id` to recognise a player. A player may have several sockets
  (phone and laptop) and may reconnect at any time, so a game must cope with that.
- Keep game state in memory and save it under `ctx.dataDir` if it should survive a restart.
- Never trust the payload: validate everything a client sends.

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
  are optional. Games that were abandoned should not be recorded.
- `extras` holds numbers only. The profile page sums (or takes the maximum of) each key declared in `module.json`
  and shows it under the game's name, next to the standard games played, wins, losses, win rate, total and best
  score. Bots count as players, but the leaderboard leaves them out.

## Client half: `client/index.js`

Export a Vue component. The site passes these props:

| prop | |
| --- | --- |
| `socket` | a connected Socket.IO client for this module's namespace. Use it instead of calling `io()`. It reconnects by itself: listen for `connect` and ask the server for your state again. |
| `user` | the signed-in user `{ id, username, displayName, background }` |
| `search` | the page's query string when it loaded (for example `?boss-aware-you` from an invite link) |
| `setSearch(search)` | change the address bar's query string without reloading, e.g. `setSearch(code)` shows `/play/<id>?code` |

Use the shared look: the site's stylesheet (`src/style.css`) defines CSS variables (`--amber`, `--parchment`,
`--bg-raised`, `--muted`, ...) and the classes `.panel`, `.stack`, `.row`, `.muted` and the button styles
`button`, `button.primary`, `button.quiet`. Your component sits on a calm panel in the play field and must work on
a phone-width screen as well as a desktop one. Do not set `body` or `html` styles. Do not draw your own page
header: the site has one.

**The header: title, Rules and Leave game.** While a game is open, the site header (not the play area) shows the game's
title and a Rules button at the top right, and a "Leave game" button in the menu bar. Never draw your own title, Rules
or Leave button. The title and Rules come from `module.json` and `rules.md`; Leave is switched on by the game:

```js
import { useLeave } from '../../../src/playBar.js';
useLeave({
  canLeave: computed(() => Boolean(state.value)),       // boolean, ref or function: false hides the button
  leave: () => send('leave'),                           // the game's own leave logic (may return a promise)
  confirmText: computed(() => (playing.value ? 'A computer player takes your seat if you leave.' : '')),
});
```

Call it once from the game's top component (it unregisters itself on unmount). A non-empty `confirmText` makes the
header ask first ("Yes, leave" / "Stay"); an empty one leaves at once. `src/playBar.js` is the whole contract
(`playBar`, `useLeave`, `leaveOffer`).

**The standard screen.** Build the table with `GameFrame` (below): the score bar on top, the table, optional slim bars
for the other players, and two boxes along the bottom that are the same in every game: Recent moves (left, a `GameLog`)
and Status (right, a `GameStatus`). All status, instruction and turn messages, and game-state facts (round or turn
number, bag/deck counts, first-player marker, target score), go in Status; errors may be toasts. Nothing may grow or
shrink while the game is played, and the page never scrolls: the frame is sized from the window only. Azulejo
(`modules/azulejo/client/Table.vue`) is the reference.

Game addresses: the site serves a module at `/play/<id>`. A game with invite links should use
`/play/<id>?<code>` (so a link shared with a friend signs them in first, then lands in the right place).

## Tests

Put module tests next to the module as `modules/<id>/*.test.js`; `npm test` runs `server/*.test.js` plus
`modules/*/*.test.js`. Test the rules without sockets where possible, and the socket protocol against a real
site with `startSite({ port: 0, dataDir, modulesDir })` from `server/index.js` (see `server/hub.test.js`).

## Card games

Card games share a few pieces so they look and behave alike:

- `shared/cards.js` (import from a module as `../../shared/cards.js`): the 52-card deck as short strings (`"QS"`,
  `"10H"`), `fullDeck()`, `shuffle(cards, rng)`, `rankValue`, `suitOf`, `sortHand`, `cardName`, ...
- `src/components/PlayingCard.vue` (import as `../../../src/components/PlayingCard.vue` from `modules/<id>/client/`):
  a card drawn in CSS. `<PlayingCard card="QS" />` is a face, `<PlayingCard :card="null" />` is a face-down card drawn
  with the viewer's chosen **card back** (Profile > Card back: a preset design or their own uploaded picture, exposed
  as the CSS variable `--card-back`; any element can use it through the global `.card-back` class). Props: `size`
  (`sm`/`md`/`lg`), `clickable` (renders a button and emits `pick`), `disabled`, `selected`, `dimmed`.
- **Built-in computer players.** A room has a fixed number of seats; the host can add or remove computer players in the
  lobby, and the game starts only when every seat is taken. Computer players are not accounts: give them ids like
  `bot:1`, drive their turns on the server after a short random delay (so people can follow the play), and leave them
  out of `ctx.stats.record` (only accounts are recorded).
- Hidden information stays on the server: send each player their own hand, and only the *count* of everyone else's.
- `src/components/SeatLobby.vue`: the waiting room for fixed-seat games (seats, add/remove/fill computer players,
  remove a human, Start enabled only when every seat is filled). Pass `seats` (`{ id, name, kind: 'human' | 'bot' |
  'empty', isHost, isMe, away }`), put the game's own options in the `#settings` slot, and handle `addBot`,
  `removeBot`, `fillBots`, `kick` and `start`.
- Overlays (`position: fixed`) work inside the play field, but remember that a game can be played on a phone.

## Computer players (AIs)

Every game with built-in computer players should offer a range of them, from "smart" to "just pick a random legal
move". A bot is given one for the whole game when the game starts. The registry lives in `shared/ai.js`
(`defineAIs`, `pickAI`, `assignAIs`, `aiById`, `describeAI`); what an AI actually decides is up to the game.

**Layout.** A module keeps its AIs in `modules/<id>/ai/`: one file per AI, plus `ai/index.js` that lists them:

```js
import { defineAIs } from '../../../shared/ai.js';
import standard from './standard.js';
import sharp from './sharp.js';
export const AIS = defineAIs([standard, sharp /* , ... */]);
```

Adding an AI is dropping a file in that folder and adding it to the list. Keep the first entry as the fallback (what
the bots did before AIs existed). Keep the files free of sockets and files, and of `Math.random`: use the `rng` the game
passes in so that seeded games and tests are repeatable. The test helper `launchModule` copies the whole module folder,
so a new `ai/` folder needs nothing extra there (a hand-written copy list in a test must include it, and `shared/ai.js`).

**An AI** is a plain object:

| | |
| --- | --- |
| `id` | unique within the game, lowercase; stored in saved rooms, so do not rename one casually |
| `name`, `description` | shown to people (name and description only, never the functions) |
| `weight` | optional, default 1: how often the AI is picked at random. Make the strongest and the "standard" ones the most common. `0` keeps an AI out of the random pool (it can still be set by id in tests) |
| decision functions | game-specific, each taking one plain-data context (e.g. Hearts: `choosePass(ctx)`, `choosePlay(ctx)`, optional `bidsMoon(ctx)`). The context holds only what that seat is allowed to know, never other players' hidden cards |

Hearts is the worked example (`modules/hearts/ai/`: `standard`, `sharp`, `moon`, `jack`, `avoider`, `random`). Its
context is built by `aiContext(room, seat, rng)` in `game.js`.

**Assignment and state.**

- Each bot seat gets its AI id when the game starts, with `assignAIs(AIS, botSeats, rng)` using the game's own seeded
  `rng` (not `Math.random`, wherever the game is seeded or tested). Do it after the deal if the first hand of a seeded
  test must not change. Seats that were bots in the lobby are given theirs at start, and a new game (play again) draws again.
- A bot that takes over from a human who leaves mid-game picks an AI at that moment (`pickAI(AIS, rng)`).
- The id is stored in the room state beside the bot seat (`room.seats[i].ai = 'sharp'`), so it survives a restart, a
  reconnection and a human leaving. It is part of the server's room object, which is never sent as it is: the view is
  built field by field. The view MAY show `{ id, name }` (use `describeAI`) as `seats[].ai` for bot seats, and nothing
  else about an AI. Hearts shows it once the game has started.
- Look an AI up with `aiById(AIS, id)`: a room saved before this existed, or with an AI that was renamed or removed,
  falls back to the first AI instead of breaking.
- Anything an AI needs to remember about the hand (such as the tricks played) must be in the room state too, not in
  the AI: AIs are stateless functions of their context, which is what makes restarts safe.

**Tests.** Test the registry in `shared/ai.test.js`. For a module, test that every AI plays whole games legally and
that they finish (all-bot tables, several seeds, each option on and off), that each AI shows its distinguishing trait
over many seeded games, that the AI choice is assigned, saved and restored, and that a pre-AI room still plays.
`modules/hearts/arena.js` (`playGame`, `versus`) and `modules/hearts/ai.test.js` are a template.

## Shared components (everything games should reuse)

All in `src/components/`, import from `modules/<id>/client/` as `../../../src/components/<Name>.vue`:

| | |
| --- | --- |
| `ScoreBoard` | always-visible sticky score bar, plus a large pop-up of every round that opens after each round and at the end (shape in `shared/scores.js`; slots `#round`, `#footer`; emits `continue` when the round pop-up is closed by any route, which is how a person says they are ready for the next round; props `waiting`, `awaiting`; `show()`/`close()`; scoreboard players are `{ id, name, score, isMe?, away?, note?, ready?, bot?, current? }`: `bot: true` gets the `BotIcon` on the chip, and `current: true` (whose turn it is; in Dixnt the word-chooser; in Tints and Hints the hinter) gives the chip a bright glow and `aria-current`, set by the server in every game's view; optional per-player details: prop `hasDetails` `(playerId) => boolean` turns those chips into buttons (aria-label "Show NAME's details"), prop `openDetails` is the id whose details are open (aria-pressed), and event `details` carries the clicked id, or `null` when that one was already open) |
| `BotIcon` | the small robot glyph for a computer player (`size` px, `label` default "Computer player"); reuse it wherever a seat can be a computer |
| `ScoreTable` | the all-rounds table on its own |
| `GameModal` | a general large pop-up (Esc, backdrop click, focus kept inside) |
| `RoomEntry` | "start a new game / join with a code" screen |
| `InviteCode` | the code pill that copies the invite link |
| `SeatLobby` | seats and computer players waiting room |
| `GameFrame` | the standard screen: a 12-column grid sized to the window (`data-fits-window`, no page scroll). Slots `scorebar`, `main`, `others`, `log`, `status`; `main` and `others` receive `{ width, height, left, right, gap, mainSpan, columns }` (pixels) so a game can size its pieces. Props `mainSpan` (columns for the left part of the main row, default 7) and `logSpan` (columns for Recent moves, default 6) set each row's split on the shared grid, so outer edges and gutters line up while splits differ; a game's main content may use `grid-template-columns: subgrid` and `grid-column: span N` |
| `GameStatus` | the content of the Status box: `headline` (+ `mine` for the accent colour), `lines` (strings or `{ text, tone }`), slot `facts` (the persistent round/bag/lid line) and a default slot; fills its box and scrolls inside |
| `PlayingCard` | a CSS-drawn card, or a face-down card with the viewer's card back |

Before writing a new screen for a game, check whether one of these already does the job; if you build something that
two games would want, put it here and add it to this list.
