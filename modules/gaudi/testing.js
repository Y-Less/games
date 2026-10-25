// Helpers shared by the Gaudi tests (not used by the game itself).
import assert from 'node:assert/strict';
import * as game from './game.js';
import { botStep, botWindow } from './bot.js';
import { CELLS, COLOURS, ORTHOGONAL, bagSize, patternOf, poolSize } from './rules.js';

/** A small seeded random number generator (mulberry32), so a failing run can be repeated. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const die = (c, v, id = 1000 + Math.floor(Math.random() * 1e6)) => ({ id, c, v });

/** A started game of n people (ids 1..n, host 1) with every window chosen: the first of each player's four. */
export function playingRoom(n, { seed = 1, pick = null } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: n });
  for (let i = 2; i <= n; i++) assert.equal(game.addHuman(room, i, `p${i}`).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  for (let seat = 0; seat < n; seat++) {
    const pid = pick?.[seat] && room.options[seat].includes(pick[seat]) ? pick[seat] : room.options[seat][0];
    assert.equal(game.chooseWindow(room, seat, pid, rng).ok, true);
  }
  assert.equal(room.phase, 'playing');
  return { room, rng };
}

/** Puts a window's patterns in place (even ones not dealt), for hand-built positions. */
export function setWindow(room, seat, pid) {
  room.patterns[seat] = pid;
  room.tokens[seat] = patternOf(pid).difficulty;
  room.tokenTotal = room.tokens.reduce((a, b) => a + b, 0) + room.spent.reduce((a, b) => a + b, 0);
}

export function allDice(room) {
  return [...room.bag, ...room.pool, ...room.track.flat(), ...room.grids.flat().filter(Boolean)];
}

/** Everything that must hold after every single action. */
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

/** One computer-style decision for whoever has to act, whatever kind of seat it is. Returns false when the game is over. */
export function driveStep(room, rng) {
  if (room.phase === 'windows') {
    const seat = room.picked.findIndex((p) => !p);
    const result = game.chooseWindow(room, seat, botWindow(room.options[seat], rng), rng);
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

/** Every die id, colour and face in a view that could be a bag die: they must not appear. */
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
