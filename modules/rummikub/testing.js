// Helpers shared by the Rummikub tests (not used by the game itself).
import assert from 'node:assert/strict';
import * as game from './game.js';
import { chooseTurn } from './bot.js';
import { AIS } from './ai/index.js';
import { numberedCount, totalTiles } from './rules.js';
import { seeded } from '../../shared/testkit.js';

export { seeded };

// Tile ids by meaning: tile(s, colour, number, copy) takes the settings, a 0-based colour, a 1-based number and the copy (0 or
// 1); joker(s, i) the i-th joker. Both return an id; no side effects.
export const tile = (s, colour, number, copy = 0) => copy * s.colours * s.numbers + colour * s.numbers + number - 1;
// See tile() above: the id of the i-th joker.
export const joker = (s, i = 0) => numberedCount(s) + i;
// The standard settings used by most tests: a classic 13-number, 4-colour, 2-joker set, one round, 30-point meld, no timer.
export const STD = { numbers: 13, colours: 4, wildcards: 2, rounds: 1, meld: 30, timer: 0 };

/**
 * A started game of n people (ids 1..n, host 1) with the given settings, or with computer players in the other seats.
 *
 * @param {number} n  the number of seats
 * @param {object} [options]
 * @param {number} [options.seed]  seed for the deal
 * @param {object} [options.settings]  rule settings passed to createRoom
 * @param {boolean} [options.bots]  true to fill every other seat with computer players instead of people
 * @returns {{ room: object, rng: () => number }} the started room and the seeded generator used
 * Side effects: none outside the new room (asserts that starting worked).
 */
export function playingRoom(n, { seed = 1, settings = {}, bots = false } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ now: 0, code: 'one-two-three', hostId: 1, hostName: 'p1', size: n, settings });
  if (bots) game.fillWithBots(room, 1);
  else for (let i = 2; i <= n; i++) assert.equal(game.addHuman(room, i, `p${i}`).ok, true);
  const result = game.start(room, 1, rng, Date.now());
  assert.equal(result.ok, true, result.error);
  return { room, rng };
}

/**
 * The best play of the classic AI (or of options.ai, an AI object), without going through a seat's own AI choice.
 *
 * @param {object} room  not changed
 * @param {number} seat  whose rack to play from
 * @param {object} [options]  passed to the AI's plan (budget, rng...); options.ai picks a different AI
 * @returns {{ table: number[][], added: number } | null} the play, or null when there is none
 * Side effects: none.
 */
export function bestPlay(room, seat, options = {}) {
  const ai = options.ai ?? AIS[0];
  return ai.plan(room, seat, options);
}

/**
 * Everything that must hold after every single action: every tile is somewhere exactly once, scores are integers that
 * sum to zero (up to rounding) and match the history, and a round in progress has a valid turn and no empty rack.
 *
 * @param {object} room  not changed
 * @param {string} [label]  text added to failure messages
 * @returns {void}
 * Side effects: none (throws an assertion error when something is wrong).
 */
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

/**
 * One decision for whoever is to move, whatever kind of seat it is (the seat's own AI chooses, even for a person's seat).
 *
 * @param {object} room  mutated by the play or draw
 * @param {number} now  the clock, in milliseconds
 * @param {() => number} [rng]  random numbers for the AI (seeded by default, so a test is repeatable)
 * @returns {{ seat: number, type: 'play' | 'draw' } | false} the action taken, or false when no round is in progress
 * Side effects: plays or draws for the seat whose turn it is; asserts the move was legal.
 */
export function driveStep(room, now, rng = seeded(1)) {
  if (room.phase !== 'playing') return false;
  const seat = room.turn;
  const choice = chooseTurn(room, seat, { rng });
  const result = choice.type === 'play' ? game.play(room, seat, { table: choice.table }, now) : game.draw(room, seat, now);
  assert.equal(result.ok, true, `a computer move must be legal: ${choice.type} -> ${result.error}`);
  return { seat, type: choice.type };
}
