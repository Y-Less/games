// Lifecycle for Scribblers against the real site: a game surviving a restart (and the board, which is not saved,
// being blank afterwards), one account on two sockets, and the host leaving.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { launchModule, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'scribblers';

process.env.SCRIBBLERS_CHOOSE_WAIT = '20000';
process.env.SCRIBBLERS_BETWEEN_WAIT = '400';
process.env.SCRIBBLERS_SCORES_WAIT = '20000';
process.env.SCRIBBLERS_AWAY_WAIT = '20000';
process.env.SCRIBBLERS_BOT_DELAY = '50-150';
process.env.SCRIBBLERS_BOT_DRAW = '100';
process.env.SCRIBBLERS_BOT_RATE = '5000'; // a computer player draws its picture in one go here, rather than at its usual pace
process.env.SCRIBBLERS_PICTURES = 'test'; // a computer player draws without reaching for the web


/**
 * A started game: everybody in, the first drawer choosing.
 * @param {object} site  from launchModule
 * @param {string[]} names  the accounts
 * @returns {Promise<{ people: object[], code: string }>}
 */
async function gameOf(site, names) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const created = await people[0].call('create', { rounds: 2, drawTime: 30 });
  assert.equal(created.ok, true, created.error);
  for (const person of people.slice(1)) assert.equal((await person.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === names.length), 'everybody in the lobby');
  assert.equal((await people[0].call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'choosing'), 'the first drawer is choosing');
  return { people, code: created.code };
}

test('a game survives a restart of the site: the word, the scores and the turn are as they were, and the board starts again blank', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribblers-restart-'));
  const first = await launchModule(t, { id: ID, moduleDir: here, dataDir, keep: true });
  const { people, code } = await gameOf(first, ['ann', 'bob', 'cat']);
  const drawer = people.find((p) => p.state.youDraw);
  assert.equal((await drawer.call('word', { n: 0 })).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'drawing'), 'the drawing starts');
  const word = drawer.state.word;
  const guesser = people.find((p) => p !== drawer);
  assert.equal((await guesser.call('guess', { text: word })).ok, true);
  for (let n = 0; n < 4; n++) assert.equal((await drawer.call('line', { x: n, y: n, x2: n + 1, y2: n + 1, c: 1, w: 8 })).ok, true);
  const scoreBefore = guesser.state.players.find((p) => p.id === guesser.id).score;
  assert.ok(scoreBefore > 0);
  await sleep(250); // saves are batched
  await first.stop();

  const second = await launchModule(t, { id: ID, moduleDir: here, dataDir, keep: true });
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true })); // registered last, so it runs after the site has closed
  /** Signs an account back in on the restarted site and resumes its game. */
  const open = async (name) => {
    const res = await fetch(`${second.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: `${name} password` }) });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const socket = connect(`${second.base}/${ID}`, { forceNew: true, extraHeaders: { cookie } });
    t.after(() => socket.close());
    const me = { name, state: undefined, canvases: [], call: (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve)) };
    socket.on('state', (s) => (me.state = s));
    socket.on('canvas', (message) => me.canvases.push(message));
    await new Promise((resolve) => socket.on('connect', resolve));
    assert.deepEqual(await me.call('resume'), { ok: true, code });
    return me;
  };
  const back = Object.fromEntries(await Promise.all(['ann', 'bob', 'cat'].map(async (n) => [n, await open(n)])));
  await until(() => Object.values(back).every((p) => p.state?.phase === 'drawing'), 'the game is back');
  assert.equal(back[drawer.name].state.word, word, 'the same word');
  assert.equal(back[guesser.name].state.word, word, 'still known to the one who guessed it');
  assert.equal(back[guesser.name].state.youGuessed, true);
  assert.equal(back[guesser.name].state.players.find((p) => p.name === guesser.name).score, scoreBefore, 'the same score');

  // The board is not saved: there is nothing to send back, and drawing carries on from blank.
  assert.equal((await back[guesser.name].call('canvas')).ok, true);
  await until(() => back[guesser.name].canvases.some((m) => m.done), 'the board came');
  assert.deepEqual(back[guesser.name].canvases.flatMap((m) => m.ops), [], 'the strokes were not kept');
  assert.equal((await back[drawer.name].call('line', { x: 1, y: 1, x2: 2, y2: 2, c: 1, w: 8 })).ok, true);
});

test('one account on two sockets sees the same game, and both are sent the strokes', async (t) => {
  const site = await launchModule(t, { id: ID, moduleDir: here });
  const { people } = await gameOf(site, ['ann', 'bob']);
  const drawer = people.find((p) => p.state.youDraw);
  const guesser = people.find((p) => p !== drawer);
  const tab = await guesser.twin();
  assert.equal((await tab.call('resume', {})).ok, true); // a new tab asks for its game, as the client does on loading
  await until(() => tab.state?.phase === 'choosing', 'the other tab sees the game');
  const seen = [];
  tab.socket.on('draw', (message) => seen.push(message));
  assert.equal((await drawer.call('word', { n: 0 })).ok, true);
  await until(() => tab.state?.phase === 'drawing', 'the drawing starts');
  assert.equal((await drawer.call('line', { x: 1, y: 1, x2: 2, y2: 2, c: 1, w: 8 })).ok, true);
  await until(() => seen.length === 1, 'the stroke reached the other tab');
  assert.equal((await tab.call('guess', { text: drawer.state.word })).ok, true, 'and it can guess');
  await until(() => guesser.state?.youGuessed === true, 'both tabs know it was guessed');
});

test('the host leaving passes the game on, and one account is in one game at a time', async (t) => {
  const site = await launchModule(t, { id: ID, moduleDir: here });
  const { people } = await gameOf(site, ['ann', 'bob', 'cat']);
  const [ann, bob, cat] = people;
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => [bob, cat].every((p) => p.state?.hostId !== ann.id), 'somebody else is the host');
  assert.ok([bob.id, cat.id].includes(bob.state.hostId));
  const created = await ann.call('create', { rounds: 1 });
  assert.equal(created.ok, true, 'and the one who left can start another game');
  const again = await ann.call('create', { rounds: 1 });
  assert.equal(again.ok, false, 'but not two at once');
  assert.equal(again.error, 'alreadyInGameStart');
});
