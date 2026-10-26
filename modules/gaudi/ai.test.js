// The Gaudi computer players' AIs: the registry, legality at every size, what each one is for, a seeded tournament,
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
import { PATTERNS, isDeadSpace, patternOf } from './rules.js';
import { assertInvariants, die, playingRoom, seeded } from './testing.js';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { aiById } from '../../shared/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ids = AIS.map((a) => a.id);
const byId = (id) => AIS.find((a) => a.id === id);
const at = (r, c) => r * 5 + c;

// Test windows: an empty one, and one whose space at row 2, column 3 needs a ruby die.
const cells = (overrides = {}) => Array.from({ length: 20 }, (_, i) => overrides[i] ?? '.');
PATTERNS['ai.blank'] = { pid: 'ai.blank', card: 98, face: 0, name: 'AI blank', difficulty: 3, rows: [], cells: cells() };
PATTERNS['ai.hole'] = { pid: 'ai.hole', card: 98, face: 1, name: 'AI hole', difficulty: 3, rows: [], cells: cells({ [at(1, 2)]: 'R' }) };

/** A started two-person game with seat 0 to move, a hand-picked window, pool, tools and tokens. */
function lab({ pid = 'ai.blank', pool = [], tokens = 5, tools = ['lathe', 'mirror', 'refire'], colour = 'ruby', publicIds = ['deep-pairs', 'full-palette', 'colour-chains'], grid = [], badPrivate = false } = {}) {
  const { room } = playingRoom(2, { seed: 5 });
  room.settings.badPrivate = badPrivate;
  room.patterns = [pid, pid];
  room.tokens = [tokens, tokens];
  room.tools = tools;
  room.spent = tools.map(() => 0);
  room.tokenTotal = tokens * 2;
  room.privateColours = [colour, colour === 'ruby' ? 'jade' : 'ruby'];
  room.publicIds = publicIds;
  room.pool = pool;
  for (const [r, c, colourName, shade, id] of grid) room.grids[0][at(r, c)] = die(colourName, shade, id);
  room.turn = { seat: 0, number: 1, placements: 0, toolUsed: false, extra: false };
  return room;
}
const step = (id, room, seed = 1) => byId(id).chooseStep(bot.snapshot(room, 0), 0, seeded(seed));
const steps = (id, room, n = 30) => Array.from({ length: n }, (_, i) => step(id, room, i));
/** The step really is legal: apply it to a copy. */
const legal = (room, choice) => {
  const copy = structuredClone(room);
  const result = choice.type === 'place' ? game.placeDie(copy, 0, choice) : choice.type === 'tool' ? game.useTool(copy, 0, { tool: choice.tool, params: choice.params }) : game.endTurn(copy, 0);
  assert.equal(result.ok, true, `${JSON.stringify(choice)}: ${result.error}`);
};

// ---- the registry ----

test('the registry: standard first, a random AI, sharp, and at least three more; everything described', () => {
  assert.equal(AIS[0].id, 'standard', 'rooms saved before AIs existed fall back to the first');
  for (const id of ['standard', 'random', 'sharp']) assert.ok(ids.includes(id), id);
  assert.ok(AIS.length >= 6);
  for (const ai of AIS) {
    assert.ok(ai.name && ai.description.length > 20, ai.id);
    assert.equal(typeof ai.chooseWindow, 'function');
    assert.equal(typeof ai.chooseStep, 'function');
    assert.ok(ai.weight > 0);
  }
  assert.equal(Math.min(...AIS.map((a) => a.weight)), byId('random').weight, 'random is the rarest');
  assert.ok(byId('random').weight < byId('standard').weight);
});

test('the state an AI sees holds no bag and nobody else’s secret colour', () => {
  const { room } = playingRoom(3, { seed: 4 });
  const state = bot.snapshot(room, 1);
  const text = JSON.stringify(state);
  assert.ok(!('bag' in state) && !('options' in state) && !('picked' in state));
  assert.equal(state.privateColour, room.privateColours[1]);
  assert.ok(!('privateColours' in state));
  for (const d of room.bag.slice(0, 8)) assert.ok(!text.includes(`"id":${d.id},"c"`), 'no bag die');
});

// ---- legality ----

test('every AI plays complete all-computer games at every player count, legally, and the game ends', () => {
  for (const id of ids) {
    for (const n of [2, 3, 4, 5]) {
      for (const badPrivate of [false, true]) {
        const { room, steps: taken } = playBotGame(Array(n).fill(id), { seed: 17 * n + (badPrivate ? 1 : 0), badPrivate, onStep: (r) => assertInvariants(r, `${id} ${n}p`) });
        assert.equal(room.phase, 'finished', `${id} ${n} players`);
        assert.ok(taken > n * 10, `${id}: ${taken} steps`);
        assertInvariants(room, `${id} ${n}p end`);
      }
    }
  }
});

test('mixed tables finish too, and every AI picks one of the windows it was offered', () => {
  for (let g = 0; g < 40; g++) {
    const n = 2 + (g % 4);
    const table = Array.from({ length: n }, (_, i) => ids[(g + i * 2) % ids.length]);
    const { room } = playBotGame(table, { seed: 300 + g, badPrivate: g % 3 === 0 });
    assert.equal(room.phase, 'finished', table.join());
  }
  const options = ['0.0', '0.1', '1.0', '1.1'];
  for (const ai of AIS) for (let i = 0; i < 30; i++) assert.ok(options.includes(ai.chooseWindow(options, seeded(i))), ai.id);
});

test('every AI turn, in thousands of positions, is a legal step', () => {
  let positions = 0;
  for (const id of ids) {
    for (let g = 0; g < 6; g++) {
      const n = 2 + (g % 4);
      const rng = seeded(900 + g);
      const { room } = playingRoom(n, { seed: 900 + g });
      room.seats = room.seats.map((_, i) => ({ kind: 'bot', id: `bot:${i}`, name: `Bot ${i}`, ai: id }));
      for (let k = 0; k < 400 && room.phase === 'playing'; k++) {
        const seat = room.turn.seat;
        if (rng() < 0.3) {
          room.tokens[seat] += 3; // spare tokens make the tool branches reachable
          room.tokenTotal += 3;
        }
        const choice = bot.botStep(structuredClone(room), seat, seeded(k));
        const copy = structuredClone(room);
        const result = choice.type === 'place' ? game.placeDie(copy, seat, choice) : choice.type === 'tool' ? game.useTool(copy, seat, { tool: choice.tool, params: choice.params }) : game.endTurn(copy, seat);
        assert.equal(result.ok, true, `${id}: ${JSON.stringify(choice)}: ${result.error}`);
        positions++;
        bot.runPending(room, rng);
      }
    }
  }
  assert.ok(positions > 2000, `${positions} positions`);
});

// ---- traits ----

test('random: any legal placement in even shares, and it never uses a tool, even when stuck', () => {
  const room = lab({ pool: [die('ruby', 2, 1), die('topaz', 3, 2)] });
  const seen = new Map();
  const ai = byId('random');
  const rng = seeded(5);
  for (let i = 0; i < 3000; i++) {
    const s = ai.chooseStep(bot.snapshot(room, 0), 0, rng);
    assert.equal(s.type, 'place');
    const key = `${s.die}:${s.cell}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  assert.equal(seen.size, 2 * 14, 'both dice on each of the fourteen edge and corner spaces');
  const expected = 3000 / seen.size;
  for (const n of seen.values()) assert.ok(n > expected * 0.6 && n < expected * 1.4);
  const stuck = lab({ pool: [], tokens: 5 });
  assert.deepEqual(step('random', stuck), { type: 'end' });
  const second = lab({ pool: [die('ruby', 2, 1)], grid: [[0, 0, 'jade', 1, 900]] });
  second.turn.placements = 1;
  assert.deepEqual(step('random', second), { type: 'end' });
});

test('private chaser takes its own colour at the highest shade; the public hunter takes the pair', () => {
  const room = lab({ colour: 'ruby', publicIds: ['deep-pairs', 'middle-pairs', 'pale-pairs'], grid: [[0, 0, 'jade', 5, 900]], pool: [die('ruby', 3, 1), die('topaz', 6, 2), die('ruby', 2, 3)], tokens: 0 });
  for (const s of steps('private-chaser', room)) assert.equal(s.die, 1, 'the Ruby 3, the best of its colour');
  for (const s of steps('public-hunter', room)) assert.equal(s.die, 2, 'the 6 that pairs with the 5');
  const flat = lab({ colour: 'ruby', badPrivate: true, tokens: 0, grid: [[0, 0, 'jade', 5, 900]], pool: [die('topaz', 6, 2), die('ruby', 1, 3)] });
  for (const s of steps('private-chaser', flat)) assert.equal(s.die, 3, 'with flat scoring any ruby is worth 3');
});

test('private chaser turns a die over for a much bigger shade of its colour; standard does not', () => {
  const room = lab({ colour: 'ruby', pool: [die('ruby', 1, 1)], tokens: 3 });
  for (const s of steps('private-chaser', room, 10)) {
    assert.deepEqual(s, { type: 'tool', tool: 'mirror', params: { die: 1 } });
    legal(room, s);
  }
  for (const s of steps('standard', room, 10)) assert.equal(s.type, 'place');
  const none = lab({ colour: 'ruby', pool: [die('ruby', 1, 1)], tokens: 0 });
  for (const s of steps('private-chaser', none, 10)) assert.equal(s.type, 'place', 'no tokens, no tool');
});

test('tool user spends tokens where standard keeps them, and takes the hardest window', () => {
  const room = lab({ colour: 'ruby', pool: [die('ruby', 2, 1), die('topaz', 3, 2)], tokens: 4, tools: ['lathe', 'mirror', 'refire'] });
  const toolStep = steps('tool-user', room, 10);
  assert.ok(toolStep.every((s) => s.type === 'tool'), JSON.stringify(toolStep[0]));
  toolStep.forEach((s) => legal(room, s));
  assert.ok(steps('standard', room, 10).every((s) => s.type === 'place'));
  const options = ['0.0', '0.1', '1.0', '1.1'];
  const hardest = options.reduce((best, pid) => (patternOf(pid).difficulty > patternOf(best).difficulty ? pid : best));
  const picks = Array.from({ length: 30 }, (_, i) => byId('tool-user').chooseWindow(options, seeded(i)));
  assert.ok(picks.every((pid) => patternOf(pid).difficulty === patternOf(hardest).difficulty));
});

test('tidy never boxes in a space that needs a ruby, and takes the easiest window', () => {
  // Row 2, column 3 needs a Ruby die. A Ruby placed beside it would leave it impossible to fill.
  const room = lab({ pid: 'ai.hole', grid: [[0, 4, 'jade', 1, 900]], pool: [die('ruby', 4, 1)] });
  const pattern = patternOf('ai.hole');
  const placed = new Set();
  for (const s of steps('tidy', room, 40)) {
    assert.equal(s.type, 'place');
    placed.add(s.cell);
    const after = room.grids[0].slice();
    after[s.cell] = room.pool[0];
    assert.ok(!isDeadSpace(after, pattern, at(1, 2)), `cell ${s.cell} leaves the ruby space dead`);
  }
  assert.ok(!placed.has(at(1, 3)));
  const options = ['0.0', '0.1', '1.0', '1.1'];
  const easiest = Math.min(...options.map((p) => patternOf(p).difficulty));
  for (let i = 0; i < 30; i++) assert.equal(patternOf(byId('tidy').chooseWindow(options, seeded(i))).difficulty, easiest);
  // Random is not so careful about it.
  const careless = Array.from({ length: 80 }, (_, i) => byId('random').chooseStep(bot.snapshot(room, 0), 0, seeded(i)).cell);
  assert.ok(careless.includes(at(1, 3)), 'random does sometimes make a dead space');
});

test('sharp: a die of its colour first, mirrors a 1 into a 6, leaves bad bargains alone and never makes a dead space', () => {
  const room = lab({ colour: 'ruby', pool: [die('ruby', 1, 1)], tokens: 3 });
  for (const s of steps('sharp', room, 12)) {
    assert.deepEqual(s, { type: 'tool', tool: 'mirror', params: { die: 1 } }, 'a token for five points');
    legal(room, s);
  }
  const fair = lab({ colour: 'ruby', pool: [die('ruby', 5, 1)], tokens: 3 });
  for (const s of steps('sharp', fair, 12)) assert.equal(s.type, 'place', 'turning a 5 over would lose points; lathe +1 gains one for a token');
  const pick = lab({ colour: 'ruby', pool: [die('topaz', 6, 2), die('ruby', 5, 1)], tokens: 0, publicIds: ['rainbow-rows', 'tonal-rows', 'rainbow-columns'] });
  for (const s of steps('sharp', pick, 12)) assert.equal(s.die, 1);
  const dead = lab({ pid: 'ai.hole', grid: [[0, 4, 'jade', 1, 900]], pool: [die('ruby', 4, 1)] });
  for (const s of steps('sharp', dead, 40)) assert.notEqual(s.cell, at(1, 3));
});

test('sharp keeps a row of different colours going rather than repeating a colour', () => {
  const room = lab({ colour: 'amethyst', publicIds: ['rainbow-rows', 'tonal-rows', 'full-spectrum'], grid: [[0, 0, 'jade', 1, 900], [0, 1, 'ruby', 2, 901]], pool: [die('ruby', 4, 1), die('topaz', 5, 2)] });
  for (const s of steps('sharp', room, 20)) {
    const row = Math.floor(s.cell / 5);
    if (row === 0) assert.equal(s.die, 2, 'a Topaz in row 1; a second Ruby would spoil the rainbow');
  }
});

test('standard is exactly the original computer player', () => {
  const a = playBotGame(['standard', 'standard', 'standard'], { seed: 77 }).room;
  const rng = seeded(77);
  const b = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: 3 });
  game.fillWithBots(b, 1);
  b.seats[0] = { kind: 'human', id: 1, name: 'p1' };
  game.start(b, 1, rng);
  b.seats = b.seats.map((s, i) => ({ kind: 'bot', id: `bot:${i}`, name: `Bot ${i}` })); // no `ai` field: an old room
  while (b.phase !== 'finished') bot.runPending(b, rng);
  assert.deepEqual(b.grids, a.grids);
  assert.deepEqual(b.history, a.history);
});

// ---- strength ----

test('seeded tournament: sharp beats standard beats random', () => {
  const three = tournament(['sharp', 'standard', 'random'], { games: 200, seed: 11 });
  const two = tournament(['sharp', 'standard'], { games: 200, seed: 12 });
  const five = tournament(['sharp', 'standard', 'public-hunter', 'private-chaser', 'tidy'], { games: 120, seed: 13 });
  const row = (label, t) => console.log(`  ${label}: ` + Object.entries(t).map(([id, v]) => `${id} ${v.mean.toFixed(1)} pts ${(v.winRate * 100).toFixed(0)}% wins`).join(', '));
  row('3 players', three);
  row('2 players', two);
  row('5 players', five);
  assert.ok(three.sharp.mean > three.standard.mean && three.standard.mean > three.random.mean);
  assert.ok(three.sharp.winRate > three.standard.winRate && three.standard.winRate > three.random.winRate);
  assert.ok(two.sharp.mean > two.standard.mean);
  assert.ok(two.sharp.winRate > 0.6, `heads-up: ${two.sharp.winRate}`);
  assert.ok(five.sharp.mean > five.standard.mean && five.sharp.winRate > five.standard.winRate);
  assert.ok(five.standard.mean > five.tidy.mean, 'the tidy player gives up the objectives');
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
  assert.deepEqual(again.options, room.options, 'and the same windows dealt');
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
  assert.deepEqual(withBots.options, people.options);
});

test('the AI is saved in the room, survives a save and load, and the game carries on the same', () => {
  const { room } = playingRoom(3, { seed: 6 });
  room.seats[1] = { kind: 'bot', id: 'bot:1', name: 'Bot', ai: 'tidy' };
  room.seats[2] = { kind: 'bot', id: 'bot:2', name: 'Bot 2', ai: 'tool-user' };
  const saved = JSON.parse(JSON.stringify(room));
  assert.deepEqual(saved.seats.map((s) => s.ai), [undefined, 'tidy', 'tool-user']);
  const a = structuredClone(saved);
  const b = JSON.parse(JSON.stringify(saved));
  const ra = seeded(9);
  const rb = seeded(9);
  for (let i = 0; i < 2000 && a.phase !== 'finished'; i++) {
    if (a.turn?.seat === 0) {
      game.endTurn(a, 0, ra);
      game.endTurn(b, 0, rb);
    } else {
      bot.runPending(a, ra);
      bot.runPending(b, rb);
    }
  }
  assert.equal(a.phase, 'finished');
  assert.deepEqual(a.grids, b.grids);
  assert.equal(a.seats[1].ai, 'tidy');
});

test('a room saved before AIs existed falls back to standard, as does an unknown id', () => {
  const { room } = playingRoom(2, { seed: 2 });
  room.seats[1] = { kind: 'bot', id: 'bot:1', name: 'Old' };
  assert.equal(game.aiOf(room, 1).id, 'standard');
  assert.deepEqual(game.viewFor(room, 1).seats[1].ai, { id: 'standard', name: 'Standard' });
  room.seats[1].ai = 'retired-ai';
  assert.equal(game.aiOf(room, 1), aiById(AIS, 'retired-ai'));
  assert.equal(game.aiOf(room, 1).id, 'standard');
  room.turn.seat = 1;
  assert.ok(bot.botStep(room, 1, seeded(1)), 'and it still plays');
});

test('a person who leaves mid-game is replaced by a computer player that picks an AI then', () => {
  const room = lobby(3, 1);
  game.start(room, 1, seeded(2));
  const before = room.seats.map((s) => s.ai);
  const seat = game.seatOf(room, 2);
  assert.equal(game.removeHuman(room, 2, seeded(4)).ok, true);
  assert.equal(room.seats[seat].kind, 'bot');
  assert.ok(ids.includes(room.seats[seat].ai), 'the replacement has an AI');
  assert.deepEqual(room.seats.filter((_, i) => i !== seat).map((s) => s.ai), before.filter((_, i) => i !== seat), 'the others keep theirs');
  const other = lobby(3, 1);
  game.start(other, 1, seeded(2));
  game.removeHuman(other, 2, seeded(4));
  assert.equal(other.seats[seat].ai, room.seats[seat].ai, 'the rng decides it');
  const waiting = lobby(3, 1);
  game.removeHuman(waiting, 2);
  assert.equal(waiting.seats[2], null, 'in the lobby the seat is just freed');
});

test('the view shows the AI of computer seats only, and not before the start', () => {
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
  assert.ok(!/chooseStep|description/.test(JSON.stringify(view)));
});

test('playing again picks the AIs afresh', () => {
  const room = lobby(3, 2);
  game.start(room, 1, seeded(1));
  room.phase = 'finished';
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.ok(room.seats.every((s) => !('ai' in s)), 'cleared in the lobby');
  game.start(room, 1, seeded(2));
  assert.ok(room.seats.filter(game.isBot).every((s) => ids.includes(s.ai)));
});

test('over the real site: each computer keeps its AI through a restart, and a replacement gets one', async (t) => {
  process.env.GAUDI_BOT_DELAY = '30-50';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaudi-ai-'));
  const first = await launchModule(t, { id: 'gaudi', moduleDir: here, dataDir, keep: true });
  const ann = await first.person('ann').open();
  const bob = await first.person('bob').open();
  const { code } = await ann.call('create', { seats: 4 });
  await bob.call('join', { code });
  await ann.call('fillBots');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.phase === 'windows' && bob.state?.phase === 'windows', 'the windows');
  const assigned = ann.state.seats.map((s) => s.ai);
  assert.equal(assigned.filter(Boolean).length, 2);
  assert.ok(ann.state.seats.every((s) => s.bot === Boolean(s.ai)), 'only computers show one');
  assert.deepEqual(bob.state.seats.map((s) => s.ai), assigned, 'everyone sees the same');
  await sleep(150);
  const cookie = ann.cookie;
  const bobCookie = bob.cookie;
  await first.stop();

  const second = await launchModule(t, { id: 'gaudi', moduleDir: here, dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  await again.call('resume');
  await until(() => again.state?.phase, 'the saved game');
  assert.deepEqual(again.state.seats.map((s) => s.ai), assigned, 'the same AIs after the restart');

  const bobAgain = second.person('bob');
  bobAgain.cookie = bobCookie;
  await bobAgain.connect();
  await bobAgain.call('resume');
  const bobSeat = again.state.seats.findIndex((s) => s.name === 'bob');
  assert.equal((await bobAgain.call('leave')).ok, true);
  await until(() => again.state.seats[bobSeat].bot, 'a computer in the seat');
  assert.ok(ids.includes(again.state.seats[bobSeat].ai.id));
});
