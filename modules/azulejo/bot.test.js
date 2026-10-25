// The computer players: always legal, sensible choices in hand-built positions, and legal in thousands of positions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import * as bot from './bot.js';
import { emptyWall } from './rules.js';
import { playingRoom, seeded, setTable } from './testing.js';

const blank = (room) => {
  room.lines.forEach((ls, seat) => ls.forEach((_, i) => (room.lines[seat][i] = { colour: null, count: 0 })));
  room.walls.forEach((_, seat) => (room.walls[seat] = emptyWall()));
  room.floors.forEach((_, seat) => (room.floors[seat] = []));
};

test('pendingAction: only a computer player whose turn it is, or who has to choose a column', () => {
  const { room } = playingRoom(3, { seed: 1 });
  room.seats[1] = { kind: 'bot', id: 'bot:1', name: 'Bot' };
  room.turn = 0;
  assert.equal(bot.pendingAction(room), null, 'a person is to move');
  room.turn = 1;
  assert.deepEqual(bot.pendingAction(room), { type: 'move', seat: 1 });
  room.phase = 'finished';
  assert.equal(bot.pendingAction(room), null);
  room.phase = 'lobby';
  assert.equal(bot.pendingAction(room), null);
  room.phase = 'tiling';
  room.pending = [null, null, { row: 0, colour: 0, columns: [0, 1] }];
  assert.equal(bot.pendingAction(room), null, 'a person has to choose');
  room.pending[1] = { row: 0, colour: 0, columns: [0, 1] };
  assert.deepEqual(bot.pendingAction(room), { type: 'column', seat: 1 });
});

test('a computer player completes a line rather than start a new one', () => {
  const { room, rng } = playingRoom(2, { seed: 8 });
  room.seats[0] = { kind: 'bot', id: 'bot:1', name: 'Bot' };
  blank(room);
  setTable(room, { factories: [[2, 2, 3, 1], [4, 4, 4, 0]], centre: [], marker: true, turn: 0 });
  room.lines[0][2] = { colour: 2, count: 1 }; // two more Terracotta fill line 3
  room.walls[0] = [[], [null, null, null, null, 4], [null, null, 0, 1, null], [], []].map((r) => (r.length ? r : Array(5).fill(null))); // a tile at (2,4) would score 5
  for (let i = 0; i < 20; i++) assert.deepEqual(bot.chooseMove(room, 0, seeded(i)), { source: 0, colour: 2, line: 2 });
  assert.equal(bot.runPending(room, rng).move.colour, 2);
  assert.deepEqual(room.lines[0][2], { colour: 2, count: 3 });
});

test('a computer player avoids the floor and the marker when a clean take exists', () => {
  const { room } = playingRoom(2, { seed: 8 });
  blank(room);
  setTable(room, { factories: [[0, 1, 2, 3]], centre: [0, 0, 0, 1], marker: true, turn: 0 });
  for (let i = 0; i < 20; i++) {
    const move = bot.chooseMove(room, 0, seeded(i));
    assert.equal(move.source, 0, 'a single tile from a factory beats three from the centre with the marker');
    assert.notEqual(move.line, 'floor');
  }
});

test('a computer player puts everything on the floor when no pattern line is legal', () => {
  const { room } = playingRoom(2, { seed: 8 });
  blank(room);
  setTable(room, { factories: [[1, 1, 1, 1]], centre: [], marker: false, turn: 0 });
  for (let row = 0; row < 5; row++) room.walls[0][row][(1 + row) % 5] = 1; // colour 1 is on every row of the wall
  assert.deepEqual(game.legalMoves(room, 0), [{ source: 0, colour: 1, line: 'floor' }]);
  assert.deepEqual(bot.chooseMove(room, 0), { source: 0, colour: 1, line: 'floor' });
});

test('a computer player takes tiles an opponent needs to finish a line when it costs it nothing', () => {
  const { room } = playingRoom(2, { seed: 8 });
  blank(room);
  setTable(room, { factories: [[0, 3, 3, 3], [1, 3, 3, 3]], centre: [], marker: false, turn: 0 });
  room.lines[1][3] = { colour: 1, count: 3 }; // seat 1 needs one Saffron
  let denied = 0;
  for (let i = 0; i < 40; i++) if (bot.chooseMove(room, 0, seeded(i)).source === 1 && bot.chooseMove(room, 0, seeded(i)).colour === 1) denied++;
  assert.ok(denied > 0, 'it sometimes takes the single Saffron');
});

test('the free wall column: the computer chooses the place that scores most', () => {
  const { room } = playingRoom(2, { seed: 8, free: true });
  blank(room);
  room.walls[0][0] = [null, null, null, 3, 4];
  room.walls[0][1] = [null, null, null, 2, null];
  room.phase = 'tiling';
  room.pending = [{ row: 1, colour: 1, columns: [0, 1, 2, 4] }, null];
  // Column 4 joins (1,3) in the row and (0,4) above: the best score.
  for (let i = 0; i < 30; i++) assert.equal(bot.chooseColumnFor(room, 0, seeded(i)), 4);
  room.pending[0].columns = [0, 1];
  assert.ok([0, 1].includes(bot.chooseColumnFor(room, 0)));
});

test('the computer avoids creating a place on a free wall where nothing can ever go', () => {
  const { room } = playingRoom(2, { seed: 8, free: true });
  blank(room);
  // Row 0 has colours 0-2 in columns 0-2; the last two places (columns 3 and 4) take colours 3 and 4.
  // Column 3 has a 4 below, so putting colour 3 in column 4 would leave (0,3) with nothing that can go there.
  room.walls[0][0] = [0, 1, 2, null, null];
  room.walls[0][3][3] = 4;
  room.phase = 'tiling';
  room.pending = [{ row: 0, colour: 3, columns: [3, 4] }, null];
  for (let i = 0; i < 30; i++) assert.equal(bot.chooseColumnFor(room, 0, seeded(i)), 3);
});

test('a computer player never makes an illegal move: thousands of random positions, all sizes, both wall rules', () => {
  let positions = 0;
  let floors = 0;
  let columns = 0;
  for (let g = 0; g < 120; g++) {
    const n = 2 + (g % 4);
    const { room, rng } = playingRoom(n, { seed: 900 + g, free: g % 2 === 1 });
    let guard = 0;
    while (room.phase !== 'finished' && guard++ < 3000) {
      if (room.phase === 'tiling') {
        const seat = room.pending.findIndex(Boolean);
        const col = bot.chooseColumnFor(room, seat, rng);
        assert.ok(room.pending[seat].columns.includes(col));
        columns++;
        const pick = rng() < 0.5 ? col : room.pending[seat].columns[Math.floor(rng() * room.pending[seat].columns.length)];
        assert.equal(game.chooseColumn(room, seat, { col: pick }, rng).ok, true);
        continue;
      }
      const seat = room.turn;
      const move = bot.chooseMove(room, seat, rng);
      assert.ok(move, 'there is always a move');
      positions++;
      if (move.line === 'floor') floors++;
      const legal = game.legalMoves(room, seat);
      assert.ok(legal.some((m) => m.source === move.source && m.colour === move.colour && m.line === move.line), 'the move is on the legal list');
      // Play the computer's move most of the time, and a random legal one otherwise, to reach different positions.
      const play = rng() < 0.7 ? move : legal[Math.floor(rng() * legal.length)];
      assert.equal(game.takeTiles(room, seat, play, rng).ok, true);
    }
    assert.equal(room.phase, 'finished');
  }
  assert.ok(positions > 3000, `${positions} positions`);
  assert.ok(floors < positions / 3, 'the floor is the exception');
  console.log(`  ${positions} positions checked, ${floors} floor-only moves, ${columns} column choices`);
});

test('runPending plays a column for a computer and nothing for a person', () => {
  const { room, rng } = playingRoom(2, { seed: 8, free: true });
  assert.equal(bot.runPending(room, rng), null, 'seat 0 is a person and it may be anybody’s turn');
  room.seats[1] = { kind: 'bot', id: 'bot:1', name: 'Bot' };
  blank(room);
  room.phase = 'tiling';
  room.turn = null;
  room.tiling = [0, 1].map(() => ({ cursor: 0, placed: [], gained: 0, newRows: 0, dropped: [] }));
  room.lines[1][0] = { colour: 2, count: 1 };
  room.pending = [null, { row: 0, colour: 2, columns: [0, 1, 2, 3, 4] }];
  const action = bot.runPending(room, rng);
  assert.equal(action.type, 'column');
  assert.ok(!room.pending[1]);
  assert.equal(room.walls[1][0].filter((c) => c === 2).length, 1);
});
