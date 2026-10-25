// Helpers shared by the Azulejo tests (not used by the game itself).
import assert from 'node:assert/strict';
import * as game from './game.js';
import { chooseColumnFor, chooseMove } from './bot.js';
import { COLOURS, FLOOR_SLOTS, MARKER, PER_COLOUR, SIZE, TILES, lineCapacity, rowHas, colHas, wallColour } from './rules.js';
import { seeded } from '../../shared/testkit.js';

export { seeded };

/** A started game of n people (ids 1..n, host 1). */
export function playingRoom(n, { seed = 1, free = false } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: n, settings: { freeWall: free } });
  for (let i = 2; i <= n; i++) assert.equal(game.addHuman(room, i, `p${i}`).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  return { room, rng };
}

/**
 * Hand-built positions: puts a table in place (nothing is checked for conservation). Anything left out is emptied.
 * `walls[seat]` is five strings of five characters: '.' empty, 'X' the tile that belongs there in the fixed wall, or a
 * digit 0-4 for an explicit colour (free walls).
 */
export function setWall(room, seat, rows) {
  room.walls[seat] = rows.map((text, r) => [...text].map((ch, c) => (ch === '.' ? null : ch === 'X' ? wallColour(r, c) : Number(ch))));
}

export function setTable(room, { factories = [], centre = [], marker = true, turn = 0, bag = null, lid = null } = {}) {
  room.factories = Array.from({ length: game.factoryCount(room.size) }, (_, i) => factories[i] ?? []);
  room.centre = centre;
  room.markerInCentre = marker;
  room.turn = turn;
  room.phase = 'playing';
  if (bag) room.bag = bag;
  if (lid) room.lid = lid;
}

/** Everything that must hold after every single action. */
export function assertInvariants(room, label = '') {
  const where = `${label} (round ${room.round}, ${room.phase})`;
  if (!['playing', 'tiling', 'finished'].includes(room.phase)) return;
  const n = room.size;
  const everything = [
    ...room.bag,
    ...room.lid,
    ...room.factories.flat(),
    ...room.centre,
    ...room.lines.flatMap((ls) => ls.flatMap((l) => Array(l.count).fill(l.colour))),
    ...room.walls.flat(2).filter((c) => c !== null),
    ...room.floors.flat().filter((c) => c !== MARKER),
  ];
  assert.equal(everything.length, TILES, `${where}: bag + lid + factories + centre + lines + walls + floors = ${TILES}`);
  assert.equal(game.tileCount(room), TILES, where);
  for (const c of COLOURS) assert.equal(everything.filter((x) => x === c).length, PER_COLOUR, `${where}: ${PER_COLOUR} tiles of colour ${c}`);
  assert.equal(room.factories.length, game.factoryCount(n), `${where}: factory count`);
  assert.ok(room.factories.every((f) => f.length <= 4), `${where}: at most four tiles on a factory`);
  room.lines.forEach((lines, seat) => {
    lines.forEach((l, i) => {
      assert.ok(l.count >= 0 && l.count <= lineCapacity(i), `${where}: line ${i} count`);
      assert.equal(l.colour === null, l.count === 0, `${where}: a line has a colour exactly when it holds tiles`);
      if (l.count) assert.ok(!rowHas(room.walls[seat], i, l.colour), `${where}: seat ${seat} line ${i} holds a colour its wall row already has`);
    });
    assert.ok(room.floors[seat].length <= FLOOR_SLOTS, `${where}: floor size`);
    const wall = room.walls[seat];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = wall[r][c];
        if (cell === null) continue;
        if (!room.settings.freeWall) assert.equal(cell, wallColour(r, c), `${where}: the fixed wall`);
        else {
          assert.equal(wall[r].filter((x) => x === cell).length, 1, `${where}: free wall repeats a colour in a row`);
          assert.equal(wall.filter((row) => row[c] === cell).length, 1, `${where}: free wall repeats a colour in a column`);
        }
      }
    }
  });
  const markers = room.floors.flat().filter((c) => c === MARKER).length;
  assert.ok(markers <= 1, `${where}: at most one marker on the floors`);
  if (markers) assert.equal(room.markerInCentre, false, `${where}: the marker is in one place`);
  assert.ok(room.scores.every((s) => Number.isInteger(s) && s >= 0), `${where}: scores are never negative`);
  for (let seat = 0; seat < n; seat++) {
    const sum = room.history.reduce((total, h) => total + h.deltas[seat], 0);
    assert.equal(sum, room.scores[seat], `${where}: seat ${seat} score = the sum of the history`);
  }
  assert.equal(room.history.filter((h) => h.label !== 'Bonuses').length, room.playedRounds, `${where}: one history entry per round`);
  if (room.phase === 'finished') {
    assert.equal(room.history.at(-1).label, 'Bonuses');
    assert.ok(room.walls.some((w) => w.some((row) => row.every((c) => c !== null))) || room.factories.every((f) => !f.length), `${where}: ended with a complete row`);
  } else assert.ok(room.history.every((h) => h.label !== 'Bonuses'));
  if (room.phase === 'playing') assert.ok(room.turn >= 0 && room.turn < n, `${where}: a turn`);
  if (room.phase === 'tiling') assert.ok(room.pending.some(Boolean), `${where}: tiling only waits for a choice`);
}

/** One computer-style decision for whoever has to act, whatever kind of seat it is. Returns false when the game is over. */
export function driveStep(room, rng) {
  if (room.phase === 'tiling') {
    const seat = room.pending.findIndex(Boolean);
    const col = chooseColumnFor(room, seat, rng);
    const result = game.chooseColumn(room, seat, { col }, rng);
    assert.equal(result.ok, true, result.error);
    return { type: 'column', seat, col };
  }
  if (room.phase !== 'playing') return false;
  const seat = room.turn;
  const move = chooseMove(room, seat, rng);
  const result = game.takeTiles(room, seat, move, rng);
  assert.equal(result.ok, true, `a computer move must be legal: ${JSON.stringify(move)} -> ${result.error}`);
  return { type: 'move', seat, ...move };
}

/** Anything in a view that would reveal the bag: its key, its contents or its order. */
export function viewLeaks(room, view) {
  const text = JSON.stringify(view);
  const problems = [];
  if (/"bag":/.test(text)) problems.push('a bag key');
  if (/"(?:draw|deck|hidden)/i.test(text)) problems.push('a suspicious key');
  if (room.bag.length >= 5 && text.includes(JSON.stringify(room.bag.slice(-5)))) problems.push('the top of the bag');
  if (room.bag.length >= 8 && text.includes(JSON.stringify(room.bag))) problems.push('the bag');
  if (view.bagCount !== undefined && view.bagCount !== room.bag.length) problems.push('a wrong bag count');
  if (view.lid && JSON.stringify(view.lid) !== JSON.stringify(COLOURS.map((c) => room.lid.filter((x) => x === c).length))) problems.push('lid counts differ');
  if (view.lid && view.lid.length !== COLOURS.length) problems.push('the lid is not a list of counts');
  return problems;
}

export { colHas };
