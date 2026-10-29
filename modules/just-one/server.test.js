// Just One against the real site: accounts over HTTP, a game over sockets, what each person is sent, computer players and the
// statistics a finished game records.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t) => launchModule(t, { id: 'just-one', moduleDir: here });

test('a whole game with four people: create, join, start, clues, guess, best hint, reveal, finish and statistics', async (t) => {
  const site = await launch(t);
  const people = [await site.person('ann').open(), await site.person('bob').open(), await site.person('cat').open(), await site.person('dan').open()];
  const [ann, bob, cat, dan] = people;

  assert.deepEqual(await ann.call('resume'), { ok: true, code: null });
  assert.match((await ann.call('join', { code: 'boss-aware-you' })).error, /No game has that code/);
  const created = await ann.call('create', { turnsEach: 1 });
  assert.ok(created.ok);
  assert.equal((await ann.call('create')).ok, false, 'already in a game');
  for (const p of [bob, cat, dan]) assert.ok((await p.call('join', { code: created.code })).ok);
  await until(() => ann.state.players.length === 4, 'four players');
  assert.equal((await bob.call('start')).ok, false, 'only the host starts');
  assert.ok((await ann.call('start')).ok);

  for (let turn = 1; turn <= 4; turn++) {
    await until(() => people.every((p) => p.state?.phase === 'clues' && p.state.turn === turn), `turn ${turn}`);
    const guesser = people.find((p) => p.state.guesser === p.id);
    const writers = people.filter((p) => p !== guesser);
    const word = writers[0].state.word;
    assert.ok(word);
    assert.equal(guesser.state.word, null, 'the guesser does not see the word');
    assert.equal((await guesser.call('clue', { text: 'cheat' })).ok, false);
    assert.equal((await writers[0].call('clue', { text: word })).ok, false, 'not the word itself');
    assert.equal((await writers[0].call('clue', { text: 'two words' })).ok, false);
    assert.ok((await writers[0].call('clue', { text: 'alpha' })).ok);
    await until(() => writers[1].state.players.find((p) => p.id === writers[0].id).written, 'a clue seen as written');
    assert.deepEqual(writers[1].state.clues, [], 'nobody sees a clue before the clues are in');
    assert.ok((await writers[1].call('clue', { text: 'Alpha' })).ok);
    assert.ok((await writers[2].call('clue', { text: 'gamma' })).ok);
    await until(() => people.every((p) => p.state.phase === 'guessing'), 'guessing');
    assert.deepEqual(guesser.state.clues, [{ n: 0, text: 'gamma' }], 'the guesser sees only the clue that is left');
    assert.ok(!JSON.stringify(guesser.states.filter((s) => s?.turn === turn)).includes(word), 'the word never reached the guesser early');
    assert.equal(writers[0].state.clues.filter((c) => c.cancelled).length, 2);

    assert.equal((await writers[0].call('guess', { text: word })).ok, false, 'only the guesser guesses');
    if (turn === 1) {
      assert.ok((await guesser.call('pass')).ok);
      await until(() => people.every((p) => p.state.phase === 'reveal'), 'the reveal after a pass');
      assert.equal(guesser.state.result.correct, false);
    } else {
      assert.ok((await guesser.call('guess', { text: word })).ok);
      await until(() => people.every((p) => p.state.phase === 'choosing'), 'choosing');
      assert.equal(guesser.state.word, null, 'still hidden while picking');
      assert.equal((await writers[0].call('best', { n: 0 })).ok, false);
      assert.equal((await guesser.call('best', { n: 5 })).ok, false);
      assert.ok((await guesser.call('best', { n: 0 })).ok);
      await until(() => people.every((p) => p.state.phase === 'reveal'), 'the reveal');
      assert.equal(guesser.state.result.best, writers[2].id);
      assert.equal(guesser.state.word, word);
    }
    for (const p of people) assert.ok((await p.call('ready')).ok);
  }
  await until(() => ann.state.phase === 'finished', 'the end');
  assert.equal(ann.state.players.reduce((n, p) => n + p.score, 0), 3 * 3, 'three right guesses: 2 for the guesser and 1 for the best hint');
  const stats = JSON.stringify((await ann.http('GET', '/api/stats/me')).data);
  assert.ok(stats.includes('just-one'), 'the game was recorded');
  assert.ok(stats.includes('correctGuesses'));
});

test('computer players fill the table, write, guess, pick the best hint and finish a game', async (t) => {
  process.env.JUST_ONE_BOT_DELAY = '0-5';
  const site = await launch(t);
  const ann = await site.person('ann').open();
  assert.ok((await ann.call('create', { turnsEach: 1 })).ok);
  assert.ok((await ann.call('fillBots', { count: 4 })).ok);
  await until(() => ann.state.players.length === 4, 'three computers');
  assert.ok(ann.state.players.slice(1).every((p) => p.bot && p.online));
  assert.ok((await ann.call('start')).ok);
  for (let turn = 1; turn <= 4; turn++) {
    await until(() => ann.state.turn === turn && ann.state.phase !== 'finished', `turn ${turn}`);
    if (ann.state.guesser === ann.id) {
      await until(() => ann.state.phase === 'guessing', 'the clues of the computers');
      assert.equal(ann.state.word, null);
      assert.ok((await ann.call('pass')).ok);
    } else {
      await until(() => ann.state.phase === 'clues' && ann.state.word, 'my clue');
      assert.ok((await ann.call('clue', { text: 'zebra' })).ok);
      await until(() => ['guessing', 'choosing', 'reveal'].includes(ann.state.phase), 'the computer guesser');
    }
    await until(() => ann.state.phase === 'reveal', 'the reveal');
    assert.ok(ann.state.players.every((p) => (p.bot ? p.ai : true)), 'computer players show their AI');
    assert.ok((await ann.call('ready')).ok);
  }
  await until(() => ann.state.phase === 'finished', 'the end');
  assert.equal(ann.state.scoreboard.rounds.length, 4);
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
});
