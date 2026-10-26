// The Azulejo computer players' AIs: the registry, legality at every size, what each one is for, a seeded tournament,
// and how an AI is assigned, saved and shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as game from './game.js';
import * as bot from './bot.js';
import { AIS } from './ai/index.js';
import { playBotGame, tournament } from './ai-support.js';
import { emptyWall } from './rules.js';
import { assertInvariants, playingRoom, seeded, setTable, setWall } from './testing.js';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { aiById } from '../../shared/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ids = AIS.map((a) => a.id);
const byId = (id) => AIS.find((a) => a.id === id);

const blank = (room) => {
  room.lines.forEach((ls, seat) => ls.forEach((_, i) => (room.lines[seat][i] = { colour: null, count: 0 })));
  room.walls.forEach((_, seat) => (room.walls[seat] = emptyWall()));
  room.floors.forEach((_, seat) => (room.floors[seat] = []));
};
/** A hand-built two-player position with the AI's seat (0) to move. */
const position = (build) => {
  const { room } = playingRoom(2, { seed: 8 });
  blank(room);
  build(room);
  return room;
};
const choose = (id, room, seed = 1) => byId(id).chooseMove(bot.snapshot(room), 0, game.legalMoves(room, 0), seeded(seed));
const picks = (id, room, n = 30) => Array.from({ length: n }, (_, i) => choose(id, room, i));

// ---- the registry ----

test('the registry: standard first, a random AI, sharp, and at least three more; everything described', () => {
  assert.equal(AIS[0].id, 'standard', 'rooms saved before AIs existed fall back to the first');
  for (const id of ['standard', 'random', 'sharp']) assert.ok(ids.includes(id), id);
  assert.ok(AIS.length >= 6);
  for (const ai of AIS) {
    assert.ok(ai.name && ai.description.length > 20, ai.id);
    assert.equal(typeof ai.chooseMove, 'function');
    assert.equal(typeof ai.chooseColumn, 'function');
    assert.ok(ai.weight > 0);
  }
  assert.equal(Math.min(...AIS.map((a) => a.weight)), byId('random').weight, 'random is the rarest');
  assert.ok(byId('random').weight < byId('standard').weight);
});

test('the state an AI sees has no bag', () => {
  const { room } = playingRoom(3, { seed: 4 });
  const state = bot.snapshot(room);
  assert.ok(!('bag' in state));
  assert.ok(!JSON.stringify(state).includes(JSON.stringify(room.bag.slice(0, 12))));
  assert.equal(state.bagCount, room.bag.length);
});

// ---- legality: every AI, every size, both wall rules ----

test('every AI plays complete all-computer games at every player count, legally, and the game ends', () => {
  for (const id of ids) {
    for (const n of [2, 3, 4, 5]) {
      for (const free of [false, true]) {
        const { room, steps } = playBotGame(Array(n).fill(id), { seed: 31 * n + (free ? 1 : 0), free, onStep: (r) => assertInvariants(r, `${id} ${n}p`) });
        assert.equal(room.phase, 'finished', `${id} ${n} players free=${free}`);
        assert.ok(steps > 10 && steps < 2000, `${id}: ${steps} steps`);
        assert.ok(room.winners.length >= 1);
        assertInvariants(room, `${id} ${n}p end`);
      }
    }
  }
});

test('mixed tables of every AI finish too (and in thousands of positions nothing illegal is chosen)', () => {
  let games = 0;
  for (let g = 0; g < 40; g++) {
    const n = 2 + (g % 4);
    const table = Array.from({ length: n }, (_, i) => ids[(g + i * 3) % ids.length]);
    const { room } = playBotGame(table, { seed: 700 + g, free: g % 3 === 0 });
    assert.equal(room.phase, 'finished', table.join());
    games++;
  }
  assert.equal(games, 40);
});

// ---- traits ----

test('random: any legal move, floor included, in roughly even shares', () => {
  const room = position((r) => setTable(r, { factories: [[0, 1, 1, 2]], centre: [3], marker: false, turn: 0 }));
  const legal = game.legalMoves(room, 0);
  const seen = new Map();
  const rng = seeded(5);
  const ai = byId('random');
  for (let i = 0; i < 4000; i++) {
    const m = ai.chooseMove(bot.snapshot(room), 0, legal, rng);
    const key = JSON.stringify(m);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  assert.equal(seen.size, legal.length, 'every legal move is chosen sometimes');
  const expected = 4000 / legal.length;
  for (const n of seen.values()) assert.ok(n > expected * 0.6 && n < expected * 1.4, `${n} vs ${expected}`);
  assert.ok([...seen.keys()].some((k) => k.includes('"floor"')));
  assert.equal(ai.chooseMove(bot.snapshot(room), 0, [], rng), null, 'nothing legal, nothing chosen');
});

test('greedy: the biggest wall score right now, never a bonus plan', () => {
  // Colour 2 completes line 3 at (2,4), joining a row run and a column run (score 5); colour 0 completes line 1 for 1 point.
  const room = position((r) => {
    setWall(r, 0, ['.....', '....X', '..XX.', '....X', '.....']);
    r.lines[0][2] = { colour: 2, count: 2 };
    r.lines[0][0] = { colour: null, count: 0 };
    setTable(r, { factories: [[2, 4, 4, 4], [0, 3, 3, 3]], centre: [], marker: false, turn: 0 });
  });
  for (const m of picks('greedy', room)) assert.deepEqual(m, { source: 0, colour: 2, line: 2 });
});

test('row finisher: completes the row that is nearly full, even for fewer points', () => {
  // Row 4 of the wall (index 3) has four tiles and needs Terracotta at its first place; the other completion scores more.
  const room = position((r) => {
    setWall(r, 0, ['.....', '....X', '..XX.', '.XXXX', '.....']);
    r.lines[0][2] = { colour: 2, count: 2 }; // (2,4) would score 6
    r.lines[0][3] = { colour: 2, count: 3 }; // (3,0) completes the row: 5
    setTable(r, { factories: [[2, 4, 4, 4]], centre: [], marker: false, turn: 0 });
  });
  for (const m of picks('row-finisher', room)) assert.deepEqual(m, { source: 0, colour: 2, line: 3 });
  for (const m of picks('greedy', room)) assert.deepEqual(m, { source: 0, colour: 2, line: 2 }, 'greedy takes the bigger tile');
});

test('colour collector: finishes a colour set rather than the bigger tile', () => {
  // Cobalt (1) is on four rows; a single Saffron on line 1 completes the set. A Verdigris tile elsewhere scores 6.
  const room = position((r) => {
    setWall(r, 0, ['....X', '..XX.', '...XX', '....X', 'X....']);
    r.lines[0][1] = { colour: 3, count: 1 };
    setTable(r, { factories: [[1, 4, 4, 4], [3, 0, 0, 0]], centre: [], marker: false, turn: 0 });
  });
  for (const m of picks('colour-collector', room)) assert.deepEqual(m, { source: 0, colour: 1, line: 0 });
  for (const m of picks('greedy', room)) assert.deepEqual(m, { source: 1, colour: 3, line: 1 });
});

test('denier: takes the tile the opponent needs to finish a line; greedy does not', () => {
  const room = position((r) => {
    setWall(r, 0, ['.....', '..X..', '.....', '..X..', '.....']);
    r.lines[1][3] = { colour: 1, count: 3 }; // the opponent needs one Saffron
    setTable(r, { factories: [[1, 0, 0, 0]], centre: [], marker: false, turn: 0 });
  });
  for (const m of picks('denier', room)) assert.equal(m.colour, 1);
  for (const m of picks('greedy', room)) assert.equal(m.colour, 0, 'a line of three Cobalt scores 3');
});

test('sharp: ends the game only when it wins; behind, it declines the row and plays on', () => {
  const build = (mine, theirs) => (r) => {
    setWall(r, 0, ['XXXX.', '.....', '.....', '.....', '.....']);
    r.lines[0][0] = { colour: null, count: 0 };
    r.scores[0] = mine;
    r.scores[1] = theirs;
    setTable(r, { factories: [[4, 1, 1, 1], [3, 3, 2, 2]], centre: [], marker: false, turn: 0 });
  };
  const behind = position(build(0, 60));
  for (const m of picks('sharp', behind, 12)) assert.ok(!(m.colour === 4 && m.line === 0), 'it does not complete the row while 60 behind');
  for (const m of picks('row-finisher', behind, 12)) assert.deepEqual(m, { source: 0, colour: 4, line: 0 });
  const ahead = position(build(60, 0));
  for (const m of picks('sharp', ahead, 12)) assert.deepEqual(m, { source: 0, colour: 4, line: 0 }, 'ahead, it finishes the game');
});

test('sharp: a free wall tile goes where it scores and keeps every place fillable', () => {
  const { room } = playingRoom(2, { seed: 8, free: true });
  blank(room);
  room.walls[0][0] = [0, 1, 2, null, null];
  room.walls[0][3][3] = 4; // putting colour 3 in column 4 would leave (0,3) dead
  room.phase = 'tiling';
  room.pending = [{ row: 0, colour: 3, columns: [3, 4] }, null];
  for (let i = 0; i < 20; i++) assert.equal(byId('sharp').chooseColumn(bot.snapshot(room), 0, room.pending[0], seeded(i)), 3);
});

test('standard is exactly the original computer player', () => {
  // The original bot.test.js positions still pass unchanged; here, a whole game with no AI on the seats matches "standard".
  const a = playBotGame(['standard', 'standard', 'standard'], { seed: 77 }).room;
  const rng = seeded(77);
  const b = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: 3 });
  game.fillWithBots(b, 1);
  b.seats[0] = { kind: 'human', id: 1, name: 'p1' };
  game.start(b, 1, rng);
  b.seats = b.seats.map((s, i) => ({ kind: 'bot', id: `bot:${i}`, name: `Bot ${i}` })); // no `ai` field: an old room
  while (b.phase !== 'finished') bot.runPending(b, rng);
  assert.deepEqual(b.scores, a.scores);
  assert.deepEqual(b.history, a.history);
});

// ---- strength ----

test('sharp is not stuck at five rounds: games between sharp players sometimes run longer, standard ones never do', () => {
  const rounds = (ai, games) => Array.from({ length: games }, (_, g) => playBotGame([ai, ai], { seed: 4000 + g }).room.playedRounds);
  const sharp = rounds('sharp', 60);
  const standard = rounds('standard', 30);
  assert.ok(sharp.every((r) => r >= 5));
  assert.ok(sharp.some((r) => r > 5), `rounds: ${sharp.join('')}`);
  assert.ok(standard.every((r) => r === 5), 'the flaw: every standard game is five rounds');
  console.log(`  sharp-only 2p games over ${sharp.length}: ${sharp.filter((r) => r > 5).length} ran past five rounds (longest ${Math.max(...sharp)})`);
});

test('seeded tournament: sharp beats standard beats random', () => {
  const three = tournament(['sharp', 'standard', 'random'], { games: 240, seed: 11 });
  const two = tournament(['sharp', 'standard'], { games: 200, seed: 12 });
  const four = tournament(['sharp', 'standard', 'greedy', 'denier'], { games: 120, seed: 13 });
  const row = (label, t) => console.log(`  ${label}: ` + Object.entries(t).filter(([k]) => k !== 'rounds').map(([id, v]) => `${id} ${v.mean.toFixed(1)} pts ${(v.winRate * 100).toFixed(0)}% wins`).join(', '));
  row('3 players', three);
  row('2 players', two);
  row('4 players', four);
  assert.ok(three.sharp.mean > three.standard.mean && three.standard.mean > three.random.mean);
  assert.ok(three.sharp.winRate > three.standard.winRate && three.standard.winRate > three.random.winRate);
  assert.ok(two.sharp.winRate > 0.6, `heads-up: ${two.sharp.winRate}`);
  assert.ok(two.sharp.mean > two.standard.mean);
  assert.ok(four.sharp.mean > four.standard.mean && four.sharp.winRate > four.standard.winRate);
  assert.ok(four.standard.mean > four.denier.mean, 'the denier gives up too many points of its own');
});

// ---- assignment, saving, viewing ----

const lobby = (n, bots) => {
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: n });
  for (let i = 0; i < bots; i++) game.addBot(room, 1);
  for (let i = 2; i <= n - bots; i++) game.addHuman(room, i, `p${i}`);
  return room;
};

test('starting gives every computer player an AI by the game rng, and nobody else', () => {
  const room = lobby(5, 3);
  assert.ok(room.seats.every((s) => !('ai' in s)), 'nothing before the start');
  assert.equal(game.start(room, 1, seeded(3)).ok, true);
  for (const seat of room.seats) {
    if (game.isBot(seat)) assert.ok(ids.includes(seat.ai), seat.ai);
    else assert.ok(!('ai' in seat));
  }
  const again = lobby(5, 3);
  game.start(again, 1, seeded(3));
  assert.deepEqual(again.seats.map((s) => s.ai), room.seats.map((s) => s.ai), 'the same seed, the same AIs');
  assert.deepEqual(again.bag, room.bag, 'and the same deal');
  // Over many starts every AI turns up, the rare random one least.
  const counts = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let s = 0; s < 400; s++) {
    const r = lobby(5, 4);
    game.start(r, 1, seeded(s));
    for (const seat of r.seats) if (game.isBot(seat)) counts[seat.ai]++;
  }
  for (const id of ids) assert.ok(counts[id] > 0, `${id} is picked sometimes`);
  assert.ok(counts.random < counts.standard / 3);
});

test('the deal is the same with computer players as it was before AIs existed', () => {
  const withBots = lobby(3, 2);
  const people = lobby(3, 0);
  game.start(withBots, 1, seeded(5));
  game.start(people, 1, seeded(5));
  assert.deepEqual(withBots.bag, people.bag);
  assert.deepEqual(withBots.factories, people.factories);
});

test('the AI is saved in the room, survives a save and load, and the game carries on the same', () => {
  const { room, rng } = playingRoom(3, { seed: 6 });
  room.seats[1] = { kind: 'bot', id: 'bot:1', name: 'Bot', ai: 'greedy' };
  room.seats[2] = { kind: 'bot', id: 'bot:2', name: 'Bot 2', ai: 'denier' };
  const saved = JSON.parse(JSON.stringify(room));
  assert.deepEqual(saved.seats.map((s) => s.ai), [undefined, 'greedy', 'denier']);
  const a = structuredClone(saved);
  const b = JSON.parse(JSON.stringify(saved));
  const ra = seeded(9);
  const rb = seeded(9);
  for (let i = 0; i < 400 && a.phase !== 'finished'; i++) {
    if (a.turn === 0 || (a.phase === 'tiling' && a.pending[0])) {
      const action = game.legalMoves(a, a.turn)[0];
      game.takeTiles(a, 0, action, ra);
      game.takeTiles(b, 0, action, rb);
    } else {
      bot.runPending(a, ra);
      bot.runPending(b, rb);
    }
  }
  assert.deepEqual(a.scores, b.scores);
  assert.equal(a.seats[1].ai, 'greedy');
  void rng;
});

test('a room saved before AIs existed falls back to standard, as does an unknown id', () => {
  const { room } = playingRoom(2, { seed: 2 });
  room.seats[1] = { kind: 'bot', id: 'bot:1', name: 'Old' };
  assert.equal(game.aiOf(room, 1).id, 'standard');
  assert.deepEqual(game.viewFor(room, 1).seats[1].ai, { id: 'standard', name: 'Standard' });
  room.seats[1].ai = 'retired-ai';
  assert.equal(game.aiOf(room, 1), aiById(AIS, 'retired-ai'));
  assert.equal(game.aiOf(room, 1).id, 'standard');
  assert.ok(bot.chooseMove(Object.assign(room, { turn: 1 }), 1), 'and it still plays');
});

test('a person who leaves mid-game is replaced by a computer player that picks an AI then', () => {
  const room = lobby(3, 1);
  game.start(room, 1, seeded(2));
  const before = room.seats.map((s) => s.ai);
  const seat = game.seatOf(room, 2);
  assert.equal(game.removeHuman(room, 2, seeded(4)).ok, true);
  assert.equal(room.seats[seat].kind, 'bot');
  assert.ok(ids.includes(room.seats[seat].ai), 'the replacement has an AI');
  assert.equal(room.seats.findIndex((s) => game.isBot(s) && s.ai === undefined), -1);
  assert.deepEqual(room.seats.filter((_, i) => i !== seat).map((s) => s.ai), before.filter((_, i) => i !== seat), 'the others keep theirs');
  const other = lobby(3, 1);
  game.start(other, 1, seeded(2));
  game.removeHuman(other, 2, seeded(4));
  assert.equal(other.seats[seat].ai, room.seats[seat].ai, 'the rng decides it');
  // In the lobby nothing is assigned: the seat is simply freed.
  const waiting = lobby(3, 1);
  game.removeHuman(waiting, 2);
  assert.equal(waiting.seats[2], null);
});

test('the view shows the AI of computer seats only, never to be mistaken for a person, and not before the start', () => {
  const room = lobby(3, 1);
  assert.ok(game.viewFor(room, 1).seats.every((s) => !s || !('ai' in s)), 'nothing in the lobby');
  game.start(room, 1, seeded(8));
  const view = game.viewFor(room, 1);
  view.seats.forEach((s, i) => {
    if (game.isBot(room.seats[i])) {
      assert.deepEqual(s.ai, { id: room.seats[i].ai, name: byId(room.seats[i].ai).name });
      assert.deepEqual(Object.keys(s.ai).sort(), ['id', 'name']);
    } else assert.ok(!('ai' in s), 'people have none');
  });
  assert.ok(!/chooseMove|description/.test(JSON.stringify(view)));
});

test('playing again picks the AIs afresh', () => {
  const room = lobby(3, 2);
  game.start(room, 1, seeded(1));
  room.phase = 'finished';
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.ok(room.seats.every((s) => !('ai' in s)), 'cleared in the lobby');
  assert.ok(game.viewFor(room, 1).seats.every((s) => !('ai' in s)));
  game.start(room, 1, seeded(2));
  assert.ok(room.seats.filter(game.isBot).every((s) => ids.includes(s.ai)));
});

test('over the real site: each computer keeps its AI through a restart, and a replacement gets one', async (t) => {
  process.env.AZULEJO_BOT_DELAY = '30-50';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azulejo-ai-'));
  const first = await launchModule(t, { id: 'azulejo', moduleDir: here, dataDir, keep: true });
  const ann = await first.person('ann').open();
  const bob = await first.person('bob').open();
  const { code } = await ann.call('create', { seats: 4 });
  await bob.call('join', { code });
  await ann.call('fillBots');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.phase === 'playing', 'play');
  const assigned = ann.state.seats.map((s) => s.ai);
  assert.equal(assigned.filter(Boolean).length, 2);
  assert.ok(ann.state.seats.every((s) => s.bot === Boolean(s.ai)), 'only computers show one');
  await until(() => bob.state?.phase === "playing", "bob sees the game");
  assert.deepEqual(bob.state.seats.map((s) => s.ai), assigned, "everyone sees the same");
  await sleep(150);
  const cookie = ann.cookie;
  await first.stop();

  const second = await launchModule(t, { id: 'azulejo', moduleDir: here, dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  await again.call('resume');
  await until(() => again.state?.phase, 'the saved game');
  assert.deepEqual(again.state.seats.map((s) => s.ai), assigned, 'the same AIs after the restart');

  // Bob (a person) leaves: a computer replaces him with an AI of its own.
  const bobAgain = second.person('bob');
  bobAgain.cookie = bob.cookie;
  await bobAgain.connect();
  await bobAgain.call('resume');
  const bobSeat = again.state.seats.findIndex((s) => s.name === 'bob');
  assert.equal((await bobAgain.call('leave')).ok, true);
  await until(() => again.state.seats[bobSeat].bot, 'a computer in the seat');
  assert.ok(ids.includes(again.state.seats[bobSeat].ai.id));
});


