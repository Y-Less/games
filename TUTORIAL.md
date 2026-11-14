# Writing a game, from nothing to a table — a worked example

`MODULES.md` is the contract: everything a module may do, in no particular order.  This is the other half — one game
built from the first empty folder to a finished table, in the order you would actually write it.  Read this first, and
keep `MODULES.md` open beside it for the details.

The game we build is **Coin Flip**.  It is deliberately tiny, because every line of it is about the *platform* rather
than about the game: a lobby, settings, turns, a view, computer players, statistics, achievements and tests, with as
little game as it is possible to have.

> **Coin Flip is not a game on this site, and should not become one.**  There is a stub of it in
> `server/fixtures/modules/coin/`, which the server tests use as a module that is not a real game; the code below is
> the teaching version of it.  Build it in a scratch folder, read it, throw it away.  If you want to see all of this in
> a game people really play, read `modules/just-one/` — it is the same shape, about four times the size.

## The game

Two to six people.  Everybody calls heads or tails in secret; one coin is flipped for the whole table; everybody who
called it right scores a point.  The host chooses how many flips (1 to 10).  Most points wins.

Because there is one coin for the whole table, a run of heads is a run *everybody saw* — which is what the
achievement at the end of this tutorial is about.

## What you are going to write

```
modules/coin/
  module.json          the menu card, the player limits, the statistics and the achievements
  rules.md             the rules players read from the "Rules" button
  game.js              the rules the computer plays: no sockets, no files, no clock of its own
  server.js            the socket half: a short call to the shared room server
  locales/en.json      every word a player reads
  client/
    index.js           exports the root component
    CoinFlip.vue       picks the screen: start, lobby or table
    Lobby.vue          the waiting room
    Table.vue          the game
  coin.test.js         the rules, then a whole game over real sockets
  client/render.test.js  every view of a whole game, drawn
```

Nine files.  Three of them are the game; the rest is the site's.

## The one rule

**The server is authoritative, and it tells each player only what that player may know.**  Everything else in this
tutorial follows from that.  A client is a drawing of a view the server sent, plus buttons that ask the server for
things.  It never decides anything.

---

# 1. `module.json`: how the site finds your game

The site loads every folder in `modules/`.  `module.json` is how your folder introduces itself.

```json
{
  "id": "coin",
  "name": "Coin Flip",
  "description": "Call it in the air, and watch for a run of heads.",
  "minPlayers": 2,
  "maxPlayers": 6,
  "category": "party",
  "rules": "rules.md",
  "stats": [
    { "key": "flips", "label": "Coins flipped", "agg": "sum" },
    { "key": "rightCalls", "label": "Calls you got right", "agg": "sum" },
    { "key": "headsRun", "label": "Longest run of heads", "agg": "max" }
  ]
}
```

`id` must match the folder name.  `stats` are the numbers your game reports about a player when a game ends; `agg` is
`sum` (default) or `max`.  We will come back and add `achievements` in step 8 — they are easier to write once the
statistics exist, because most of them are just a statistic with some levels drawn on it.

Write `rules.md` at the same time, in the voice of somebody explaining the game to a friend.  It is shown by the
"Rules" button and nowhere else, so it costs nothing to make it good.

---

# 2. `game.js`: the rules, and nothing else

This is the file worth being careful about.  It knows nothing about sockets, files, timers or the clock.  Everything
it touches is a **room**: a plain object that survives `JSON.stringify`.

```js
export function createRoom({ code, hostId, hostName, settings = {}, now }) {
  const room = {
    code,
    hostId,
    phase: 'lobby',
    players: [],
    nextBot: 1,          // computer players are players with kind 'bot' and an id 'bot:<n>'
    roundsEach: ROUNDS_EACH.default,
    round: 0,
    coin: null,          // the side that came up, while the flip is on show
    run: 0,              // how many heads the coin has just done in a row
    history: [],         // one row a round for the shared scoreboard
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
  room.players.push(makePlayer(room, { kind: 'human', id: hostId, name: hostName }));
  setSettings(room, hostId, settings);   // a setting the host got wrong is left at its default
  return room;
}
```

Three conventions in that object are not optional, because the shared code reads them:

| field | what the shared code does with it |
| --- | --- |
| `room.code` | the invite code; the room is filed under it |
| `room.phase` | `'lobby'` while people arrive; your own names after that |
| `room.players` | a person is `{ kind: 'human', id: <account id>, name }`, a computer player `{ kind: 'bot', id: 'bot:<n>', name }` |

**A person's id in a room *is* their account id.**  Not a seat number, not a token you invented.  Get this right and
the score bar shows their avatar, the statistics find them, and the lobby's removals work; get it wrong and you will
spend a day finding out why.

## Every rule answers the same way

```js
export function call(room, id, side, rng) {
  if (room.phase !== 'calling') return fail('notTimeToCall');
  const player = playerOf(room, id);
  if (!player) return fail('notInGame');
  if (!SIDES.includes(side)) return fail('headsOrTails');
  player.call = side;
  if (room.players.every((p) => p.call !== null)) flip(room, rng);
  return ok();
}
```

`ok()` and `fail()` come from `shared/seats.js`.  A refusal is a **code**, never a sentence: `'headsOrTails'`, not
`"Call heads or tails."`.  The code is looked up in your locale file and then the site's, so the player reads it in
their own language (step 6).  `fail('roundsEach', { min: 1, max: 10 })` passes the values the sentence needs.

A refused rule must change nothing.  Check everything first, then mutate — as `call` does above.

## Randomness and the clock are given to you

Nothing in `game.js` calls `Math.random()` or `Date.now()`.  They arrive as arguments:

```js
function flip(room, rng) {
  room.coin = SIDES[Math.floor(rng() * SIDES.length)];
  room.run = room.coin === 'heads' ? room.run + 1 : 0;
  ...
}
```

This is what lets a test replay a whole game from a seed, and it is why the test further down can say "a coin that
always comes up heads" in one line:

```js
const heads = () => 0;
```

## The view: what one player may see

`viewFor(room, userId, { online })` returns the whole of what one person is sent.  It is the only thing the client
ever sees, so anything you leave in it is public:

```js
function playerView(room, p, youId, online) {
  const revealed = ['flip', 'finished'].includes(room.phase);
  return {
    id: p.id,
    name: p.name,
    bot: isBot(p),
    online: isBot(p) || online(p.id),
    score: p.score,
    called: p.call !== null,
    // A call is secret until the coin is in the air: before then only its owner sees it.
    call: revealed || p.id === youId ? p.call : null,
  };
}
```

`called` and `call` are two different facts, and the difference is the whole game: everybody may know *that* you have
called, nobody may know *what* you called.  Hidden information is kept out of the view, not hidden by the client.

Build `view.scoreboard` in the standard shape (`shared/scores.js`) and the site draws the score bar, the after-round
pop-up and the all-rounds table for you.

---

# 3. The lobby, which you mostly do not write

Every room game needs: a room made from an invite code, people joining and leaving, the host adding and removing
computer players, somebody being removed, somebody dropping out mid-game, somebody coming back.  You write none of it.

```js
const roster = createRosterRules({
  isLive,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  botNames: BOT_NAMES,
  makePlayer,
  takeOver: (room, oldId, bot) => renameId(room, oldId, bot.id),
  handOver: (room, botId, person) => renameId(room, botId, person.id),
});
export const { addHuman, removeHuman, addBot, removeBot, fillWithBots, kick } = roster;
```

That is the entire lobby of Coin Flip.  `shared/roster.js` is for games that keep a **list** of players;
`shared/seats.js` (`createSeatRules`) is the same vocabulary for games with **numbered seats**, where an empty seat is
a real thing.  Pick by asking "does seat 3 mean something in my game?"  In Coin Flip it does not, so: roster.

What you get for those ten lines:

- **joining** in the lobby, up to `maxPlayers`, with names made unique (two people called Sam become "Sam" and "Sam (2)");
- **leaving**: in the lobby they simply go; **in a game under way a computer player takes their place**, keeping their
  score, their counters and whatever they had already done this round, so no round is ever spoilt by somebody leaving;
- **arriving at a game under way**: a latecomer takes a computer player's place — *their own first*, if the one standing
  in for them is still there, so somebody who dropped out and came back carries on where they were.  A game of nothing
  but people answers `gameFull`;
- **the host's removals** (`kick`), which also bar that person, so the invitation does not let them walk back in;
- **the rest of the table voting somebody out**, without the host (`shared/voteKick.js`), for free;
- computer players: `addBot`, `removeBot`, `fillWithBots`.

## The two hooks you do write

A place changes hands in both directions, and both are the same renaming: everything in your room that writes a
player's id down has to be told the id has changed.

```js
const renameId = (room, from, to) => {}; // Coin Flip writes no player's id down anywhere
```

Coin Flip keeps each player's call *on the player*, so the player object carries it to the new owner by itself, and
its scoreboard history is written by slot (`deltas[player.slot]`), which goes with the place and is never renamed.
So there is nothing for it to do, and you could leave both hooks out.  A game that keeps `room.whoseTurn`, or
`room.clues[playerId]`, renames those here — and gets it wrong the first time, which is why the fuzz tests in the
bigger games check that no answer is ever left under an id nobody has.

## The lobby screen

`src/components/PlayerListPanel.vue` draws the players and all the host's buttons:

```vue
<PlayerListPanel
  :players="state.players"
  :you="state.you"
  :host-id="state.hostId"
  :is-host="isHost"
  :min="state.limits.min"
  :max="state.limits.max"
  @add-bot="send('addBot')"
  @remove-bot="(id) => send('removeBot', { seat: id })"
  @kick="(id) => send('kick', { userId: id })"
  @fill-bots="(count) => send('fillBots', { count })"
/>
```

(`SeatLobby` is its opposite number for games with numbered seats.)  Put the invite code above it with `InviteCode`,
your own settings below it, and the lobby is done.

---

# 4. `server.js`: shorter than you think

```js
import { botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';

const pickSettings = (payload) => pickKeys(payload, ['roundsEach']);

export default function (ctx) {
  const delays = { bot: readDelayRange('COIN_BOT_DELAY', '600-1400'), flip: readDelayMs('COIN_FLIP_WAIT', 6000) };
  const nameOf = (id) => ctx.users?.get(id)?.displayName ?? 'Someone';

  return createRoomServer(ctx, {
    game,
    pickSettings,
    members: (room) => room.players,   // a list of players, not numbered seats
    kickKey: 'userId',                 // the client names the person to remove by account id
    migrate: (room) => game.migrate(room, nameOf),
    nextAction(room, rng) { ... },
    registerEvents({ act, on, userId, rng }) {
      on('call', ({ side }) => act((room) => game.call(room, userId, side, rng)));
      on('next', () => act((room) => game.next(room, userId)));
    },
  });
}
```

`createRoomServer` keeps the rooms in memory, saves them under `ctx.dataDir` atomically, sweeps old ones, tracks each
account's sockets, sends every person their own view on every change, reports a finished game to the statistics once,
and handles `create`, `join`, `resume`, `leave`, `kick`, `voteKick`, `settings`, `addBot`, `removeBot`, `fillBots`,
`start` and `again`.  Your `registerEvents` adds only the events that are yours — here, two.

`act(rule)` runs your rule on the room this socket is in, and if it worked, tells everybody.  That is the whole
request cycle.

## `nextAction`: what the server does when nobody does anything

Two things in Coin Flip happen without a player: a computer player calls, and a flip nobody closes moves on by itself.

```js
nextAction(room, rng) {
  const action = game.pendingBotAction(room);
  if (action) {
    return {
      wait: botWait(delays.bot, rng),
      run() {
        if (!game.runBotAction(room, rng, action)) throw new Error(`the computer player ${action.id} could not call`);
      },
    };
  }
  if (game.waitingOnFlip(room)) {
    return {
      key: `flip:${room.round}`,
      wait: delays.flip,
      run() {
        const outcome = game.next(room, room.hostId);
        if (!outcome.ok) throw new Error(outcome.error);
      },
    };
  }
  return null;
}
```

Two things to notice:

- **`key`.** Without it, the timer restarts every time the room changes — and a room changes when anybody's connection
  comes or goes, so a six-second wait would never end at a lively table.  With `key: 'flip:3'`, round 3's timer is set
  once and keeps running.
- **Throwing on a refusal.** A move that silently does nothing would be asked for again, for ever.  Throw, and the room
  server logs it and retries with a growing pause, three times, then leaves the room alone until somebody acts.

Make the delays settable from the environment (`readDelayRange`, `readDelayMs`) and your tests run in milliseconds
instead of seconds.

## Computer players

```js
export function pendingBotAction(room) {
  if (room.phase !== 'calling') return null;
  const bot = room.players.find((p) => isBot(p) && p.call === null);
  return bot ? { id: bot.id } : null;
}

export function runBotAction(room, rng, action = pendingBotAction(room)) {
  if (!action) return false;
  return call(room, action.id, SIDES[Math.floor(rng() * SIDES.length)], rng).ok;
}
```

A computer player plays by *calling the same rules a person does*.  It never gets a private door into the room, which
means it can never do something a person could not — and it decides from `viewFor(room, itsOwnId)`, so it cannot see
anything a person in its place could not see either.  (A game where that matters — where a bot could cheat by knowing
the secret word — should pass it the view explicitly, as `modules/dixnt` does.)

Coin Flip has no skill in it, so its computer players call at random.  A game with real decisions keeps one file per
"personality" under `ai/` and deals them out at the start with `assignAIs` from `shared/ai.js`.

---

# 5. The client

Three components, and almost all of what they draw is the site's.

```vue
<script setup>
const { state, loaded, busy, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  leaveConfirm: () => '',
});
</script>

<template>
  <div class="coin stack">
    <p v-if="!loaded" class="muted">{{ $t('play.loading') }}</p>
    <RoomEntry
      v-else-if="!state"
      :noun="t('entry.noun')"
      :intro="t('entry.intro')"
      :initial-code="initialCode"
      :busy="busy"
      :error="notice"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <template v-else>
      <ErrorToast v-if="notice" :text="notice" />
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" />
    </template>
  </div>
</template>
```

`useGameSocket` is the client's half of `createRoomServer`: it puts the player back into their room on every
connection (using the invite link's code the first time), keeps that code in the address bar, registers the header's
"Leave game" button, and hands you `state`, `loaded`, `busy`, `notice`, `connected`, `initialCode` and `send`.  The
whole of a game's connection handling is those eight lines.

The table uses `GameFrame` (the 12-column layout that fits the window without scrolling), `ScoreBoard`, `GameStatus`
and `usePlayerPopup`.  Check the table of shared components at the end of `MODULES.md` before you draw anything
yourself: a game that writes its own score bar will look subtly wrong beside the others, and will not get the next
improvement to the shared one.

**`t` and `$t` are different.** `t('table.heads')` (from `useGameText()`) reads your game's locale file and falls back
to the site's; `$t('lobby.start')` reads the site's.  Use `t` for your words and `$t` for words every game shares.

---

# 6. Words

Nothing a player reads is written in a `.js` or a `.vue` file — there is a test that fails if it is.  Everything is a
key in `locales/en.json`:

```json
{
  "table": {
    "heads": "Heads",
    "tails": "Tails",
    "run": "No heads in a row | Heads once | Heads {count} times in a row",
    "waiting": "Waiting for {names}…"
  },
  "errors": {
    "roundsEach": "Choose between {min} and {max} flips.",
    "headsOrTails": "Call heads or tails."
  }
}
```

The `errors.*` keys are the refusal codes `game.js` returns.  The bars in `run` are the plural forms, chosen by the
count you pass: `t('table.run', { count: state.run }, state.run)`.

Two tests keep this honest, and they are stricter than you expect: **every key you ask for must exist**, and **every
key you declare must be asked for**.  A key you stop using is a test failure, not dead weight.

Anything the server puts in a view that is words — a scoreboard label, say — is a **message**, not a string:
`msg('round.label', { n: room.round })`, which the client turns into the player's language with `text()`.

---

# 7. Statistics

When a game reaches a finished phase, the room server records it once.  All you provide is the rows:

```js
export function statsPlayers(room) {
  return statsRows(standings(room), (p) => ({
    outcome: p.winner ? 'win' : 'loss',
    placement: p.placement,
    score: p.score,
    extras: { flips: p.flips, rightCalls: p.rightCalls, headsRun: p.headsRun },
  }));
}
```

`statsRows` drops everybody who is not an account, so computer players are never recorded (they still count in the
placements — coming second to a computer is still coming second).  The keys in `extras` are the ones you declared in
`module.json`, and nothing else.

Keep the counters **on the player object**, as `p.flips` is here.  They are then saved with the room, they survive a
restart, and they follow a place when it changes hands — a counter kept in a side table beside the room is a bug
waiting for somebody to leave mid-game.

---

# 8. Achievements, and "Ten in a row"

An achievement is a number that grows and the levels it unlocks.  There are two ways to provide the number, and
choosing the right one is most of the work.

## The easy way: a statistic with levels on it

Coin Flip already records `headsRun`, the longest run of heads a player was at the table for, aggregated as `max`.  So
the achievement is a declaration and no code at all:

```json
"achievements": [
  {
    "key": "tenInARow",
    "name": "Ten in a row",
    "text": "Be at the table for {n} heads in a row",
    "levels": [10],
    "stat": "headsRun"
  },
  {
    "key": "caller",
    "name": "Good call",
    "text": "Call the coin right {n} times",
    "one": "Call the coin right",
    "levels": "easy",
    "stat": "rightCalls"
  }
]
```

`stat` makes the value come from the recorded results, which has a pleasant consequence: it counts **games played
before the achievement existed**.  Add this to a game that has been running for a year and people wake up with it.

`levels` is either the numbers themselves (`[10]`: one level, reached at ten) or the name of a tier —
`veryEasy`, `easy`, `medium`, `hard`, `veryHard`, `unlock` — which are tuned so that a game's achievements top out
after 100 to 200 games of it.  Prefer a tier; `[10]` is here because "ten in a row" is a specific thing to ask for.
`text` is what a level asks for with `{n}` filled in, and `one` replaces it when the number is 1 ("Call the coin
right", not "Call the coin right 1 times").

Every game also gets **Played the game** and **Won the game** without asking.

## The other way: keep the progress yourself

Use `ctx.achievements` when the thing you are counting is not a statistic you record — because it is not per-game, or
because the player should see the pop-up the *moment* it happens rather than when the game ends:

```js
ctx.achievements.add(userId, 'key');          // add one (or an amount)
ctx.achievements.raise(userId, 'key', value); // keep the best ever
ctx.achievements.collect(userId, 'key', ids); // "have had N different ..." — counts each id once, ever
```

Leave `stat` out of the definition when you do this, or it will throw: a definition reads its number from exactly one
place.

For "ten in a row", the declarative version is the right one — the run is already a statistic worth showing on the
profile page — but the imperative one would pop while the player was still looking at the coin.  That is the real
trade-off between them, and it is worth thinking about per achievement rather than picking one style for the game.

## Where the number comes from

Whichever way you choose, the number has to be *computed* somewhere.  Here it is three lines in the flip, and they are
the only part of this feature that is really about the game:

```js
room.run = room.coin === 'heads' ? room.run + 1 : 0;
for (const player of room.players) {
  ...
  peak(player, 'headsRun', room.run);   // the best run this player was at the table for
}
```

`peak` is from `shared/tally.js` and keeps the maximum.  Note what is being counted: the run belongs to the **coin**,
so everybody at the table shares it, and a player who joins halfway through only ever gets credit for runs they were
there for.  Deciding exactly what an achievement means is harder than wiring it up, and it is worth writing the
sentence down before you write the code.

Levels pay Gilders — 100 times the level number, or a flat 250 for a one-level achievement — and the player gets a
pop-up wherever they are on the site.  You do not write any of that.

---

# 9. Tests

Three kinds, in the order you should write them.

**The rules, with no sockets.**  Fast, and where the thinking goes.  They read like the rules themselves:

```js
test('the rules: a run of heads is the coin\'s, and every player at the table keeps the best one they saw', () => {
  const { made } = room(['Ann', 'Bob'], { roundsEach: 10 });
  const heads = () => 0; // a coin that always comes up heads
  assert.equal(game.start(made, 1).ok, true);
  for (let flip = 1; flip <= 10; flip++) {
    game.call(made, 1, 'heads', heads);
    game.call(made, 2, 'tails', heads);
    assert.equal(made.run, flip);
    if (flip < 10) assert.equal(game.next(made, 1).ok, true);
  }
  for (const p of made.players) assert.equal(p.headsRun, 10, 'both of them were there for all ten');
});
```

**A whole game over real sockets**, with `launchModule` from `shared/testkit.js`, which starts the actual site with
only your module on a spare port:

```js
test('over sockets: a person and a computer player play a whole game, and only the person is recorded', async (t) => {
  const site = await launchModule(t, { id: 'coin', moduleDir: here });
  const ann = await site.person('ann').open();
  await ann.call('create');
  await ann.call('fillBots');
  await until(() => ann.state?.players.length === 2, 'a computer player joins');
  ...
  assert.equal(site.site.db.prepare('SELECT COUNT(*) AS n FROM result_players').get().n, 1);
});
```

`launchModule` fails the test if the server logged anything that looks like a failure, so a handler that throws is
caught even when the test would otherwise have passed.

**Every view, drawn.**  Play a seeded game, keep every view it produced, and feed them all to the real client with
every Vue warning collected:

```js
const { sent, problems } = await walkViews(Root, views);
expect(problems).toEqual([]);
```

This one earns its place.  Writing this tutorial, it was the test that caught `list(waitingFor)` where the code meant
`list(waitingFor.value)` — a crash on a screen that the other tests never drew.

`npm test` runs the first two (node) and the third (vitest).  `npm run test:ui` drives a real browser and is not part
of `npm test`; add a case there once the game works.

---

# 10. The order to do it in

1. `module.json` and `rules.md` — ten minutes, and the game now exists in the menu.
2. `game.js` with `createRoom`, one action and `viewFor`, and a rules test for that action.
3. The lobby: `createRosterRules` (or `createSeatRules`) and the two renaming hooks.
4. `server.js` — mostly copying the one above and changing the event names.
5. A socket test that creates a room, fills it with computer players and starts.  **Stop here and play it.**
6. The client: `RoomEntry`, then the lobby, then the table.
7. The locale file, as you go rather than at the end.
8. `statsPlayers`, then the achievements.
9. The render test, the fuzz if the game is big enough to deserve one, and a UI test.

## Before you call it done

- Does a refused action leave the room exactly as it was?
- Can a client learn anything from the view that the player should not know?
- If somebody closes the tab mid-game, does the game carry on?  If they come back, do they get their place?
- Does `npm test` pass, including the two locale tests?
- Is there anything in your `server.js` that another game would also want?  If so it belongs in `shared/`, and in the
  table at the end of `MODULES.md`.
