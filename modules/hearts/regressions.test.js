// Regression tests for Hearts: bugs that were fixed in this module without a test being written for them at the time.
// Each test names the commit it pins and says what went wrong, and each asserts what that commit's message says is
// right, so that taking the fix back out fails here rather than at a table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fullDeck } from '../../shared/cards.js';
import { refusalReply } from '../../shared/messages.js';
import { seeded } from '../../shared/random.js';
import * as g from './game.js';
import startHearts from './server.js';

/** A started game of four: seat 0 is Ann (account 1), the rest are computer players. */
function started() {
  const room = g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 4, jackOfDiamonds: false } });
  g.fillWithBots(room, 1, room.seats.length);
  assert.equal(g.start(room, 1, seeded(1)).ok, true);
  return room;
}

/** A hand with two tricks left and Ann to lead: the given hands, and every other card already taken by seat 1. */
function lateHand(hands) {
  const room = started();
  const inHands = new Set(hands.flat());
  Object.assign(room, {
    phase: 'playing',
    passDirection: 'none',
    hands: hands.map((hand) => [...hand]),
    trick: [],
    turn: 0,
    tricksPlayed: 11,
    heartsBroken: true,
    taken: [[], fullDeck().filter((card) => !inHands.has(card)), [], []],
    moonBid: null,
    updatedAt: Date.now(),
  });
  return room;
}

/**
 * The real Hearts server over one saved room, with Ann connected to it and looking at her game.
 * @param {import('node:test').TestContext} t  the running test, whose `after` hook stops the server
 * @param {object} room  the room to start from
 * @returns {Promise<{ ask: (event: string, payload?: object) => Promise<object>, counted: Array<[number, number]> }>}
 *   `ask` sends one of Ann's socket events and resolves with the answer; `counted` is every [account, cards] the
 *   server reported towards Played cards for a move that was allowed
 */
async function tableWith(t, room) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-regressions-'));
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify([room]));
  const counted = [];
  const ctx = {
    io: new EventEmitter(),
    dataDir,
    log() {},
    codes: { normalise: (code) => code ?? '', generate: () => 'd-e-f' },
    stats: { record() {} },
    // As server/achievements.js does it: the cards count only if the move was allowed, and the outcome is handed back.
    achievements: {
      cardsPlayed(userId, outcome, count) {
        if (outcome?.ok) counted.push([userId, count]);
        return outcome;
      },
    },
  };
  const server = startHearts(ctx);
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
  return { ask, counted, live: () => server.rooms.get(room.code) };
}

// 4cecc50 "Card games: name each computer player's pending action, so other people's moves do not restart its
// timer".  The rules got a test for the name; that the server hands it on to its timer did not, and that is the half
// a player sees: each person passing restarted the next computer player's pass.
test("a person passing does not make the computer player that is thinking start its wait again", async (t) => {
  const before = process.env.HEARTS_BOT_DELAY;
  process.env.HEARTS_BOT_DELAY = '1000-1000'; // a computer player thinks for exactly a second
  t.after(() => {
    if (before === undefined) delete process.env.HEARTS_BOT_DELAY;
    else process.env.HEARTS_BOT_DELAY = before;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] }); // the second is stepped through, not waited for

  const room = started();
  room.seats[2] = { kind: 'human', id: 2, name: 'Bob' }; // Bob has not passed, so the hand cannot move on without him
  room.updatedAt = Date.now();
  assert.equal(room.phase, 'passing');
  const { ask, live } = await tableWith(t, room);
  const passed = () => live().passes.filter(Boolean).length;
  assert.equal(passed(), 0, 'nobody has passed yet');

  t.mock.timers.tick(900);
  assert.equal(passed(), 0, 'the computer player is still thinking');
  assert.deepEqual(await ask('pass', { cards: live().hands[0].slice(0, 3) }), { ok: true });
  assert.equal(passed(), 1, 'Ann has passed');
  t.mock.timers.tick(200);
  assert.equal(passed(), 2, 'and the computer player passed when its own second was up, not a second after Ann did');
});

// 5f5389d "A refusal thrown out of createRoom keeps its code; a rules bug never shows the player a sentence".  Hearts
// threw a plain Error with an English sentence for a table size or a setting it would not take, which the room server
// can only answer as a server error; Azulejo, changed in the same commit, got a test and Hearts did not.
test('a new game with a number of seats or a setting Hearts will not take is refused with a code, not a server error', () => {
  const answerTo = (settings) => {
    try {
      g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann', settings });
    } catch (error) {
      return refusalReply(error); // as the room server answers a throw from createRoom
    }
    return { ok: true };
  };
  assert.deepEqual(answerTo({ seats: 99 }), { ok: false, error: 'playersRange', params: { min: g.MIN_SEATS, max: g.MAX_SEATS } });
  const badSetting = answerTo({ target: 'a great many' });
  assert.equal(badSetting.ok, false);
  assert.notEqual(badSetting.error, 'serverError', 'the rules said why, and the player is told that');
});

// da6f0ee "Hearts: tell a computer player only whether it is chasing the moon, and record every stat counter".
// Every AI was handed the seat that had bid for the moon, which is that seat's own secret.
test('a computer player is told whether it is chasing the moon itself, and nothing about who else is', () => {
  const room = started();
  const told = (bidder, seat) => {
    room.moonBid = bidder;
    const { rng, ...context } = g.aiContext(room, seat, seeded(1));
    return context;
  };
  assert.equal(told(2, 2).chasingMoon, true, 'the seat that bid knows it did');
  assert.equal(told(2, 1).chasingMoon, false, 'and another seat is not chasing');
  // Whoever has bid, and whether anybody has, a seat that has not is told exactly the same.
  assert.deepEqual(told(2, 1), told(3, 1), 'seat 1 cannot tell seat 2 bidding from seat 3 bidding');
  assert.deepEqual(told(2, 1), told(null, 1), 'nor from nobody bidding at all');
});

// 305a272 "Fix remaining review findings: stats dedupe, register limit, Hearts claim, client leaks".  Claiming the
// rest of a hand plays every card the claimer has left, but none of them was counted towards Played cards.
test('claiming the rest of the hand counts every card the claimer had left as played', async (t) => {
  const { ask, counted } = await tableWith(t, lateHand([['AS', 'AH'], ['2C', '3C'], ['4C', '5C'], ['6C', '7C']]));
  assert.deepEqual(await ask('claim'), { ok: true });
  assert.deepEqual(counted, [[1, 2]], 'both of the cards she held, once, to her account');
});
