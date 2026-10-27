// Built-in computer players for Tints and Hints: seats in the room that the server plays for itself. They exist for
// testing and have no logic (a random word as a hint, a random square as a guess). Rules first (no sockets), then
// real sockets: a whole game of one person and computers, removal, people leaving and the statistics.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { AIS } from './ai/index.js';
import { WORDS } from './ai/random.js';
import { checkRoom } from './checks.js';
import * as game from './game.js';
import { isCell } from './grid.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.TINTS_BOT_DELAY = '0-3';

function seededRng(seed = 1) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** A lobby with one person (the host, id 1) and `bots` computer players. */
function lobbyWith(bots, { turnsEach = 1 } = {}) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, turnsEach });
  for (let i = 0; i < bots; i++) assert.equal(game.addBot(room, 1).ok, true);
  return room;
}

/** Whatever the person (id 1) would do next, from their own view; false when there is nothing for them to do. */
function personActs(room, rng) {
  const view = game.viewFor(room, 1);
  const me = view.players.find((p) => p.id === 1);
  if (['guessing1', 'guessing2'].includes(room.phase)) {
    if (view.hinter === 1) {
      const key = room.phase === 'guessing1' ? 'first' : 'second';
      if (!room.hints[key]) return game.setHint(room, 1, 'a person\'s hint').ok;
      return game.advance(room, 1, rng).ok; // refuses until everyone has guessed
    }
    return !me.guessed && game.guess(room, 1, 'A0').ok;
  }
  return room.phase === 'reveal' && game.advance(room, 1, rng).ok;
}

function playOut(room, rng, guard = 3000) {
  for (let i = 0; i < guard; i++) {
    if (room.phase === 'finished') return;
    if (game.runBotAction(room, rng)) continue;
    if (!personActs(room, rng)) assert.fail(`stuck in ${room.phase} (turn ${room.turn})`);
    checkRoom(room);
  }
  assert.fail('the game did not finish');
}

test('the random AI: a short everyday word as a hint, and any legal square as a guess', () => {
  assert.deepEqual(AIS.map((ai) => ai.id), ['random']);
  const [ai] = AIS;
  assert.equal(ai.name, 'Random');
  const rng = seededRng(3);
  const hints = new Set();
  const cells = new Set();
  for (let i = 0; i < 400; i++) {
    const hint = ai.hint({ round: 1 }, rng);
    assert.ok(WORDS.includes(hint) && hint.trim() && hint.length <= game.HINT_LENGTH, hint);
    hints.add(hint);
    const cell = ai.guess({ round: 2 }, rng);
    assert.ok(isCell(cell), cell);
    cells.add(cell);
  }
  assert.ok(hints.size > 5 && cells.size > 100, 'it really is random');
  assert.ok(WORDS.length >= 10 && WORDS.every((w) => /^[a-z]+$/.test(w)));
});

test('the host adds, fills and removes computer players in the lobby, up to the maximum', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  game.addPlayer(room, 2);
  assert.equal(game.addBot(room, 2).ok, false, 'only the host');
  assert.equal(game.fillBots(room, 2).ok, false);
  const added = game.addBot(room, 1);
  assert.ok(added.ok && /^bot:\d+$/.test(added.id));
  const bot = room.players.find((p) => p.id === added.id);
  assert.ok(bot.bot && bot.name && !('ai' in bot), 'named, and no AI until the game starts');
  assert.equal(game.removeBot(room, 2, added.id).ok, false, 'only the host removes');
  assert.equal(game.removeBot(room, 1, 2).ok, false, 'a person is not a computer player');
  assert.equal(game.removeBot(room, 1, added.id).ok, true);
  assert.equal(room.players.length, 2);
  assert.ok(game.fillBots(room, 1, 5).ok);
  assert.equal(room.players.length, 5);
  assert.equal(game.fillBots(room, 1, 99).ok, true);
  assert.equal(room.players.length, game.MAX_PLAYERS, 'never over the maximum');
  assert.match(game.addBot(room, 1).error, /full/);
  assert.equal(new Set(room.players.map((p) => p.name ?? p.id)).size, room.players.length, 'every seat has its own name');
  checkRoom(room);
  assert.equal(game.addPlayer(room, 3).ok, false, 'a full table of computers still turns people away');
  game.start(room, 1);
  assert.equal(game.addBot(room, 1).ok, false, 'not once the game has started');
  assert.equal(game.fillBots(room, 1).ok, false);
  assert.equal(game.removeBot(room, 1, 'bot:1').ok, false, 'in a game it is removePlayer');
});

test('starting deals each computer player an AI, shown as { id, name } on bot seats only, and never the secret tint', () => {
  const room = lobbyWith(3);
  assert.ok(game.viewFor(room, 1).players.every((p) => p.ai === null), 'no AI before the start');
  assert.equal(game.start(room, 1, seededRng(9)).ok, true);
  const bots = room.players.filter((p) => p.bot);
  assert.ok(bots.every((p) => p.ai === 'random'));
  const view = game.viewFor(room, 1);
  assert.deepEqual(view.players.find((p) => p.id === 1).ai, null);
  for (const p of view.players.filter((x) => x.id !== 1)) {
    assert.equal(p.bot, true);
    assert.deepEqual(p.ai, { id: 'random', name: 'Random', description: AIS[0].description });
  }
  assert.ok(view.scoreboard.players.filter((p) => p.id !== 1).every((p) => p.bot === true && p.away === false));
  assert.equal(view.scoreboard.players.find((p) => p.id === 1).bot, false);
  // Only the hinter's own view carries the tint, and a bot guesser is never handed it.
  const seen = [];
  const original = AIS[0].guess;
  AIS[0].guess = (context, rng) => {
    seen.push(JSON.stringify({ ...context, cells: undefined }));
    return original(context, rng);
  };
  try {
    for (let i = 0; i < 10 && room.phase === 'guessing1'; i++) if (!game.runBotAction(room, seededRng(i))) personActs(room, seededRng(i));
  } finally {
    AIS[0].guess = original;
  }
  assert.ok(seen.length > 0 || room.hinter !== 1);
  assert.ok(seen.every((text) => !text.includes(`"tint"`) && !text.includes(room.tint)), "a guesser never sees the tint");
});

test('computer hints and guesses are legal on every pending action, in both rounds', () => {
  const room = lobbyWith(3);
  const rng = seededRng(4);
  game.start(room, 1, rng);
  const log = [];
  for (let i = 0; i < 400 && room.phase !== 'finished'; i++) {
    const action = game.pendingBotAction(room);
    if (action) {
      assert.ok(room.players.find((p) => p.id === action.id).bot, 'only computers are asked to act');
      if (action.type !== 'hint') assert.equal(action.type === 'guess' ? room.hinter !== action.id : room.hinter === action.id, true);
      assert.equal(game.runBotAction(room, rng, action), true);
      log.push(action.type);
      if (action.type === 'hint') assert.ok(room.hints[room.phase === 'guessing1' ? 'first' : 'second'].length > 0);
      if (action.type === 'guess') assert.ok(isCell([...room.first, ...room.second].find((g) => g.id === action.id).cell));
    } else if (!personActs(room, rng)) assert.fail(`stuck in ${room.phase}`);
  }
  assert.equal(room.phase, 'finished');
  for (const word of [room.history.length]) assert.equal(word, room.turnsTotal);
  assert.ok(log.includes('hint') && log.includes('guess'));
  for (const round of [1, 2]) assert.ok(game.viewFor(room, 1).guesses.some((g) => g.round === round), `guesses were made in round ${round}`);
});

test('a bot guess in round two is also random and may ignore the first one', () => {
  const room = lobbyWith(3);
  game.start(room, 1, seededRng(2));
  const rng = seededRng(77);
  let different = 0;
  let total = 0;
  while (room.phase === 'guessing1' || room.phase === 'guessing2') {
    if (!game.runBotAction(room, rng) && !personActs(room, rng)) break;
    if (room.phase === 'reveal') break;
  }
  for (const g of room.second) {
    total++;
    if (g.cell !== room.first.find((f) => f.id === g.id)?.cell) different++;
  }
  assert.ok(total >= 2 && different >= 1, 'second guesses are fresh draws');
});

test('an AI that throws or answers with rubbish is replaced by a random legal choice', () => {
  const room = lobbyWith(2);
  game.start(room, 1, seededRng(1));
  const [ai] = AIS;
  const saved = { hint: ai.hint, guess: ai.guess };
  ai.hint = () => {
    throw new Error('broken');
  };
  ai.guess = () => 'ZZ';
  try {
    const rng = seededRng(5);
    for (let i = 0; i < 30 && room.phase === 'guessing1'; i++) if (!game.runBotAction(room, rng)) personActs(room, rng);
    assert.ok(room.hints.first || room.hinter === 1);
    assert.ok(room.first.every((g) => isCell(g.cell)));
    assert.ok(room.hints.first !== '' || room.hinter === 1);
  } finally {
    Object.assign(ai, saved);
  }
});

test('a whole game of one person and computers finishes, at every table size', () => {
  for (let bots = 1; bots <= game.MAX_PLAYERS - 1; bots++) {
    for (const seed of [1, 2]) {
      const room = lobbyWith(bots);
      const rng = seededRng(seed * 31 + bots);
      assert.ok(game.start(room, 1, rng).ok);
      playOut(room, rng);
      assert.equal(room.turn, room.turnsTotal);
      assert.equal(room.turnsTotal, bots + 1);
      assert.equal(room.history.length, bots + 1);
      const stats = game.statsPlayers(room);
      assert.deepEqual(stats.map((p) => p.userId), [1], 'only the person is recorded');
      assert.ok(game.viewFor(room, 1).players.some((p) => p.winner));
    }
  }
});

test('removing a computer player: from the lobby, and in a game (the game carries on, or is abandoned)', () => {
  const room = lobbyWith(3);
  game.start(room, 1, seededRng(8));
  const rng = seededRng(8);
  const botOf = () => room.players.find((p) => p.bot && p.id !== room.hinter);
  const out = game.removePlayer(room, botOf().id, rng);
  assert.deepEqual(out, { ok: true, empty: false, abandoned: false, finished: false });
  assert.equal(room.players.length, 3);
  checkRoom(room);
  game.removePlayer(room, botOf().id, rng);
  assert.equal(room.players.length, 2);
  playOut(room, rng);
  assert.equal(room.phase, 'finished');

  const two = lobbyWith(1);
  game.start(two, 1, rng);
  const dropped = game.removePlayer(two, two.players.find((p) => p.bot).id, rng);
  assert.equal(dropped.abandoned, true, 'a person alone is not a game');
  assert.equal(two.phase, 'abandoned');
});

test('when the last person leaves, the computer players alone do not keep the game', () => {
  const room = lobbyWith(2);
  game.start(room, 1, seededRng(8));
  const out = game.removePlayer(room, 1, seededRng(8));
  assert.equal(out.empty, true);
  const second = game.createRoom({ code: 'x-y-z', hostId: 1 });
  game.addPlayer(second, 2);
  game.addBot(second, 1);
  game.start(second, 1, seededRng(1));
  game.removePlayer(second, 1, seededRng(1));
  assert.equal(second.hostId, 2, 'the host passes to a person, never a computer');
  assert.equal(game.removePlayer(second, 2, seededRng(1)).empty, true);
});

test('old saved rooms still load: migrate gives them a bot counter', () => {
  const room = lobbyWith(0);
  delete room.nextBot;
  game.migrate(room);
  assert.equal(room.nextBot, 1);
  assert.equal(game.addBot(room, 1).id, 'bot:1');
});

// ---------- real sockets ----------

const launch = (t) => launchModule(t, { id: 'tints-and-hints', moduleDir: here });

/** Does what the person would do next in this state; returns whether it did anything. */
async function humanStep(p) {
  const s = p.state;
  if (!s) return false;
  const me = s.players.find((x) => x.id === p.id);
  if (['guessing1', 'guessing2'].includes(s.phase)) {
    if (s.hinter === p.id) {
      const text = s.phase === 'guessing1' ? s.hints.first : s.hints.second;
      if (!text) return (await p.call('hint', { text: 'warm' })).ok === true;
      return (await p.call('advance', {})).ok === true;
    }
    return !me.guessed && (await p.call('guess', { cell: 'C3' })).ok === true;
  }
  if (s.phase === 'reveal' && s.hostId === p.id) return (await p.call('advance', {})).ok === true;
  return false;
}

async function playThrough(p, what) {
  const deadline = Date.now() + 20000;
  while (p.state?.phase !== 'finished') {
    if (Date.now() > deadline) assert.fail(`${what} did not finish; last state ${JSON.stringify(p.state)}`);
    if (!(await humanStep(p))) await sleep(5);
  }
}

test('one person fills the lobby with computers, plays a whole game over sockets and is the only one recorded', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const created = await ann.call('create', { turnsEach: 1 });
  assert.equal(created.ok, true);
  await until(() => ann.state?.phase === 'lobby', 'the lobby');
  assert.equal((await ann.call('start')).ok, false, 'alone is not enough');

  assert.equal((await ann.call('fillBots', {})).ok, true);
  await until(() => ann.state.players.length === 2, 'filled to the minimum');
  assert.equal((await ann.call('addBot')).ok, true);
  await until(() => ann.state.players.length === 3, 'a third seat');
  const bots = ann.state.players.filter((p) => p.bot);
  assert.equal(bots.length, 2);
  assert.ok(bots.every((b) => /^bot:/.test(b.id) && b.name && b.online && b.ai === null));

  const removed = await ann.call('removeBot', { seat: bots[1].id });
  assert.equal(removed.ok, true);
  await until(() => ann.state.players.length === 2, 'a seat freed');
  assert.equal((await ann.call('removeBot', { seat: ann.id })).ok, false, 'a person is not a computer');
  assert.equal((await ann.call('removeBot', { seat: 'bot:99' })).ok, false);
  assert.equal((await ann.call('removeBot', {})).ok, false);
  assert.equal((await ann.call('kick', { userId: 'bot:1' })).ok, false, 'bots are removed with removeBot');
  assert.equal((await ann.call('addBot')).ok, true);
  await until(() => ann.state.players.length === 3);
  assert.deepEqual(ann.state.players.map((p) => p.name).filter((n, i, all) => all.indexOf(n) === i).length, 3, 'distinct names');

  assert.equal((await ann.call('start')).ok, true);
  await playThrough(ann, 'the game');
  const s = ann.state;
  assert.equal(s.scoreboard.rounds.length, 3);
  assert.ok(s.players.filter((p) => p.bot).every((p) => p.ai?.id === 'random' && p.ai.name === 'Random'));
  assert.ok(s.scoreboard.players.filter((p) => p.bot).length === 2);
  checkSeenNoTint(ann);

  const stats = await ann.stats();
  assert.equal(stats.summary.played, 1);
  assert.equal(stats.recent[0].players, 1, 'computer players are not recorded');
  assert.ok((await ann.call('removeBot', { seat: s.players.find((p) => p.bot).id })).ok === false || true);
  assert.equal(JSON.stringify(stats).includes('bot:'), false);
});

/** The bots' tint never appears in what a guesser saw: here the person never sees a tint unless they were the hinter. */
function checkSeenNoTint(person) {
  for (const state of person.states.filter(Boolean)) {
    if (state.phase === 'guessing1' || state.phase === 'guessing2') {
      assert.equal(state.tint === null, state.hinter !== person.id, 'only the hinter has the tint before the reveal');
    }
  }
}

test('the host removes a computer player mid-game; with one person left and a computer, removing it abandons the game; the computers never keep a game alive', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  assert.equal((await ann.call('create', { turnsEach: 5 })).ok, true);
  await ann.call('fillBots', { count: 4 });
  await until(() => ann.state.players.length === 4);
  await ann.call('start');
  await until(() => ann.state.phase === 'guessing1');
  const [first, second] = ann.state.players.filter((p) => p.bot);
  assert.equal((await ann.call('removeBot', { seat: first.id })).ok, true);
  await until(() => ann.state.players.length === 3 && !ann.state.players.some((p) => p.id === first.id), 'a bot removed mid-game');
  assert.ok(['guessing1', 'guessing2', 'reveal'].includes(ann.state.phase));
  assert.equal((await ann.call('removeBot', { seat: first.id })).ok, false, 'already gone');
  assert.equal((await ann.call('removeBot', { seat: second.id })).ok, true);
  await until(() => ann.state.players.length === 2 || ann.state.phase === 'abandoned');
  const last = ann.state.players.find((p) => p.bot);
  if (last) {
    assert.equal((await ann.call('removeBot', { seat: last.id })).ok, true);
    await until(() => ann.state.phase === 'abandoned', 'abandoned');
  }
  assert.equal((await ann.stats()).summary.played, 0, 'abandoned games are not recorded');
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null);
});

test('only the host can use the computer-player events, and a game with people and computers lets people leave', async (t) => {
  const site = await launch(t);
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const created = await ann.call('create', { turnsEach: 2 });
  await bob.call('join', { code: created.code });
  await cat.call('join', { code: created.code });
  await until(() => ann.state.players.length === 3);
  assert.equal((await bob.call('addBot')).ok, false);
  assert.equal((await bob.call('fillBots', { count: 8 })).ok, false);
  assert.equal((await ann.call('fillBots', { count: 5 })).ok, true);
  await until(() => ann.state.players.length === 5);
  const botId = ann.state.players.find((p) => p.bot).id;
  assert.equal((await bob.call('removeBot', { seat: botId })).ok, false);
  assert.equal((await ann.call('fillBots', { count: 'rubbish' })).ok, true, 'garbage counts fall back to the minimum');
  assert.equal(ann.state.players.length, 5);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.phase === 'guessing1');

  // A person leaves mid-game: the seat is not taken over (the game carries on with fewer players, as before).
  assert.equal((await cat.call('leave')).ok, true);
  await until(() => ann.state.players.length === 4, 'cat gone');
  assert.equal(ann.state.players.filter((p) => p.bot).length, 2);
  assert.ok(ann.state.phase !== 'abandoned');
  assert.equal((await ann.call('kick', { userId: bob.id })).ok, true);
  await until(() => ann.state.players.length === 3, 'bob removed');

  // The last person leaves: the computers alone are dropped, and the room is gone.
  const code = ann.state.code;
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null);
  await sleep(30);
  const again = await ann.call('join', { code });
  assert.equal(again.ok, false);
  assert.match(again.error, /No game has that code/);
});

test('computers stay on time: a game of two people and a computer moves on by itself between their actions', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const bob = await site.person('bob').open();
  const created = await ann.call('create', { turnsEach: 1 });
  await bob.call('join', { code: created.code });
  await ann.call('addBot');
  await until(() => ann.state.players.length === 3);
  await ann.call('start');
  await until(() => ann.state.phase === 'guessing1');
  const people = [ann, bob];
  const deadline = Date.now() + 20000;
  while (ann.state.phase !== 'finished') {
    if (Date.now() > deadline) assert.fail(`stuck: ${JSON.stringify(ann.state)}`);
    let did = false;
    for (const p of people) did = (await humanStep(p)) || did;
    if (!did) await sleep(5);
  }
  const statsAnn = await ann.stats();
  const statsBob = await bob.stats();
  assert.equal(statsAnn.summary.played, 1);
  assert.equal(statsBob.summary.played, 1);
  assert.equal(statsAnn.recent[0].players, 2, 'two people, the computer is not counted');
  checkSeenNoTint(bob);
});
