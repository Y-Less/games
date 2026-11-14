# Writing a game module

This file is the contract: everything a module may do.  If you have not written one before, read `TUTORIAL.md` first —
it builds one small game from an empty folder to a finished table, in the order you would actually write it, and sends
you back here for the details.

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
| `ctx.games` | the *other* games: `list()` their manifests (never this one's), `open(id, options)` a started room in one of them, `onFinished(handler)` to hear when any game anywhere ends (below) |
| `ctx.dataDir` | a folder this module may save files in (the site creates it) |
| `ctx.mount(subpath, folder, options)` | serve a folder at `/assets/<id><subpath>` (e.g. card images kept elsewhere) |
| `ctx.markers` | marker colours (`shared/markerColours.js`): `canCustom(userId)` says whether a player has unlocked any colour, and `preferred(userId)` is the default they saved if they may still use it, else `null` |
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

Every room-based game writes its `server.js` as a short call to
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
  whose drawer has left).  A connection going is not a change to a room, but it is asked for again when one goes, so a
  game that waits on somebody who has left can set that timer there and then rather than at the next change.
- `registerEvents({ on, act, userId, socket, rng, now, roomOf, relay })`: the game's own socket events.  `roomOf()` is the room
  this socket is in; `relay(room, event, payload, { except })` sends an event straight to the room's people, for a stream
  no view can carry.  A view is the whole state of a room, sent to everybody on every change, so a game whose data is far
  too large or too frequent for that (the thousands of strokes of a drawing: see `modules/scribblers`) keeps it out of the
  room, relays it as it is made, and hands the lot to anybody who arrives in the middle.

Seat rules are shared too.  Games with numbered seats build theirs with `createSeatRules` (`shared/seats.js`); games that
keep a list of players use `createRosterRules` (`shared/roster.js`).  Those two are front doors, not implementations:
joining, leaving, being replaced and being put out are written once in `shared/members.js`, and the only thing the two
families really disagree about — how a place is addressed, and what an empty one is — lives in `shared/layout.js` as a
`layout`.  `shared/members.test.js` is the contract: it asserts the whole story of both families side by side, and says
plainly where they are meant to differ, so that the one telling cannot quietly change it.  Both give you `addHuman`,
`removeHuman`, `addBot`, `removeBot`, `fillWithBots` and `kick`, with these conventions: a person is
`{ kind: 'human', id, name }` and a computer
player is `{ kind: 'bot', id: 'bot:<n>', name }` (never a `bot: true` flag); names are made unique whatever their
capitals; and `kick` is refused once the game is over.  A person who leaves a *finished* seated game should leave the
`goneSeat` marker (`{ kind: 'gone', name }`, pass it as `finishedSeat`) rather than an empty seat, so the final scores
still name them and the table never meets a missing seat; `playAgain` then calls `freeGoneSeats(room)`.

**How many seats a room has is one question, and both families answer it the same way.**  Tell `createSeatRules` or
`createRosterRules` the game's `minPlayers`, `maxPlayers`, and `fillTo` (how many seats "fill with computer players"
makes up, four by default, or the nearest the game allows — Cribbage says two), and you get `sizeOf`, `setSize`, and
`lockSize` beside the rest.  A room opens with every seat the game allows, so nobody who could have joined it is
turned away; `setSize` lets the host take seats away, within the limits and never below the people already sitting
(the host puts somebody out first — the rules never choose who goes); and the game's `start` calls `lockSize`
**before it deals**, because from then on how much there is to deal is read off the seats.  Answer every refusal
before `lockSize`, since settling renumbers the seats and a start that does not happen must leave the lobby as it was.
Send the count to the client as `sizeOf(room)` and never keep a second copy of it: a seated room's seats are
`room.seats`, and a list counts them in `room.size`.  Seats are only ever taken away in the lobby, and a computer
player sitting in one there is a player like any other, holding it for nobody; it is only once the game is under way
that a seat stands in for somebody who left, and that a latecomer can take one over.

**A lobby that says what you would be dealt asks `wouldPlay`, and sends the answer.**  The seats a room has and the
game it would make are two different numbers: a room of seven with two people in it would be a game of two.  So a
lobby that describes the deal — Hearts' "Five players: 10 cards each", Cheat's packs, Cribbage's cards, Azulejo's
plates, Gaudi's dice, Rummikub's hands — works it out from `wouldPlay(room, min)` (`shared/seats.js`) and sends it as
`playing` in the view, rather than each client counting seats for itself.  The floor matters: a host sitting alone is
not a game of one, and the smallest game the room could become is the honest thing to show them — some of these
sentences are looked up per count (`lobby.deal.2`) and have nothing to say below the minimum.

**A place changes hands both ways.**  When somebody leaves a game under way, a computer player takes their place, keeps
their score and whatever else was theirs, and remembers whose place it is holding (`stoodInFor`).  When somebody joins a
game under way — a friend slow to open the invitation, or the leaver coming back — they take a computer player's place
the same way round.  Their own comes first if it is still being held for them; failing that, one the host added, so that
the others who might yet come back keep theirs; failing that, the first.  A game with nobody but people in it answers
`gameFull`, and a game that is over answers `thatGameStarted`.

Both directions are the same renaming, so write it once.  `takeOver(room, oldId, member, rng, now, seat)` renames the
person to the computer player; `handOver(room, botId, person, bot, seat)` renames the computer player to the person.
**Both are given the member already in its place, and change it where it sits — they return nothing.**  (They used to
have one shape in each family, and the seated one returned the object to store; that is why a hook returning a new
object now has no effect, silently.)  What a place *becomes* is the separate `replacement(room, leaving, bot)` hook,
and its default is the family's: a seated game starts the place afresh, because it keeps the hand and the pegs in
arrays beside the seats, while a game with a list hands the place over as it stands, because it keeps all of that on
the member.  Cribbage is the one seated game that says otherwise, since it does keep its pegs on the seat.

A game with numbered seats usually needs no renaming at all (the seat index
is the identity, so the cards and the pegs come with the seat), only a hook to drop what belongs to a computer player
alone — Cribbage's `replaced` mark, Splendour's entry in `room.ais`.  A game that keeps a list of players identifies its
players by id, so it must rename that id everywhere it writes one down; factor that into a `renameId(room, from, to)`
and call it from both (see `modules/just-one/game.js`).  The shared code takes `ai` and `stoodInFor` off before your
hook runs.  Get this wrong and the fuzz tests say so: an answer or a clue left under the old id fails "the answers are
from players in the room" within a few hundred random steps.

**The scoreboard history is the one thing `renameId` must not touch.**  Every player in a list game has a `slot` — a
string like `"s0"` that `shared/roster.js` hands out once when they join and that travels with the place through every
one of those changes of hands.  Write the history against the slot (`deltas[player.slot]`, `notes[player.slot]`) and it
never has to be written twice; `historyView(room)` turns it back into the player ids the scoreboard has always been
sent, so your `scoreboardView` is `rounds: historyView(room)` and nothing on the wire changes.  Games with numbered
seats already do the same thing with the seat index, which is their slot.

**A room outlives the game being played in it.**  "Play again" keeps the code, the settings and the people, and starts
the next game among them, so a room is a container of games rather than one game that gets wiped.  Call `nextGame(room)`
at the top of your `playAgain` — both families export it — and go on resetting whatever your game holds, `history: []`
and `recorded: false` included; the helper only advances `room.gameSeq`.  That number is in the key the rounds are
saved under, which is what lets the game just finished keep its scoreboard: before it existed, emptying the history on
a replay deleted every round of the game before.  Do **not** reset `room.nextSlot` — the people carry on into the next
game, so their slots must too, and somebody joining it must not be handed one that is already in use.

**Every game plays again in place, and none is ended early.**  `playAgain` is for the host, and for a game that is
over: anybody else is answered `hostOnly`, and a game under way (or a room already in its lobby) `notOver`.  A game
with a list of players writes it as one call to `backToLobby(room, id, { blank, keep, freshPlayer })`
(`shared/roster.js`), which does all of the above: `blank` is a room as `createRoom` makes it, copied over the old one
so that a field added later is reset without anybody remembering to; `keep` names the settings that survive; and
`freshPlayer` is what each player starts the next game with.  `shared/playAgain.test.js` asserts the same promises of
every such game, so add yours to its list.  On the client, put `<PlayAgain :state="state" @again="send('again')" />`
(`src/components/PlayAgain.vue`) in the Status box: it draws the host's button once the game is over and nothing
otherwise.

The slot is `"s0"` and not `0` for a reason worth knowing before you write a key by hand.  Account ids are small
numbers too, so a numeric slot and an id cannot be told apart once either is a key of an object, and reading a history
by the wrong one finds *the wrong player's points* rather than finding nothing.  Two bugs were written exactly that way
while slots were being introduced, and in both the test that should have caught it passed.

Do not reach for `renameInHistory`.  It exists for one legacy importer and is the thing slots were introduced to stop
needing.

**The small things every list game wants are written once.**  `shared/roster.js` has `playerOf(room, id)`,
`namer(room, nameOf)` (a player's saved name, else the account's), and `renameField(holder, was, now)` for a `migrate`
that has renamed something a saved room still calls by its old word.  `shared/roomServer.js` has `accountNames(ctx)`,
which is the `nameOf` a `server.js` hands to its rules, and `insist(outcome)`, which turns a refused rule into a throw
inside a `nextAction`'s `run` so that the room server's retry takes over.  Beside them are the shapes a `nextAction`
returns: `botMove(action, wait, play)` for a computer player's move (one that plays nothing is a failure),
`afterWait(key, wait, rule)` for a rule the server runs when a wait runs out, and `soonest(due, now)` for a game that
runs several clocks off the one timer.  A phase that waits for everybody to close the scores is
`createReadyRules({ finish, phase })` (`shared/roster.js`), which gives `ready`, `forceNext`, `waitingForReady`, and
`unready`; an AI is asked through `attempt` (`shared/ai.js`), so that one that throws falls back to a legal choice.

**Games where people type guesses at a drawing** (Scribblers, Draw!) share `shared/guessing.js`: `cleanGuess`, the
feed of what everybody has typed (`addFeed`), how fast one player may type (`tooFast`), the characters of a word that
are never hidden (`ALWAYS_SHOWN`), and a computer player's turn at it (`nextGuesser`, `botWordChoice`,
`botGuessText`).  What a right guess scores, and when a turn ends, stay in the game.

**Randomness and the clock are injected.** The server creates `rng` (Math.random) and `now` (Date.now) once and hands them
to the rules and the computer players.  Rules and AIs must not default to `Math.random` or `Date.now`: take an `rng` or
`now` argument, so a test can replay a game from a seed.

### Where the rooms are kept

A module's rooms live in `rooms.sqlite` in its `ctx.dataDir`, and `shared/roomStore.js` is the only thing that touches
it.  A game never reads or writes it: `createRoomServer` loads the rooms at start-up, holds them in memory, and saves a
room when it changes, so nothing in the course of playing reads from disk.

Two things about the shape are worth knowing while writing rules:

- **The history is a table of its own, one row per finished round, and only ever appended to.**  That is what makes an
  ordinary move cost one small write instead of rewriting every room in the game.  A game that rewrites rounds it has
  already written still works — the store notices and puts it right — but it is paying for it, so prefer not to.
- **A room with no history and a room whose history is empty are different rooms.**  If your `migrate` shows the scores
  a room already had as one "earlier rounds" row when it was saved before you kept a history (Dixnt and Tints and Hints
  both do), it is telling those two apart, and the store keeps the difference for you.  Test it: delete `history` from a
  saved room and load it again.

In tests, read what was saved with `savedRooms(dataDir)` from `shared/testkit.js` rather than opening the file: that is
the one place that knows where rooms are kept.  To rig a saved room and restart — a dealt hand you want to control, a
room aged a fortnight — write it as a `rooms.json` beside an emptied database and let the start-up import pick it up,
which exercises the path a real site upgrading takes once (`modules/nomination-whist/e2e.test.js` does this).

## Reaching the other games (`ctx.games`)

Modules are sealed from one another: each has its own socket namespace, its own rooms, its own saved file and its own
codes, and that is deliberate — a game should not be able to reach into another one.  The single exception is a module
whose whole job is to decide *which* game is played next (the tour), and `ctx.games` is the narrow door it uses.  Most
games will never touch it.

- `ctx.games.list()` — every **other** loaded module's manifest, by name.  `minPlayers` and `maxPlayers` are what you
  want: they say which games a given number of people could actually play.
- `ctx.games.open(id, { hostId, hostName, people, size, settings })` — opens a room in that game **already under way**,
  and answers `{ ok: true, code, seated }`.  It seats the host and as many of `people` as the game will hold (`seated`
  says who got in), fills the rest of `size` with computer players, and starts it.  Nobody is connected to it: the
  people walk in by code, through the ordinary `join`, exactly as they would from an invitation.  A game that refuses
  answers `{ ok: false, error }` — it never throws.  A module that is not room-based cannot be opened.
- `ctx.games.onFinished(handler)` — `handler(gameId, room)` whenever a game in **any** module finishes.  It is called
  once per game, from the same place and under the same guard as the statistics (`shared/roomLife.js`), so a room that
  goes on changing afterwards does not report itself twice.  It returns a function that stops listening.

Nothing is asked of a game to take part in this.  `openFor` is on the handle `createRoomServer` already returns and
`ctx.onGameFinished` is supplied by the site, so every room-based module is openable and reports its finished games
without a word in its own `server.js`.

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

**Rewards.** Every level unlocked pays 100 Gilders times its level number (100 for level 1, up to 500 for level 5), once; an achievement with only one level pays a flat 250. The player sees a pop-up wherever they are on
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
"Big spender" (Gilders spent) and "Customised" (something paid for from every part of the shop; avatar parts count slot by slot, so hair, eyes
and hats are parts of their own, and a part with only free items is not asked for) take their values from `measure` functions the site
gives `createAchievements`; buying in the shop settles them straight away.
"Indecisive" counts every shop item put on (a background, card back, name style or animation, avatar part, site colour, font, or background
animation swapped for another), whether from the shop or the profile page; the server adds to it when a profile change is saved.
"Welcome" (`measure: 'member'`) is 1 for every account and is paid the moment one is made (existing accounts get it the next time their achievements are
settled); "Persistent" counts games lost.

Three more are the site's own doing, and need nothing from a game.  "Fashionable" counts the things an account has bought
that cost Gilders (`measure: 'purchases'`), so the free starting background and card back are not among them.  "Out in the shed"
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
`minPlayers` with `{ min }`, `playersRange` with `{ min, max }`, `removeBeforeFewerPlayers` ...), and a game's own go in its file.
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

Put module tests next to the module as `modules/<id>/*.test.js`; `npm test` first type-checks (see below), then runs
`server/*.test.js`, `shared/*.test.js`
and `modules/*/*.test.js` with Node's test runner, then the vitest component tests (`src/**/*.test.js` and
`modules/*/client/**/*.test.js`).

**The JSDoc in `shared/` and `server/` is checked, and your module's is not.**  `npm test` runs `tsc --noEmit` over
those two folders (`npm run test:types` on its own), which reads the `@param` and `@returns` already written there and
reports where they no longer match the code — a `@param {object}` whose fields are then read, a `@returns` that has
lost a field somebody added later, a documentation block that has drifted onto the wrong function.  Nothing is
compiled and no file is renamed.  Game modules and the client are out of scope for now, so your `game.js` is checked
only where it calls into `shared/`; the discipline is still worth keeping, because a module that documents itself
honestly is one that can be brought in later without a day of corrections.  Test the rules without sockets where possible, and the socket protocol against a real
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
game that draws to run against a buffer of pixels in a test (`src/drawBoard.test.js` tests the drawing itself
on such a buffer, with no canvas at all).

**A failure under load may be the load.**  Much of this suite waits on real things — a site on a real port, a real
browser, a computer player's timer, a view arriving over a socket — so a machine that is busy can miss a deadline that
is nowhere near missed on a quiet one.  Before believing a failure, **run it again**, on its own
(`node --test modules/hearts/lifecycle.test.js`, `vitest run src/i18n.test.js -t hearts`), with nothing else running.
A failure that comes back every time is a real one.  Say which it was when reporting a failure, and how many runs it
took to tell: "fails every time in three runs" and "failed once in three" are different findings.

**But a failure that comes and goes is not automatically the machine.**  Four such failures were run down while this
suite was being changed, and *none* of them wanted a longer wait; every one was a test asserting something it had not
actually waited for, and each had an exact fix:

- **Wait for the thing you are about to assert, not for something that usually implies it.**  Scribblers waited for the
  first guess from a computer player and then asserted that one of the guesses was of the right length.  They guess one
  at a time, so the first one through need not be that one.
- **A loop that plays for you can play past the point you meant to stop at.**  A `playOn(people, done)` that checks
  `done()` once per pass closes one person's round-end pop-up, lets the next person's state arrive while that call is
  in flight, and closes theirs too — which is everybody ready, so the next round is dealt and played out before the
  loop looks again.  Check `done()` before each person.
- **Take a snapshot only when the server has nothing of its own to do.**  Comparing a room before and after a restart
  means catching it on a human's turn, where `pendingAction` is null and no timer can fire; anywhere else a computer
  player can move between the snapshot and the shutdown.
- **A leak check that asks "does this text contain the secret" will accuse the innocent.**  Draw's word list holds
  "raw", which is inside the error code `notYourTurnToDraw`, and "error", which is the name of the field every refusal
  carries.  See the secrecy section below for what to do instead.

A longer wait is the right answer when a test is genuinely waiting for something slow.  It is the wrong answer when
the test never waited for the right thing at all, and so is relaxing the assertion: both hide whichever of the above
it was.  Look for the exact fix first, and if you cannot find one, say so rather than loosening the test quietly.

### Secrecy: does a view tell its reader too much?

Every game keeps something back — a hand, the word only the drawer knows, the dice still in the bag, the target only
the psychic sees — and `viewFor` is what keeps it.  A bug there is silent: the game plays correctly and the wrong
player simply knows too much, which no ordinary test notices.

`shared/leaks.js` is the mechanism; the policy stays in the game.  A new game gets the same protection by writing one
function saying what a viewer may see, and calling `assertNoLeaks(view, policy)` over the views its `views.js` already
records:

```js
assertNoLeaks(view, { allowed: allowedCards(view), pattern: CARD, who: `seat ${view.you}` });   // secrets that are ids
assertNoLeaks(view, { forbidden: [{ text: room.word, why: 'the word reached a guesser' }] });   // secrets that are not
```

Use `allowed` with `pattern` when the secret is an identifier — a card, a die, a tile with a name — and `forbidden`
when it is a value in its own right.  Both compare against what the view *says*: a secret is only named when it stands
on its own, never as part of a longer word, and never because a **key** happens to spell it.  Both of those are real
bugs this check has already had.

What `shared/leaks.js` deliberately does **not** do is check that a view is a legal view at all — a phase in range, no
duplicate players, counts matching their source, scores matching the scoreboard.  That is a separate concern and lives
in the game's own checks (`modules/tints-and-hints/checks.js` is the fullest example).  Keep the two apart: they fail
for different reasons and want different messages.

The UI tests (`npm run test:ui`) are the ones to be most careful with: they drive a real Chrome and are not run by
`npm test`, so they are both the slowest and the likeliest to have gone stale without anybody noticing.  Prefer an
assertion that reads the truth from the source — the count of a game's achievements from its `module.json`, say —
over a number written into the test, which is a number that goes quietly wrong the next time somebody adds one.

## Card games

Card games share a few pieces so they look and behave alike:

- `shared/cards.js` (import from a module as `../../shared/cards.js`): the 52-card deck as short strings (`"QS"`,
  `"10H"`), `fullDeck()`, `shuffle(cards, rng)`, `rankValue`, `suitOf`, `sortHand`, `cardName`, ...
- `src/components/PlayingCard.vue` (import as `../../../src/components/PlayingCard.vue` from `modules/<id>/client/`):
  a card drawn in CSS. `<PlayingCard card="QS" />` is a face, `<PlayingCard :card="null" />` is a face-down card drawn
  with the viewer's chosen **card back** (Profile > Card back: a preset design or their own uploaded picture, exposed
  as the CSS variable `--card-back`; any element can use it through the global `.card-back` class).  Props: `size`
  (`sm`/`md`/`lg`), `clickable` (renders a button and emits `pick`), `disabled`, `selected`, `dimmed`.
- **Built-in computer players.** A room opens as big as the game allows and the host can add or remove computer players
  in the lobby; the game starts with whoever is there, and the empty seats go (see *How many a room holds*).  Computer players are not accounts: give them ids like
  `bot:1` and `kind: 'bot'`, drive their turns on the server after a short random delay (so people can follow the play), and leave them
  out of `ctx.stats.record` (only accounts are recorded).
- Hidden information stays on the server: send each player their own hand, and only the *count* of everyone else's.
- `src/components/SeatLobby.vue`: the waiting room for fixed-seat games (seats, how many the game is for, add/remove/fill
  computer players, remove a human, Start enabled once the game's minimum is at the table).  Pass `seats` (`{ id, name,
  kind: 'human' | 'bot' | 'empty', isHost, isMe, away }`) and the game's `min`, `max`, and `fillTo`, put the game's own
  options in the `#settings` slot, and handle `addBot`, `removeBot`, `fillBots`, `size`, `kick`, and `start`.
  `src/components/PlayerListPanel.vue` is the same panel for a game with a list of players.
- **The host can remove any other player at any time** (the Remove button of `PlayerPopup`), so every game's server has a
  host-only removal that the table calls with the seat or account id (never the host's own, never garbage): `kick` for a
  person and `removeBot` for a computer player.  In the lobby the seat is freed.  In a game
  a person's place is taken over by a computer player (as when they leave) in every game, seated or list-based, with
  their score and their place in the turn order, so nobody's turns are lost; a computer player can only be removed in
  the lobby, because the game needs the player, and the pop-up shows the server's refusal.  Once a game
  is over, `kick` is refused (Cribbage marks the seat as left).  Being removed by other people is not the same as
  leaving: the room remembers them (`room.barred`, shared/seats.js `barFromRoom`) and the invitation answers
  `removedFromGame`, so they cannot take a computer player's place and walk back in.
- **The rest of the table can vote somebody out**, from the same pop-up, without the host.  The rules are shared
  (shared/voteKick.js) and so is the plumbing: `roomServer` handles `voteKick`, `voteAnswer` and `voteDrop` for every
  game, names the player the same way the game's `kick` does (`kickKey`), and puts `vote` into the view while one is
  running.  A vote needs three people, one runs at a time, whoever asks has said yes by asking, and it carries when
  more than half of the people who are not the one being voted on agree.  Nothing is timed: a vote simply stops
  counting a minute after it was asked.  A game's client passes `vote`, `askVote`, `answerVote` and `dropVote` to
  `usePlayerPopup` and the shared pop-up draws the rest.
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
`server.js` then fetches a picture of that word and puts it on the board (`shared/picture.js`), just as a
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
| `GameShell` | the root of a game's client: the loading line, the "new game or invite code" screen (`RoomEntry`), the error toast, and `useGameSocket` underneath.  Props `socket`, `search`, `setSearch`, `leaveConfirm`, `onState`, `noun`, `intro`, `lobbyPhase`; slots `lobby` and `table` (each given `{ state, send }`) and `overlay` (given `{ connected }`) |
| `GameFrame` | the standard screen: a 12-column grid sized to the window (`data-fits-window`, no page scroll).  Slots `scorebar`, `main`, `others`, `log`, `status`; `main` and `others` receive `{ width, height, left, right, gap, mainSpan, columns }` (pixels) so a game can size its pieces.  Props `mainSpan` (columns for the left part of the main row, default 7) and `logSpan` (columns for Recent moves, default 6) set each row's split on the shared grid, so outer edges and gutters line up while splits differ; a game's main content may use `grid-template-columns: subgrid` and `grid-column: span N` |
| `NoticePopup` | the generic small pop-up over the top of the page: slot content, `active`, `duration`, `autoHide` (false: stays until OK), OK button, `name` (extra class), `row` (stack two). `YourTurnPopup` and the achievement unlocks are built on it |
| `GameStatus` | the content of the Status box: `headline` (+ `mine` for the accent colour), `lines` (strings or `{ text, tone }`), slot `facts` (the persistent round/bag/lid line) and a default slot; fills its box and scrolls inside |
| `MarkerPicker` | the marker-colour picker of a lobby, for a game that gives each player a colour (Tints and Hints, Wavelength, Trivium): the free palette with the taken colours disabled, and any colour for a player who has unlocked that.  Props `colours`, `players`, `you`, `canCustom`; emits `pick`, which the game sends as its `colour` event.  The rules are `shared/markerRules.js`: `markerFor(room, base, extras)` for a game's `makePlayer`, and `chooseMarker(room, id, colour, canCustom)` for the event (with `ctx.markers` for `playerExtras` and `canCustom`) |
| `PlayAgain` | the host's "Play again" button, for the Status box: drawn once the game is over and for the host alone, so a table puts it there unconditionally.  Prop `state` (its `phase`, `hostId`, and `you`); emits `again`, which the table sends as the `again` event |
| `WordPopup` | a word shown large to everybody at the same moment and gone by itself after a few seconds: the word a chooser has just locked in (Dixnt), a hint just given (Tints and Hints), the word a turn begins with (Just One).  Prop `popup` (`{ label, word, dark?, at }` or null, in the player's own words; `dark` is for the one player kept from the word) and `duration`.  A game works out what to announce from the change between two states (`onState`) and puts it in `GameShell`'s `overlay` slot |
| `Lightbox` | a large look at one thing over the table (a card, a picture), stepping through the row it came from with buttons or the arrow keys, with buttons for what can be done with it.  Props `open`, `item`, `items`, `actions` (`[{ label, run, primary? }]`), and the words (`label`, `previousLabel`, `nextLabel`, `countText`); emits `step` and `close`; the default slot draws the item |
| `PlayingCard` | a CSS-drawn card, or a face-down card with the viewer's card back |
| `DrawingBoard` | the 1600 x 900 drawing canvas of the games that draw, shown at whatever size there is room for.  Props `active` (may this viewer draw), `tool`, `width`/`height`; emits `ops` (what the player has just drawn, for the table to send on); exposes `apply(ops)` and `reset(ops)`.  A game with two boards on screen draws one of these per board (see `modules/draw`).  The instructions themselves, what the server will accept into a drawing, and the palette are `shared/drawing.js`; the brush and the flood fill are `src/drawBoard.js`; `fitBoard(width, height)` in `src/boardFit.js` is the largest board that fits a box |
| `DrawingToolbox` | the drawer's tools under a `DrawingBoard`: the palette, pen, rubber, and paint bucket, the brush sizes (`widths`), undo, and clear.  Props `tool` (from `useDrawingTools`, changed in place) and `widths`; emits `undo` and `clear`.  Its words are the site's (`board.*`) |
| `GuessPanel` | what everybody has typed and the box to type in, for a game where people guess at a drawing.  Props `feed`, `canGuess`, `maxLength`, `placeholder`, `height` (0 fills its box), `bare` (no panel or title); emits `guess` |

Three helpers beside them, imported from `modules/<id>/client/` as `../../../src/<name>.js`:

| | |
| --- | --- |
| `spanWidth`, `fewestSpan`, `barSpan` (`src/frameLayout.js`) | arithmetic on the area `GameFrame` gives its slots: the pixel width of `n` of its columns, the fewest columns wide enough for a piece, and how many columns each of the other players' slim bars spans |
| `useGameSocket({ socket, search, setSearch, leaveConfirm, onState })` | the client plumbing **every** room game shares, called once from the top component's setup: it resumes the player's room on every connection (using the invite link's code the first time), keeps that code in the address bar, and registers the header's "Leave game" button with the game's own confirmation text.  It gives back `state` (the view, null outside a room), `loaded` (the server has said which), `busy` (a request is in flight), `notice` (the last refusal, already in the player's language), `connected` (false while the socket is down, for a game that tells the player so), `initialCode` (for `RoomEntry`) and `send(event, payload)`.  `onState(next, previous)` is where a game works out what changed, such as its Recent moves |
| `useDrawingTools({ active, undo, widths })` | the drawer's tool (`{ kind, colour, width }`), shared by the board and the toolbox, with its keyboard shortcuts (Q, W, E, the number keys for the brush, Ctrl+Z) |
| `useStrokeFeed({ socket, send, boards, turnKey, wanted })` | the client half of `shared/strokeRelay.js`: hands relayed strokes to the board they belong to, and asks for the boards whole on mounting, on a new turn, and on every reconnection |
| `useTurnClock(getState)` | counts the seconds down from the `remaining` milliseconds a view carries, re-anchoring to the local clock on every new view, so a game never depends on the server's clock agreeing with the player's (Rummikub, Scribblers) |
| `usePlayerPopup(...)` | which player's details are open, and the host's removal (see `PlayerPopup` above) |

Before writing a new screen for a game, check whether one of these already does the job; if you build something that
two games would want, put it here and add it to this list.
