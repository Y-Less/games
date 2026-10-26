import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { rackValue, totalTiles } from './rules.js';
import { STD, assertInvariants, joker, playingRoom, seeded, tile } from './testing.js';

const t = (c, n, copy = 0) => tile(STD, c, n, copy);

/** Puts a hand-built position in place (tiles not mentioned stay in the pool so conservation still holds). */
function setPosition(room, { racks, table = [], turn = 0, melded = null }) {
  const used = new Set([...racks.flat(), ...table.flat()]);
  room.racks = racks.map((r) => [...r].sort((a, b) => a - b));
  room.table = table;
  room.pool = Array.from({ length: totalTiles(room.settings) }, (_, i) => i).filter((id) => !used.has(id));
  room.turn = turn;
  room.idle = 0;
  if (melded) room.melded = melded;
}

test('creating and configuring a room', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', size: 3, settings: { numbers: 9, colours: 5 } });
  assert.equal(room.phase, 'lobby');
  assert.equal(room.settings.numbers, 9);
  assert.equal(room.settings.wildcards, 2);
  assert.throws(() => game.createRoom({ code: 'a', hostId: 1, hostName: 'A', size: 7 }));
  assert.throws(() => game.createRoom({ code: 'a', hostId: 1, hostName: 'A', size: 1 }));
  assert.throws(() => game.createRoom({ code: 'a', hostId: 1, hostName: 'A', settings: { numbers: 'many' } }));
  assert.equal(game.setSettings(room, 2, { numbers: 5 }).ok, false, 'not the host');
  assert.equal(game.setSettings(room, 1, { numbers: 500, timer: 1 }).ok, true);
  assert.equal(room.settings.numbers, 20);
  assert.equal(room.settings.timer, 15);
  assert.equal(game.setSettings(room, 1, { colours: 'x' }).ok, false);
  assert.equal(room.settings.colours, 5, 'a refused change leaves the settings alone');
  assert.equal(game.setSize(room, 1, 6).ok, true);
  assert.equal(room.seats.length, 6);
  assert.equal(game.setSize(room, 1, 7).ok, false);
  assert.equal(game.setSize(room, 1, 1).ok, false);
});

test('seats: humans, computer players, kicking, one seat each', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', size: 3 });
  assert.equal(game.addHuman(room, 2, 'Ann').ok, true);
  assert.equal(room.seats[1].name, 'Ann (2)');
  assert.equal(game.addHuman(room, 2, 'Ann').seat, 1, 'joining twice is harmless');
  assert.equal(game.addHuman(room, 3, 'Cat').ok, true);
  assert.equal(game.addHuman(room, 4, 'Dan').ok, false, 'full');
  assert.equal(game.kick(room, 2, 2).ok, false, 'only the host');
  assert.equal(game.kick(room, 1, 0).ok, false, 'not yourself');
  assert.equal(game.kick(room, 1, 2).userId, 3);
  assert.equal(game.addBot(room, 1).ok, true);
  assert.equal(room.seats[2].kind, 'bot');
  assert.deepEqual(game.viewFor(room, 1).scoreboard.players.map((p) => p.bot), [false, false, true], 'the scoreboard marks computer players');
  assert.equal(game.removeBot(room, 1, 2).ok, true);
  assert.equal(game.removeBot(room, 1, 1).ok, false, 'a person is not a computer player');
  assert.equal(game.fillWithBots(room, 1).ok, true);
  assert.equal(game.addBot(room, 1).ok, false);
});

test('starting: the deal, the pool, and refusing games that cannot be played', () => {
  const { room } = playingRoom(4, { seed: 3 });
  assert.equal(room.phase, 'playing');
  assert.ok(room.racks.every((r) => r.length === 14));
  assert.equal(room.pool.length, 106 - 56);
  assertInvariants(room);
  const small = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 6, settings: { numbers: 3, colours: 2, wildcards: 0 } });
  game.fillWithBots(small, 1);
  const refused = game.start(small, 1);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /too few/);
  assert.equal(small.phase, 'lobby');
  const fewer = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 6, settings: { numbers: 10, colours: 4, wildcards: 2 } });
  game.fillWithBots(fewer, 1);
  assert.equal(game.start(fewer, 1).ok, true);
  assert.ok(fewer.racks.every((r) => r.length === 11), 'a smaller deal for a smaller tile set');
  assert.ok(fewer.pool.length >= 11);
  assert.equal(game.start(fewer, 1).ok, false, 'already started');
  const empty = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 3 });
  assert.equal(game.start(empty, 1).ok, false, 'empty seats');
  const impossible = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 2, settings: { numbers: 2, colours: 2, wildcards: 8 } });
  game.fillWithBots(impossible, 1);
  assert.match(game.start(impossible, 1).error, /no run or group/);
});

test('turns: only the player to move can act, and a refused play changes nothing', () => {
  const { room } = playingRoom(3, { seed: 5 });
  const mover = room.turn;
  const other = (mover + 1) % 3;
  const snapshot = JSON.stringify(room);
  assert.equal(game.draw(room, other).ok, false);
  assert.equal(game.play(room, other, { table: [] }).ok, false);
  assert.equal(game.play(room, mover, { table: [[room.racks[mover][0]]] }).ok, false);
  assert.equal(game.play(room, mover, 'garbage').ok, false);
  assert.equal(game.play(room, mover, {}).ok, false);
  assert.equal(JSON.stringify(room), snapshot, 'nothing changed');
  assert.equal(game.draw(room, mover).ok, true);
  assert.equal(room.racks[mover].length, 15);
  assert.equal(room.turn, other);
  assertInvariants(room);
});

test('a first meld, then extending the table', () => {
  const { room } = playingRoom(2, { seed: 2 });
  setPosition(room, { racks: [[t(0, 10), t(0, 11), t(0, 12), t(1, 1), t(2, 1)], [t(0, 13), t(3, 9), t(2, 9), t(1, 9)]], turn: 0 });
  assert.equal(game.play(room, 0, { table: [[t(0, 10), t(0, 11), t(0, 12)]] }).ok, true);
  assert.equal(room.melded[0], true);
  assert.deepEqual(room.racks[0].length, 2);
  assert.equal(room.turn, 1);
  assert.equal(room.lastPlay.seat, 0);
  // seat 1 cannot extend the run before melding
  const refused = game.play(room, 1, { table: [[t(0, 10), t(0, 11), t(0, 12), t(0, 13)]] });
  assert.equal(refused.ok, false);
  assert.equal(room.racks[1].length, 4);
  // a group of 9s is worth 27 < 30
  assert.equal(game.play(room, 1, { table: [[t(0, 10), t(0, 11), t(0, 12)], [t(3, 9), t(2, 9), t(1, 9)]] }).ok, false);
  assert.equal(game.draw(room, 1).ok, true);
  assertInvariants(room);
  // seat 0 has melded: now it may extend with whatever it holds, but it holds nothing useful, so it draws
  assert.equal(game.draw(room, 0).ok, true);
});

test('going out wins the round: the winner gains the others\' racks, the others lose their own', () => {
  const { room } = playingRoom(3, { seed: 4 });
  setPosition(room, {
    racks: [[t(0, 10), t(0, 11), t(0, 12)], [t(1, 1), t(2, 5), joker(STD)], [t(3, 13), t(3, 12)]],
    turn: 0,
  });
  const result = game.play(room, 0, { table: [[t(0, 10), t(0, 11), t(0, 12)]] });
  assert.equal(result.ok, true);
  assert.equal(room.phase, 'finished', 'one round by default');
  assert.deepEqual(room.scores, [61, -36, -25]);
  assert.deepEqual(room.winners, [0]);
  assert.equal(room.lastRound.reason, 'out');
  assert.deepEqual(room.lastRound.racks[1].length, 3);
  assertInvariants(room);
});

test('the numbers: jokers cost 30 and the score table adds up', () => {
  const { room } = playingRoom(2, { seed: 4 });
  setPosition(room, { racks: [[t(0, 10), t(0, 11), t(0, 12)], [joker(STD), t(2, 5)]], turn: 0 });
  game.play(room, 0, { table: [[t(0, 10), t(0, 11), t(0, 12)]] });
  assert.deepEqual(room.scores, [35, -35]);
  assert.equal(rackValue(room.settings, room.racks[1]), 35);
  assert.equal(room.history[0].deltas[0], 35);
});

test('a blocked round: pool empty and everyone passes; the lowest rack wins and the difference is paid', () => {
  const { room } = playingRoom(3, { seed: 6 });
  setPosition(room, { racks: [[t(0, 1), t(1, 4)], [t(0, 2), t(1, 9)], [t(0, 3), t(1, 3)]], turn: 0 });
  room.pool = [];
  assert.equal(game.draw(room, 0).ok, true);
  assert.equal(room.idle, 1);
  assert.equal(game.draw(room, 1).ok, true);
  assert.equal(room.phase, 'playing');
  assert.equal(game.draw(room, 2).ok, true);
  assert.equal(room.phase, 'finished');
  assert.equal(room.lastRound.reason, 'blocked');
  assert.deepEqual(room.lastRound.totals, [5, 11, 6]);
  assert.deepEqual(room.winners, [0]);
  assert.deepEqual(room.scores, [7, -6, -1], 'seat 0 collects (11-5) + (6-5)');
});

test('a blocked round with tied lowest racks shares the winnings, rounded down', () => {
  const { room } = playingRoom(3, { seed: 6 });
  setPosition(room, { racks: [[t(0, 1), t(1, 4)], [t(0, 2), t(1, 3)], [t(0, 3), t(1, 9)]], turn: 0 });
  room.pool = [];
  game.draw(room, 0);
  game.draw(room, 1);
  game.draw(room, 2);
  assert.deepEqual(room.lastRound.winners, [0, 1]);
  assert.deepEqual(room.lastRound.deltas, { 0: 3, 1: 3, 2: -7 });
  assert.deepEqual(room.winners, [0, 1]);
});

test('a draw from a full pool resets the pass count, so passing needs an empty pool', () => {
  const { room } = playingRoom(2, { seed: 8 });
  room.idle = 5;
  game.draw(room, room.turn);
  assert.equal(room.idle, 0);
  assert.equal(room.phase, 'playing');
});

test('several rounds: scores add up, everybody continues, the first player moves on', () => {
  const { room } = playingRoom(2, { seed: 9, settings: { rounds: 2 } });
  const first = room.first;
  setPosition(room, { racks: [[t(0, 10), t(0, 11), t(0, 12)], [t(2, 5), t(3, 5)]], turn: room.turn });
  const mover = room.turn;
  setPosition(room, { racks: mover === 0 ? [[t(0, 10), t(0, 11), t(0, 12)], [t(2, 5), t(3, 5)]] : [[t(2, 5), t(3, 5)], [t(0, 10), t(0, 11), t(0, 12)]], turn: mover });
  assert.equal(game.play(room, mover, { table: [[t(0, 10), t(0, 11), t(0, 12)]] }).ok, true);
  assert.equal(room.phase, 'between');
  assert.equal(room.history.length, 1);
  assert.equal(game.play(room, mover, { table: [] }).ok, false, 'no play between rounds');
  assert.equal(game.draw(room, mover).ok, false);
  assert.equal(game.next(room, 0).ok, true);
  assert.equal(room.phase, 'between', 'waits for the other person too');
  assert.equal(game.next(room, 0).ok, true, 'pressing twice is harmless');
  assert.equal(game.next(room, 1).ok, true);
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 2);
  assert.equal(room.first, (first + 1) % 2);
  assert.ok(room.racks.every((r) => r.length === 14));
  assert.equal(room.table.length, 0);
  assert.deepEqual(room.melded, [false, false]);
  assert.equal(room.scores[mover], 10);
  assertInvariants(room);
});

test('between rounds the server can force the next round, and a leaver is replaced', () => {
  const { room } = playingRoom(3, { seed: 9, settings: { rounds: 2 } });
  setPosition(room, { racks: [[t(0, 10), t(0, 11), t(0, 12)], [t(2, 5), t(3, 5)], [t(1, 1), t(2, 2)]], turn: 0 });
  game.play(room, 0, { table: [[t(0, 10), t(0, 11), t(0, 12)]] });
  assert.equal(room.phase, 'between');
  game.next(room, 0);
  game.next(room, 1);
  assert.equal(room.phase, 'between');
  const left = game.removeHuman(room, 3);
  assert.equal(left.ok, true);
  assert.equal(left.replaced, true);
  assert.equal(room.seats[2].kind, 'bot');
  assert.equal(room.phase, 'playing', 'everyone who is left was ready');
  const again = playingRoom(2, { seed: 1, settings: { rounds: 2 } });
  setPosition(again.room, { racks: [[t(0, 10), t(0, 11), t(0, 12)], [t(2, 5)]], turn: 0 });
  game.play(again.room, 0, { table: [[t(0, 10), t(0, 11), t(0, 12)]] });
  assert.equal(game.forceNext(again.room).ok, true);
  assert.equal(again.room.round, 2);
  assert.equal(game.forceNext(again.room).ok, false);
});

test('a game of several rounds finishes with placements and statistics', () => {
  const { room } = playingRoom(3, { seed: 12, settings: { rounds: 2 } });
  for (let round = 0; round < 2; round++) {
    const mover = room.turn;
    const racks = [[t(2, 5)], [t(2, 6)], [t(2, 7)]];
    racks[mover] = [t(0, 10), t(0, 11), t(0, 12)];
    setPosition(room, { racks, turn: mover });
    game.play(room, mover, { table: [[t(0, 10), t(0, 11), t(0, 12)]] });
    if (room.phase === 'between') game.forceNext(room);
  }
  assert.equal(room.phase, 'finished');
  assertInvariants(room);
  const stats = game.statsPlayers(room);
  assert.equal(stats.length, 3);
  for (const p of stats) {
    assert.ok(['win', 'loss'].includes(p.outcome));
    assert.equal(p.extras.roundsPlayed, 2);
    assert.equal(typeof p.score, 'number');
    for (const key of game.STAT_KEYS) assert.equal(typeof p.extras[key], 'number', key);
  }
  assert.ok(stats.some((p) => p.outcome === 'win'));
  assert.ok(stats.every((p) => p.placement >= 1));
  assert.equal(game.playAgain(room, 2).ok, false, 'only the host');
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.round, 0);
});

test('the turn timer: nothing before the deadline, then a draw', () => {
  const { room } = playingRoom(2, { seed: 3, settings: { timer: 30 } });
  assert.ok(room.deadline > 0);
  const mover = room.turn;
  assert.equal(game.timeout(room, room.deadline - 1).ok, false);
  assert.equal(game.timeout(room, room.deadline).ok, true);
  assert.equal(room.racks[mover].length, 15);
  assert.notEqual(room.turn, mover);
  const off = playingRoom(2, { seed: 3 });
  assert.equal(off.room.deadline, null);
  assert.equal(game.timeout(off.room, Date.now() + 1e9).ok, false);
});

test('a human who leaves mid-game is replaced by a computer player who keeps the rack', () => {
  const { room } = playingRoom(3, { seed: 7 });
  const rack = [...room.racks[1]];
  const result = game.removeHuman(room, 2);
  assert.equal(result.replaced, true);
  assert.equal(room.seats[1].kind, 'bot');
  assert.deepEqual(room.racks[1], rack);
  assert.equal(game.removeHuman(room, 2).ok, false);
  game.removeHuman(room, 1);
  assert.equal(room.hostId, 3, 'the host moves on');
  const last = game.removeHuman(room, 3);
  assert.equal(last.empty, true);
});

test('views show your own rack and only counts of the others, never the pool', () => {
  const { room } = playingRoom(3, { seed: 11 });
  const view = game.viewFor(room, 2);
  assert.deepEqual(view.rack, room.racks[1]);
  assert.equal(view.poolCount, room.pool.length);
  assert.deepEqual(view.seats.map((s) => s.count), [14, 14, 14]);
  const text = JSON.stringify(view);
  assert.ok(!text.includes('"pool"') && !text.includes('"racks"'));
  assert.ok(!text.includes(JSON.stringify(room.racks[0])), 'no one else rack');
  assert.ok(!text.includes(JSON.stringify(room.pool.slice(0, 8))), 'no pool contents');
  const outsider = game.viewFor(room, 99);
  assert.deepEqual(outsider.rack, []);
  assert.equal(outsider.you, -1);
  assert.equal(game.viewFor(room, 1, { now: 1000 }).remaining, null);
  const lobby = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A' });
  const lobbyView = game.viewFor(lobby, 1);
  assert.equal(lobbyView.rack, undefined);
  assert.equal(lobbyView.deal.hand, 14);
});

test('end-of-round views reveal the racks, but not the pool', () => {
  const { room } = playingRoom(2, { seed: 11 });
  setPosition(room, { racks: [[t(0, 10), t(0, 11), t(0, 12)], [t(2, 5), t(3, 5)]], turn: 0 });
  game.play(room, 0, { table: [[t(0, 10), t(0, 11), t(0, 12)]] });
  const view = game.viewFor(room, 2);
  assert.deepEqual(view.lastRound.racks[1], [t(2, 5), t(3, 5)]);
  assert.equal(view.final.players.length, 2);
  assert.ok(!JSON.stringify(view).includes('"pool"'));
});

test('persistence: a room survives a JSON round trip', () => {
  const { room, rng } = playingRoom(4, { seed: 13, bots: true });
  for (let i = 0; i < 10; i++) game.draw(room, room.turn);
  const copy = JSON.parse(JSON.stringify(room));
  assert.deepEqual(copy, room);
  assertInvariants(copy);
  assert.equal(game.draw(copy, copy.turn).ok, true);
  void rng;
  void seeded;
});
