// The socket half of Scribblers against a real site: a game from the invite code to the final scores, and the drawing
// protocol - strokes relayed to the other players as they are made, the board handed to somebody who arrives in the
// middle of a turn, and undo and clear redrawing it for everybody.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { MAX_BATCH } from './drawing.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// A turn is made short so that a whole game is a test rather than a wait.
process.env.SCRIBBLERS_CHOOSE_WAIT = '1500';
process.env.SCRIBBLERS_BETWEEN_WAIT = '150';
process.env.SCRIBBLERS_SCORES_WAIT = '1500';
process.env.SCRIBBLERS_AWAY_WAIT = '300';

/** A line instruction, with whatever is wanted changed. */
const line = (over = {}) => ({ x: 100, y: 100, x2: 200, y2: 200, c: 2, w: 8, ...over });

/**
 * Starts the site and puts `names` into one game, started, with the given options.
 * @param {import('node:test').TestContext} t  the running test
 * @param {string[]} names  the accounts to make
 * @param {object} [settings]  what the host chooses
 * @returns {Promise<{ site: object, people: object[], code: string }>}
 */
async function table(t, names, settings = { rounds: 1, drawTime: 30 }) {
  const site = await launchModule(t, { id: 'scribblers', moduleDir: here });
  const people = await Promise.all(names.map((name) => site.person(name).open()));
  const created = await people[0].call('create', settings);
  assert.equal(created.ok, true, created.error);
  for (const person of people.slice(1)) assert.equal((await person.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === names.length), 'everybody in the lobby');
  assert.equal((await people[0].call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'choosing'), 'the first drawer is choosing');
  return { site, people, code: created.code };
}

/** Whoever is drawing now, and everybody else. */
const split = (people) => {
  const drawer = people.find((p) => p.state?.youDraw);
  return { drawer, guessers: people.filter((p) => p !== drawer) };
};

/**
 * Collects the drawing events a person is sent.
 * @param {object} person  a connected person
 * @returns {{ draws: object[], canvases: object[] }} the arrays fill as the events arrive
 */
function watchDrawing(person) {
  const draws = [];
  const canvases = [];
  person.socket.on('draw', (message) => draws.push(message));
  person.socket.on('canvas', (message) => canvases.push(message));
  return { draws, canvases };
}

test('a game is played from the invite code to the final scores, and is recorded once', async (t) => {
  const { people } = await table(t, ['ann', 'bob', 'cat']);
  const before = (await people[0].stats()).perGame?.find((g) => g.game === 'scribblers')?.played ?? 0;

  for (let turn = 0; turn < 3; turn++) {
    await until(() => people.every((p) => p.state?.phase === 'choosing'), `turn ${turn} begins`);
    const { drawer, guessers } = split(people);
    assert.ok(drawer, 'somebody is drawing');
    assert.equal(drawer.state.choices.length, 3, 'the drawer is offered words');
    for (const guesser of guessers) assert.deepEqual(guesser.state.choices, [], 'nobody else sees the words');
    assert.equal((await drawer.call('word', { n: 0 })).ok, true);
    await until(() => people.every((p) => p.state?.phase === 'drawing'), 'the drawing starts');
    const word = drawer.state.word;
    assert.ok(word, 'the drawer knows the word');
    for (const guesser of guessers) assert.equal(guesser.state.word, null, 'a guesser does not');
    for (const guesser of guessers) assert.equal((await guesser.call('guess', { text: word })).ok, true);
    await until(() => people.every((p) => ['between', 'scores', 'finished'].includes(p.state?.phase)), 'the turn is over');
  }

  await until(() => people.every((p) => p.state?.phase === 'finished'), 'the game is over', { timeout: 10000 });
  for (const person of people) {
    assert.ok(person.state.players.every((p) => p.score > 0), 'everybody scored');
    assert.equal(person.state.scoreboard.rounds.length, 1, 'one round in the scoreboard');
  }
  await sleep(200);
  const after = (await people[0].stats()).perGame.find((g) => g.game === 'scribblers');
  assert.equal(after.played, before + 1);
});

test('the drawer strokes are relayed to the others as they are made, and not back to the drawer', async (t) => {
  const { people } = await table(t, ['ann', 'bob']);
  const { drawer, guessers } = split(people);
  assert.equal((await drawer.call('word', { n: 0 })).ok, true);
  await until(() => guessers[0].state?.phase === 'drawing', 'the drawing starts');

  const watching = watchDrawing(guessers[0]);
  const own = watchDrawing(drawer);
  assert.equal((await drawer.call('line', line())).ok, true);
  assert.equal((await drawer.call('fill', { x: 10, y: 10, c: 5 })).ok, true);
  assert.equal((await drawer.call('draw', { ops: [{ t: 'line', ...line({ x: 1 }) }, { t: 'line', ...line({ x: 2 }) }] })).ok, true);
  await until(() => watching.draws.flatMap((m) => m.ops).length === 4, 'four instructions arrived');
  const ops = watching.draws.flatMap((m) => m.ops);
  assert.deepEqual(ops[0], { t: 'line', ...line() });
  assert.deepEqual(ops[1], { t: 'fill', x: 10, y: 10, c: 5 });
  assert.equal(own.draws.length, 0, 'the drawer is not sent their own strokes back');
});

test('a guesser cannot draw, and nor can anybody once the turn is over', async (t) => {
  const { people } = await table(t, ['ann', 'bob']);
  const { drawer, guessers } = split(people);
  assert.equal((await guessers[0].call('line', line())).error, 'notYourTurnToDraw');
  assert.equal((await guessers[0].call('clear')).error, 'notYourTurnToDraw');
  assert.equal((await guessers[0].call('undo')).error, 'notYourTurnToDraw');
  assert.equal((await drawer.call('line', line())).error, 'notYourTurnToDraw', 'not before a word is chosen');
  assert.equal((await drawer.call('word', { n: 0 })).ok, true);
  await until(() => drawer.state?.phase === 'drawing', 'the drawing starts');
  assert.equal((await drawer.call('line', line())).ok, true);
  assert.equal((await drawer.call('line', { x: 'over there' })).error, 'badDrawing');
  assert.equal((await drawer.call('draw', { ops: [] })).error, 'badDrawing');
});

test('somebody who arrives in the middle of a turn is sent the board as it stands', async (t) => {
  const { people } = await table(t, ['ann', 'bob']);
  const { drawer, guessers } = split(people);
  assert.equal((await drawer.call('word', { n: 0 })).ok, true);
  await until(() => guessers[0].state?.phase === 'drawing', 'the drawing starts');
  for (let n = 0; n < 5; n++) assert.equal((await drawer.call('line', line({ x: n }))).ok, true);

  // A second tab of the same account: it has seen none of the strokes, so it asks for the board.
  const tab = await guessers[0].twin();
  const watching = watchDrawing(tab);
  assert.equal((await tab.call('resume', {})).ok, true);
  assert.equal((await tab.call('canvas')).ok, true);
  await until(() => watching.canvases.some((m) => m.done), 'the whole board arrived');
  const ops = watching.canvases.flatMap((m) => m.ops);
  assert.equal(ops.length, 5);
  assert.equal(watching.canvases[0].first, true);
  assert.equal(ops[0].x, 0);
  assert.equal(ops[4].x, 4);
});

test('undo takes the last stroke off for everybody, and clear empties the board', async (t) => {
  const { people } = await table(t, ['ann', 'bob']);
  const { drawer, guessers } = split(people);
  assert.equal((await drawer.call('word', { n: 0 })).ok, true);
  await until(() => guessers[0].state?.phase === 'drawing', 'the drawing starts');
  const watching = watchDrawing(guessers[0]);

  assert.equal((await drawer.call('line', line({ x: 1 }))).ok, true);
  await sleep(250); // a pause, so the next stroke is one of its own
  assert.equal((await drawer.call('line', line({ x: 2 }))).ok, true);
  assert.equal((await drawer.call('undo')).ok, true);
  await until(() => watching.canvases.length > 0, 'the board came again');
  const afterUndo = watching.canvases.filter((m) => m.first).at(-1);
  assert.equal(afterUndo.ops.length, 1, 'one stroke left');
  assert.equal(afterUndo.ops[0].x, 1);

  assert.equal((await drawer.call('clear')).ok, true);
  await until(() => watching.canvases.filter((m) => m.first).length > 1, 'the board was cleared');
  assert.deepEqual(watching.canvases.filter((m) => m.first).at(-1).ops, []);
});

test('a batch bigger than one message allows is cut down rather than refused', async (t) => {
  const { people } = await table(t, ['ann', 'bob']);
  const { drawer, guessers } = split(people);
  assert.equal((await drawer.call('word', { n: 0 })).ok, true);
  await until(() => guessers[0].state?.phase === 'drawing', 'the drawing starts');
  const watching = watchDrawing(guessers[0]);
  const ops = Array.from({ length: MAX_BATCH + 50 }, (_, n) => ({ t: 'line', ...line({ x: n % 1000 }) }));
  assert.equal((await drawer.call('draw', { ops })).ok, true);
  await until(() => watching.draws.flatMap((m) => m.ops).length === MAX_BATCH, 'only a message-full was taken');
});

test('a right guess is kept from the table, a close one is shown only to its writer, and the turn ends when all have it', async (t) => {
  const { people } = await table(t, ['ann', 'bob', 'cat']);
  const { drawer, guessers } = split(people);
  assert.equal((await drawer.call('word', { n: 0 })).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'drawing'), 'the drawing starts');
  const word = drawer.state.word;

  assert.equal((await guessers[0].call('guess', { text: 'nonsense' })).ok, true);
  assert.equal((await guessers[0].call('guess', { text: `${word}s` })).ok, true);
  await until(() => guessers.every((p) => p.state.feed.length === 2), 'both guesses reached everybody');
  assert.deepEqual(guessers[0].state.feed.map((l) => l.kind), ['guess', 'close']);
  assert.deepEqual(guessers[1].state.feed.map((l) => l.kind), ['guess', 'guess']);

  assert.equal((await guessers[0].call('guess', { text: word })).ok, true);
  await until(() => guessers[1].state.feed.some((l) => l.kind === 'correct'), 'the table was told somebody got it');
  assert.equal(guessers[1].state.feed.find((l) => l.kind === 'correct').text, '');
  assert.equal(guessers[1].state.word, null, 'the word is still hidden from the one still guessing');
  assert.equal(guessers[0].state.word, word, 'but shown to the one who got it');

  assert.equal((await guessers[1].call('guess', { text: word })).ok, true);
  await until(() => people.every((p) => ['between', 'scores', 'finished'].includes(p.state?.phase)), 'the turn ended itself');
  for (const person of people) assert.ok(person.state.players.find((p) => p.id === person.state.drawer).score > 0, 'the drawer scored');
});

test('a word nobody chooses is chosen by the clock, and letters appear as the time runs down', async (t) => {
  const { people } = await table(t, ['ann', 'bob'], { rounds: 1, drawTime: 30 });
  await until(() => people.every((p) => p.state?.phase === 'drawing'), 'the clock chose a word', { timeout: 6000 });
  const { drawer, guessers } = split(people);
  assert.ok(drawer.state.word, 'the drawer was told what they are drawing');
  const hidden = guessers[0].state.hints.filter((h) => h.ch === null).length;
  assert.ok(hidden > 0, 'the guesser sees blanks');
  assert.ok(guessers[0].state.remaining > 0, 'the guesser is told how long is left');
});

test('a turn whose drawer has gone is given up and play moves on', async (t) => {
  const { people } = await table(t, ['ann', 'bob', 'cat'], { rounds: 2, drawTime: 30 });
  const { drawer } = split(people);
  const others = people.filter((p) => p !== drawer);
  assert.equal((await drawer.call('leave')).ok, true);
  await until(() => others.every((p) => p.state?.players.some((q) => q.bot)), 'a stand-in took their place');
  await until(() => others.every((p) => p.state?.phase !== 'choosing' || p.state.drawer !== drawer.id), 'the turn was given up', { timeout: 8000 });
  await until(() => others.some((p) => p.state?.reveal?.reason === 'drawerAway' || p.state?.phase === 'choosing'), 'the table was told why');
});

test('the lobby options are the host business, and the game needs two players', async (t) => {
  const site = await launchModule(t, { id: 'scribblers', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const created = await ann.call('create', {});
  assert.equal(created.ok, true);
  assert.equal((await ann.call('start')).ok, false, 'one player is not a game');
  assert.equal((await bob.call('join', { code: created.code })).ok, true);
  await until(() => ann.state?.players.length === 2, 'two players');
  assert.equal((await bob.call('settings', { rounds: 9 })).ok, false, 'only the host');
  assert.equal((await ann.call('settings', { rounds: 9, drawTime: 120, wordChoices: 5 })).ok, true);
  await until(() => bob.state?.settings.rounds === 9, 'the option reached everybody');
  assert.deepEqual([bob.state.settings.drawTime, bob.state.settings.wordChoices], [120, 5]);
  assert.equal((await ann.call('settings', { rounds: 99 })).ok, false);
  assert.equal((await ann.call('start')).ok, true);
  assert.equal((await ann.call('settings', { rounds: 2 })).ok, false, 'not once it has started');
});
