// Wavelength against the real site: accounts over HTTP, a game over sockets, privacy of the target, computer players
// and the statistics a finished game records.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t) => launchModule(t, { id: 'wavelength', moduleDir: here });
const stateOf = (p) => p.state;

test('a whole game with three people: create, join, start, clue, guess, reveal, finish and statistics', async (t) => {
  process.env.WAVELENGTH_NEXT_WAIT = '60000';
  const site = await launch(t);
  const people = [await site.person('ann').open(), await site.person('bob').open(), await site.person('cat').open()];
  const [ann, bob, cat] = people;

  assert.deepEqual(await ann.call('resume'), { ok: true, code: null });
  assert.equal((await ann.call('join', { code: 'nonsense' })).ok, false);
  assert.match((await ann.call('join', { code: 'boss-aware-you' })).error, /No game has that code/);
  const created = await ann.call('create', { turnsEach: 1 });
  assert.ok(created.ok);
  assert.equal((await ann.call('create')).ok, false, 'already in a game');
  assert.ok((await bob.call('join', { code: ` ${created.code.toUpperCase()} ` })).ok);
  assert.ok((await cat.call('join', { code: created.code })).ok);
  await until(() => ann.state?.players.length === 3, 'three players');
  assert.equal((await bob.call('start')).ok, false, 'only the host starts');
  assert.ok((await ann.call('start')).ok);

  for (let turn = 1; turn <= 3; turn++) {
    await until(() => people.every((p) => p.state?.phase === 'clue' && p.state.turn === turn), `turn ${turn}`);
    const psychic = people.find((p) => p.state.target !== null);
    const guessers = people.filter((p) => p !== psychic);
    assert.equal(people.filter((p) => p.state.target !== null).length, 1, 'only the psychic sees the target');
    const target = psychic.state.target;
    assert.ok(psychic.state.spectrum.left && psychic.state.spectrum.right);
    assert.equal((await guessers[0].call('clue', { text: 'cheating' })).ok, false);
    assert.equal((await guessers[0].call('guess', { position: 50 })).ok, false, 'no guess before the clue');
    assert.equal((await psychic.call('clue', { text: '  ' })).ok, false);
    assert.ok((await psychic.call('clue', { text: 'a hot bath' })).ok);
    await until(() => guessers.every((g) => g.state.clue === 'a hot bath'), 'the clue');

    assert.equal((await psychic.call('guess', { position: 50 })).ok, false, 'the psychic cannot guess');
    assert.equal((await guessers[0].call('guess', { position: 101 })).ok, false);
    assert.equal((await guessers[0].call('guess', { position: 'left' })).ok, false);
    assert.ok((await guessers[0].call('guess', { position: target })).ok);
    assert.equal((await guessers[0].call('guess', { position: target })).ok, false, 'one guess a turn');
    await until(() => guessers[1].state.players.find((p) => p.id === guessers[0].id).guessed, 'a guess seen as made');
    assert.deepEqual(guessers[1].state.guesses, [], 'others\' guesses stay hidden');
    assert.equal(guessers[1].state.target, null);
    for (const g of guessers) {
      const seen = JSON.stringify(g.states.filter((s) => s?.turn === turn && s.phase !== 'reveal'));
      assert.ok(!seen.includes(`"target":${target}`), 'the target never reached a guesser early');
    }
    assert.ok((await guessers[1].call('guess', { position: target > 50 ? target - 30 : target + 30 })).ok);

    await until(() => people.every((p) => p.state.phase === 'reveal'), 'the reveal');
    for (const p of people) {
      assert.equal(p.state.target, target);
      assert.equal(p.state.guesses.length, 2);
      assert.equal(p.state.result.psychicPoints, 2);
      assert.equal(p.state.scoreboard.rounds.length, turn);
    }
    if (turn === 2) {
      // A phone loses its connection and comes back: the same game, with the same view.
      await guessers[1].socket.close();
      await until(() => psychic.state.players.find((p) => p.id === guessers[1].id).online === false, 'someone offline');
      await guessers[1].connect();
      assert.deepEqual(await guessers[1].call('resume'), { ok: true, code: created.code });
      await until(() => guessers[1].state?.phase === 'reveal', 'the game back');
      assert.equal(guessers[1].state.target, target);
    }
    for (const p of people) assert.ok((await p.call('ready')).ok);
  }

  await until(() => ann.state.phase === 'finished', 'the end');
  const final = ann.state;
  assert.equal(final.players.reduce((n, p) => n + p.score, 0), 3 * 4 + 3 * 2 * 1 + 0, 'a bullseye, a miss and a psychic score every turn');
  const stats = (await ann.http('GET', '/api/stats/me')).data;
  assert.ok(JSON.stringify(stats).includes('wavelength'), 'the game was recorded');
  assert.ok(JSON.stringify(stats).includes('bullseyes'), 'with its own numbers');
});

test('computer players fill the table, play their own turns and finish a game', async (t) => {
  process.env.WAVELENGTH_BOT_DELAY = '0-5';
  const site = await launch(t);
  const ann = await site.person('ann').open();
  assert.ok((await ann.call('create', { turnsEach: 1 })).ok);
  assert.equal((await ann.call('removeBot', { seat: 'bot:9' })).ok, false);
  assert.ok((await ann.call('fillBots', { count: 3 })).ok);
  await until(() => ann.state.players.length === 3, 'two computers');
  assert.ok(ann.state.players.slice(1).every((p) => p.bot && p.online));
  assert.ok((await ann.call('start')).ok);
  for (let turn = 1; turn <= 3; turn++) {
    await until(() => ann.state.turn === turn && ['clue', 'guessing', 'reveal'].includes(ann.state.phase), `turn ${turn}`);
    if (ann.state.psychic === ann.id) {
      await until(() => ann.state.phase === 'clue', 'my clue turn');
      assert.ok((await ann.call('clue', { text: 'warm' })).ok);
    } else {
      await until(() => ann.state.clue, 'the computer psychic\'s clue');
      assert.equal(ann.state.target, null, 'a person is not shown the computer\'s target');
      await until(() => ann.state.phase === 'guessing', 'guessing');
      assert.ok((await ann.call('guess', { position: 40 })).ok);
    }
    await until(() => ann.state.phase === 'reveal', 'the reveal');
    assert.ok(ann.state.players.every((p) => p.bot ? p.ai : true), 'computer players show their AI');
    assert.ok((await ann.call('ready')).ok);
  }
  await until(() => ann.state.phase === 'finished', 'the end');
  assert.equal(ann.state.scoreboard.rounds.length, 3);
});

test('the host can remove a person, who then has no game', async (t) => {
  const site = await launch(t);
  const [ann, bob, cat] = [await site.person('ann').open(), await site.person('bob').open(), await site.person('cat').open()];
  const { code } = await ann.call('create');
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => ann.state.players.length === 3, 'three players');
  assert.equal((await bob.call('kick', { userId: cat.id })).ok, false, 'only the host removes people');
  assert.equal((await ann.call('kick', { userId: ann.id })).ok, false, 'not themselves');
  assert.ok((await ann.call('kick', { userId: cat.id })).ok);
  await until(() => cat.state === null, 'the removed player out of the game');
  await until(() => ann.state.players.length === 2, 'two players');
  assert.ok(stateOf(bob));
});
