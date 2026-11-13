// Regression tests for Cheat: bugs that were fixed in this module without a test being written for them at the time.
// Each test names the commit it pins and says what went wrong, and each asserts what that commit's message says is
// right, so that taking the fix back out fails here rather than at a table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seeded } from '../../shared/random.js';
import * as bot from './bot.js';
import * as g from './game.js';
import startCheat from './server.js';

/**
 * The real Cheat server over one saved room.
 * @param {import('node:test').TestContext} t  the running test, whose `after` hook stops the server
 * @param {object} room  the room to start from
 * @returns {{ live: () => object, person: (id: number, name: string) => Promise<(event: string, payload?: object) => Promise<object>> }}
 *   `live` is the room as the server holds it; `person` connects an account to it and resolves with a function that
 *   sends one of their socket events and resolves with the answer
 */
function tableWith(t, room) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cheat-regressions-'));
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify([{ ...room, updatedAt: Date.now() }]));
  const ctx = {
    io: new EventEmitter(),
    dataDir,
    log() {},
    codes: { normalise: (code) => code ?? '', generate: () => 'd-e-f' },
    stats: { record() {} },
    achievements: { cardsPlayed: (userId, outcome) => outcome },
  };
  const server = startCheat(ctx);
  t.after(() => {
    server.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    live: () => server.rooms.get(room.code),
    async person(id, name) {
      const socket = new EventEmitter();
      socket.data = { user: { id, name } };
      const emit = socket.emit.bind(socket);
      socket.emit = (event, payload) => (event === 'state' ? true : emit(event, payload)); // the views are not looked at here
      const ask = (event, payload = {}) => new Promise((resolve) => emit(event, payload, resolve));
      ctx.io.emit('connection', socket);
      assert.deepEqual(await ask('resume', { code: room.code }), { ok: true, code: room.code });
      return ask;
    },
  };
}

// 00f06f1 "What a browser found that the other suites could not".  The lobby counted its packs from the seats around
// the table rather than from the people at it, so a seven-seat room with three people in it promised the deal of a
// seven-player game.
test('the lobby counts the packs for the people who would be playing, not for the seats around them', () => {
  const room = g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 7 } });
  assert.equal(g.fillWithBots(room, 1, 3).ok, true);
  assert.equal(room.seats.filter(Boolean).length, 3, 'three at a table of seven');
  assert.equal(room.seats.length, 7);
  assert.notEqual(g.decksFor(3), g.decksFor(7), 'the two counts differ, or this test shows nothing');
  assert.equal(g.viewFor(room, 1).decks, g.decksFor(3), 'the packs a game of three is dealt from');
});

// e7f18a9 "The count a lobby previews from has a name, and a race is waited out".  The fix above had a floor in it
// with no word about why; this commit wrote the reason down: below the minimum the game cannot start at all, so the
// smallest game the room could become is the honest thing to show somebody sitting alone in it.
test('somebody alone in the lobby is shown the smallest game the room could become', () => {
  const room = g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 7 } });
  assert.equal(g.viewFor(room, 1).decks, g.decksFor(g.MIN_SEATS));
});

// 4cecc50 "Card games: name each computer player's pending action, so other people's moves do not restart its
// timer".  The rules got a test for the name; that the server hands it on to its timer did not, and that is the half
// a player sees: each person accepting the final play restarted the computer player that was deciding about it.
test('a person accepting the final play does not make the computer player that is deciding start its wait again', async (t) => {
  const before = process.env.CHEAT_BOT_DELAY;
  process.env.CHEAT_BOT_DELAY = '1000-1000'; // a computer player takes 600 ms over a decision (see decideWait in server.js)
  t.after(() => {
    if (before === undefined) delete process.env.CHEAT_BOT_DELAY;
    else process.env.CHEAT_BOT_DELAY = before;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] }); // the wait is stepped through, not waited for

  // Ann has just played her last card, so everybody else must accept it or call it: Bob is a person, seats 1 and 3
  // are computer players, and the first of those is the one the server is waiting on.
  const room = g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 4 } });
  assert.equal(g.fillWithBots(room, 1, 4).ok, true);
  assert.equal(g.start(room, 1, seeded(1)).ok, true);
  room.seats[2] = { kind: 'human', id: 2, name: 'Bob' };
  Object.assign(room, { hands: [['5C'], ['2C', '9D'], ['3C', '4D'], ['6C', '7D']], turn: 0, plays: 0, pile: ['KS'], last: null, lastCall: null, decided: [], phase: 'playing' });
  assert.equal(g.playCards(room, 0, ['5C']).ok, true);
  assert.equal(room.phase, 'check');
  const deciding = bot.pendingAction(room);
  assert.deepEqual([deciding.type, deciding.seat], ['decide', 1]);

  const table = tableWith(t, room);
  const bob = await table.person(2, 'Bob');
  const stillDeciding = () => bot.pendingAction(table.live())?.key === deciding.key;

  t.mock.timers.tick(500);
  assert.equal(stillDeciding(), true, 'the computer player is still making up its mind');
  assert.deepEqual(await bob('accept'), { ok: true });
  assert.equal(stillDeciding(), true, 'Bob accepting is not its decision');
  t.mock.timers.tick(200);
  assert.equal(stillDeciding(), false, 'and it decided when its own wait was up, not that long after Bob did');
});
