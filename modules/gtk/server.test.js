// GTK against the real site: accounts over HTTP, a game over sockets, what each person is sent, computer players, and
// the statistics a finished game records.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t) => launchModule(t, { id: 'gtk', moduleDir: here });

/** Everybody writes two answers of their own: the subject's are the truth, the rest are made up. */
async function everybodyWrites(people) {
  for (const p of people) assert.ok((await p.call('answers', { texts: p.state.prompts.map((_, n) => `${p.name} ${['first', 'second', 'third', 'fourth'][n]}`) })).ok, `${p.name} writes`);
}
/** The option this person must not pick (their own), and the one that is really the subject's. */
const ownOption = (person) => person.state.options.findIndex((o) => o.yours);

test('a whole game with four people: create, join, start, answers, picking, the reveal, finishing and statistics', async (t) => {
  const site = await launch(t);
  const people = [await site.person('ann').open(), await site.person('bob').open(), await site.person('cat').open(), await site.person('dan').open()];
  const [ann, bob] = people;

  assert.deepEqual(await ann.call('resume'), { ok: true, code: null });
  assert.equal((await ann.call('join', { code: 'boss-aware-you' })).error, 'noGameWithCode');
  const created = await ann.call('create', { roundsEach: 1 });
  assert.ok(created.ok);
  assert.equal((await ann.call('create')).ok, false, 'already in a game');
  for (const p of people.slice(1)) assert.ok((await p.call('join', { code: created.code })).ok);
  await until(() => ann.state.players.length === 4, 'four players');
  assert.equal((await bob.call('start')).ok, false, 'only the host starts');
  assert.ok((await ann.call('start')).ok);

  for (let round = 1; round <= 4; round++) {
    await until(() => people.every((p) => p.state?.phase === 'writing' && p.state.round === round), `round ${round}`);
    const subject = people.find((p) => p.state.isSubject);
    const others = people.filter((p) => p !== subject);
    assert.equal(subject.state.prompts.length, 2, 'two questions a round');
    assert.ok(others[0].state.prompts[0].includes(subject.state.subjectName), 'the others are told whose round it is');
    assert.equal((await subject.call('answers', { texts: ['only one'] })).ok, false, 'both questions need an answer');
    assert.equal((await subject.call('choose', { n: 0 })).ok, false, 'nothing to pick yet');
    await everybodyWrites(people);

    for (let question = 1; question <= 2; question++) {
      await until(() => people.every((p) => p.state.phase === 'picking' && p.state.question === question), `question ${question}`);
      assert.equal(subject.state.options.length, 4, 'four different answers are on the table');
      assert.equal(subject.state.truth, null, 'the true answer is not named while it is being picked');
      assert.ok(subject.state.options.every((o) => !('authors' in o)), 'nobody sees who wrote what yet');
      assert.equal((await subject.call('choose', { n: 0 })).ok, false, 'the subject does not pick');
      assert.equal((await others[0].call('choose', { n: ownOption(others[0]) })).ok, false, 'nor can you pick your own');

      const truth = others[0].state.options.findIndex((o) => o.text === `${subject.name} first` || o.text === `${subject.name} second`);
      assert.ok(truth >= 0);
      assert.ok((await others[0].call('choose', { n: truth })).ok, 'a right pick');
      assert.equal((await others[0].call('choose', { n: truth })).ok, false, 'one pick each');
      await until(() => others[1].state.players.find((p) => p.id === others[0].id).picked, 'a pick seen by the others');
      const wrong = others[1].state.options.findIndex((o, n) => n !== truth && !o.yours);
      assert.ok((await others[1].call('choose', { n: wrong })).ok);
      assert.ok((await others[2].call('choose', { n: truth })).ok);

      await until(() => people.every((p) => p.state.phase === 'reveal'), 'the reveal');
      assert.equal(others[0].state.truth, others[0].state.options.find((o) => o.truth).text);
      assert.ok(others[0].state.options.every((o) => Array.isArray(o.authors)), 'now everybody sees who wrote what');
      for (const p of people) assert.ok((await p.call('ready')).ok);
    }
  }
  await until(() => ann.state.phase === 'finished', 'the end');
  assert.equal(ann.state.scoreboard.rounds.length, 8, 'two questions in each of four rounds');
  const stats = JSON.stringify((await ann.http('GET', '/api/stats/me')).data);
  assert.ok(stats.includes('gtk'), 'the game was recorded');
  assert.ok(stats.includes('rightAnswers'));
});

test('the true answer never reaches anybody before the reveal', async (t) => {
  const site = await launch(t);
  const people = [await site.person('ann').open(), await site.person('bob').open(), await site.person('cat').open()];
  const { code } = await people[0].call('create', { roundsEach: 1 });
  for (const p of people.slice(1)) await p.call('join', { code });
  await until(() => people[0].state.players.length === 3, 'three players');
  await people[0].call('start');
  await until(() => people.every((p) => p.state.phase === 'writing'), 'writing');
  const subject = people.find((p) => p.state.isSubject);
  const secret = 'A very particular answer';
  assert.ok((await subject.call('answers', { texts: [secret, `${secret} two`] })).ok);
  for (const p of people.filter((x) => x !== subject)) assert.ok((await p.call('answers', { texts: [`${p.name} one`, `${p.name} two`] })).ok);
  await until(() => people.every((p) => p.state.phase === 'picking'), 'picking');
  for (const p of people.filter((x) => x !== subject)) {
    const before = JSON.stringify(p.states.filter((s) => s && s.phase === 'writing'));
    assert.ok(!before.includes(secret), `${p.name} never saw it while the answers were being written`);
    assert.equal(p.state.options.filter((o) => o.text === secret).length, 1, 'it is on the table, but unmarked');
    assert.equal(p.state.truth, null);
    assert.equal(p.state.options.find((o) => o.text === secret).yours, false);
  }
});

test('computer players fill the table, write, pick and finish a game', async (t) => {
  process.env.GTK_BOT_DELAY = '0-5';
  const site = await launch(t);
  const ann = await site.person('ann').open();
  assert.ok((await ann.call('create', { roundsEach: 1 })).ok);
  assert.ok((await ann.call('fillBots', { count: 4 })).ok);
  await until(() => ann.state.players.length === 4, 'three computer players');
  assert.ok(ann.state.players.slice(1).every((p) => p.bot && p.online));
  assert.ok((await ann.call('start')).ok);
  for (let step = 0; step < 8; step++) {
    await until(() => ann.state.phase !== 'finished' && (ann.state.phase === 'writing' || ann.state.phase === 'picking' || ann.state.phase === 'reveal'), 'something to do');
    if (ann.state.phase === 'writing') {
      if (!ann.state.yourAnswers) assert.ok((await ann.call('answers', { texts: ['Ann says one', 'Ann says two'] })).ok);
      await until(() => ann.state.phase !== 'writing', 'the computers write');
    }
    if (ann.state.phase === 'picking' && !ann.state.isSubject && !ann.state.yoursWasTrue) {
      const n = ann.state.options.findIndex((o) => o.canPick);
      assert.ok((await ann.call('choose', { n })).ok);
    }
    await until(() => ann.state.phase === 'reveal', 'the reveal');
    assert.ok(ann.state.players.every((p) => (p.bot ? p.ai : true)), 'computer players show their AI');
    assert.ok((await ann.call('ready')).ok);
    await until(() => ann.state.phase !== 'reveal', 'moving on');
    if (ann.state.phase === 'finished') break;
  }
  await until(() => ann.state.phase === 'finished', 'the end');
  assert.equal(ann.state.scoreboard.rounds.length, 8);
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
