// Zurubang over real sockets, against the real site: a whole game against a computer player, a chair changing hands
// in the middle of one, and a tournament of three people playing a round out to its standings.
//
// The tournament is the reason this game is for two: a game of two is the shape an evening of them is made of, and
// no line of this module knows anything about that, so this test is here to prove it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, savedRooms, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.ZURUBANG_BOT_DELAY = '0-2';
process.env.ZURUBANG_REVEAL_WAIT = '5';
process.env.ZURUBANG_NEXT_WAIT = '200';

/** The duels each person has already changed a card in, so that a table always gets on with it (see robustness.test.js). */
const swapped = new Set();

/** One move for this person, in whatever the game is waiting for; false when there is nothing for them to do. */
async function stepOnce(p) {
  const s = p.state;
  if (!s || s.you === -1) return false;
  switch (s.phase) {
    case 'turn': {
      if (s.turn !== s.you) return false;
      const once = `${s.code}:${p.name}:${s.duelNo}`;
      if (swapped.has(once)) return (await p.call('challenge', {})).ok;
      swapped.add(once);
      return (await p.call('swapOne', { card: s.hand[0] })).ok;
    }
    case 'challenged':
      return s.duel.challenger === s.you ? false : (await p.call('answer', { accept: true })).ok;
    case 'starter':
      return s.duel.challenger === s.you ? false : (await p.call('starter', { seat: s.you })).ok;
    case 'placing':
      return s.placer?.seat === s.you ? (await p.call('place', { card: s.hand[0] })).ok : false;
    case 'revealing':
      await p.call('reveal', {});
      return true;
    case 'sudden': {
      if (s.duel.sudden.picked !== null) return false;
      const out = new Set(s.duel.sudden.out);
      return (await p.call('sudden', { position: [0, 1, 2, 3, 4].find((position) => !out.has(position)) })).ok;
    }
    case 'duelOver':
      return s.seats[s.you].ready ? false : (await p.call('ready', {})).ok;
    default:
      return false;
  }
}

/** Plays until `done`, asking each person in turn and checking `done` again before each of them. */
async function playOn(people, done, limit = 60000) {
  const started = Date.now();
  while (!done()) {
    assert.ok(Date.now() - started < limit, `the game got stuck: ${people.map((p) => `${p.name} in ${p.state?.phase}`).join(', ')}`);
    let moved = false;
    for (const p of people) {
      if (done()) break;
      moved = (await stepOnce(p)) || moved;
    }
    if (!moved) await sleep(3);
  }
}

test('a whole game against a computer player, over sockets, is played and recorded once', async (t) => {
  const site = await launchModule(t, { id: 'zurubang', moduleDir: here });
  const ann = await site.person('ann').open();
  const { code, ok } = await ann.call('create', { target: 20 });
  assert.equal(ok, true);
  assert.equal((await ann.call('fillBots', {})).ok, true);
  await until(() => ann.state?.seats.filter(Boolean).length === 2, 'a computer player takes the other chair');
  assert.equal((await ann.call('start', {})).ok, true);
  await playOn([ann], () => ann.state?.phase === 'finished');

  assert.ok(ann.state.seats.some((seat) => seat.score >= 20));
  assert.equal(ann.state.code, code);
  await sleep(250);
  const stats = await ann.stats();
  assert.equal(stats.perGame[0].played, 1, 'one record for the one game');
  assert.equal(site.site.db.prepare('SELECT COUNT(*) AS n FROM result_players').get().n, 1, 'and nothing at all for the computer player');

  // Every different card she has held is counted towards "the whole deck", which nothing but the server does.
  const sections = (await ann.http('GET', '/api/achievements')).data.sections;
  const collector = sections.flatMap((section) => section.achievements ?? []).find((achievement) => achievement.id === 'zurubang.collector');
  assert.ok(collector, 'the achievement is on the page');
  assert.ok(collector.value >= 5, `she held at least a hand of cards, but the achievement says ${collector.value}`);
});

test('a chair left in the middle of a game is taken by a computer player, and given back when its owner returns', async (t) => {
  const site = await launchModule(t, { id: 'zurubang', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { target: 20 });
  assert.equal((await bob.call('join', { code })).ok, true);
  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => ann.state?.phase === 'turn' && bob.state?.phase === 'turn', 'the first turn');

  const score = bob.state.seats[1].score;
  assert.equal((await bob.call('leave', {})).ok, true);
  await until(() => ann.state?.seats[1]?.bot === true, 'a computer player takes the empty chair');
  assert.equal(ann.state.seats[1].score, score, 'and keeps the score that was there');
  assert.equal(ann.state.seats[1].name, 'bob', `under the name it is standing in for (${JSON.stringify(ann.state.seats)})`);

  // The game carries on with nobody but a computer player to play it, which is what a leaver must not be able to spoil.
  await playOn([ann], () => ann.state?.phase !== 'lobby' && (ann.state?.duelNo > 0 || ann.state?.phase === 'finished'));

  assert.equal((await bob.call('resume', { code })).ok, true);
  await until(() => bob.state?.you === 1 && ann.state?.seats[1]?.bot === false, 'bob walks back into his own chair');
  assert.equal(bob.state.seats[1].name, 'bob');
});

test('a room saved in the middle of a game is read back with every card still in it', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zurubang-saved-'));
  const site = await launchModule(t, { id: 'zurubang', moduleDir: here, dataDir });
  const ann = await site.person('ann').open();
  const { code } = await ann.call('create', { target: 20 });
  await ann.call('fillBots', {});
  await until(() => ann.state?.seats.filter(Boolean).length === 2, 'the other chair');
  await ann.call('start', {});
  // A snapshot is only safe on a person's turn, where the server has nothing of its own waiting to happen: anywhere
  // else a computer player can move between the reading and the file.
  await playOn([ann], () => ann.state?.phase === 'turn' && ann.state.turn === ann.state.you);
  await sleep(300); // the store writes a hundred milliseconds after the last change, so give it room
  const rooms = savedRooms(path.join(dataDir, 'site', 'modules', 'zurubang'));
  const saved = rooms.find((room) => room.code === code);
  assert.ok(saved, `the room was written to disk (wanted ${code}, found ${rooms.map((room) => `${room.code}/${room.phase}`).join(', ') || 'nothing'})`);
  assert.equal(saved.phase, 'turn');
  const cards = [...saved.hands.flat(), ...saved.stacks.flat(), ...saved.graveyard, ...(saved.duel?.placed.flat().filter(Boolean) ?? [])];
  assert.equal(cards.length, 105, 'every card survived the trip to disk');
  assert.equal(new Set(cards).size, 105);
});

test('a tournament of three people deals tables of two, plays a round out, and counts the standings', async (t) => {
  const site = await launchModule(t, { id: 'zurubang', moduleDir: here });
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann] = people;
  const { code } = await ann.call('create', { target: 20 });
  // A tournament is a lobby setting, and not a line of this module's own code.  It has to be switched on before the
  // third person arrives: a game of Zurubang has two chairs, and a tournament of it has no such limit.
  assert.equal((await ann.call('settings', { tournament: { on: true, humans: 2, bots: 0 } })).ok, true);
  for (const p of people.slice(1)) assert.equal((await p.call('join', { code })).ok, true, `${p.name} could not join the tournament`);
  await until(() => people.every((p) => p.state?.tournament?.on === true), 'the tournament lobby');
  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => people.filter((p) => p.state?.tournament?.yourTable).length === 2, 'two of the three drawn for the one table a round of pairs has');

  const drawn = people.filter((p) => p.state.tournament.yourTable);
  assert.equal(drawn.length, 2, `two of the three are drawn (${JSON.stringify(ann.state.tournament)})`);
  const table = drawn[0].state.tournament.yourTable;
  assert.equal(drawn[1].state.tournament.yourTable, table, 'and it is the same table for both of them');

  for (const p of drawn) {
    assert.equal((await p.call('resume', { code: table })).ok, true, `${p.name} walks into the table drawn for them`);
  }
  await until(() => drawn.every((p) => p.state?.code === table && p.state.phase === 'turn'), 'an ordinary game of Zurubang, at a table of a tournament');
  assert.equal(drawn[0].state.seats.filter(Boolean).length, 2, 'a table of a two-player game is two players');

  await playOn(drawn, () => drawn.every((p) => p.state?.phase === 'finished'));
  const winner = drawn.find((p) => p.state.winner === p.state.you);
  assert.ok(winner, 'somebody won it');

  // Back to the tournament, which has been counting.
  for (const p of people) assert.equal((await p.call('resume', { code })).ok, true);
  await until(() => people.every((p) => p.state?.code === code), 'back in the tournament');
  const standings = ann.state.tournament.standings;
  assert.equal(standings.length, 3, 'everybody is on the table, played or not');
  assert.ok(
    standings.some((row) => row.wins === 1),
    'and the game just played has been counted',
  );
});
