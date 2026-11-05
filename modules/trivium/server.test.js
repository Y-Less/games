// Trivium over real sockets, against a real site: a quiz played from the invite code to the final score, the clock
// moving the game on by itself, the questions coming from a source, and nothing about an answer reaching anybody
// before the question has closed.  The questions here are made up (TRIVIUM_TRIVIA=test), so no test touches the web.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'trivium';

process.env.TRIVIUM_TRIVIA = 'test';
process.env.TRIVIUM_SPIN_MS = '120';
process.env.TRIVIUM_ANSWER_MS = '1500';
process.env.TRIVIUM_REVEAL_STEP = '15';
process.env.TRIVIUM_REVEAL_HOLD = '150';
process.env.TRIVIUM_GRACE_MS = '4000';

const launch = (t) => launchModule(t, { id: ID, moduleDir: here });

/** A room with these people in it, in the lobby. */
async function lobbyOf(site, names, settings = { rounds: 1, perRound: 2 }) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const [host, ...rest] = people;
  const created = await host.call('create', settings);
  assert.equal(created.ok, true, created.error);
  for (const p of rest) assert.equal((await p.call('join', { code: created.code })).ok, true, `${p.name} joined`);
  await until(() => people.every((p) => p.state?.players.length === people.length), 'everybody in the lobby');
  return { people, host, code: created.code };
}

/** Waits until everybody is looking at a question, and answers it for each of them. */
async function answerOne(people, choose = () => 0) {
  await until(() => people.every((p) => p.state?.phase === 'question'), 'a question for everybody');
  for (const [index, person] of people.entries()) {
    const reply = await person.call('answer', { choice: choose(person, index), x: 0.4, y: 0.6 });
    assert.equal(reply.ok, true, `${person.name}: ${reply.error}`);
  }
}

test('a whole quiz: the wheel spins, questions are asked and answered, and the result is recorded', async (t) => {
  const site = await launch(t);
  const { people, host } = await lobbyOf(site, ['ann', 'bob'], { rounds: 1, perRound: 2 });
  const [ann, bob] = people;

  assert.equal(ann.state.phase, 'lobby');
  assert.ok(ann.state.wheel.length >= 1, 'the lobby already shows a wheel');
  assert.equal((await host.call('start')).ok, true);

  await until(() => people.every((p) => p.state?.phase === 'spin'), 'the wheel turning');
  assert.ok(ann.state.spin.category, 'it is turning towards a category');
  assert.equal(ann.state.question, null, 'and no question is up yet');

  await answerOne(people, (unused, index) => index); // one of them is right, the other is not
  await until(() => people.every((p) => p.state?.phase === 'reveal'), 'the reveal');
  assert.equal(ann.state.result.entries.length, 2, 'both answers are shown');
  assert.equal(typeof ann.state.correct, 'number');
  assert.ok(ann.state.reveal.step > 0);

  await answerOne(people, () => 0);
  await until(() => people.every((p) => p.state?.phase === 'finished'), 'the end of the quiz');
  assert.equal(ann.state.scoreboard.rounds.length, 2, 'a scoreboard line for each question');
  assert.ok(ann.state.players.some((p) => p.winner), 'somebody won');

  await sleep(200);
  assert.equal((await ann.stats()).perGame[0].played, 1, 'the game was recorded once');
  assert.equal(bob.state.phase, 'finished');
});

test('an answer is the first one given, and nobody sees another player until the question closes', async (t) => {
  const site = await launch(t);
  const { people, host } = await lobbyOf(site, ['ann', 'bob', 'cat'], { rounds: 1, perRound: 1 });
  const [ann, bob] = people;
  assert.equal((await host.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'question'), 'a question');

  assert.equal((await ann.call('answer', { choice: 1, x: 0.25, y: 0.75 })).ok, true);
  assert.equal((await ann.call('answer', { choice: 2, x: 0.5, y: 0.5 })).error, 'alreadyAnswered');
  assert.deepEqual(ann.state.mine, { choice: 1, x: 0.25, y: 0.75 });
  assert.equal(bob.state.mine, null, 'and that is nobody else to know');
  assert.equal(bob.state.correct, null);
  assert.equal(bob.state.result, null);
  assert.ok(!JSON.stringify(bob.state).includes('"choice"'), 'no choice of anybody reaches another player');
  assert.ok(bob.state.players.find((p) => p.id === ann.id).answered, 'though the table can see that she has answered');

  assert.equal((await bob.call('answer', { choice: 9, x: 0.5, y: 0.5 })).error, 'notAnAnswer');
  assert.equal((await bob.call('answer', { choice: 0, x: 2, y: 0.5 })).error, 'tapOnTheButton');
  assert.equal((await bob.call('answer', { choice: 0, x: 0.5, y: 0.5 })).ok, true);
  assert.equal(bob.state.phase, 'question', 'the third player has still to answer');
  assert.equal((await people[2].call('answer', { choice: 0, x: 0.5, y: 0.5 })).ok, true);
  await until(() => people.every((p) => p.state?.phase !== 'question'), 'the question closing as soon as everybody has answered');
  assert.equal(ann.state.result.entries.length, 3);
});

test('a question nobody answers closes on its own, and the quiz carries on', async (t) => {
  const site = await launch(t);
  const { people, host } = await lobbyOf(site, ['ann', 'bob'], { rounds: 1, perRound: 1 });
  assert.equal((await host.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'question'), 'a question');
  await until(() => people.every((p) => p.state?.phase === 'finished'), 'the quiz ending without a single answer', { timeout: 15000 });
  assert.deepEqual(people[0].state.result, null, 'a finished quiz is past its last reveal');
  assert.equal(people[0].state.scoreboard.rounds.length, 1);
  assert.ok(people[0].state.players.every((p) => p.score === 0));
});

test('computer players answer by themselves and the quiz runs to its end with nobody doing anything', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const created = await ann.call('create', { rounds: 2, perRound: 2 });
  assert.equal(created.ok, true, created.error);
  assert.equal((await ann.call('fillBots', { count: 5 })).ok, true);
  await until(() => ann.state?.players.length === 5, 'a room of five');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.phase === 'finished', 'the quiz ending by itself', { timeout: 30000 });
  assert.equal(ann.state.scoreboard.rounds.length, 4);
  const bots = ann.state.players.filter((p) => p.bot);
  assert.equal(bots.length, 4);
  assert.ok(bots.some((p) => p.score > 0), 'the computer players got some of them right');
  for (const bot of bots) assert.ok(bot.ai?.name, 'and each shows which sort of player it is');
  assert.equal(ann.state.players.find((p) => p.id === ann.id).score, 0, 'the person who did nothing scored nothing');
});

test('the settings belong to the host, keep within their limits, and are fixed once the quiz has started', async (t) => {
  const site = await launch(t);
  const { people, host } = await lobbyOf(site, ['ann', 'bob'], {});
  const [, bob] = people;
  assert.equal((await host.call('settings', { rounds: 4, perRound: 6 })).ok, true);
  await until(() => bob.state?.rounds === 4 && bob.state.perRound === 6, 'the settings reaching everybody');
  assert.equal((await host.call('settings', { rounds: 99 })).error, 'roundsRange');
  assert.equal((await host.call('settings', { perRound: 0 })).error, 'perRoundRange');
  assert.equal((await bob.call('settings', { rounds: 2 })).ok, false, 'only the host');
  assert.equal(host.state.rounds, 4);
  assert.equal((await host.call('settings', { rounds: 1, perRound: 1 })).ok, true);
  assert.equal((await host.call('start')).ok, true);
  assert.equal((await host.call('settings', { rounds: 2 })).ok, false, 'not once it has started');
});

test('marker colours are chosen in the waiting room and are never shared', async (t) => {
  const site = await launch(t);
  const { people } = await lobbyOf(site, ['ann', 'bob']);
  const [ann, bob] = people;
  const annColour = ann.state.players.find((p) => p.id === ann.id).colour;
  assert.equal((await bob.call('colour', { colour: annColour })).error, 'colourTaken');
  const free = ann.state.colours.find((c) => !ann.state.players.some((p) => p.colour === c));
  assert.equal((await bob.call('colour', { colour: free })).ok, true);
  await until(() => ann.state.players.find((p) => p.id === bob.id)?.colour === free, 'the new colour reaching everybody');
  assert.equal((await bob.call('colour', { colour: '#abcdef' })).error, 'colourIsUnlock');
  assert.equal((await bob.call('colour', { colour: 'not a colour' })).error, 'notAColour');
});
