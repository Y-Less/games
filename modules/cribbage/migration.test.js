// The move to the shared seat model: rooms saved in the old shape still load and play on, a computer player whose AI
// throws cannot leave the game stuck, and the host cannot remove anybody from a finished game.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, seeded, until } from '../../shared/testkit.js';
import * as game from './game.js';
import { AIS } from './ai/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.CRIBBAGE_BOT_DELAY = '0-2';

/**
 * Turns a current room into the shape the old server saved: packed seats with userId / bot / botId / left, plus
 * seatCount and botsMade. (A JSON round trip, like a real rooms.json.)
 *
 * @param {object} room  a room in the current shape
 * @returns {object} the same room as the old code would have saved it
 */
function asOldRoom(room) {
  const old = JSON.parse(JSON.stringify(room));
  old.seatCount = old.seats.length;
  old.botsMade = old.nextBot - 1;
  delete old.nextBot;
  old.seats = old.seats.filter(Boolean).map(({ kind, id, ...rest }) => ({
    ...rest,
    userId: kind === 'human' ? id : kind === 'gone' ? 9 : null,
    bot: kind === 'bot',
    ...(kind === 'bot' ? { botId: id } : {}),
    ...(kind === 'gone' ? { left: true } : {}),
  }));
  return old;
}

/**
 * A started game: person 1 (the host) and computer players in the other seats.
 *
 * @param {number} [seed]   random seed for the deal
 * @param {number} [seats]  how many seats
 * @returns {object} the room
 */
function startedRoom(seed = 4, seats = 2) {
  const room = game.createRoom({ code: 'old-room-code', hostId: 1, hostName: 'Ann', settings: { seats } });
  game.fillWithBots(room, 1);
  assert.ok(game.start(room, 1, seeded(seed)).ok);
  return room;
}

/**
 * Plays person 1's moves by hand and lets the computer players do the rest, until the game finishes.
 *
 * @param {object} room
 * @param {() => number} rng
 */
function playToTheEnd(room, rng) {
  for (let guard = 0; room.phase !== 'finished' && guard < 5000; guard++) {
    const mine = game.seatOf(room, 1);
    if (room.phase === 'discard' && !room.seats[mine].discarded) game.discard(room, mine, room.hands[mine].slice(0, game.dealRules(room.seats.length, mine === room.dealer).discards), rng);
    else if (room.phase === 'play' && room.play.turn === mine) game.playCard(room, mine, game.playableCards(room, mine)[0]);
    else if (room.phase === 'show' && !room.seats[mine].ready) game.ready(room, mine, rng);
    else assert.equal(game.botMove(room, rng).ok, true);
  }
  assert.equal(room.phase, 'finished');
}

test('migrate: an old-shape room becomes a current one and plays on to the end', () => {
  const old = asOldRoom(startedRoom());
  assert.equal(old.seats[1].bot, true, 'the fixture really is in the old shape');
  const migrated = game.migrate(old);
  assert.equal(migrated, old, 'the same object comes back');
  assert.deepEqual(migrated.seats.map((s) => [s.kind, s.id]), [['human', 1], ['bot', 'bot:1']]);
  assert.equal(migrated.nextBot, 2);
  assert.equal(migrated.seatCount, undefined);
  assert.equal(migrated.botsMade, undefined);
  assert.equal(migrated.seats[0].userId, undefined);
  assert.equal(game.seatOf(migrated, 1), 0);
  assert.equal(game.viewFor(migrated, 1).seats[1].bot, true);
  playToTheEnd(migrated, seeded(7));
});

test('migrate: lobby rooms are padded with empty seats, people who left stay as markers, and current rooms are untouched', () => {
  const lobby = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 4 } });
  const padded = game.migrate(asOldRoom(lobby));
  assert.equal(padded.seats.length, 4);
  assert.deepEqual(padded.seats.map((s) => s?.kind ?? null), ['human', null, null, null]);

  const finished = startedRoom();
  finished.phase = 'finished';
  finished.winner = 0;
  finished.seats[1] = { ...finished.seats[1], kind: 'gone', id: null };
  const legacy = asOldRoom(finished);
  assert.equal(legacy.seats[1].left, true);
  assert.equal(game.migrate(legacy).seats[1].kind, 'gone');
  assert.equal(game.hasPlayer(legacy, 9), false, 'a person who left is not seated');

  const current = startedRoom();
  const copy = JSON.stringify(current);
  assert.equal(JSON.stringify(game.migrate(current)), copy, 'a current room is returned unchanged');
});

test('migrate: the next computer player does not reuse an id, and a replaced person keeps their name', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 3 } });
  game.addHuman(room, 2, 'Bob');
  game.addBot(room, 1);
  game.start(room, 1, seeded(3));
  game.removeHuman(room, 2, seeded(3));
  assert.equal(room.seats[1].replaced, true);
  assert.equal(room.seats[1].name, 'Bob');
  const migrated = game.migrate(asOldRoom(room));
  const ids = migrated.seats.filter((s) => s.kind === 'bot').map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes(`bot:${migrated.nextBot}`), 'the next id is unused');
});

test('a saved old-shape rooms.json loads in the real server and the game goes on', async (t) => {
  const room = startedRoom();
  room.updatedAt = Date.now();
  const old = asOldRoom(room);
  const setup = (dataDir) => {
    const folder = path.join(dataDir, 'site', 'modules', 'cribbage');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'rooms.json'), JSON.stringify([old]));
  };
  const site = await launchModule(t, { id: 'cribbage', moduleDir: here, setup });
  const ann = await site.person('ann').open();
  assert.equal(ann.id, 1, 'the first account is user 1, the host of the saved room');
  assert.equal((await ann.call('resume', {})).code, 'old-room-code');
  await until(() => ann.state?.code === 'old-room-code', 'the saved room');
  assert.equal(ann.state.seats[1].bot, true);
  assert.equal(ann.state.seats[0].name, 'Ann');
  assert.equal(ann.state.phase, 'discard');
  assert.equal((await ann.call('discard', { cards: ann.state.hand.slice(0, 2) })).ok, true);
  await until(() => ann.state.phase === 'play', 'the computer player to discard too');
});

test('a computer player whose AI throws or answers nonsense still moves', () => {
  const ai = AIS.find((a, i) => i > 0);
  const saved = { discard: ai.discard, play: ai.play };
  try {
    for (const [label, broken] of [['throws', () => { throw new Error('boom'); }], ['answers nonsense', () => 'ZZ']]) {
      ai.discard = broken;
      ai.play = broken;
      const room = startedRoom(11);
      room.seats[1].ai = ai.id;
      playToTheEnd(room, seeded(2));
      assert.equal(room.phase, 'finished', `the game finished although the AI ${label}`);
    }
  } finally {
    Object.assign(ai, saved);
  }
});

test('kick: refused once the game is over, and nothing changes', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 2 } });
  game.addHuman(room, 2, 'Bob');
  game.start(room, 1, seeded(5));
  room.phase = 'finished';
  room.winner = 0;
  const refused = game.kick(room, 1, 1);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /over/);
  assert.equal(room.seats[1].kind, 'human', 'nothing changed');
});
