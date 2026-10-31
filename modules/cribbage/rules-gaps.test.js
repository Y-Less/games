// Rules-level gaps found by reading game.js against the existing tests: names, settings edges, leaving after the
// game, returning to the lobby and kicking.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';

const room2 = (extra = {}) => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats: 2, ...extra } });

test('names are tidied, shortened and made unique, however many people share them', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: '  Ann   Lee  ', settings: { seats: 4 } });
  assert.equal(room.seats[0].name, 'Ann Lee');
  game.addHuman(room, 2, 'ann lee');
  game.addHuman(room, 3, 'ANN LEE');
  assert.deepEqual(room.seats.filter(Boolean).map((s) => s.name), ['Ann Lee', 'ann lee (2)', 'ANN LEE (3)']);
  const long = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'x'.repeat(100), settings: { seats: 3 } });
  assert.equal(long.seats[0].name.length, game.MAX_NAME_LENGTH);
  game.addHuman(long, 2, 'x'.repeat(100));
  assert.equal(long.seats[1].name.length, game.MAX_NAME_LENGTH, 'the suffix fits inside the limit');
  assert.notEqual(long.seats[0].name, long.seats[1].name);
  for (const bad of [undefined, null, '', '   ', 42, {}]) {
    const r = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: bad });
    assert.ok(r.seats[0].name.length > 0);
  }
});

test('settings: the seat count cannot drop below the people seated, and bad values change nothing', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats: 4 } });
  game.addHuman(room, 2, 'bob');
  game.addHuman(room, 3, 'cat');
  const before = JSON.stringify(room);
  assert.equal(game.setSettings(room, 1, { seats: 2 }).ok, false);
  assert.equal(game.setSettings(room, 1, { seats: 3.5 }).ok, false);
  assert.equal(game.setSettings(room, 1, { target: 100 }).ok, false);
  assert.equal(game.setSettings(room, 1, { seats: 3, target: 99 }).ok, false);
  assert.equal(game.setSettings(room, 2, { seats: 3 }).ok, false);
  assert.equal(JSON.stringify(room), before);
  assert.equal(game.setSettings(room, 1, { seats: 3, target: 61 }).ok, true);
  assert.equal(room.seats.length, 3);
  assert.equal(game.setSettings(room, 1, {}).ok, true, 'nothing to change is fine');
  assert.throws(() => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'a', settings: { seats: 99 } }), /2 to 5/, 'too many seats are refused');
  assert.throws(() => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'a', settings: { seats: -3 } }), /2 to 5/);
  assert.throws(() => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'a', settings: { target: 77 } }), /61 or 121/);
});

test('after the game: leaving marks the seat as gone, the lobby drops people who left, and kicking works', () => {
  const room = room2();
  game.addHuman(room, 2, 'bob');
  game.start(room, 1);
  room.phase = 'finished';
  room.winner = 0;
  assert.equal(game.removeHuman(room, 2).ok, true);
  assert.equal(room.seats[1].kind, 'gone');
  assert.equal(game.hasPlayer(room, 2), false);
  assert.equal(game.kick(room, 1, 1).ok, false, 'a seat that has left cannot be removed again');
  assert.equal(game.playAgain(room, 2).ok, false, 'only the host');
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.seats[1], null, 'the person who left has left an empty seat in the lobby');
  assert.equal(room.phase, 'lobby');
  assert.equal(room.seats[0].score, 0);
  assert.equal(game.addHuman(room, 2, 'bob').ok, true, 'and may come back');
});

test('kicking: not yourself, not a computer player, a game in progress is fine: a computer player takes over', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats: 3 } });
  game.addHuman(room, 2, 'bob');
  game.addBot(room, 1);
  assert.equal(game.kick(room, 1, 0).ok, false);
  assert.equal(game.kick(room, 1, 2).ok, false);
  assert.equal(game.kick(room, 1, 7).ok, false);
  assert.equal(game.kick(room, 1, -1).ok, false);
  assert.equal(game.kick(room, 2, 0).ok, false);
  game.start(room, 1);
  const result = game.kick(room, 1, 1);
  assert.equal(result.ok, true);
  assert.equal(room.seats[1].kind, 'bot');
  assert.equal(room.seats[1].replaced, true);
});

test('leaving a game in progress while everybody else waits moves the game on', () => {
  const room = room2();
  game.addHuman(room, 2, 'bob');
  game.start(room, 1);
  const seat = game.seatOf(room, 2);
  game.discard(room, game.seatOf(room, 1), room.hands[game.seatOf(room, 1)].slice(0, 2));
  assert.equal(room.phase, 'discard');
  assert.equal(game.removeHuman(room, 2).ok, true);
  assert.ok(game.pendingBot(room), 'the computer player that took over has a discard to make');
  assert.equal(room.seats[seat].kind, 'bot');
  while (game.pendingBot(room) && room.phase === 'discard') game.botMove(room);
  assert.equal(room.phase, 'play');
});
