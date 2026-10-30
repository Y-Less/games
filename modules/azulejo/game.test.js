// The rules of Azulejo with no sockets: lobby, factories, bag and lid, taking and placing, the floor, the marker,
// wall-tiling and scoring, the end, bonuses, tie-breaks, the free wall, views and statistics.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { MARKER, bonuses, emptyWall, floorPenalty, wallColour, wallColumn } from './rules.js';
import { assertInvariants, playingRoom, seeded, setTable, setWall, viewLeaks } from './testing.js';

const SIZES = [2, 3, 4, 5];
const snapshot = (room) => JSON.stringify(room);
const failsAtomically = (room, action, pattern) => {
  const before = snapshot(room);
  const result = action();
  assert.equal(result.ok, false);
  if (pattern) assert.match(result.error, pattern);
  assert.equal(snapshot(room), before, 'a failed action changes nothing');
  return result;
};
const mk = (size = 4, extra = {}) => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size, ...extra });

/**
 * A started game of n people where seat 0 is to move and only one tile (colour `last`) is left, on factory 0. Taking it
 * ends the round. Lines, walls and floors are emptied for the caller to fill in.
 */
function endgame(n = 2, { free = false, last = 0, seed = 5 } = {}) {
  const { room, rng } = playingRoom(n, { seed, free });
  setTable(room, { factories: [[last]], centre: [], marker: false, turn: 0, bag: game.makeBag(rng), lid: [] });
  room.bag.splice(0, 60); // a smaller bag; conservation is not checked in these hand-built positions
  room.lines.forEach((ls, seat) => ls.forEach((_, i) => (room.lines[seat][i] = { colour: null, count: 0 })));
  room.walls.forEach((_, seat) => (room.walls[seat] = emptyWall()));
  room.floors.forEach((_, seat) => (room.floors[seat] = []));
  room.scores = Array(n).fill(0);
  return { room, rng };
}
const finishRound = (room, rng, move = { source: 0, colour: room.factories[0][0], line: 3 }) => {
  const result = game.takeTiles(room, room.turn, move, rng);
  assert.equal(result.ok, true, result.error);
};

// ---- the lobby ----

test('creating a room: sizes 2 to 5 only, the host in seat 0, free wall off by default', () => {
  for (const size of SIZES) {
    const room = mk(size, { hostId: 7, hostName: 'Host' });
    assert.equal(room.seats.length, size);
    assert.deepEqual(room.seats[0], { kind: 'human', id: 7, name: 'Host' });
    assert.ok(room.seats.slice(1).every((s) => s === null));
    assert.equal(room.phase, 'lobby');
    assert.deepEqual(room.settings, { freeWall: false });
  }
  assert.equal(game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'H' }).size, 4, 'four by default');
  for (const bad of [1, 6, 0, -1, 2.5, '3', null, NaN]) assert.throws(() => mk(bad));
  assert.throws(() => mk(3, { settings: { freeWall: 'yes' } }));
  assert.equal(mk(3, { settings: { freeWall: true } }).settings.freeWall, true);
});

test('seat count and the free wall option: only the host, only in the lobby, keeping everyone seated', () => {
  const room = mk(5);
  assert.equal(game.addHuman(room, 2, 'B').ok, true);
  assert.equal(game.setSize(room, 2, 3).ok, false, 'not the host');
  assert.equal(game.setSize(room, 1, 3).ok, true);
  assert.equal(room.seats.length, 3);
  assert.equal(game.setSize(room, 1, 2).ok, true);
  assert.equal(game.addHuman(room, 3, 'C').ok, false, 'full');
  assert.equal(game.setSize(room, 1, 1).ok, false);
  assert.equal(game.setSize(room, 1, 6).ok, false);
  assert.equal(game.setSize(room, 1, '4').ok, false);
  assert.equal(game.setSettings(room, 2, { freeWall: true }).ok, false);
  assert.equal(game.setSettings(room, 1, { freeWall: 1 }).ok, false);
  assert.equal(room.settings.freeWall, false);
  assert.equal(game.setSettings(room, 1, { freeWall: true }).ok, true);
  assert.equal(room.settings.freeWall, true);
  assert.equal(game.setSettings(room, 1, {}).ok, true, 'nothing to change');
  assert.equal(room.settings.freeWall, true);
  game.addBot(room, 1);
  assert.equal(game.setSize(room, 1, 5).ok, true);
  assert.deepEqual(game.viewFor(room, 1).scoreboard.players.map((p) => p.bot), room.seats.filter(Boolean).map((s) => s.kind === 'bot'), 'the scoreboard marks computer players');
  assert.equal(game.start(room, 1).ok, false, 'empty seats');
  game.fillWithBots(room, 1);
  assert.equal(game.start(room, 1).ok, true);
  assert.equal(game.setSize(room, 1, 3).ok, false, 'after the start');
  assert.equal(game.setSettings(room, 1, { freeWall: false }).ok, false, 'after the start');
});

test('computer players: add, remove, fill; the game needs one person', () => {
  const room = mk(3);
  assert.equal(game.addBot(room, 2).ok, false, 'only the host');
  assert.equal(game.addBot(room, 1, 5).ok, false);
  assert.equal(game.addBot(room, 1, 0).ok, false, 'taken');
  assert.equal(game.addBot(room, 1, 'x').ok, false);
  assert.equal(game.addBot(room, 1, 1).ok, true);
  assert.equal(room.seats[1].kind, 'bot');
  assert.match(room.seats[1].id, /^bot:\d+$/);
  assert.equal(game.removeBot(room, 1, 0).ok, false, 'a person');
  assert.equal(game.removeBot(room, 1, 1).ok, true);
  assert.equal(room.seats[1], null);
  assert.equal(game.fillWithBots(room, 1).ok, true);
  assert.equal(new Set(room.seats.map((s) => s.name)).size, 3, 'distinct names');
  assert.equal(game.addBot(room, 1).ok, false, 'every seat is taken');
  const bots = game.createRoom({ code: 'x-y-z', hostId: 1, hostName: 'A', size: 2 });
  game.addBot(bots, 1);
  bots.seats[0] = bots.seats[1];
  bots.seats[1] = { kind: 'bot', id: 'bot:9', name: 'B' };
  assert.equal(game.start(bots, 1).ok, false, 'no person seated');
});

test('names: duplicates become Sam, Sam (2), Sam (3)', () => {
  const room = mk(4, { hostName: 'Sam' });
  room.seats[0].name = 'Sam';
  game.addHuman(room, 2, 'Sam');
  game.addHuman(room, 3, 'Sam');
  assert.deepEqual(room.seats.filter(Boolean).map((s) => s.name), ['Sam', 'Sam (2)', 'Sam (3)']);
});

test('kick: host only, a person other than yourself; mid-game a computer player takes over', () => {
  const room = mk(3);
  game.addHuman(room, 2, 'B');
  game.addBot(room, 1);
  assert.equal(game.kick(room, 2, 0).ok, false);
  assert.equal(game.kick(room, 1, 0).ok, false, 'not yourself');
  assert.equal(game.kick(room, 1, 2).ok, false, 'a computer player is removed, not kicked');
  assert.equal(game.kick(room, 1, 7).ok, false);
  assert.equal(game.kick(room, 1, 'x').ok, false);
  const done = game.kick(room, 1, 1);
  assert.equal(done.ok, true);
  assert.equal(done.userId, 2);
  assert.equal(room.seats[1], null);
  game.addHuman(room, 2, 'B');
  game.fillWithBots(room, 1);
  game.start(room, 1);
  const at = room.seats.findIndex((s) => s.id === 2); // the seats are shuffled when the game starts
  assert.equal(game.kick(room, 2, at).ok, false, 'still only the host');
  const mid = game.kick(room, 1, at);
  assert.deepEqual([mid.ok, mid.userId, mid.replaced], [true, 2, true]);
  assert.equal(room.seats[at].kind, 'bot', 'a computer player took the seat');
  assert.equal(room.seats.every(Boolean), true);
  assert.equal(game.kick(room, 1, at).ok, false, 'and it is not a person to kick');
  assert.equal(game.removeBot(room, 1, at).ok, false, 'nor can it be removed from a game that has started');
  room.phase = 'finished';
  assert.equal(game.kick(room, 1, room.seats.findIndex((s) => s.kind === 'human' && s.id !== 1)).ok, false, 'nobody to remove once it is over');
});

test('removing a human: the seat is freed in the lobby, a computer takes over mid-game, the host passes on', () => {
  const room = mk(3);
  game.addHuman(room, 2, 'B');
  game.addHuman(room, 3, 'C');
  assert.equal(game.removeHuman(room, 99).ok, false);
  assert.equal(game.removeHuman(room, 2).replaced, false);
  assert.equal(room.seats[1], null);
  game.addHuman(room, 2, 'B');
  game.start(room, 1);
  const left = game.removeHuman(room, 1);
  assert.equal(left.ok, true);
  assert.equal(left.replaced, true);
  assert.equal(room.seats[0].kind, 'bot');
  assert.equal(room.hostId, 2, 'the next person hosts');
  assert.equal(game.removeHuman(room, 2).empty, false);
  assert.equal(game.removeHuman(room, 3).empty, true, 'nobody left');
});

// ---- the start of a round ----

test('factory displays: 2n + 1 of them, four tiles each, drawn from a bag of 100 (20 of each colour)', () => {
  assert.deepEqual(SIZES.map(game.factoryCount), [5, 7, 9, 11]);
  for (const n of SIZES) {
    const { room } = playingRoom(n, { seed: n });
    assert.equal(room.factories.length, 2 * n + 1);
    assert.ok(room.factories.every((f) => f.length === 4), `n=${n}: four tiles on every factory`);
    assert.equal(room.bag.length, 100 - 4 * (2 * n + 1));
    assert.equal(room.lid.length, 0);
    assert.deepEqual(room.centre, []);
    assert.equal(room.markerInCentre, true);
    assert.equal(room.round, 1);
    assert.equal(room.turn, room.first);
    assertInvariants(room, `n=${n}`);
  }
  const bag = game.makeBag();
  assert.equal(bag.length, 100);
  for (const c of [0, 1, 2, 3, 4]) assert.equal(bag.filter((x) => x === c).length, 20);
  assert.notDeepEqual(game.makeBag(seeded(1)), game.makeBag(seeded(2)), 'a random order');
  assert.deepEqual(game.makeBag(seeded(7)), game.makeBag(seeded(7)), 'the same seed, the same bag');
});

test('the first player of the first round is chosen at random', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 60; seed++) firsts.add(playingRoom(4, { seed }).room.first);
  assert.ok(firsts.size >= 3, `seats seen: ${[...firsts]}`);
  assert.ok([...firsts].every((s) => s >= 0 && s < 4));
});

test('when the bag runs out the lid is shuffled back in; if both run out play goes on with what there is', () => {
  // The last tile is taken: the new round is dealt from a bag of 3 and a lid of 40.
  const { room, rng } = endgame(2);
  room.bag = [1, 1, 1];
  room.lid = Array.from({ length: 40 }, (_, i) => i % 5);
  finishRound(room, rng);
  assert.equal(room.round, 2);
  assert.ok(room.factories.every((f) => f.length === 4), 'every factory filled from the refilled bag');
  assert.equal(room.bag.length + room.lid.length + room.factories.flat().length, 43 + 0, 'no tile lost or made (the tile taken is on a line)');
  assert.equal(room.lid.length, 0, 'the lid went into the bag');
  assert.equal(room.bag.length, 23);

  // Not enough for everything: 5 tiles in all for five factories of four.
  const poor = endgame(2);
  poor.room.bag = [2, 2];
  poor.room.lid = [3, 3, 3];
  finishRound(poor.room, poor.rng);
  assert.equal(poor.room.round, 2);
  assert.equal(poor.room.factories.flat().length, 5);
  assert.deepEqual(poor.room.factories.map((f) => f.length), [4, 1, 0, 0, 0], 'filled in order, then play on with what there is');
  assert.equal(poor.room.bag.length + poor.room.lid.length, 0);

  // Nothing at all to deal (every tile on a board): the game ends instead of looping.
  const none = endgame(2);
  none.room.bag = [];
  none.room.lid = [];
  finishRound(none.room, none.rng);
  assert.equal(none.room.phase, 'finished');
  assert.equal(none.room.round, 1);
  assert.equal(none.room.history.at(-1).label, 'Bonuses');
});

// ---- taking tiles ----

test('every illegal take is refused, atomically, with a sentence that gives nothing away', () => {
  const { room } = playingRoom(3, { seed: 4 });
  setTable(room, { factories: [[0, 0, 1, 2], [3, 3, 3, 4], [1, 1, 2, 2]], centre: [4, 4], turn: 0 });
  const take = (seat, args) => () => game.takeTiles(room, seat, args);
  failsAtomically(room, take(1, { source: 0, colour: 0, line: 0 }), /not your turn/);
  failsAtomically(room, take(0, { source: 9, colour: 0, line: 0 }), /factory display or the centre/);
  failsAtomically(room, take(0, { source: -1, colour: 0, line: 0 }), /factory display or the centre/);
  failsAtomically(room, take(0, { source: 'x', colour: 0, line: 0 }), /factory display or the centre/);
  failsAtomically(room, take(0, { source: 0.5, colour: 0, line: 0 }), /factory display or the centre/);
  failsAtomically(room, take(0, { source: 0, colour: 5, line: 0 }), /Choose a colour/);
  failsAtomically(room, take(0, { source: 0, colour: '0', line: 0 }), /Choose a colour/);
  failsAtomically(room, take(0, { source: 0, colour: 3, line: 0 }), /no Verdigris in factory 1/);
  failsAtomically(room, take(0, { source: 'centre', colour: 0, line: 0 }), /no Cobalt in the centre/);
  failsAtomically(room, take(0, { source: 0, colour: 0, line: 5 }), /no such pattern line/);
  failsAtomically(room, take(0, { source: 0, colour: 0, line: -1 }), /no such pattern line/);
  failsAtomically(room, take(0, { source: 0, colour: 0, line: 'floors' }), /no such pattern line/);
  failsAtomically(room, take(0, { source: 0, colour: 0 }), /no such pattern line/);
  failsAtomically(room, () => game.takeTiles(room, 0, null), /factory display or the centre/);
  failsAtomically(room, () => game.takeTiles(room, 0, 'x'), /factory display or the centre/);
  failsAtomically(room, () => game.takeTiles(room, 7, { source: 0, colour: 0, line: 0 }), /not your turn/);
  room.phase = 'finished';
  failsAtomically(room, take(0, { source: 0, colour: 0, line: 0 }), /not being played/);
  room.phase = 'lobby';
  failsAtomically(room, take(0, { source: 0, colour: 0, line: 0 }), /not being played/);
});

test('placing: empty or same colour only, not on a full line, not where the wall row has the colour', () => {
  const { room } = playingRoom(2, { seed: 4 });
  setTable(room, { factories: [[0, 0, 1, 1], [2, 2, 2, 2]], centre: [], turn: 0 });
  room.lines[0][1] = { colour: 1, count: 1 };
  room.lines[0][2] = { colour: 0, count: 3 };
  room.walls[0][3][wallColumn(3, 2)] = 2; // colour 2 already in wall row 4 (index 3)
  const take = (args) => () => game.takeTiles(room, 0, args);
  failsAtomically(room, take({ source: 0, colour: 0, line: 1 }), /Line 2 already holds Saffron/);
  failsAtomically(room, take({ source: 0, colour: 1, line: 2 }), /Line 3 is already full|Line 3 already holds Cobalt/);
  failsAtomically(room, take({ source: 0, colour: 0, line: 2 }), /already full/);
  failsAtomically(room, take({ source: 1, colour: 2, line: 3 }), /Row 4 of your wall already has Terracotta/);
  assert.equal(game.legalMoves(room, 0).some((m) => m.source === 1 && m.colour === 2 && m.line === 3), false);
  assert.equal(game.legalMoves(room, 0).some((m) => m.source === 1 && m.colour === 2 && m.line === 'floor'), true, 'the floor is always legal');
  assert.equal(game.takeTiles(room, 0, { source: 1, colour: 2, line: 4 }).ok, true, 'but another line is fine');
  assert.deepEqual(room.lines[0][4], { colour: 2, count: 4 });
});

test('legal moves: the floor is always available and every pattern line is checked', () => {
  const { room } = playingRoom(2, { seed: 9 });
  const moves = game.legalMoves(room, room.turn);
  const sourceColours = new Set(room.factories.flatMap((f, i) => [...new Set(f)].map((c) => `${i}:${c}`)));
  assert.equal(moves.length, sourceColours.size * 6, 'five lines and the floor for every group on an empty board');
  assert.deepEqual(game.legalMoves(room, (room.turn + 1) % 2), [], 'nothing off-turn');
  for (const m of moves) assert.equal(snapshotApply(room, m), true);
});
function snapshotApply(room, move) {
  const copy = structuredClone(room);
  return game.takeTiles(copy, copy.turn, move, seeded(1)).ok;
}

test('taking from a factory slides the rest to the centre; taking from the centre takes one colour only', () => {
  const { room } = playingRoom(2, { seed: 4 });
  setTable(room, { factories: [[0, 0, 1, 2], [3, 3, 3, 4]], centre: [], turn: 0 });
  assert.equal(game.takeTiles(room, 0, { source: 0, colour: 0, line: 1 }).ok, true);
  assert.deepEqual(room.factories[0], []);
  assert.deepEqual(room.centre, [1, 2], 'the rest slide to the centre');
  assert.deepEqual(room.lines[0][1], { colour: 0, count: 2 });
  assert.equal(room.turn, 1);
  assert.equal(game.takeTiles(room, 1, { source: 1, colour: 3, line: 2 }).ok, true);
  assert.deepEqual(room.centre, [1, 2, 4]);
  assert.deepEqual(room.factories[1], []);
  assert.equal(game.takeTiles(room, 0, { source: 'centre', colour: 2, line: 0 }).ok, true);
  assert.deepEqual(room.centre, [1, 4], 'only the Terracotta left the centre');
  assert.equal(room.turn, 1);
});

test('overflow: tiles that do not fit go to the floor, in slot order, past the seventh to the lid', () => {
  const { room } = playingRoom(2, { seed: 4 });
  setTable(room, { factories: [[2, 2, 2, 2], [1, 1, 1, 1], [4]], centre: [], turn: 0, lid: [] });
  assert.equal(game.takeTiles(room, 0, { source: 0, colour: 2, line: 1 }).ok, true, 'two fit on line 2');
  assert.deepEqual(room.lines[0][1], { colour: 2, count: 2 });
  assert.deepEqual(room.floors[0], [2, 2]);
  assert.equal(floorPenalty(room.floors[0]), 2);
  assert.equal(game.takeTiles(room, 1, { source: 1, colour: 1, line: 'floor' }).ok, true, 'all to the floor, by choice');
  assert.deepEqual(room.floors[1], [1, 1, 1, 1]);
  assert.deepEqual(room.lines[1].map((l) => l.count), [0, 0, 0, 0, 0]);
  // Seven slots, then the lid.
  const full = playingRoom(2, { seed: 4 });
  setTable(full.room, { factories: [[3, 3, 3, 3], [3, 3, 3, 3], [4]], centre: [], turn: 0, lid: [] });
  full.room.floors[0] = [0, 0, 0, 0, 0];
  assert.equal(game.takeTiles(full.room, 0, { source: 0, colour: 3, line: 'floor' }).ok, true);
  assert.equal(full.room.floors[0].length, 7, 'seven slots at most');
  assert.deepEqual(full.room.lid, [3, 3], 'the other two went to the lid');
  assert.equal(floorPenalty(full.room.floors[0]), 14, 'and cost nothing more');
});

test('a full pattern line takes no more tiles, even of its own colour', () => {
  const { room } = playingRoom(2, { seed: 4 });
  setTable(room, { factories: [[1, 1, 0, 0]], centre: [], turn: 0 });
  room.lines[0][1] = { colour: 1, count: 2 };
  failsAtomically(room, () => game.takeTiles(room, 0, { source: 0, colour: 1, line: 1 }), /already full/);
  assert.equal(game.takeTiles(room, 0, { source: 0, colour: 1, line: 'floor' }).ok, true);
});

// ---- the first-player marker ----

test('the marker: the first take from the centre takes it onto the floor line, and that player starts the next round', () => {
  const { room, rng } = endgame(3);
  room.factories = [[0, 0, 1, 1], [4], [], [], [], [], []];
  room.markerInCentre = true;
  room.first = 0;
  room.turn = 0;
  assert.equal(game.takeTiles(room, 0, { source: 0, colour: 0, line: 1 }).ok, true);
  assert.equal(room.markerInCentre, true, 'taking from a factory does not take the marker');
  assert.deepEqual(room.floors[0], []);
  const taken = game.takeTiles(room, 1, { source: 'centre', colour: 1, line: 1 });
  assert.equal(taken.ok, true);
  assert.equal(room.markerInCentre, false);
  assert.deepEqual(room.floors[1], [MARKER], 'the marker is a penalty tile on the floor');
  assert.equal(room.nextFirst, 1);
  assert.equal(room.turn, 2);
  assert.equal(game.takeTiles(room, 2, { source: 1, colour: 4, line: 'floor' }).ok, true);
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 2);
  assert.equal(room.first, 1, 'seat 1 starts round 2');
  assert.equal(room.turn, 1);
  assert.equal(room.markerInCentre, true, 'the marker is back in the centre');
  assert.deepEqual(room.floors[1], [], 'and the floor line was emptied');
  // Seat 0 and seat 1 each completed line 2 (1 point) and seat 1 lost 1 for the marker; seat 2 lost 1 for the tile.
  assert.deepEqual(room.history[0].deltas, { 0: 1, 1: 0, 2: 0 });
  assert.equal(room.history[0].notes[1], 'floor -1');
});

test('only the first player to take from the centre gets the marker', () => {
  const { room } = playingRoom(3, { seed: 2 });
  setTable(room, { factories: [[0, 1, 1, 1]], centre: [2, 2, 3, 3], turn: 0 });
  assert.equal(game.takeTiles(room, 0, { source: 'centre', colour: 2, line: 'floor' }).ok, true);
  assert.deepEqual(room.floors[0], [MARKER, 2, 2]);
  assert.equal(game.takeTiles(room, 1, { source: 'centre', colour: 3, line: 'floor' }).ok, true);
  assert.deepEqual(room.floors[1], [3, 3], 'no marker for the second');
  assert.equal(room.nextFirst, 0);
});

test('the marker with a full floor line costs nothing but still makes the taker first next round', () => {
  const { room, rng } = endgame(2);
  room.centre = [0];
  room.factories = [[], [], [], [], []];
  room.markerInCentre = true;
  room.turn = 1;
  room.floors[1] = [2, 2, 2, 2, 2, 2, 2];
  assert.equal(game.takeTiles(room, 1, { source: 'centre', colour: 0, line: 'floor' }).ok, true);
  assert.equal(room.round, 2, 'the round ended and the next began');
  assert.equal(room.first, 1);
  assert.deepEqual(room.history[0].deltas[1], 0, 'floor penalties on a score of zero change nothing');
  assert.equal(room.lid.filter((c) => c === 0).length, 1, 'the extra tile went to the lid');
  assert.equal(room.lid.filter((c) => c === 2).length, 7);
  assert.equal(game.tileCount(room) - room.bag.length - room.factories.flat().length, 8);
});

test('if nobody takes from the centre the first player stays the same', () => {
  const { room, rng } = endgame(2);
  room.first = 1;
  room.turn = 0;
  finishRound(room, rng, { source: 0, colour: 0, line: 3 });
  assert.equal(room.round, 2);
  assert.equal(room.first, 1);
  assert.equal(room.turn, 1);
});

// ---- wall-tiling ----

test('wall-tiling: full lines move their rightmost tile to the wall, score, the rest go to the lid, partial lines stay', () => {
  const { room, rng } = endgame(2, { last: 3 });
  setWall(room, 0, ['.....', '.X...', '.....', '.....', '.....']); // (1,1) is colour 0
  room.lines[0][0] = { colour: 1, count: 1 }; // -> (0,1), above (1,1)
  room.lines[0][2] = { colour: 4, count: 3 }; // -> (2, wallColumn(2,4) = 1), below (1,1)
  room.lines[0][4] = { colour: 0, count: 3 }; // not full: stays
  room.floors[0] = [0, 1, 2];
  room.scores[0] = 3;
  room.lines[1][0] = { colour: 0, count: 1 }; // -> (0,0)
  room.floors[1] = [0, 0, 0, 0]; // -1 -1 -2 -2 = -6
  room.scores[1] = 1;
  finishRound(room, rng);
  assert.equal(room.walls[0][0][1], 1);
  assert.equal(room.walls[0][2][1], 4);
  // (0,1): column only (with (1,1)) = 2. (2,1): the column (0,1),(1,1),(2,1) = 3. Row 4 line is not full.
  // 3 + 2 + 3 - 4 = 4
  assert.equal(room.scores[0], 4);
  assert.deepEqual(room.lines[0][4], { colour: 0, count: 3 }, 'an incomplete line keeps its tiles');
  assert.deepEqual(room.lines[0][3], { colour: 3, count: 1 }, 'including the one just placed');
  assert.deepEqual(room.lines[0][0], { colour: null, count: 0 });
  assert.deepEqual(room.lines[0][2], { colour: null, count: 0 });
  assert.equal(room.walls[1][0][0], 0);
  assert.equal(room.scores[1], 0, 'never below zero: 1 + 1 - 6');
  assert.deepEqual(room.floors, [[], []], 'the floors are emptied');
  // Lid: two Plum from line 3, the floor tiles 0,1,2 and 0,0,0,0.
  const counts = [0, 1, 2, 3, 4].map((c) => room.lid.filter((x) => x === c).length);
  assert.deepEqual(counts, [1 + 4, 1, 1, 0, 2]);
  assert.deepEqual(room.history[0], { label: 'Round 1', deltas: { 0: 1, 1: -1 }, notes: { 0: 'floor -4', 1: 'floor -2' } });
  assert.deepEqual(room.tally.map((t) => t.floorPenalties), [4, 2], 'points actually lost to the floor');
  assert.equal(room.round, 2);
  assert.equal(room.phase, 'playing');
});

test('wall-tiling scores in order from the top: a lower tile counts the tile just placed above it', () => {
  const { room, rng } = endgame(2);
  room.lines[0][0] = { colour: 0, count: 1 }; // (0,0)
  room.lines[0][1] = { colour: 4, count: 2 }; // (1, wallColumn(1,4) = 0): directly below
  room.lines[0][2] = { colour: 3, count: 3 }; // (2, wallColumn(2,3) = 0): below again
  finishRound(room, rng);
  assert.equal(room.walls[0][0][0], 0);
  assert.equal(room.walls[0][1][0], 4);
  assert.equal(room.walls[0][2][0], 3);
  assert.equal(room.scores[0], 1 + 2 + 3, 'a chain growing down the column: 1, 2, 3');
});

test('scores in the wall-tiling: isolated, row only, column only, both and a long chain, on one wall', () => {
  const { room, rng } = endgame(2);
  // Row 0: (0,0)(0,1) filled, (0,2) placed -> a row run of three (no column neighbour).
  // Row 3: (3,4) placed, (2,4) above filled and (4,4) below filled -> column of three, nothing beside.
  setWall(room, 0, ['XX...', '.....', '....X', '.....', '....X']);
  room.lines[0][0] = { colour: wallColour(0, 2), count: 1 };
  room.lines[0][3] = { colour: wallColour(3, 4), count: 4 };
  finishRound(room, rng, { source: 0, colour: 0, line: 'floor' });
  // Row-only: 3. Column-only: 3. Floor: -1 (the tile taken).
  assert.equal(room.scores[0], 3 + 3 - 1);
  const both = endgame(2, { last: 3 });
  // (2,2) placed with (2,1),(2,3) beside it and (1,2),(3,2) above and below: row of 3 + column of 3 = 6.
  setWall(both.room, 0, ['.....', '..X..', '.X.X.', '..X..', '.....']);
  both.room.lines[0][2] = { colour: wallColour(2, 2), count: 3 };
  finishRound(both.room, both.rng, { source: 0, colour: 3, line: 4 });
  assert.equal(both.room.scores[0], 6 - 0);
  const isolated = endgame(2, { last: 0 });
  setWall(isolated.room, 0, ['.....', '.....', '..X..', '.....', '.X...']);
  isolated.room.lines[0][4] = { colour: wallColour(4, 3), count: 5 };
  isolated.room.lines[0][1] = { colour: wallColour(1, 4), count: 2 };
  finishRound(isolated.room, isolated.rng, { source: 0, colour: 0, line: 3 });
  assert.equal(isolated.room.scores[0], 1 + 1, 'two lone tiles score 1 each; diagonals do not touch');
});

test('the score never goes below 0, and the history records the change actually made', () => {
  const { room, rng } = endgame(2);
  room.scores = [2, 0];
  room.floors[0] = [0, 0, 0, 0, 0, 0, 0]; // -14
  room.floors[1] = [0];
  finishRound(room, rng);
  assert.deepEqual(room.scores, [0, 0]);
  assert.deepEqual(room.history[0].deltas, { 0: -2, 1: 0 });
  assert.deepEqual(room.history[0].notes, { 0: 'floor -2', 1: 'floor -0' });
});

test('wall-tiling with several lines gives each its place by colour on the fixed wall', () => {
  const { room, rng } = endgame(2);
  for (let row = 0; row < 5; row++) room.lines[0][row] = { colour: (row * 2) % 5, count: row + 1 };
  finishRound(room, rng, { source: 0, colour: 0, line: 'floor' });
  for (let row = 0; row < 5; row++) assert.equal(room.walls[0][row][wallColumn(row, (row * 2) % 5)], (row * 2) % 5);
  assert.equal(room.walls[0].flat().filter((c) => c !== null).length, 5);
  assert.equal(room.lid.length, 10 + 1, 'one tile of each line stays on the wall; the rest and the floor tile went to the lid');
});

// ---- the end of the game ----

test('the game does not end while no row is complete, and ends after the round in which one is', () => {
  const { room, rng } = endgame(2);
  setWall(room, 0, ['XXX..', '.....', '.....', '.....', '.....']);
  room.lines[0][0] = { colour: wallColour(0, 3), count: 1 }; // row 1 has four: not complete
  finishRound(room, rng);
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 2);

  const done = endgame(2);
  setWall(done.room, 0, ['XXXX.', '.....', '.....', '.....', '.....']);
  done.room.lines[0][0] = { colour: wallColour(0, 4), count: 1 };
  done.room.scores = [4, 4];
  finishRound(done.room, done.rng);
  assert.equal(done.room.phase, 'finished');
  assert.equal(done.room.round, 1);
  // The tile scores 5, the row bonus is +2.
  assert.deepEqual(done.room.scores, [4 + 5 + 2, 4]);
  assert.deepEqual(done.room.history.map((h) => h.label), ['Round 1', 'Bonuses']);
  assert.deepEqual(done.room.history[0].deltas, { 0: 5, 1: 0 });
  assert.equal(done.room.history[0].notes[0], 'row complete');
  assert.deepEqual(done.room.history[1].deltas, { 0: 2, 1: 0 });
  assert.equal(done.room.history[1].notes[0], '1 row');
  assert.equal(done.room.history[1].notes[1], 'no bonuses');
  assert.deepEqual(done.room.winners, [0]);
  assert.equal(done.room.turn, null);
  assert.equal(game.takeTiles(done.room, 0, { source: 0, colour: 0, line: 0 }).ok, false, 'no moves after the end');
});

test('the game ends when two players complete rows in the same round, and a row already complete counts', () => {
  const { room, rng } = endgame(3);
  setWall(room, 0, ['XXXX.', '.....', '.....', '.....', '.....']);
  setWall(room, 2, ['.....', '.....', '.....', '.....', 'X.XXX']);
  room.lines[0][0] = { colour: wallColour(0, 4), count: 1 };
  room.lines[2][4] = { colour: wallColour(4, 1), count: 5 };
  finishRound(room, rng);
  assert.equal(room.phase, 'finished');
  assert.equal(room.history[0].notes[0], 'row complete');
  assert.equal(room.history[0].notes[2], 'row complete');
  assert.equal(room.final.players[0].rows, 1);
  assert.equal(room.final.players[2].rows, 1);
});

test('end-of-game bonuses: +2 per row, +7 per column, +10 per colour: a full wall earns all of them', () => {
  const { room, rng } = endgame(2);
  setWall(room, 0, ['.XXXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  room.lines[0][0] = { colour: wallColour(0, 0), count: 1 };
  room.scores[0] = 20;
  room.turn = 1;
  finishRound(room, rng);
  // (0,0) joins a full row and a full column: 5 + 5 = 10.
  assert.equal(room.history[0].deltas[0], 10);
  assert.deepEqual(room.final.players[0], { seat: 0, name: 'p1', before: 30, rows: 5, columns: 5, sets: 5, bonus: 2 * 5 + 7 * 5 + 10 * 5, total: 30 + 95, placement: 1 });
  assert.equal(room.scores[0], 125);
  assert.equal(room.history[1].notes[0], '5 rows, 5 columns, 5 colour sets');
});

test('bonuses from columns and colour sets alone', () => {
  const { room, rng } = endgame(2);
  // Colour 3 on its diagonal in rows 0-3 plus row 4 by a line; row 0 gets a fifth tile by a line so the game ends.
  setWall(room, 0, ['XXXX.', '....X', 'X....', '.X...', '.....']);
  room.lines[0][0] = { colour: wallColour(0, 4), count: 1 };
  room.lines[0][4] = { colour: 3, count: 5 };
  finishRound(room, rng, { source: 0, colour: 0, line: 3 });
  // Row 0: (0,4): row of five + column with (1,4): 5 + 2 = 7. Row 5: (4,2) is alone: 1.
  assert.equal(room.history[0].deltas[0], 8);
  assert.deepEqual(bonuses(room.walls[0]), { rows: 1, columns: 0, sets: 1, points: 12 });
  assert.equal(room.scores[0], 8 + 12);
});

test('tie-breaks: the highest score, then the most complete rows, then a shared win', () => {
  // Same total, seat 1 has two complete rows against one.
  const { room, rng } = endgame(3);
  setWall(room, 0, ['XXXX.', '.....', '.....', '.....', '.....']);
  setWall(room, 1, ['XXXXX', 'XXXXX', '.....', '.....', '.....']);
  room.lines[0][0] = { colour: wallColour(0, 4), count: 1 };
  room.scores = [10, 13, 0];
  finishRound(room, rng);
  assert.deepEqual(room.scores, [10 + 5 + 2, 13 + 4, 0]);
  assert.deepEqual(room.winners, [1], 'two rows beat one at the same score');
  assert.deepEqual(room.final.players.map((p) => p.placement), [2, 1, 3]);

  // Same score and the same number of rows: they share the win.
  const shared = endgame(3);
  setWall(shared.room, 0, ['XXXX.', '.....', '.....', '.....', '.....']);
  setWall(shared.room, 1, ['XXXXX', '.....', '.....', '.....', '.....']);
  shared.room.lines[0][0] = { colour: wallColour(0, 4), count: 1 };
  shared.room.scores = [5, 10, 2];
  finishRound(shared.room, shared.rng);
  assert.deepEqual(shared.room.scores, [12, 12, 2]);
  assert.deepEqual(shared.room.winners, [0, 1]);
  assert.deepEqual(shared.room.final.players.map((p) => p.placement), [1, 1, 3]);

  // A higher score wins whatever the rows.
  const high = endgame(2);
  setWall(high.room, 0, ['XXXX.', '.....', '.....', '.....', '.....']);
  setWall(high.room, 1, ['XXXXX', 'XXXXX', 'XXXXX', '.....', '.....']);
  high.room.lines[0][0] = { colour: wallColour(0, 4), count: 1 };
  high.room.scores = [30, 3];
  finishRound(high.room, high.rng);
  assert.deepEqual(high.room.winners, [0]);
});

test('statistics: one entry per person still seated, with outcome, placement, score and extras', () => {
  const { room, rng } = endgame(3);
  room.seats[2] = { kind: 'bot', id: 'bot:1', name: 'Bot' };
  setWall(room, 0, ['XXXX.', '..X..', '..X..', '..X..', '..X..']);
  room.lines[0][0] = { colour: wallColour(0, 4), count: 1 };
  room.lines[0][1] = { colour: wallColour(1, 0), count: 2 };
  room.floors[0] = [0, 0];
  room.floors[1] = [1, 1, 1];
  room.scores = [20, 20, 0];
  finishRound(room, rng, { source: 0, colour: 0, line: 'floor' });
  const rows = game.statsPlayers(room);
  assert.equal(rows.length, 2, 'the computer player is not recorded');
  assert.deepEqual(rows.map((r) => r.userId), [1, 2]);
  assert.equal(rows[0].outcome, 'win');
  assert.equal(rows[1].outcome, 'loss');
  assert.equal(rows[0].placement, 1);
  assert.equal(rows[1].placement, 2);
  assert.equal(rows[0].score, room.scores[0]);
  assert.deepEqual(Object.keys(rows[0].extras).sort(), [...game.STAT_KEYS].sort());
  assert.equal(rows[0].extras.rowsCompleted, 1);
  assert.equal(rows[0].extras.columnsCompleted, 1);
  assert.equal(rows[0].extras.roundsPlayed, 1);
  assert.equal(rows[0].extras.floorPenalties, 4, 'two tiles on the floor, plus the one taken to it: 1 + 1 + 2');
  assert.equal(rows[1].extras.floorPenalties, 4, 'three tiles: 1 + 1 + 2');
  assert.equal(rows[1].extras.rowsCompleted, 0);
});

// ---- the free wall ----

test('free wall: the rules for a line use rows and columns, not fixed places', () => {
  const { room } = playingRoom(2, { seed: 4, free: true });
  setTable(room, { factories: [[2, 2, 1, 1]], centre: [], turn: 0 });
  room.walls[0] = emptyWall();
  assert.equal(room.walls.every((w) => w.flat().every((c) => c === null)), true, 'a blank wall');
  room.walls[0][2] = [0, 2, null, null, null];
  const take = (args) => () => game.takeTiles(room, 0, args);
  failsAtomically(room, take({ source: 0, colour: 2, line: 2 }), /Row 3 of your wall already has Terracotta/);
  assert.equal(game.takeTiles(room, 0, { source: 0, colour: 2, line: 1 }).ok, true, 'a free wall allows it in another row');
  // A colour that has no free column left in the row: row 4 full of other colours except one column holding colour 1 above.
  const blocked = playingRoom(2, { seed: 4, free: true });
  setTable(blocked.room, { factories: [[1, 1, 0, 0]], centre: [], turn: 0 });
  blocked.room.walls[0][3] = [0, 2, 3, 4, null];
  blocked.room.walls[0][0][4] = 1;
  failsAtomically(blocked.room, () => game.takeTiles(blocked.room, 0, { source: 0, colour: 1, line: 3 }), /Saffron has no free column left in row 4/);
  assert.equal(game.takeTiles(blocked.room, 0, { source: 0, colour: 0, line: 3 }).ok, false, 'colour 0 is in that row');
  assert.equal(game.takeTiles(blocked.room, 0, { source: 0, colour: 1, line: 2 }).ok, true);
});

test('free wall: a player with a choice waits, others are scored, and the choice is validated', () => {
  const { room, rng } = endgame(2, { free: true });
  room.walls[1][0] = [null, 3, null, null, null]; // colour 3 in column 1 of row 1
  room.lines[0][0] = { colour: 2, count: 1 };
  room.lines[1][0] = { colour: 4, count: 1 };
  room.scores = [0, 0];
  finishRound(room, rng);
  assert.equal(room.phase, 'tiling');
  assert.equal(room.round, 1, 'waiting for the choices');
  assert.deepEqual(room.pending[0], { row: 0, colour: 2, columns: [0, 1, 2, 3, 4] });
  assert.deepEqual(room.pending[1], { row: 0, colour: 4, columns: [0, 2, 3, 4] });
  assert.equal(game.chooseColumn(room, 0, { col: 9 }).ok, false);
  assert.equal(game.chooseColumn(room, 0, { col: '2' }).ok, false);
  assert.equal(game.chooseColumn(room, 0, { col: -1 }).ok, false);
  assert.equal(game.chooseColumn(room, 0, null).ok, false);
  assert.equal(game.chooseColumn(room, 1, { col: 1 }).ok, false, 'column 1 is taken in that row');
  assert.equal(game.chooseColumn(room, 0, { col: 3 }).ok, true);
  assert.equal(room.walls[0][0][3], 2);
  assert.equal(room.phase, 'tiling', 'seat 1 has still to choose');
  assert.equal(game.chooseColumn(room, 0, { col: 3 }).ok, false, 'only once');
  assert.deepEqual(game.legalMoves(room, 0), [], 'no moves during the tiling');
  assert.equal(game.takeTiles(room, 0, { source: 0, colour: 0, line: 0 }).ok, false);
  const done = game.chooseColumn(room, 1, { col: 4 });
  assert.equal(done.ok, true);
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 2);
  assert.deepEqual(room.history[0].deltas, { 0: 1, 1: 1 });
});

test('free wall: a tile with only one place goes there by itself; scoring uses the real neighbours', () => {
  const { room, rng } = endgame(2, { free: true });
  room.walls[0][1] = [0, 1, 3, 4, null];
  room.lines[0][1] = { colour: 2, count: 2 };
  finishRound(room, rng);
  assert.equal(room.phase, 'finished', 'no choice was needed, and the row is complete');
  assert.equal(room.walls[0][1][4], 2);
  assert.equal(room.history[0].deltas[0], 5, 'a row of five');
});

test('free wall: a full line with no legal column left goes to the lid and scores nothing', () => {
  const { room, rng } = endgame(2, { free: true });
  room.walls[0][2] = [0, 2, 3, 4, null];
  room.walls[0][4][4] = 1; // colour 1 already in column 4
  room.lines[0][2] = { colour: 1, count: 3 };
  finishRound(room, rng);
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.lines[0][2], { colour: null, count: 0 });
  assert.equal(room.walls[0][2][4], null);
  assert.equal(room.scores[0], 0);
  assert.equal(room.lid.filter((c) => c === 1).length, 3);
  assert.match(room.history[0].notes[0], /no room on the wall/);
});

test('free wall: an earlier tile of the same phase can use up the last place of a later row', () => {
  const { room, rng } = endgame(2, { free: true });
  // Row 0 gets colour 1 in column 4 by choice; row 1 then has only column 4 for colour 1... which is now blocked.
  room.walls[0][1] = [0, 2, 3, 4, null];
  room.lines[0][0] = { colour: 1, count: 1 };
  room.lines[0][1] = { colour: 1, count: 2 };
  room.walls[0][0] = [null, null, null, null, null];
  finishRound(room, rng);
  assert.equal(room.phase, 'tiling', 'row 1 is waiting on the choice in row 0');
  assert.deepEqual(room.pending[0].row, 0);
  assert.equal(game.chooseColumn(room, 0, { col: 4 }).ok, true);
  assert.equal(room.walls[0][0][4], 1);
  assert.equal(room.phase, 'playing');
  assert.equal(room.walls[0][1][4], null, 'the second tile found no place');
  assert.equal(room.lid.filter((c) => c === 1).length, 2);
});

test('free wall: bonuses count in the same way, whatever the arrangement', () => {
  const { room, rng } = endgame(2, { free: true });
  room.walls[0] = [
    [0, 1, 2, 3, null],
    [1, 2, 3, 4, 0],
    [2, 3, 4, 0, 1],
    [3, 4, 0, 1, 2],
    [4, 0, 1, 2, 3],
  ];
  room.lines[0][0] = { colour: 4, count: 1 };
  room.turn = 1;
  finishRound(room, rng);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.final.players[0], { seat: 0, name: 'p1', before: 10, rows: 5, columns: 5, sets: 5, bonus: 95, total: 105, placement: 1 });
});

// ---- views and play again ----

test('views carry the whole table but never the bag; the scoreboard totals equal the scores', () => {
  for (const n of SIZES) {
    const { room, rng } = playingRoom(n, { seed: 30 + n });
    for (let i = 0; i < 12 && room.phase === 'playing'; i++) {
      const moves = game.legalMoves(room, room.turn);
      game.takeTiles(room, room.turn, moves[Math.floor(rng() * moves.length)], rng);
    }
    for (let seat = 0; seat < n; seat++) {
      const view = game.viewFor(room, seat + 1);
      assert.deepEqual(viewLeaks(room, view), []);
      assert.equal(view.you, seat);
      assert.equal(view.bagCount, room.bag.length);
      assert.equal(view.factories.length, 2 * n + 1);
      assert.equal(view.scoreboard.players.length, n);
      for (const p of view.scoreboard.players) assert.equal(p.score, view.seats[p.id].score);
      assert.equal(view.seats[seat].wall.length, 5);
    }
    const spectator = game.viewFor(room, 999);
    assert.equal(spectator.you, -1);
    assert.deepEqual(viewLeaks(room, spectator), []);
  }
});

test('the scoreboard history sums to the scores after every round of a whole game, and ends with the Bonuses row', () => {
  const { room, rng } = playingRoom(3, { seed: 12 });
  let rounds = 0;
  let last = 0;
  let guard = 0;
  while (room.phase !== 'finished' && guard++ < 5000) {
    const seat = room.phase === 'tiling' ? room.pending.findIndex(Boolean) : room.turn;
    if (room.phase === 'tiling') game.chooseColumn(room, seat, { col: room.pending[seat].columns[0] }, rng);
    else {
      const moves = game.legalMoves(room, seat);
      game.takeTiles(room, seat, moves[Math.floor(rng() * moves.length)], rng);
    }
    if (room.history.length !== last) {
      last = room.history.length;
      rounds++;
      const view = game.viewFor(room, 1);
      const sums = Object.fromEntries(view.scoreboard.players.map((p) => [p.id, view.scoreboard.rounds.reduce((s, r) => s + r.deltas[p.id], 0)]));
      for (const p of view.scoreboard.players) assert.equal(sums[p.id], p.score, `after history entry ${last}`);
    }
  }
  assert.equal(room.phase, 'finished');
  assert.equal(room.history.at(-1).label, 'Bonuses');
  assert.equal(room.history.length, room.playedRounds + 1);
  assert.deepEqual(room.history.slice(0, -1).map((h) => h.label), Array.from({ length: room.playedRounds }, (_, i) => `Round ${i + 1}`));
  assert.ok(rounds >= 6);
  assertInvariants(room, 'finished random game');
});

test('play again: host only, only when finished, back to an empty history with the same seats', () => {
  const { room, rng } = endgame(2);
  setWall(room, 0, ['XXXX.', '.....', '.....', '.....', '.....']);
  room.lines[0][0] = { colour: wallColour(0, 4), count: 1 };
  assert.equal(game.playAgain(room, 1).ok, false, 'not finished');
  finishRound(room, rng);
  assert.equal(room.phase, 'finished');
  assert.equal(game.playAgain(room, 2).ok, false, 'host only');
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.history, []);
  assert.deepEqual(room.scores, [0, 0]);
  assert.equal(room.seats.length, 2);
  assert.equal(room.recorded, false);
});

test('the room survives being saved as JSON in every phase', () => {
  const { room, rng } = playingRoom(4, { seed: 3 });
  for (let i = 0; i < 40; i++) {
    const copy = JSON.parse(JSON.stringify(room));
    assert.deepEqual(copy, room);
    if (room.phase !== 'playing') break;
    const moves = game.legalMoves(room, room.turn);
    game.takeTiles(room, room.turn, moves[Math.floor(rng() * moves.length)], rng);
  }
});

test('statistics: a game that ends with the whole wall filled counts the bottom row and the full grid', () => {
  const { room, rng } = endgame(2);
  setWall(room, 0, ['XXXXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  finishRound(room, rng, { source: 0, colour: 0, line: 'floor' });
  const [full, other] = game.statsPlayers(room);
  assert.deepEqual([full.extras.gridsFilled, full.extras.bottomRows], [1, 1]);
  assert.deepEqual([full.extras.wallTiles, other.extras.wallTiles], [25, 0], 'tiles placed on the wall at the end');
  assert.deepEqual([other.extras.gridsFilled, other.extras.bottomRows], [0, 0]);
});
