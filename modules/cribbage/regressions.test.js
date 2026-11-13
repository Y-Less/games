// Regression tests for Cribbage: bugs that were fixed in this module whose server half got no test at the time (the
// rules did).  Each test names the commit it pins and says what went wrong, and each asserts what that commit's
// message says is right, so that taking the fix back out fails here rather than at a table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seeded } from '../../shared/random.js';
import * as game from './game.js';
import startCribbage from './server.js';

/** A started room: seat 0 is Ann (account 1), the others computer players. */
function started(seats) {
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { target: 121, seats } });
  assert.ok(game.fillWithBots(room, 1, room.seats.length).ok);
  assert.ok(game.start(room, 1, seeded(5)).ok);
  return room;
}

/** Sets an environment variable for the length of one test. */
function withEnv(t, name, value) {
  const before = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
}

/**
 * The real Cribbage server over one saved room, with Ann connected to it and looking at her game.
 * @param {import('node:test').TestContext} t  the running test, whose `after` hook stops the server
 * @param {object} room  the room to start from
 * @returns {Promise<{ ask: (event: string, payload?: object) => Promise<object>, live: () => object }>}
 *   `ask` sends one of Ann's socket events and resolves with the answer; `live` is the room as the server holds it
 */
async function tableWith(t, room) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cribbage-regressions-'));
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify([{ ...room, updatedAt: Date.now() }]));
  const ctx = {
    io: new EventEmitter(),
    dataDir,
    log() {},
    codes: { normalise: (code) => code ?? '', generate: () => 'd-e-f' },
    stats: { record() {} },
    achievements: { cardsPlayed: (userId, outcome) => outcome },
  };
  const server = startCribbage(ctx);
  t.after(() => {
    server.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const ann = new EventEmitter();
  ann.data = { user: { id: 1, name: 'Ann' } };
  const emit = ann.emit.bind(ann);
  ann.emit = (event, payload) => (event === 'state' ? true : emit(event, payload)); // the views she is sent are not looked at here
  const ask = (event, payload = {}) => new Promise((resolve) => emit(event, payload, resolve));
  ctx.io.emit('connection', ann);
  assert.deepEqual(await ask('resume', { code: room.code }), { ok: true, code: room.code });
  return { ask, live: () => server.rooms.get(room.code) };
}

// 4cecc50 "Card games: name each computer player's pending action, so other people's moves do not restart its
// timer".  The rules got a test for the name; that the server hands it on to its timer did not, and that is the half
// a player sees: each person discarding restarted a computer player's discard.
test('a person discarding does not make the computer player that is thinking start its wait again', async (t) => {
  withEnv(t, 'CRIBBAGE_BOT_DELAY', '1000-1000'); // a computer player thinks for exactly a second
  t.mock.timers.enable({ apis: ['setTimeout'] }); // the second is stepped through, not waited for

  const room = started(4);
  room.seats[2] = { ...room.seats[2], kind: 'human', id: 2, name: 'Bob' }; // Bob has not discarded, so the hand cannot move on without him
  assert.equal(room.phase, 'discard');
  const { ask, live } = await tableWith(t, room);
  const discarded = () => live().seats.filter((seat) => seat.discarded).length;
  assert.equal(discarded(), 0, 'nobody has discarded yet');

  t.mock.timers.tick(900);
  assert.equal(discarded(), 0, 'the computer player is still thinking');
  const hand = live().hands[0];
  assert.deepEqual(await ask('discard', { cards: hand.slice(0, hand.length - 4) }), { ok: true });
  assert.equal(discarded(), 1, 'Ann has discarded');
  t.mock.timers.tick(200);
  assert.equal(discarded(), 2, 'and the computer player discarded when its own second was up, not a second after Ann did');
});

// 1530682 "Cribbage: time the show out like the other hand-end waits, and keep the back peg on the last real score".
// A person who closed their tab during the show (still seated, just offline) stalled the table until the host removed
// them: nothing dealt the next hand without every person's "ready".  The rules got a test for being forced on; that
// the server ever forces them, and that closing the show does not start the wait again, did not.
test('the show is moved on by the clock when somebody never closes it, however many others do', async (t) => {
  withEnv(t, 'CRIBBAGE_NEXT_WAIT', '60000');
  t.mock.timers.enable({ apis: ['setTimeout'] }); // the minute is stepped through, not waited for

  // Ann and Bob at the show of a hand: the last four cards of the play are played out to get there.
  const room = started(2);
  room.seats[1] = { ...room.seats[1], kind: 'human', id: 2, name: 'Bob' };
  Object.assign(room, {
    dealer: 0,
    phase: 'play',
    hands: [['QS', '6C'], ['KH', '5D']],
    kept: [['QS', '6C'], ['KH', '5D']],
    crib: ['KC', 'KD', 'QC', 'QD'],
    starter: '2D',
    log: [],
    history: [],
    handDeltas: {},
    play: { count: 0, sequence: [], turn: 1, last: null, said: [], previous: [] },
  });
  room.seats.forEach((seat) => Object.assign(seat, { score: 0, back: 0, discarded: true }));
  for (const [seat, card] of [[1, 'KH'], [0, 'QS'], [1, '5D'], [0, '6C']]) assert.ok(game.playCard(room, seat, card).ok);
  assert.equal(room.phase, 'show');
  const hand = room.handNo;

  const { ask, live } = await tableWith(t, room); // Bob never connects: he is seated, and away
  t.mock.timers.tick(50000);
  assert.equal(live().phase, 'show', 'the minute is not up, and Bob has not closed the show');
  assert.deepEqual(await ask('ready'), { ok: true });
  assert.equal(live().phase, 'show', 'Ann closing it is not enough on its own');
  t.mock.timers.tick(15000);
  assert.equal(live().handNo, hand + 1, 'the next hand was dealt a minute after the show began, not a minute after Ann closed it');
  assert.notEqual(live().phase, 'show');
});
