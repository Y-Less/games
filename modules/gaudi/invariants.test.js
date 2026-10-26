// Computer players and invariants: thousands of random positions, hundreds of whole computer-only games.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import * as bot from './bot.js';
import { CELLS, patternOf, restrictionOf } from './rules.js';
import { assertInvariants, driveStep, playingRoom, seeded, viewLeaks } from './testing.js';

const SIZES = [2, 3, 4, 5];

test('computer-only games always terminate, with every invariant true after EVERY action', () => {
  const tally = { games: 0, actions: 0, tools: 0, placements: 0, perfect: 0, filled: 0, cells: 0 };
  const toolsSeen = new Set();
  for (const n of SIZES) {
    for (let g = 0; g < 70; g++) {
      const rng = seeded(n * 100000 + g);
      const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: n, settings: { badPrivate: g % 5 === 0 } });
      for (let i = 2; i <= n; i++) game.addHuman(room, i, `P${i}`);
      assert.equal(game.start(room, 1, rng).ok, true);
      let steps = 0;
      let step;
      while ((step = driveStep(room, rng))) {
        steps++;
        tally.actions++;
        if (step.type === 'tool') {
          tally.tools++;
          toolsSeen.add(step.tool);
        }
        if (step.type === 'place') tally.placements++;
        assertInvariants(room, `n=${n} game ${g} step ${steps}`);
        if (steps % 23 === 0) for (let seat = 0; seat < n; seat++) assert.deepEqual(viewLeaks(room, game.viewFor(room, seat + 1)), [], `n=${n} game ${g} step ${steps} seat ${seat}`);
        assert.ok(steps < 2000, 'the game must end');
      }
      assert.equal(room.phase, 'finished');
      assertInvariants(room, `n=${n} game ${g} end`);
      assert.equal(room.final.players.length, n);
      assert.ok(room.winners.length >= 1);
      tally.games++;
      for (const grid of room.grids) {
        if (grid.every(Boolean)) tally.perfect++;
        tally.filled += grid.filter(Boolean).length;
        tally.cells += CELLS;
      }
      // The final table agrees with the live provisional score plus the private objective.
      for (let seat = 0; seat < n; seat++) assert.equal(room.final.players[seat].total, game.provisionalOf(room, seat) + game.privateOf(room, seat));
    }
  }
  assert.equal(tally.games, 280);
  assert.ok(tally.tools > 0, 'the computers do use tools sometimes');
  assert.ok(tally.tools < tally.placements / 3, 'but sparingly');
  assert.ok(tally.filled / tally.cells > 0.5, `the computers fill their windows reasonably (${tally.filled}/${tally.cells})`);
  console.log(`  ${tally.games} games, ${tally.actions} actions, ${tally.placements} dice placed, ${tally.tools} tool uses (${[...toolsSeen].sort().join(', ')}), ${tally.perfect} perfect windows, ${Math.round((100 * tally.filled) / tally.cells)}% of spaces filled`);
});

test('computer players choose a legal move in thousands of random positions', () => {
  let positions = 0;
  let tools = 0;
  for (let g = 0; g < 150; g++) {
    const n = 2 + (g % 4);
    const rng = seeded(7000 + g);
    const { room } = playingRoom(n, { seed: 7000 + g });
    for (let step = 0; step < 200 && room.phase === 'playing'; step++) {
      const seat = room.turn.seat;
      if (rng() < 0.2) {
        room.tokenTotal += 3;
        room.tokens[seat] += 3; // spare tokens make the tool branch reachable
      }
      const choice = bot.botStep(structuredClone(room), seat, seeded(step));
      const copy = structuredClone(room);
      const result =
        choice.type === 'place'
          ? game.placeDie(copy, seat, choice)
          : choice.type === 'tool'
            ? game.useTool(copy, seat, { tool: choice.tool, params: choice.params })
            : game.endTurn(copy, seat);
      assert.equal(result.ok, true, `${JSON.stringify(choice)}: ${result.error}`);
      if (choice.type === 'tool') tools++;
      if (choice.type === 'end') assert.ok(room.turn.placements >= 1 || bot.bestPlacement(room, seat, rng) === null, 'ends the turn only when it has nothing to place');
      positions++;
      // Random progress, not the computer's: random legal placements, random tools, random ends of turn.
      const roll = rng();
      if (roll < 0.55 && room.pool.length) {
        const d = room.pool[Math.floor(rng() * room.pool.length)];
        const cells = [...Array(CELLS).keys()].filter((c) => game.placeDie(structuredClone(room), seat, { die: d.id, cell: c }).ok);
        if (cells.length) game.placeDie(room, seat, { die: d.id, cell: cells[Math.floor(rng() * cells.length)] }, rng);
        else game.endTurn(room, seat, rng);
      } else if (roll < 0.7) {
        const tool = room.tools[Math.floor(rng() * 3)];
        const d = room.pool[Math.floor(rng() * room.pool.length)];
        game.useTool(room, seat, { tool, params: { die: d?.id, delta: 1 } }, rng);
      } else game.endTurn(room, seat, rng);
      assertInvariants(room, `random position ${positions}`);
    }
  }
  assert.ok(positions >= 3000, `${positions} positions`);
  assert.ok(tools > 0, 'the tool branch was exercised');
});

test('a computer with nothing to place ends its turn, and nothing is pending for people', () => {
  const { room, rng } = playingRoom(2, { seed: 3 });
  room.pool = [];
  assert.deepEqual(bot.botStep(room, 0, rng), { type: 'end' });
  assert.equal(bot.pendingAction(room), null, 'seat 0 is a person here');
  assert.equal(bot.runPending(room, rng), null);
  room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Robot' };
  assert.deepEqual(bot.pendingAction(room), { type: 'turn', seat: 0 });
  assert.equal(bot.runPending(room, rng).step.type, 'end');
  assert.equal(room.turn.seat, 1);
});

test('pending actions: bots choose windows when the phase is windows, and only then', () => {
  const rng = seeded(1);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 3 });
  game.fillWithBots(room, 1);
  game.start(room, 1, rng);
  assert.deepEqual(bot.pendingAction(room), { type: 'window', seat: 1 });
  game.chooseWindow(room, 0, room.options[0][0], rng);
  bot.runPending(room, rng);
  bot.runPending(room, rng);
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 1);
});

test('computer window choice always picks one of the options and likes harder windows', () => {
  const rng = seeded(1);
  let total = 0;
  let count = 0;
  for (let i = 0; i < 300; i++) {
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 2 });
    game.fillWithBots(room, 1);
    game.start(room, 1, rng);
    for (const options of room.options) {
      const pid = bot.botWindow(options, rng);
      assert.ok(options.includes(pid));
      total += patternOf(pid).difficulty;
      count++;
      const mean = options.reduce((s, p) => s + patternOf(p).difficulty, 0) / options.length;
      assert.ok(patternOf(pid).difficulty >= mean - 1.5, 'never a clearly easier window');
    }
  }
  assert.ok(total / count > 4.8, `the average chosen difficulty is high (${total / count})`);
});

test('computers prefer to fill restricted spaces with dice that fit them', () => {
  let restricted = 0;
  let placed = 0;
  let restrictedSpaces = 0;
  let spaces = 0;
  for (let g = 0; g < 80; g++) {
    const rng = seeded(40 + g);
    const { room } = playingRoom(3, { seed: 40 + g });
    for (let seat = 0; seat < 3; seat++) {
      const pattern = patternOf(room.patterns[seat]);
      restrictedSpaces += pattern.cells.filter((c) => c !== '.').length;
      spaces += 20;
    }
    let step;
    while ((step = driveStep(room, rng))) if (room.round > 4) break;
    for (let seat = 0; seat < 3; seat++) {
      const pattern = patternOf(room.patterns[seat]);
      room.grids[seat].forEach((d, i) => {
        if (!d) return;
        placed++;
        if (restrictionOf(pattern.cells[i])) restricted++;
      });
    }
  }
  assert.ok(placed > 200);
  assert.ok(restricted / placed > restrictedSpaces / spaces, `restricted spaces are over-represented among placed dice (${restricted}/${placed} vs ${restrictedSpaces}/${spaces})`);
});
