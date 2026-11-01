// Helpers shared by the Gaudi tests (not used by the game itself).
// Depends on game.js (the rules, driven directly), bot.js (botStep), ai/standard.js (window choice) and rules.js (constants).
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';
import { botStep } from './bot.js';
import { chooseWindow as standardChooseWindow } from './ai/standard.js';
import { CELLS, COLOURS, ORTHOGONAL, bagSize, patternOf, poolSize } from './rules.js';

// The seeded random number generator the tests use is the shared one; it is re-exported so the Gaudi tests import it from here.
export { seeded };

/**
 * A die for a hand-built position.
 *
 * @param {string} c   a colour
 * @param {number} v   its face, 1-6
 * @param {number} [id]  its id (a random one if not given, so that it never clashes with a real die)
 * @returns {{ id: number, c: string, v: number }} the die
 *
 * Side effects: none (uses Math.random only for a default id).
 */
export const die = (c, v, id = 1000 + Math.floor(Math.random() * 1e6)) => ({ id, c, v });

/**
 * A started game of n people (ids 1..n, host 1) with every window chosen: the first of each player's four.
 *
 * @param {number} n  the number of seats
 * @param {{ seed?: number, pick?: (string | null)[] | null }} [options]  seed for the rng; pick optionally names a pattern per seat
 *   (used only when it was among that seat's four options)
 * @returns {{ room: object, rng: () => number }} the room, now in the playing phase, and the rng used
 *
 * Side effects: builds a new in-memory room; asserts that each step succeeds.
 */
export function playingRoom(n, { seed = 1, pick = null } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ now: 0, code: 'one-two-three', hostId: 1, hostName: 'p1', size: n });
  for (let i = 2; i <= n; i++) assert.equal(game.addHuman(room, i, `p${i}`).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  for (let seat = 0; seat < n; seat++) {
    const pid = pick?.[seat] && room.options[seat].includes(pick[seat]) ? pick[seat] : room.options[seat][0];
    assert.equal(game.chooseWindow(room, seat, pid, rng).ok, true);
  }
  assert.equal(room.phase, 'playing');
  return { room, rng };
}

/**
 * Puts a window's patterns in place (even ones not dealt), for hand-built positions.
 *
 * @param {object} room  the room to change
 * @param {number} seat  the seat to change
 * @param {string} pid   the pattern id to give it
 * @returns {void}
 *
 * Side effects: sets room.patterns[seat], that seat's tokens (its difficulty) and room.tokenTotal, so the token invariant still holds.
 */
export function setWindow(room, seat, pid) {
  room.patterns[seat] = pid;
  room.tokens[seat] = patternOf(pid).difficulty;
  room.tokenTotal = room.tokens.reduce((a, b) => a + b, 0) + room.spent.reduce((a, b) => a + b, 0);
}

/**
 * Every die in the game, wherever it is: bag, pool, round track and windows.
 *
 * @param {object} room  the room to look through
 * @returns {object[]} every die, once each
 *
 * Side effects: none.
 */
export function allDice(room) {
  return [...room.bag, ...room.pool, ...room.track.flat(), ...room.grids.flat().filter(Boolean)];
}

/**
 * Everything that must hold after every single action: dice and tokens conserved, no like dice side by side, the turn
 * matching the order, and so on.
 *
 * @param {object} room  the room to check
 * @param {string} [label]  text to put in failure messages, to say which action was just taken
 * @returns {void}
 *
 * Side effects: none apart from assertions, which throw on a violation.
 */
export function assertInvariants(room, label = '') {
  const where = `${label} (round ${room.round}, ${room.phase})`;
  if (!['playing', 'finished'].includes(room.phase)) return;
  const n = room.size;
  const dice = allDice(room);
  assert.equal(dice.length, bagSize(n), `${where}: bag + pool + track + windows = ${bagSize(n)} dice`);
  assert.equal(new Set(dice.map((d) => d.id)).size, dice.length, `${where}: every die is in exactly one place`);
  for (const c of COLOURS) assert.equal(dice.filter((d) => d.c === c).length, bagSize(n) / 5, `${where}: dice per colour`);
  assert.ok(room.pool.length <= poolSize(n), `${where}: pool size`);
  assert.equal(room.tokens.reduce((a, b) => a + b, 0) + room.spent.reduce((a, b) => a + b, 0), room.tokenTotal, `${where}: favour tokens are conserved`);
  assert.ok(room.tokens.every((t) => t >= 0), `${where}: no negative tokens`);
  room.grids.forEach((grid, seat) => {
    assert.equal(grid.length, CELLS);
    grid.forEach((d, i) => {
      if (!d) return;
      assert.ok(d.v >= 1 && d.v <= 6 && COLOURS.includes(d.c), `${where}: a real die`);
      for (const k of ORTHOGONAL[i]) {
        assert.ok(!grid[k] || (grid[k].c !== d.c && grid[k].v !== d.v), `${where}: seat ${seat} has like dice side by side at ${i}/${k}`);
      }
    });
  });
  if (room.phase === 'playing') {
    assert.equal(room.track.length, room.round - 1, `${where}: one track entry per finished round`);
    assert.equal(room.pool.length + room.bag.length + room.track.flat().length + room.grids.flat().filter(Boolean).length, bagSize(n));
    assert.ok(room.turn && room.turn.seat === room.order[room.turnIndex], `${where}: the turn matches the order`);
  } else {
    assert.equal(room.bag.length, 0, `${where}: the bag is used up exactly`);
    assert.equal(room.pool.length, 0);
    assert.equal(room.track.length, game.ROUNDS);
  }
}

/**
 * One computer-style decision for whoever has to act, whatever kind of seat it is. Returns false when the game is over.
 *
 * @param {object} room  the room being played
 * @param {() => number} rng  random source returning [0, 1)
 * @returns {{ type: string } | false} the step taken (a window choice is { type: 'window' }), or false when nothing is left to do
 *
 * Side effects: mutates room through the game functions; asserts that the move was legal.
 */
export function driveStep(room, rng) {
  if (room.phase === 'windows') {
    const seat = room.picked.findIndex((p) => !p);
    const result = game.chooseWindow(room, seat, standardChooseWindow(room.options[seat], rng), rng);
    assert.equal(result.ok, true, result.error);
    return { type: 'window' };
  }
  if (room.phase !== 'playing') return false;
  const seat = room.turn.seat;
  const step = botStep(room, seat, rng);
  const result =
    step.type === 'place'
      ? game.placeDie(room, seat, step, rng)
      : step.type === 'tool'
        ? game.useTool(room, seat, { tool: step.tool, params: step.params }, rng)
        : game.endTurn(room, seat, rng);
  assert.equal(result.ok, true, `a computer move must be legal: ${JSON.stringify(step)} -> ${result.error}`);
  return step;
}

/**
 * Looks for secrets in a view: a bag die, another seat's private colour or window options, or results shown too early.
 *
 * @param {object} room  the room the view was made from
 * @param {object} view  the view sent to one client
 * @returns {string[]} a description of each leak found (empty when the view is clean)
 *
 * Side effects: none.
 */
export function viewLeaks(room, view) {
  const text = JSON.stringify(view);
  const problems = [];
  const visible = new Set([...room.pool, ...room.track.flat(), ...room.grids.flat().filter(Boolean)].map((d) => d.id));
  const shown = new Set([...JSON.stringify(view.pool ?? []).matchAll(/"id":(\d+)/g)].map((m) => Number(m[1])));
  for (const id of shown) if (!visible.has(id)) problems.push(`die ${id} is not visible to anyone`);
  for (const d of room.bag) if (new RegExp(`"id":${d.id},"c"`).test(text)) problems.push(`bag die ${d.id} appears`);
  if (view.you === -1 || view.you === undefined) {
    if (view.privateObjective) problems.push('a private objective went to a spectator');
  }
  if (room.phase !== 'finished') {
    if (view.final) problems.push('final results before the end');
    room.seats.forEach((seat, i) => {
      if (i === view.you || !seat) return;
      if (room.privateColours[i] && view.privateObjective && view.privateObjective.colour === room.privateColours[i] && room.privateColours[view.you] !== room.privateColours[i]) problems.push('another private colour');
    });
    if (/privateColour|privatePoints/.test(text)) problems.push('private scoring keys before the end');
  }
  if (room.phase === 'windows') {
    room.options.forEach((options, seat) => {
      if (seat === view.you) return;
      for (const pid of options) if (text.includes(`"${pid}"`)) problems.push(`window option ${pid} of seat ${seat} appears`);
    });
  }
  return problems;
}
