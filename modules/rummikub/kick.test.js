// The host removing someone mid-game: a computer player takes the seat and the game goes on; it is host-only, never
// for oneself, never for a computer player, and nonsense seats change nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { assertInvariants, playingRoom } from './testing.js';

test('the host removes a person mid-game: a computer player takes the seat, the rest of the game is untouched', () => {
  const { room } = playingRoom(3, { seed: 4 });
  const at = room.seats.findIndex((s) => s.id === 2);
  const others = room.seats.map((s) => s.id);
  const result = game.kick(room, 1, at);
  assert.deepEqual([result.ok, result.userId, result.replaced], [true, 2, true]);
  assert.equal(room.seats[at].kind, 'bot');
  assert.deepEqual(room.seats.map((s) => s.id).filter((_, i) => i !== at), others.filter((_, i) => i !== at));
  assert.equal(room.hostId, 1);
  assertInvariants(room, 'after the removal');
  assert.equal(game.hasPlayer(room, 2), false);
});

test('only the host can remove, never themselves or a computer player, and nonsense changes nothing', () => {
  const { room } = playingRoom(3, { seed: 4 });
  const before = JSON.stringify(room);
  const host = room.seats.findIndex((s) => s.id === 1);
  const other = room.seats.findIndex((s) => s.id === 2);
  assert.equal(game.kick(room, 2, other).ok, false, 'a guest');
  assert.equal(game.kick(room, 2, host).ok, false, 'a guest removing the host');
  assert.equal(game.kick(room, 1, host).ok, false, 'themselves');
  for (const seat of [-1, 3, 99, 1.5, NaN, '1', null, undefined, {}, [], true, 2 ** 40]) assert.equal(game.kick(room, 1, seat).ok, false, String(seat));
  for (const by of [99, null, undefined, '1']) assert.equal(game.kick(room, by, other).ok, false, `by ${String(by)}`);
  assert.equal(JSON.stringify(room), before, 'nothing changed');
  assert.equal(game.kick(room, 1, other).ok, true);
  assert.equal(game.kick(room, 1, other).ok, false, 'it is a computer player now');
  assert.equal(game.removeBot(room, 1, other).ok, false, 'and stays for the game');
});

test('nobody is removed once the game is over', () => {
  const { room } = playingRoom(2, { seed: 4 });
  room.phase = 'finished';
  const before = JSON.stringify(room);
  assert.equal(game.kick(room, 1, room.seats.findIndex((s) => s.id === 2)).ok, false);
  assert.equal(JSON.stringify(room), before);
});
