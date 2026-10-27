// Property-style tests for Tints and Hints at the rules level: hundreds of seeded random games, with random legal and
// illegal actions, joins and leaves, checking the invariants after every single action.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { COLS, ROWS, cellName, isCell, parseCell } from './grid.js';
import { seeded } from '../../shared/testkit.js';
import { checkRoom, checkView, readyAll, NEXT_PHASES } from './checks.js';

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const randomCell = (rng) => pick(rng, COLS) + pick(rng, ROWS);
const near = (cell, rng) => {
  const at = parseCell(cell);
  const col = Math.min(COLS.length - 1, Math.max(0, at.col + Math.floor(rng() * 3) - 1));
  const row = Math.min(ROWS.length - 1, Math.max(0, at.row + Math.floor(rng() * 3) - 1));
  return cellName(col, row);
};
const snapshot = (room) => JSON.stringify(room);

/** Plays one random game and returns what it saw. Every action is checked; an illegal one must change nothing. */
function playRandomGame(seed) {
  const rng = seeded(seed);
  let nextId = 1;
  const room = game.createRoom({ code: `game-${seed}-x`, hostId: nextId++, turnsEach: 1 + Math.floor(rng() * 5) });
  const log = [];
  let steps = 0;
  const check = (what) => {
    steps++;
    checkRoom(room, `seed ${seed} step ${steps} (${what})`);
    for (const p of room.players) {
      const view = game.viewFor(room, p.id, { nameOf: (id) => `p${id}` });
      checkView(view, `seed ${seed} step ${steps} view of ${p.id}`);
      const hinter = room.hinter === p.id;
      if (!hinter && room.phase.startsWith('guessing')) assert.ok(!JSON.stringify(view).includes(`"tint":"${room.tint}"`), 'the tint was in a guesser view');
    }
  };
  const illegal = (what, fn) => {
    const before = snapshot(room);
    const result = fn();
    assert.equal(result.ok, false, `seed ${seed}: ${what} should have failed`);
    assert.equal(typeof result.error, 'string');
    assert.equal(snapshot(room), before, `seed ${seed}: a refused ${what} changed the room`);
  };

  // The lobby: people come and go, choose colours, change the turns.
  const wanted = 2 + Math.floor(rng() * 7);
  for (let i = 1; i < wanted; i++) assert.equal(game.addPlayer(room, nextId++).ok, true);
  if (room.players.length === game.MAX_PLAYERS) illegal('a ninth player', () => game.addPlayer(room, 999));
  check('joined');
  for (let i = 0; i < 6; i++) {
    const p = pick(rng, room.players);
    const result = game.setColour(room, p.id, pick(rng, game.COLOURS));
    if (!result.ok) assert.match(result.error, /colour/i);
    check('colour');
  }
  illegal('a non-host changing the turns', () => game.setTurnsEach(room, 999, 2));
  illegal('turns out of range', () => game.setTurnsEach(room, room.hostId, 6));
  illegal('turns as a fraction', () => game.setTurnsEach(room, room.hostId, 2.5));
  assert.equal(game.setTurnsEach(room, room.hostId, 1 + Math.floor(rng() * 5)).ok, true);
  if (rng() < 0.3 && room.players.length > 2) {
    const leaver = pick(rng, room.players.filter((p) => p.id !== room.hostId));
    assert.equal(game.removePlayer(room, leaver.id, rng).ok, true);
    check('lobby leave');
  }
  illegal('a stranger starting', () => game.start(room, 999, rng));
  illegal('a guest starting', () => game.start(room, room.players.find((p) => p.id !== room.hostId).id, rng));
  assert.equal(game.start(room, room.hostId, rng).ok, true);
  check('start');
  illegal('a second start', () => game.start(room, room.hostId, rng));
  illegal('joining a started game', () => game.addPlayer(room, 1000));
  illegal('changing a colour in play', () => game.setColour(room, room.hostId, game.COLOURS[7]));

  let previous = room.phase;
  const turnsSeen = new Set();
  while (room.phase !== 'finished' && room.phase !== 'abandoned') {
    assert.ok(steps < 4000, `seed ${seed}: the game does not end`);
    turnsSeen.add(room.turn);
    const phase = room.phase;
    const roll = rng();
    const guessers = room.players.filter((p) => p.id !== room.hinter);
    if (roll < 0.004 && phase !== 'reveal') {
      const leaver = pick(rng, room.players);
      const result = game.removePlayer(room, leaver.id, rng);
      assert.equal(result.ok, true);
      log.push('leave');
      check('leave');
    } else if (roll < 0.01 && phase === 'reveal') {
      const leaver = pick(rng, room.players);
      assert.equal(game.removePlayer(room, leaver.id, rng).ok, true);
      check('leave at the reveal');
    } else if (roll < 0.2) {
      // A refused action of some kind.
      const stranger = 5000;
      const any = pick(rng, room.players);
      const choices = [
        () => game.guess(room, stranger, randomCell(rng)),
        () => game.guess(room, room.hinter, randomCell(rng)),
        () => game.guess(room, any.id, pick(rng, ['', 'a0', 'A', 'AW1', 'A25', 'AA', null, 5, ['A1']])),
        () => game.setHint(room, guessers[0]?.id ?? stranger, 'nope'),
        () => game.advance(room, stranger, rng),
        () => game.start(room, room.hostId, rng),
        () => game.setColour(room, any.id, game.COLOURS[0]),
        () => game.setTurnsEach(room, room.hostId, 3),
        () => game.addPlayer(room, 6000 + steps),
      ];
      const before = snapshot(room);
      const result = pick(rng, choices)();
      if (result.ok) assert.fail(`seed ${seed}: an illegal action succeeded in ${phase}`);
      assert.equal(snapshot(room), before);
    } else if (phase === 'guessing1' || phase === 'guessing2') {
      const list = phase === 'guessing1' ? room.first : room.second;
      const waiting = guessers.filter((p) => !list.some((g) => g.id === p.id));
      if (rng() < 0.4 && room.hinter) {
        assert.equal(game.setHint(room, room.hinter, `  a   hint ${'z'.repeat(Math.floor(rng() * 120))} `, ).ok, true);
        check('hint');
      } else if (waiting.length) {
        const who = pick(rng, waiting);
        const cell = rng() < 0.5 ? near(room.tint, rng) : randomCell(rng);
        assert.equal(game.guess(room, who.id, cell).ok, true);
        const again = game.guess(room, who.id, randomCell(rng));
        assert.equal(again.ok, false, 'a second guess in the same round');
        check('guess');
      } else {
        const wrongPerson = guessers[0]?.id;
        if (wrongPerson !== undefined) assert.equal(game.advance(room, wrongPerson, rng).ok, false);
        assert.equal(game.advance(room, room.hinter, rng).ok, true);
        check('advance');
      }
    } else if (phase === 'reveal') {
      illegal('advancing at the reveal', () => game.advance(room, pick(rng, room.players).id, rng));
      illegal('a stranger being ready', () => game.ready(room, 5000, rng));
      if (rng() < 0.15) assert.equal(game.forceNext(room, rng).ok, true);
      else assert.equal(game.ready(room, pick(rng, room.players).id, rng).ok, true);
      check('ready');
    }
    if (room.phase !== previous) {
      assert.ok(NEXT_PHASES[previous].includes(room.phase), `seed ${seed}: ${previous} -> ${room.phase}`);
      previous = room.phase;
    }
  }
  // Nothing more can be done once it has ended.
  const ended = room.phase;
  for (const p of room.players) {
    illegal('a guess after the end', () => game.guess(room, p.id, 'A1'));
    illegal('a hint after the end', () => game.setHint(room, p.id, 'late'));
    illegal('advancing after the end', () => game.advance(room, p.id, rng));
    illegal('starting again', () => game.start(room, p.id, rng));
  }
  assert.equal(room.phase, ended);
  if (ended === 'finished') {
    const standing = game.standings(room);
    assert.ok(standing.some((s) => s.winner));
    assert.equal(standing[0].placement, 1);
    const stats = game.statsPlayers(room);
    assert.equal(stats.length, room.players.length);
    assert.ok(stats.every((s) => s.score === room.players.find((p) => p.id === s.userId).score));
  }
  return { ended, turns: turnsSeen.size, players: wanted };
}

test('300 seeded random games with illegal actions, leavers and views: invariants hold after every action and every game ends', () => {
  const ends = { finished: 0, abandoned: 0 };
  for (let seed = 1; seed <= 300; seed++) ends[playRandomGame(seed).ended]++;
  assert.ok(ends.finished > 100, `plenty finish (${JSON.stringify(ends)})`);
  assert.ok(ends.abandoned > 5, `some are abandoned (${JSON.stringify(ends)})`);
});

test('random games without leavers always finish with exactly turnsEach turns per player, in joining order', () => {
  for (let seed = 1000; seed < 1100; seed++) {
    const rng = seeded(seed);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, turnsEach: 1 + Math.floor(rng() * 5) });
    const n = 2 + Math.floor(rng() * 7);
    for (let i = 2; i <= n; i++) game.addPlayer(room, i);
    game.start(room, 1, rng);
    const hinters = [];
    while (room.phase !== 'finished') {
      if (room.phase === 'reveal') {
        readyAll(game, room, rng);
        continue;
      }
      if (!hinters.length || (hinters.at(-1).turn !== room.turn)) hinters.push({ turn: room.turn, id: room.hinter });
      for (const p of room.players) if (p.id !== room.hinter) game.guess(room, p.id, randomCell(rng));
      game.advance(room, room.hinter, rng);
      checkRoom(room, `seed ${seed}`);
    }
    assert.equal(hinters.length, room.turnsEach * n);
    for (const p of room.players) assert.equal(hinters.filter((h) => h.id === p.id).length, room.turnsEach, `seed ${seed}`);
    hinters.forEach((h, i) => assert.equal(h.id, hinters[i % n].id, 'a fixed rotation'));
    assert.equal(room.history.length, room.turnsTotal);
    assert.ok(room.players.every((p) => p.hintsGiven === room.turnsEach));
  }
});

test('the tint is always a real square, whatever the random generator returns', () => {
  for (const value of [0, 0.5, 0.999999999, 1 - Number.EPSILON]) {
    const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
    game.addPlayer(room, 2);
    game.start(room, 1, () => value);
    assert.ok(isCell(room.tint), `${value} gave ${room.tint}`);
  }
});
