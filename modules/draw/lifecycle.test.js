// Draw! over real sockets, through the things that happen to a room rather than in a turn: the site restarting in the
// middle of a drawing, between two turns, and after the game; one account open in two tabs; a drawer's connection
// dropping; and the host walking out.  What is protected is that both words, the scores, and whose turn it is come
// back exactly as they were, that the clock a turn runs on is picked up again rather than lost, that a turn is won
// once however many tabs name it, and that a finished game is recorded once.
//
// server.test.js plays whole games and covers the two boards; nothing there stops the site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// The waits are read when the site starts, so each test sets the ones it cares about before launching.  The choosing
// wait is far longer than any wait in this file, so that the clock never picks a word behind a test's back; the
// drawing time is set (to its longest) in each game for the same reason.
process.env.DRAW_CHOOSE_WAIT = '600000';
process.env.DRAW_AWAY_WAIT = '600000';
process.env.DRAW_BOT_DELAY = '0-5';
process.env.DRAW_BOT_DRAW = '10';
process.env.DRAW_BOT_RATE = '20000';
process.env.DRAW_PICTURES = 'test'; // a computer player draws without reaching for the web

/** Starts the site with the words staying up between turns for `betweenMs`. */
const launch = (t, { betweenMs = 40, ...options } = {}) => {
  process.env.DRAW_BETWEEN_WAIT = String(betweenMs);
  return launchModule(t, { id: 'draw', moduleDir: here, ...options });
};
const played = async (person) => (await person.stats()).perGame.find((g) => g.name === 'Draw!')?.played ?? 0;
const me = (person) => person.state.players.find((p) => p.id === person.state.you);
const LINE = { x: 10, y: 10, x2: 20, y2: 20, c: 3, w: 8 };

/** A started game of the named people (the first is the host): the first pair are choosing their words. */
async function gameOf(site, names) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const created = await people[0].call('create', { drawTime: 120 });
  assert.equal(created.ok, true, created.error);
  for (const p of people.slice(1)) assert.equal((await p.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === names.length), 'everybody in the lobby');
  assert.equal((await people[0].call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'choosing'), 'the first pair to be choosing');
  return { people, code: created.code };
}

/** Both drawers pick their first word; returns who is drawing, who is guessing, and the two words. */
async function intoDrawing(people) {
  const drawers = people.filter((p) => p.state.youDraw);
  assert.equal(drawers.length, 2, 'two of them draw');
  for (const p of drawers) assert.equal((await p.call('word', { n: 0 })).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'drawing'), 'the drawing to start');
  const words = drawers.map((p) => p.state.boards.find((b) => b.yours).word);
  assert.ok(words.every(Boolean), 'each drawer can read their own word');
  return { drawers, guessers: people.filter((p) => !drawers.includes(p)), words };
}

/** The same account, signed in on a restarted site with the cookie it had, and back in its game. */
async function comeBack(site, person, code) {
  const back = site.person(person.name);
  back.cookie = person.cookie;
  back.id = person.id;
  await back.connect();
  assert.deepEqual(await back.call('resume', { code }), { ok: true, code });
  await until(() => back.state?.code === code, `${person.name} to be sent the game`);
  return back;
}

test('a restart in the middle of a drawing: both words, who is drawing them, and the guesses so far are as they were', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-restart-'));
  const first = await launch(t, { dataDir, keep: true });
  const { people, code } = await gameOf(first, ['ann', 'bob', 'cat', 'dan']);
  const { drawers, guessers, words } = await intoDrawing(people);
  assert.equal((await guessers[0].call('guess', { text: 'qqqq zzzz' })).ok, true);
  for (const p of drawers) assert.equal((await p.call('line', LINE)).ok, true);
  await until(() => people.every((p) => p.state.feed.length === 1), 'everybody to see the guess');
  const before = Object.fromEntries(people.map((p) => [p.name, p.state]));
  await first.stop();

  const second = await launch(t, { dataDir });
  const back = Object.fromEntries(await Promise.all(people.map(async (p) => [p.name, await comeBack(second, p, code)])));
  for (const p of people) {
    const now = back[p.name].state;
    const was = before[p.name];
    assert.equal(now.phase, 'drawing', 'still drawing');
    assert.deepEqual([now.turn, now.turns], [was.turn, was.turns], 'the same turn of the same game');
    assert.equal(now.youDraw, was.youDraw, `${p.name} is still ${was.youDraw ? 'drawing' : 'guessing'}`);
    assert.deepEqual(now.boards.map((b) => [b.drawer, b.word, b.shape.length]), was.boards.map((b) => [b.drawer, b.word, b.shape.length]), 'the same two drawings, and the same word for whoever may read it');
    assert.deepEqual(now.feed, was.feed, 'the guesses so far');
    assert.deepEqual(now.players.map((x) => [x.id, x.name, x.score]), was.players.map((x) => [x.id, x.name, x.score]), 'the same table and the same scores');
    assert.deepEqual(now.settings, was.settings);
    assert.ok(now.remaining > 0 && now.remaining <= 120 * 1000, 'the drawing still has time on its clock, and no more than it was given');
  }
  // And the turn can still be played: a drawer draws, and a guesser names a drawing.
  const drawer = back[drawers[0].name];
  const guesser = back[guessers[1].name];
  assert.equal((await drawer.call('line', LINE)).ok, true, 'a drawer can carry on drawing');
  assert.equal((await guesser.call('line', LINE)).ok, false, 'and a guesser still cannot');
  assert.equal((await guesser.call('guess', { text: words[0] })).ok, true);
  await until(() => Object.values(back).every((p) => p.state.phase !== 'drawing'), 'the turn to end');
  await until(() => me(guesser).score === 1 && me(drawer).score === 1, 'the point each to arrive');
  assert.equal(sum(guesser.state.players.map((x) => x.score)), 2, 'that drawer and that guesser score, and nobody else');
});

test('a restart while the two words are up: the turn that was scored stays scored, and the game moves on by itself', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-between-'));
  // The words stay up for long enough to stop the site while they are; if this machine is so slow that they have gone
  // by then, the game is simply a turn further on when it comes back, which is the thing being waited for anyway.
  const first = await launch(t, { dataDir, keep: true, betweenMs: 6000 });
  const { people, code } = await gameOf(first, ['ann', 'bob', 'cat']);
  const { drawers, guessers, words } = await intoDrawing(people);
  assert.equal((await guessers[0].call('guess', { text: words[1] })).ok, true);
  await until(() => people.every((p) => p.state.scoreboard.rounds.length >= 1), 'the first turn to be scored');
  const shown = guessers[0].states.find((s) => s?.phase === 'between');
  assert.deepEqual(Object.values(shown.reveal.words).sort(), [...words].sort(), 'both words went up for everybody, the guessers included');
  const scores = Object.fromEntries(people[0].state.players.map((x) => [x.name, x.score]));
  assert.deepEqual(scores, { [drawers[1].name]: 1, [guessers[0].name]: 1, [drawers[0].name]: 0 }, 'the drawer who was named and the guesser who named them');
  await first.stop();

  const second = await launch(t, { dataDir, betweenMs: 6000 });
  const back = await Promise.all(people.map((p) => comeBack(second, p, code)));
  for (const p of back) {
    assert.deepEqual(Object.fromEntries(p.state.players.map((x) => [x.name, x.score])), scores, 'the scores of the first turn');
    assert.equal(p.state.scoreboard.rounds.length >= 1, true, 'and its line on the scoreboard');
    assert.deepEqual(p.state.scoreboard.rounds[0].deltas, Object.fromEntries(p.state.players.map((x) => [x.id, x.score])), 'which says who scored');
  }
  // Nobody presses anything: the wait that was running when the site stopped is picked up, and the next pair choose.
  await until(() => back.every((p) => p.state.phase === 'choosing' && p.state.turn === 2), 'the second turn to begin by itself', { timeout: 60000 });
  assert.equal(back.filter((p) => p.state.youDraw).length, 2, 'two of them draw');
  assert.ok(back.filter((p) => p.state.youDraw).every((p) => p.state.choices.length > 0), 'and are offered words');
});

test('a restart after the game is over: the standings are there to look at, and nothing is recorded twice', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-finished-'));
  const first = await launch(t, { dataDir, keep: true });
  const { people, code } = await gameOf(first, ['ann', 'bob', 'cat']);
  // Three players are three pairs, so three turns: each is named by its guesser straight away.
  await until(
    async () => {
      if (people.every((p) => p.state.phase === 'finished')) return true;
      if (!people.every((p) => p.state.phase === people[0].state.phase && p.state.turn === people[0].state.turn)) return false;
      if (people[0].state.phase === 'choosing') for (const p of people) if (p.state.choices.length) await p.call('word', { n: 0 });
      if (people[0].state.phase === 'drawing') {
        const word = people.find((p) => p.state.youDraw).state.boards.find((b) => b.yours).word;
        await people.find((p) => !p.state.youDraw).call('guess', { text: word });
      }
      return false;
    },
    'the game to finish',
    { timeout: 60000 },
  );
  assert.equal(people[0].state.turn, 3, 'every pair of the three drew');
  await until(async () => (await Promise.all(people.map(played))).every((n) => n === 1), 'the game to be recorded once for each of them');
  const standings = people[0].state.players.map((x) => [x.name, x.score, x.placement, x.winner]);
  const best = Math.max(...standings.map(([, score]) => score));
  for (const [name, score, , winner] of standings) assert.equal(winner, score === best, `${name}: everybody on the top score wins`);
  await first.stop();

  const second = await launch(t, { dataDir });
  const back = await Promise.all(people.map((p) => comeBack(second, p, code))); // a finished game is found by its code
  for (const p of back) {
    assert.equal(p.state.phase, 'finished');
    assert.deepEqual(p.state.players.map((x) => [x.name, x.score, x.placement, x.winner]), standings, 'the standings as they were');
    assert.equal(p.state.scoreboard.rounds.length, 3);
  }
  // The host sends everybody back to the lobby, which is a change to the room and a save of it: if a restart were going
  // to record the finished game again, it has had every chance to by now.
  assert.equal((await back[0].call('again')).ok, true);
  await until(() => back.every((p) => p.state.phase === 'lobby'), 'the lobby');
  assert.ok(back[0].state.players.every((x) => x.score === 0), 'with the scores cleared');
  for (const p of back) assert.equal(await played(p), 1, `${p.name}: recorded once`);
  assert.equal(second.site.db.prepare('SELECT COUNT(*) AS n FROM results').get().n, 1, 'one result in the statistics');
});

test('one account in two tabs naming a drawing at the same moment wins the turn once', async (t) => {
  const site = await launch(t, { betweenMs: 600000 });
  const { people, code } = await gameOf(site, ['ann', 'bob', 'cat']);
  const { drawers, guessers, words } = await intoDrawing(people);
  const [guesser] = guessers;
  const tab = await guesser.twin();
  assert.deepEqual(await tab.call('resume', {}), { ok: true, code });
  await until(() => tab.state?.phase === 'drawing', 'the other tab to see the drawing');
  assert.equal(tab.state.youDraw, false);
  assert.ok(tab.state.boards.every((b) => b.word === null), 'the other tab is a guesser too, and is sent neither word');
  await Promise.all([guesser.call('guess', { text: words[0] }), tab.call('guess', { text: words[0] })]);
  await until(() => [...people, tab].every((p) => p.state.phase === 'between'), 'the turn to end');
  for (const p of [...people, tab]) {
    assert.equal(p.state.players.find((x) => x.name === guesser.name).score, 1, `${p.name} sees one point for the guesser, not two`);
    assert.equal(p.state.players.find((x) => x.name === drawers[0].name).score, 1, 'and one for the drawer who was named');
    assert.equal(p.state.players.find((x) => x.name === drawers[1].name).score, 0, 'and none for the other drawer');
    assert.equal(p.state.scoreboard.rounds.length, 1, 'one turn has ended, once');
  }
  assert.deepEqual(tab.state.feed, guesser.state.feed, 'both tabs are shown the same guess panel');
});

test('a drawer whose connection drops keeps their place and their word, and draws on when they return', async (t) => {
  const site = await launch(t);
  const { people, code } = await gameOf(site, ['ann', 'bob', 'cat']);
  const { drawers, guessers, words } = await intoDrawing(people);
  const [away, other] = drawers;
  const [watcher] = guessers;
  away.socket.close();
  await until(() => watcher.state.players.find((x) => x.name === away.name).online === false, 'them to show as away');
  const row = watcher.state.players.find((x) => x.name === away.name);
  assert.deepEqual([row.bot, row.drawing], [false, true], 'a lost connection is not leaving: no computer player takes their place, and it is still their drawing');
  assert.equal(watcher.state.phase, 'drawing', 'the turn goes on for the other drawer');
  assert.equal((await other.call('line', LINE)).ok, true);
  await away.connect();
  assert.deepEqual(await away.call('resume', { code }), { ok: true, code });
  await until(() => away.state?.phase === 'drawing' && watcher.state.players.find((x) => x.name === away.name).online === true, 'them to be back');
  assert.equal(away.state.youDraw, true);
  assert.equal(away.state.boards.find((b) => b.yours).word, words[0], 'with the word they had');
  assert.equal((await away.call('line', LINE)).ok, true, 'and they can draw');
});

test('the host walking out mid-game: a computer player takes their place and their score, and another person is the host', async (t) => {
  const site = await launch(t, { betweenMs: 600000 });
  const { people } = await gameOf(site, ['ann', 'bob', 'cat', 'dan']);
  const [ann, ...rest] = people;
  const { guessers, words, drawers } = await intoDrawing(people);
  // A turn is won first, so that there is a score to hand over; then whoever the host is, they leave.
  assert.equal((await guessers[0].call('guess', { text: words[0] })).ok, true);
  await until(() => people.every((p) => p.state.phase === 'between'), 'the turn to end');
  const score = me(ann).score;
  assert.equal(score, [drawers[0], guessers[0]].includes(ann) ? 1 : 0);
  const place = ann.state.players.findIndex((x) => x.id === ann.state.you);
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'Ann to be out');
  await until(() => rest.every((p) => p.state.players[place].bot === true), 'a computer player in her place');
  for (const p of rest) {
    assert.equal(p.state.players.length, 4, 'the table is the size it was');
    assert.equal(p.state.players[place].score, score, 'the computer player has her score');
    assert.ok(rest.map((x) => x.state.you).includes(p.state.hostId), 'one of the people left is the host');
    assert.equal(p.state.hostId, rest[0].state.hostId, 'and they agree who');
    assert.equal(p.state.turns, 6, 'the game is as long as it was: every pair of the four');
  }
  const own = await ann.call('create');
  assert.equal(own.ok, true, 'the one who left is free to start a game of their own');
  const another = await ann.call('create');
  assert.equal(another.ok, true, 'and another beside it');
  assert.notEqual(another.code, own.code);
});

/** Adds up a list of numbers. */
function sum(list) {
  return list.reduce((a, b) => a + b, 0);
}
