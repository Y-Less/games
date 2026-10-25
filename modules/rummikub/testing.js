// Helpers shared by the Rummikub tests (not used by the game itself).
import assert from 'node:assert/strict';
import * as game from './game.js';
import { chooseTurn } from './bot.js';
import { numberedCount, totalTiles } from './rules.js';
import { seeded } from '../../shared/testkit.js';

export { seeded };

/** The id of a numbered tile (colour 0-based, number 1-based, copy 0 or 1) and of the i-th joker. */
export const tile = (s, colour, number, copy = 0) => copy * s.colours * s.numbers + colour * s.numbers + number - 1;
export const joker = (s, i = 0) => numberedCount(s) + i;
export const STD = { numbers: 13, colours: 4, wildcards: 2, rounds: 1, meld: 30, timer: 0 };

/** A started game of n people (ids 1..n, host 1) with the given settings, or with computer players in the other seats. */
export function playingRoom(n, { seed = 1, settings = {}, bots = false } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: n, settings });
  if (bots) game.fillWithBots(room, 1);
  else for (let i = 2; i <= n; i++) assert.equal(game.addHuman(room, i, `p${i}`).ok, true);
  const result = game.start(room, 1, rng);
  assert.equal(result.ok, true, result.error);
  return { room, rng };
}

/** Everything that must hold after every single action. */
export function assertInvariants(room, label = '') {
  const where = `${label} (round ${room.round}, ${room.phase})`;
  if (!['playing', 'between', 'finished'].includes(room.phase)) return;
  const s = room.settings;
  const all = game.allTiles(room);
  assert.equal(all.length, totalTiles(s), `${where}: every tile is somewhere`);
  assert.equal(new Set(all).size, all.length, `${where}: no tile twice`);
  assert.ok(all.every((id) => Number.isInteger(id) && id >= 0 && id < totalTiles(s)), `${where}: ids in range`);
  assert.ok(room.scores.every(Number.isInteger), `${where}: integer scores`);
  const sum = room.scores.reduce((a, b) => a + b, 0);
  assert.ok(sum <= 0 && sum > -room.size * room.round, `${where}: scores are zero-sum up to rounding (${sum})`);
  for (let seat = 0; seat < room.size; seat++) {
    const total = room.history.reduce((t, h) => t + h.deltas[seat], 0);
    assert.equal(total, room.scores[seat], `${where}: seat ${seat} score = history`);
  }
  if (room.phase === 'playing') {
    assert.ok(room.turn >= 0 && room.turn < room.size, `${where}: a turn`);
    assert.ok(room.racks.every((r) => r.length > 0), `${where}: nobody has an empty rack mid-round`);
  }
}

/** One decision for whoever is to move, whatever kind of seat it is. Returns the action taken, or false when none. */
export function driveStep(room, now = Date.now()) {
  if (room.phase !== 'playing') return false;
  const seat = room.turn;
  const choice = chooseTurn(room, seat);
  const result = choice.type === 'play' ? game.play(room, seat, { table: choice.table }, now) : game.draw(room, seat, now);
  assert.equal(result.ok, true, `a computer move must be legal: ${choice.type} -> ${result.error}`);
  return { seat, type: choice.type };
}
