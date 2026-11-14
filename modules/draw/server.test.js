// Draw! over real sockets: a whole game against computer players, the two boards and who may draw on which, and a
// drawer who walks out in the middle of a round.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handledSocketEvents, launchModule, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Quick-fire for real: the words are picked at once and the drawing is over in a moment.  The choosing wait is left
// longer than a computer player takes to pick, so the clock is not quietly doing their choosing for them.
process.env.DRAW_CHOOSE_WAIT = '400';
process.env.DRAW_BETWEEN_WAIT = '40';
process.env.DRAW_AWAY_WAIT = '80';
process.env.DRAW_BOT_DELAY = '0-5';
process.env.DRAW_BOT_DRAW = '10';
process.env.DRAW_BOT_RATE = '20000';
process.env.DRAW_PICTURES = 'test'; // bands worked out from the word: no network

const launch = (t, extra = {}) => launchModule(t, { id: 'draw', moduleDir: here, ...extra });

/** The socket events this module handles, which the robustness test below also keeps in step. */
const EVENTS = ['addBot', 'canvas', 'clear', 'create', 'draw', 'fillBots', 'guess', 'join', 'kick', 'leave', 'line', 'fill', 'removeBot', 'resume', 'settings', 'start', 'undo', 'voteAnswer', 'voteDrop', 'voteKick', 'word', 'again'];

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), [...new Set(EVENTS)].sort());
});

test('a person and two computer players play a whole game: every pair draws, and only the person is recorded', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const created = await ann.call('create');
  assert.equal(created.ok, true, created.error);
  assert.equal((await ann.call('start')).ok, false, 'one player is not enough');
  assert.equal((await ann.call('fillBots', { count: 3 })).ok, true);
  await until(() => ann.state?.players.length === 3, 'a table of three');
  assert.equal((await ann.call('settings', { drawTime: 10 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.turns === 3, 'three pairs of three players');

  // Play it out: Ann draws when she is drawn, and guesses nonsense when she is not, so the clock ends each round.
  const started = Date.now();
  while (ann.state?.phase !== 'finished') {
    assert.ok(Date.now() - started < 60000, `stalled in ${ann.state?.phase} turn ${ann.state?.turn}`);
    const s = ann.state;
    if (s?.phase === 'choosing' && s.choices.length) await ann.call('word', { n: 0 });
    else if (s?.phase === 'drawing' && !s.youDraw) await ann.call('guess', { text: 'not the word' });
    else await sleep(10);
  }
  assert.equal(ann.state.turn, 3, 'every pair of the three drew');
  assert.equal(ann.state.scoreboard.rounds.length, 3);

  await sleep(100);
  const stats = (await ann.stats()).perGame[0];
  assert.equal(stats.name, 'Draw!');
  assert.equal(stats.played, 1);
  assert.equal(stats.extras.find((e) => e.key === 'drawn').value, 2, 'she drew against each of the other two');
  assert.equal(site.site.db.prepare('SELECT COUNT(*) AS n FROM result_players').get().n, 1, 'the computer players are not accounts');
});

test('both boards reach everybody, and only a drawer may put strokes on their own', async (t) => {
  const site = await launch(t);
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann, bob, cat] = people;
  const { code } = await ann.call('create');
  for (const p of [bob, cat]) assert.equal((await p.call('join', { code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === 3), 'a table of three');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'choosing'), 'choosing');

  const drawers = people.filter((p) => p.state.youDraw);
  const guesser = people.find((p) => !p.state.youDraw);
  assert.equal(drawers.length, 2, 'two of them draw');
  assert.equal((await guesser.call('line', { x: 1, y: 1, x2: 2, y2: 2, c: 5, w: 8 })).ok, false, 'a guesser never draws');

  for (const p of drawers) assert.equal((await p.call('word', { n: 0 })).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'drawing'), 'drawing');

  // Each drawer's strokes reach the others, tagged with the board they belong to.
  const seen = [];
  for (const p of people) p.socket.on('draw', (message) => seen.push({ who: p.name, board: message.board, ops: message.ops.length }));
  for (const p of drawers) assert.equal((await p.call('line', { x: 10, y: 10, x2: 20, y2: 20, c: 3, w: 8 })).ok, true);
  await until(() => seen.filter((s) => s.who === guesser.name).length === 2, 'the guesser sees a stroke on each board');
  assert.deepEqual(seen.filter((s) => s.who === guesser.name).map((s) => s.board).sort(), [0, 1], 'one for each board');
  // A drawer is not sent their own strokes back, only the other board's.
  const toDrawer = seen.filter((s) => s.who === drawers[0].name);
  assert.equal(toDrawer.length, 1, 'the other board only');
  assert.notEqual(toDrawer[0].board, drawers[0].state.boards.findIndex((b) => b.yours));

  // Opening the game on a second device mid-round is sent both boards as they stand.
  const phone = await guesser.twin();
  const boards = [];
  phone.socket.on('canvas', (message) => boards.push(message));
  assert.equal((await phone.call('resume', { code })).ok, true);
  assert.equal((await phone.call('canvas')).ok, true);
  await until(() => boards.length >= 2, 'both boards');
  assert.deepEqual([...new Set(boards.map((b) => b.board))].sort(), [0, 1]);
  assert.ok(boards.some((b) => b.ops.length > 0), 'with the strokes already on them');
});

test('a drawer who walks out mid-round leaves their strokes behind for the computer player taking over', async (t) => {
  const site = await launch(t);
  const people = await Promise.all(['ann', 'bob', 'cat', 'dan'].map((n) => site.person(n).open()));
  const [ann, bob, cat, dan] = people;
  const { code } = await ann.call('create');
  for (const p of [bob, cat, dan]) assert.equal((await p.call('join', { code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === 4), 'a table of four');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'choosing'), 'choosing');
  const drawers = people.filter((p) => p.state.youDraw);
  for (const p of drawers) await p.call('word', { n: 0 });
  await until(() => people.every((p) => p.state?.phase === 'drawing'), 'drawing');

  const leaving = drawers[0];
  const theirBoard = leaving.state.boards.findIndex((b) => b.yours);
  assert.equal((await leaving.call('line', { x: 30, y: 30, x2: 40, y2: 40, c: 7, w: 8 })).ok, true);
  assert.equal((await leaving.call('leave')).ok, true);
  await until(() => leaving.state === null, 'they are out');

  const watcher = people.find((p) => p !== leaving && p.state);
  await until(() => watcher.state.players.some((p) => p.bot), 'a computer player in their place');
  const boards = [];
  watcher.socket.on('canvas', (message) => boards.push(message));
  assert.equal((await watcher.call('canvas')).ok, true);
  await until(() => boards.length >= 2, 'both boards again');
  const theirs = boards.filter((b) => b.board === theirBoard).flatMap((b) => b.ops);
  assert.ok(theirs.length > 0, 'the stroke they drew before leaving is still on the board');
});

test('the first choice of a game waits for both drawers with no clock; a later one waits for both or its whole clock', async (t) => {
  const site = await launch(t);
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann, bob, cat] = people;
  const { code } = await ann.call('create');
  for (const p of [bob, cat]) await p.call('join', { code });
  await until(() => people.every((p) => p.state?.players.length === 3), 'a table of three');
  assert.equal((await ann.call('settings', { drawTime: 120 })).ok, true, 'long enough that the drawing never runs out here');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'choosing'), 'choosing');
  assert.ok(people.every((p) => p.state.remaining === null), 'nobody is shown a clock for the first choice');

  // One of the first pair picks, and the other sits on their hands for twice the choosing wait: nothing starts.
  const [quick, slow] = people.filter((p) => p.state.youDraw);
  assert.equal((await quick.call('word', { n: 0 })).ok, true);
  await sleep(2 * Number(process.env.DRAW_CHOOSE_WAIT));
  assert.ok(people.every((p) => p.state.phase === 'choosing'), 'still choosing: the first turn waits for both of them');
  assert.equal(slow.state.choices.length > 0, true, 'and nothing was picked for the one still thinking');
  assert.equal((await slow.call('word', { n: 0 })).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'drawing'), 'drawing, once both had picked');

  // The first drawing is named, and the second pair choose: this time on a clock.
  const guesser = people.find((p) => !p.state.youDraw);
  assert.equal((await guesser.call('guess', { text: quick.state.boards.find((b) => b.yours).word })).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'choosing' && p.state.turn === 2), 'the second pair choosing');
  assert.ok(people.every((p) => p.state.remaining !== null), 'a later choice is timed');
  const [early, late] = people.filter((p) => p.state.youDraw);
  assert.equal((await early.call('word', { n: 0 })).ok, true);
  assert.ok(people.every((p) => p.state.phase === 'choosing'), 'one of them picking does not start the drawing');
  assert.equal(late.state.choices.length > 0, true, 'the other still has their words to pick from');
  await until(() => people.every((p) => p.state?.phase === 'drawing'), 'the clock picking for the one who dithered');
  assert.ok(late.state.boards.find((b) => b.yours).word, 'who has a word to draw all the same');
});

test('a round neither drawer is there for is given up, and the game carries on', async (t) => {
  const site = await launch(t);
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann, bob, cat] = people;
  const { code } = await ann.call('create');
  for (const p of [bob, cat]) await p.call('join', { code });
  await until(() => people.every((p) => p.state?.players.length === 3), 'a table of three');
  assert.equal((await ann.call('settings', { drawTime: 120 })).ok, true, 'long enough that only the walkout can end it');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'choosing'), 'choosing');
  const drawers = people.filter((p) => p.state.youDraw);
  const watcher = people.find((p) => !p.state.youDraw);
  for (const p of drawers) await p.call('word', { n: 0 });
  await until(() => watcher.state.phase === 'drawing', 'drawing');

  const turn = watcher.state.turn;
  for (const p of drawers) p.socket.close();
  await until(() => watcher.state.turn !== turn || watcher.state.phase !== 'drawing', 'the turn given up', { timeout: 10000 });
  assert.notEqual(watcher.state.phase, 'drawing', 'nobody was left to draw either of them');
});
