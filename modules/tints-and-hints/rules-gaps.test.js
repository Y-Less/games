// Rules branches the older tests did not reach, found by reading game.js and checking coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as game from './game.js';
import { launchModule, until, sleep } from '../../shared/testkit.js';
import { checkRoom, readyAll } from './checks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const first = () => 0;

function started(n = 3, turnsEach = 2) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, turnsEach });
  for (let i = 2; i <= n; i++) game.addPlayer(room, i);
  game.start(room, 1, first);
  return room;
}
const closeRound = (room) => {
  if (room.phase === 'guessing1' && !room.hints.first) assert.equal(game.setHint(room, room.hinter, 'warm').ok, true); // the first hint is mandatory
  for (const p of room.players) if (p.id !== room.hinter) game.guess(room, p.id, 'A1');
  return game.advance(room, room.hinter, first);
};

test('leaving a finished or abandoned game changes nothing and is harmless', () => {
  const room = started(2, 1);
  closeRound(room);
  closeRound(room);
  readyAll(game, room, first);
  closeRound(room);
  closeRound(room);
  readyAll(game, room, first);
  assert.equal(room.phase, 'finished');
  const before = JSON.stringify(room);
  assert.deepEqual(game.removePlayer(room, 1), { ok: true, empty: false, abandoned: false, finished: false });
  assert.deepEqual(game.removePlayer(room, 999), { ok: true, empty: false, abandoned: false, finished: false });
  assert.equal(JSON.stringify(room), before);
  assert.equal(game.isLive(room), false);
});

test('hints: whitespace is collapsed, the second hint is separate, and an object or nothing becomes text safely', () => {
  const room = started();
  assert.equal(game.setHint(room, room.hinter, '  very \n  warm\t red  ').ok, true);
  assert.equal(room.hints.first, 'very warm red');
  assert.equal(game.setHint(room, room.hinter, undefined).ok, false, 'nothing is not a first hint');
  assert.equal(room.hints.first, 'very warm red');
  closeRound(room);
  assert.equal(room.phase, 'guessing2');
  game.setHint(room, room.hinter, 'second');
  assert.deepEqual(room.hints, { first: 'very warm red', second: 'second' });
  assert.equal(game.setHint(room, room.hinter, undefined).ok, true, 'the second hint can be left empty');
  assert.equal(room.hints.second, '');
  game.setHint(room, room.hinter, 'second');
  assert.equal(game.setHint(room, room.hinter, 'x'.repeat(500)).ok, true);
  assert.equal(room.hints.second.length, game.HINT_LENGTH);
  const guesser = room.players.find((p) => p.id !== room.hinter).id;
  assert.equal(game.setHint(room, guesser, 'no').ok, false);
});

test('colours: taking someone else\'s is refused, keeping your own is fine, and the lobby gives each newcomer a free one', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  for (let i = 2; i <= 8; i++) game.addPlayer(room, i);
  assert.equal(new Set(room.players.map((p) => p.colour)).size, 8);
  assert.equal(game.setColour(room, 1, room.players[1].colour).ok, false);
  assert.equal(game.setColour(room, 1, room.players[0].colour).ok, true);
  assert.equal(game.setColour(room, 99, game.COLOURS[0]).ok, false);
  game.removePlayer(room, 3);
  game.addPlayer(room, 20);
  assert.equal(new Set(room.players.map((p) => p.colour)).size, 8, 'the freed colour is reused');
});

test('a hinter who leaves at the reveal does not hold the others up; at the second round the turn is skipped', () => {
  const room = started(3, 1);
  closeRound(room);
  closeRound(room);
  assert.equal(room.phase, 'reveal');
  const gone = room.hinter;
  game.removePlayer(room, gone, first);
  assert.equal(room.phase, 'reveal');
  assert.equal(game.advance(room, room.hostId, first).ok, false, 'the reveal is closed by being ready');
  assert.equal(readyAll(game, room, first).ok, true);
  assert.equal(room.phase, 'guessing1');
  checkRoom(room);
  closeRound(room);
  assert.equal(room.phase, 'guessing2');
  const hinter = room.hinter;
  const out = game.removePlayer(room, hinter, first);
  assert.equal(out.abandoned, true, 'two players cannot go on once one leaves');
  assert.equal(room.phase, 'abandoned');
});

test('advancing from the lobby, or from a phase with a stranger, is refused with a reason', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  game.addPlayer(room, 2);
  assert.match(game.advance(room, 1).error, /nothing to continue/);
  assert.equal(game.guess(room, 2, 'A1').ok, false);
  assert.equal(game.setHint(room, 1, 'x').ok, false);
  game.start(room, 1, first);
  assert.equal(game.addPlayer(room, 2).ok, true, 'a player already in is told ok');
  assert.match(game.addPlayer(room, 3).error, /already started/);
  assert.match(game.guess(room, 3, 'A1').error, /not in this game/);
});

test('viewFor an abandoned or finished game gives placements and shows the tint', () => {
  const room = started(2, 1);
  game.removePlayer(room, room.players.find((p) => p.id !== room.hinter).id, first);
  const view = game.viewFor(room, room.players[0].id);
  assert.equal(view.phase, 'abandoned');
  assert.equal(view.players[0].placement, 1);
  assert.equal(view.players[0].winner, true);
});

test('sockets: the host can send away an absent person after the game ended; the result keeps them and is recorded once', async (t) => {
  const site = await launchModule(t, { id: 'tints-and-hints', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { turnsEach: 1 });
  await bob.call('join', { code });
  await until(() => ann.state?.players.length === 2, 'two players');
  await ann.call('start', {});
  const both = [ann, bob];
  const key = (p) => `${p.state?.phase}/${p.state?.turn}/${p.state?.hinter}`;
  for (let step = 0; step < 12 && ann.state.phase !== 'finished'; step++) {
    await until(() => key(ann) === key(bob), 'both players to see the same step');
    const here = key(ann);
    const hinter = both.find((p) => p.id === ann.state.hinter);
    const guesser = both.find((p) => p !== hinter);
    if (ann.state.phase === 'guessing1') assert.equal((await hinter.call('hint', { text: 'warm' })).ok, true);
    if (ann.state.phase !== 'reveal') assert.equal((await guesser.call('guess', { cell: 'A1' })).ok, true);
    if (ann.state.phase === 'reveal') for (const p of both) assert.equal((await p.call('ready', {})).ok, true);
    else assert.equal((await hinter.call('advance', {})).ok, true);
    await until(() => key(ann) !== here || ann.state.phase === 'finished', 'the next step');
  }
  await until(() => both.every((p) => p.state.phase === 'finished'), 'finished');
  bob.socket.close();
  await until(() => ann.state.players.find((p) => p.id === bob.id).online === false, 'bob away');
  const reply = await ann.call('kick', { userId: bob.id });
  assert.equal(reply.ok, true);
  await sleep(50);
  assert.equal(ann.state.players.length, 2, 'the final standings still list both');
  assert.equal(ann.state.phase, 'finished');
  await sleep(100);
  assert.equal((await ann.stats()).perGame[0].played, 1);
  assert.equal((await bob.stats()).perGame[0].played, 1);
});
