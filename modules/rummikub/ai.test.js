// The Rummikub AIs: the registry, how bots get one, whole games played by each, what the table-tile budget really buys,
// a small tournament, and that the choice survives a save and a restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import * as game from './game.js';
import { AIS } from './ai/index.js';
import { aiOf, bestPlay, chooseTurn, pendingAction, runPending } from './bot.js';
import { checkPlay, totalTiles } from './rules.js';
import { shuffleAttempts } from './search.js';
import { STD, assertInvariants, joker, playingRoom, seeded, tile } from './testing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const t = (c, n, copy = 0) => tile(STD, c, n, copy);
const J = (i = 0) => joker(STD, i);
const byId = (id) => AIS.find((ai) => ai.id === id);
const IDS = ['standard', 'shuffler-5', 'shuffler-10', 'shuffler-20', 'sharp', 'random'];

function position(room, { racks, table = [], turn = 0, melded = [], pool }) {
  const used = new Set([...racks.flat(), ...table.flat()]);
  room.racks = racks;
  room.table = table;
  room.pool = pool ?? Array.from({ length: totalTiles(room.settings) }, (_, i) => i).filter((id) => !used.has(id));
  room.turn = turn;
  room.melded = room.seats.map((_, i) => Boolean(melded[i]));
}

/** A bot-only room whose seats use the given AIs (by id), started with a seeded generator. */
function botRoom(ais, { seed = 1, settings = {} } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'h', size: ais.length, settings });
  game.fillWithBots(room, 1);
  const started = game.start(room, 1, rng);
  if (!started.ok) return { room, rng, error: started.error };
  room.seats[0] = { kind: 'bot', id: 'bot:0', name: 'Zed' }; // the host's seat plays too
  room.seats.forEach((seat, i) => (seat.ai = ais[i]));
  return { room, rng };
}

function playOut(room, rng, label = '') {
  let turns = 0;
  while (room.phase !== 'finished') {
    if (room.phase === 'between') {
      assert.equal(game.forceNext(room, rng).ok, true);
      continue;
    }
    const seat = room.turn;
    const choice = chooseTurn(room, seat, { rng });
    const result = choice.type === 'play' ? game.play(room, seat, { table: choice.table }) : game.draw(room, seat);
    assert.equal(result.ok, true, `${label}: a computer move must be legal (${choice.type}): ${result.error}`);
    assertInvariants(room, `${label} turn ${turns}`);
    assert.ok(++turns < 6000, `${label}: the game must end`);
  }
  return room;
}

// ---- the registry and the choosing ----

test('Rummikub has the six AIs, the classic one first, each with a name, description and a plan', () => {
  assert.deepEqual(AIS.map((ai) => ai.id), IDS);
  assert.equal(AIS[0].id, 'standard', 'rooms saved before AIs existed fall back to the first');
  for (const ai of AIS) {
    assert.equal(typeof ai.plan, 'function');
    assert.ok(ai.name && ai.description);
  }
  assert.deepEqual(AIS.filter((ai) => ai.tableTiles).map((ai) => ai.tableTiles), [5, 10, 20]);
  assert.ok(byId('random').weight < byId('standard').weight, 'the random AI is rarer');
});

test('starting a game gives every computer seat an AI (repeatably, with the game\'s generator) and no person one', () => {
  const run = (seed) => {
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'h', size: 6 });
    game.fillWithBots(room, 1);
    assert.equal(game.start(room, 1, seeded(seed)).ok, true);
    return room;
  };
  const a = run(5);
  assert.equal(a.seats[0].ai, undefined, 'the host is a person');
  for (let i = 1; i < 6; i++) assert.ok(IDS.includes(a.seats[i].ai), a.seats[i].ai);
  assert.deepEqual(run(5).seats.map((s) => s.ai), a.seats.map((s) => s.ai), 'same seed, same AIs');
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) run(seed).seats.slice(1).forEach((s) => seen.add(s.ai));
  assert.deepEqual([...seen].sort(), [...IDS].sort(), 'over many games every AI gets picked');
});

test('the view names a computer seat\'s AI once the game has started, and never a person\'s', () => {
  const { room } = playingRoom(3, { seed: 3, bots: true });
  const view = game.viewFor(room, 1);
  assert.equal(view.seats[0].ai, undefined);
  for (const seat of [1, 2]) {
    assert.deepEqual(Object.keys(view.seats[seat].ai).sort(), ['description', 'id', 'name']);
    assert.equal(view.seats[seat].ai.id, room.seats[seat].ai);
    assert.equal(typeof view.seats[seat].ai.plan, 'undefined');
  }
  const lobby = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'h', size: 3 });
  game.fillWithBots(lobby, 1);
  assert.equal(game.viewFor(lobby, 1).seats[1].ai, undefined, 'nothing is chosen in the lobby');
});

test('a person who leaves mid-game is replaced by a computer that picks an AI then; in the lobby the seat just empties', () => {
  const { room } = playingRoom(3, { seed: 4 });
  const picks = [];
  for (const roll of [0, 0.999]) {
    const copy = structuredClone(room);
    assert.equal(game.removeHuman(copy, 2, () => roll).ok, true);
    assert.equal(copy.seats[1].kind, 'bot');
    assert.equal(copy.seats[2].kind, 'human');
    picks.push(copy.seats[1].ai);
  }
  assert.deepEqual(picks, ['standard', 'random'], 'the generator chooses: first and last of the pool');
  const outcome = game.removeHuman(room, 2);
  assert.equal(outcome.ok, true);
  assert.ok(IDS.includes(room.seats[1].ai));
  const lobby = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'h', size: 3 });
  game.addHuman(lobby, 2, 'two');
  game.removeHuman(lobby, 2);
  assert.equal(lobby.seats[1], null);
});

test('a room saved before AIs existed (no ai on its bots) plays with the classic AI', () => {
  const { room } = playingRoom(2, { seed: 2, bots: true });
  delete room.seats[1].ai;
  assert.equal(aiOf(room, 1).id, 'standard');
  room.seats[1].ai = 'a-removed-ai';
  assert.equal(aiOf(room, 1).id, 'standard');
  room.turn = 1;
  assert.ok(pendingAction(room));
  assert.equal(runPending(room).ok, true);
});

test('the room, with each seat\'s AI, survives being saved as JSON and carries on', () => {
  const { room, rng } = botRoom(['sharp', 'shuffler-10', 'random', 'standard']);
  for (let i = 0; i < 30 && room.phase === 'playing'; i++) runPending(room, rng);
  const restored = JSON.parse(JSON.stringify(room));
  assert.deepEqual(restored.seats.map((s) => s.ai), ['sharp', 'shuffler-10', 'random', 'standard']);
  assert.deepEqual(game.viewFor(restored, 1).seats.map((s) => s.ai.id), ['sharp', 'shuffler-10', 'random', 'standard']);
  playOut(restored, rng, 'restored');
  assert.deepEqual(restored.seats.map((s) => s.ai), ['sharp', 'shuffler-10', 'random', 'standard']);
});

// ---- whole games ----

const SETTINGS = [{}, { numbers: 8, colours: 3, wildcards: 0, rounds: 2 }, { numbers: 4, colours: 2, wildcards: 4, meld: 0 }];

for (const id of IDS) {
  test(`${id}: bot-only games of 2 to 6 players finish, conserve every tile and only make moves the server accepts`, () => {
    let games = 0;
    for (const players of [2, 3, 4, 5, 6]) {
      SETTINGS.forEach((settings, index) => {
        // one seat plays this AI, the others are a mix, so it meets every kind of opponent
        const lineup = Array.from({ length: players }, (_, i) => (i === 0 ? id : IDS[(i + index) % IDS.length]));
        const { room, rng, error } = botRoom(lineup, { seed: players * 10 + index, settings });
        if (error) return assert.match(error, /too few|no run or group/);
        playOut(room, rng, `${id} ${players}p settings ${index}`);
        assert.ok(room.winners.length >= 1);
        games++;
      });
    }
    assert.ok(games >= 10, `played ${games}`);
  });
}

test('every AI on every seat: all-same games also finish', () => {
  for (const id of IDS) {
    const { room, rng } = botRoom([id, id, id], { seed: 7 });
    playOut(room, rng, `all ${id}`);
  }
});

// ---- the table-tile budget ----

/**
 * Table: blue 4-5-6 and blue 7-8-9-10-11. Rack: blue 11, orange 4, black 4, red 1. The group of 4s needs the blue 4 out of the
 * first run, which means taking both runs apart (3 + 5 = 8 table tiles) and rebuilding blue 5-11 and the group.
 */
function eightTileRoom() {
  const { room } = botRoom(['standard', 'shuffler-5']);
  position(room, {
    racks: [[], [t(1, 11, 1), t(2, 4), t(0, 1), t(3, 4)]],
    table: [[t(1, 4), t(1, 5), t(1, 6)], [t(1, 7), t(1, 8), t(1, 9), t(1, 10), t(1, 11)]],
    turn: 1,
    melded: [true, true],
  });
  return room;
}

test('a position solvable only by moving 8 table tiles: a budget of 5 cannot, 10 and 20 can (and so can the classic AI)', () => {
  const room = eightTileRoom();
  const results = Object.fromEntries([5, 10, 20].map((n) => [n, byId(`shuffler-${n}`).plan(room, 1)]));
  assert.equal(results[5], null, 'five tiles is not enough');
  for (const n of [10, 20]) {
    assert.ok(results[n], `${n} finds it`);
    assert.equal(results[n].added, 2, 'the orange 4 and black 4 are played');
    const asSeat = { ...room, seats: room.seats.map((s, i) => (i === 1 ? { ...s, ai: `shuffler-${n}` } : s)) };
    assert.equal(chooseTurn(asSeat, 1).type, 'play');
  }
  assert.equal(bestPlay(room, 1).added, 2);
  const moved = shuffleAttempts(room, 1, { tableTiles: 20 }).map((a) => a.moved);
  assert.equal(Math.min(...moved), 8, 'the cheapest way moves exactly 8 tiles');
  assert.equal(shuffleAttempts(room, 1, { tableTiles: 7 }).length, 0);
  assert.equal(chooseTurn(room, 1).type, 'draw', 'the Tidy AI in that seat draws');
});

test('one table tile can be taken from the end of a long run for a budget of 1, but not from its middle when that would break it', () => {
  const { room } = botRoom(['standard', 'shuffler-5']);
  // a group of 7s needs the blue 7 from the end of blue 4-7 (the run keeps 4-5-6)
  position(room, { racks: [[], [t(2, 7), t(3, 7)]], table: [[t(1, 4), t(1, 5), t(1, 6), t(1, 7)]], turn: 1, melded: [false, true] });
  const play = byId('shuffler-5').plan(room, 1);
  assert.ok(play);
  assert.equal(shuffleAttempts(room, 1, { tableTiles: 1 }).some((a) => a.value > 0), true);
  assert.equal(shuffleAttempts(room, 1, { tableTiles: 0 }).length, 0);
  // the middle tile of a 4-run cannot be taken without breaking it
  position(room, { racks: [[], [t(2, 5), t(3, 5)]], table: [[t(1, 4), t(1, 5), t(1, 6), t(1, 7)]], turn: 1, melded: [false, true] });
  assert.equal(byId('shuffler-5').plan(room, 1), null);
});

/** Positions met in games played by a mixture of AIs: every turn of a person who has already melded and has a rack. */
function samplePositions(games = 4) {
  const out = [];
  for (let g = 0; g < games; g++) {
    const { room, rng } = botRoom(['standard', 'shuffler-10', 'sharp'], { seed: 500 + g });
    let turns = 0;
    while (room.phase === 'playing' && turns++ < 400) {
      const seat = room.turn;
      if (room.melded[seat] && room.table.length >= 2) out.push({ room: structuredClone(room), seat });
      runPending(room, rng);
    }
  }
  return out;
}

test('higher budgets are never worse: whatever 5 finds, 10 finds at least as good, and 20 at least as good again', () => {
  const positions = samplePositions();
  assert.ok(positions.length > 40, `${positions.length} positions`);
  const sums = { 5: 0, 10: 0, 20: 0 };
  let strictly = 0;
  for (const { room, seat } of positions) {
    const values = [5, 10, 20].map((n) => byId(`shuffler-${n}`).plan(room, seat)?.value ?? 0);
    assert.ok(values[0] <= values[1] && values[1] <= values[2], `values ${values}`);
    if (values[2] > values[0]) strictly++;
    [5, 10, 20].forEach((n, i) => (sums[n] += values[i]));
    // and the result is the same when asked again: the cap is a node count, not the clock
    assert.deepEqual(byId('shuffler-20').plan(room, seat)?.table, byId('shuffler-20').plan(room, seat)?.table);
  }
  assert.ok(strictly > 0, 'some positions need the bigger budget');
  console.log(`# budget sweep over ${positions.length} positions: points played at 5/10/20 = ${sums[5]}/${sums[10]}/${sums[20]}; 20 beat 5 in ${strictly}`);
});

test('a turn is quick even on a huge table', () => {
  const { room, rng } = botRoom(['shuffler-20', 'sharp', 'standard'], { seed: 21, settings: { colours: 8, numbers: 20, wildcards: 8 } });
  const started = Date.now();
  for (let i = 0; i < 25 && room.phase === 'playing'; i++) runPending(room, rng);
  assert.ok(Date.now() - started < 30000, `${Date.now() - started}ms`);
  assertInvariants(room);
});

// ---- sharp ----

test('sharp keeps a joker back for a small play, but spends it to go out or when an opponent is nearly out', () => {
  const { room } = botRoom(['standard', 'sharp']);
  const base = { table: [[t(0, 4), t(0, 5), t(0, 6)]], turn: 1, melded: [true, true] };
  // the joker could extend the run, but the player has other tiles and nobody is close
  const others = Array.from({ length: 12 }, (_, i) => 52 + i);
  position(room, { ...base, racks: [others, [t(0, 1), t(2, 9), t(3, 2), J()]] });
  assert.ok(bestPlay(room, 1)?.added >= 1, 'the classic AI spends the joker on the run');
  assert.equal(byId('sharp').plan(room, 1), null, 'sharp draws instead');
  // an opponent with two tiles left: no holding back
  room.racks[0] = [t(3, 12, 1), t(3, 13, 1)];
  assert.ok(byId('sharp').plan(room, 1), 'now it plays the joker');
  // going out
  position(room, { ...base, racks: [others, [t(0, 7), J()]] });
  assert.equal(byId('sharp').plan(room, 1).added, 2, 'two tiles, the last ones, joker included');
});

test('sharp goes out when it can, using everything', () => {
  const { room } = botRoom(['standard', 'sharp']);
  position(room, {
    racks: [Array.from({ length: 6 }, (_, i) => 52 + i), [t(0, 1), t(0, 2), t(0, 3), t(1, 12), t(2, 12), t(3, 12), t(0, 8)]],
    table: [[t(0, 9), t(0, 10), t(0, 11)]],
    turn: 1,
    melded: [true, true],
  });
  assert.equal(byId('sharp').plan(room, 1).added, 7);
});

// ---- random ----

test('the random AI only ever plays legal moves, varies with its generator, and draws when it has none', () => {
  const { room } = botRoom(['standard', 'random']);
  position(room, {
    racks: [[], [t(0, 7), t(1, 7), t(2, 7), t(0, 1), t(0, 2), t(0, 3), t(3, 11), t(1, 13)]],
    table: [[t(3, 4), t(3, 5), t(3, 6)]],
    turn: 1,
    melded: [false, true],
  });
  const results = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const play = byId('random').plan(room, 1, { rng: seeded(seed) });
    assert.ok(play, 'a legal move exists');
    assert.equal(checkPlay(room.settings, { before: room.table, rack: room.racks[1], proposed: play.table, melded: true, meld: 30 }).ok, true);
    results.add(JSON.stringify(play.table));
  }
  assert.ok(results.size > 1, 'different seeds make different moves');
  position(room, { racks: [[], [t(0, 1), t(2, 8), t(3, 11)]], table: [[t(3, 4), t(3, 5), t(3, 6)]], turn: 1, melded: [false, true] });
  assert.equal(byId('random').plan(room, 1, { rng: seeded(1) }), null);
  position(room, { racks: [[], [t(0, 1), t(0, 2), t(0, 3), t(2, 8)]], turn: 1, melded: [false, false] });
  assert.equal(byId('random').plan(room, 1, { rng: seeded(1) }), null, 'a first meld must be worth 30');
});

// ---- a tournament ----

test('a seeded tournament: the random AI is clearly last (the numbers for the others are printed)', () => {
  const lineup = IDS;
  const stats = Object.fromEntries(lineup.map((id) => [id, { games: 0, wins: 0, tiles: 0, score: 0 }]));
  const seeds = 10;
  for (let seed = 1; seed <= seeds; seed++) {
    for (let rotation = 0; rotation < lineup.length; rotation++) {
      const order = lineup.map((_, i) => lineup[(i + rotation) % lineup.length]);
      const { room, rng } = botRoom(order, { seed: seed * 100 + rotation });
      playOut(room, rng, `tournament ${seed}/${rotation}`);
      order.forEach((id, i) => {
        const row = stats[id];
        row.games++;
        row.tiles += room.tally[i].tilesPlayed;
        row.score += room.scores[i];
        if (room.winners.includes(i)) row.wins += 1 / room.winners.length;
      });
    }
  }
  const table = lineup.map((id) => ({ id, win: +(stats[id].wins / stats[id].games).toFixed(3), tiles: +(stats[id].tiles / stats[id].games).toFixed(2), score: +(stats[id].score / stats[id].games).toFixed(1) }));
  console.log(`# tournament (${seeds * lineup.length} six-player games, every AI in every seat):\n${table.map((r) => `#   ${r.id.padEnd(12)} win ${r.win}  tiles ${r.tiles}  score ${r.score}`).join('\n')}`);
  const get = (id) => table.find((r) => r.id === id);
  for (const id of lineup.filter((x) => x !== 'random')) {
    assert.ok(get(id).tiles > get('random').tiles, `${id} plays more tiles than random`);
    assert.ok(get(id).score > get('random').score, `${id} scores more than random`);
    assert.ok(get(id).win > get('random').win, `${id} wins more than random`);
  }
  assert.ok(get('random').win < 0.1, 'random hardly ever wins against the others');
});

// ---- over the sockets ----

test('over the sockets each computer seat shows its AI, and a restart keeps it', async (t2) => {
  process.env.RUMMIKUB_BOT_DELAY = '1000-1000';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rummikub-ai-'));
  const first = await launchModule(t2, { id: 'rummikub', moduleDir: here, dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.call('create', { seats: 4 });
  await ann.call('fillBots');
  assert.equal(ann.state.seats[1].ai, undefined);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.phase === 'playing', 'the game to start');
  const named = ann.state.seats.map((s) => s.ai?.id);
  assert.equal(named[0], undefined);
  assert.ok(named.slice(1).every((id) => IDS.includes(id)), JSON.stringify(named));
  const cookie = ann.cookie;
  await sleep(300);
  await first.stop();
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'site', 'modules', 'rummikub', 'rooms.json'), 'utf8').toString());
  assert.deepEqual(saved[0].seats.slice(1).map((s) => s.ai), named.slice(1), 'the AIs are in the saved room');

  const second = await launchModule(t2, { id: 'rummikub', moduleDir: here, dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  assert.equal((await again.call('resume')).ok, true);
  await until(() => again.state?.phase, 'the saved game');
  assert.deepEqual(again.state.seats.map((s) => s.ai?.id), named, 'the same AIs after the restart');
});
