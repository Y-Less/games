// Regression tests for Nomination Whist: bugs that were fixed in this module without a test being written for them at
// the time.  Each test names the commit it pins and says what went wrong, and each asserts what that commit's message
// says is right, so that taking the fix back out fails here rather than at a table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import * as g from './game.js';
import * as bot from './bot.js';
import { STAT_KEYS } from './tally.js';

/** A started game of four: seat 0 is Ann (account 1), the rest are computer players. */
function started(settings = {}, seed = 1) {
  const room = g.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 4, ...settings } });
  assert.ok(g.fillWithBots(room, 1, 4).ok);
  assert.ok(g.start(room, 1, seeded(seed)).ok);
  return room;
}

/** Plays a started game to its end, every seat with the computer's judgement. */
function playOut(room, rng) {
  for (let guard = 0; guard < 100000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'roundEnd') {
      for (const seat of room.seats) if (seat?.kind === 'human') assert.ok(g.nextRound(room, seat.id, rng).ok);
    } else if (room.phase === 'playing' && room.trick.length === room.seats.length) assert.ok(g.resolveTrick(room).ok);
    else if (room.phase === 'nominating') assert.ok(g.nominate(room, room.turn, g.botNominate(room, room.turn, rng)).ok);
    else assert.ok(g.playCard(room, room.turn, g.botPlay(room, room.turn, rng)).ok);
  }
  assert.equal(room.phase, 'finished');
}

/** Moves a started game on, a move at a time, until a computer player is the one to act. */
function untilComputerToAct(room, rng) {
  for (let guard = 0; guard < 100 && !bot.pendingAction(room); guard++) {
    assert.equal(room.seats[room.turn].kind, 'human', 'nothing is pending, so a person is to act');
    if (room.phase === 'nominating') assert.ok(g.nominate(room, room.turn, g.botNominate(room, room.turn, rng)).ok);
    else assert.ok(g.playCard(room, room.turn, g.botPlay(room, room.turn, rng)).ok);
  }
  return bot.pendingAction(room);
}

// 4cecc50 "Card games: name each computer player's pending action, so other people's moves do not restart its
// timer".  A computer player's own think-timer carried no key, and the room server restarts an unkeyed timer on every
// change to the room.  Hearts, Cheat, and Cribbage each got a test; Nomination Whist did not.
test("a computer player's pending action is named, and the name lasts exactly as long as the action does", () => {
  const rng = seeded(3);
  const room = started();
  const before = untilComputerToAct(room, rng);
  assert.ok(before, 'a computer player is to act');
  assert.equal(typeof before.key, 'string', 'the action has a name for the server to keep its timer by');
  assert.ok(before.key.length > 0);
  assert.equal(bot.pendingAction(room).key, before.key, 'asked again with nothing done, it is the same action');
  assert.ok(bot.runPending(room, rng));
  const after = bot.pendingAction(room);
  if (after) assert.notEqual(after.key, before.key, 'once it has acted, what comes next is a new action');
});

// 4cecc50 "Card games: name each computer player's pending action, so other people's moves do not restart its
// timer".  The other side of the same name: it "changes only when the action itself does", so it must change then.
// The room server keeps the timer it has for a name it has already seen, and a move with the last move's name would
// never be given one.
test('every kind of thing the server does by itself in a round is named differently from the one before it', () => {
  // A whole round of computer moves and trick ends, with no two in a row sharing a name.
  const rng = seeded(4);
  const room = started();
  room.seats[0] = { ...room.seats[1], id: 'bot:zero', name: 'Zero' }; // nobody is human, so every move is the server's
  let last = null;
  let moves = 0;
  for (let action = bot.pendingAction(room); action && moves < 200; action = bot.pendingAction(room)) {
    assert.equal(typeof action.key, 'string', `a ${action.type} has a name`);
    assert.notEqual(action.key, last, `a ${action.type} is not taken for the action before it`);
    last = action.key;
    bot.runPending(room, rng);
    moves += 1;
  }
  assert.ok(moves > 8, `a round was played (${moves} moves)`);
});

// dd91b07 "Nomination Whist: build the standard scoreboard on the server, keep the log on the page, copy the AI's
// hand".  The AI contexts handed the AI the room's live hand array despite saying they copied it, so an AI that
// rearranged what it was given rearranged (or emptied) the hand in the game.
test('what an AI is given to nominate and to play from is a copy: changing it changes nothing in the game', () => {
  const room = started();
  const seat = 1;
  const held = [...room.hands[seat]];
  const nominating = g.nominateContext(room, seat, seeded(1));
  assert.deepEqual(nominating.hand, held, 'it is told its hand');
  nominating.hand.length = 0;
  assert.deepEqual(room.hands[seat], held, 'emptying what it was given to nominate from leaves the real hand alone');

  room.phase = 'playing';
  room.turn = seat;
  const playing = g.playContext(room, seat, seeded(1));
  assert.deepEqual(playing.hand, held);
  playing.hand.reverse();
  playing.hand.pop();
  assert.deepEqual(room.hands[seat], held, 'and so does rearranging what it was given to play from');
});

// dd91b07 "Nomination Whist: build the standard scoreboard on the server, keep the log on the page, copy the AI's
// hand", which also says "stats extras go through extrasOf so a room saved before a counter existed records 0".  The
// tally was spread into the record as it stood, so a game begun before a counter was added recorded nothing for it.
test('a game saved before a counter existed records 0 for it rather than nothing', () => {
  const room = started({ length: 'short' }, 5);
  playOut(room, seeded(6));
  // As such a room comes back from being saved: Ann's tally has never heard of the two newest counters.
  const missing = STAT_KEYS.slice(-2);
  for (const key of missing) delete room.tally[0][key];
  const [ann] = g.statsPlayers(room);
  assert.equal(ann.userId, 1);
  for (const key of missing) assert.equal(ann.extras[key], 0, `${key}, which the saved room had no counter for`);
});
