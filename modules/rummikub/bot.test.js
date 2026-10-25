import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { bestPlay, chooseTurn, pendingAction, runPending } from './bot.js';
import { checkPlay, totalTiles } from './rules.js';
import { STD, assertInvariants, driveStep, joker, playingRoom, seeded, tile } from './testing.js';

const t = (c, n, copy = 0) => tile(STD, c, n, copy);
const J = (i = 0) => joker(STD, i);

function position(room, { racks, table = [], turn = 0, melded = [] }) {
  const used = new Set([...racks.flat(), ...table.flat()]);
  room.racks = racks;
  room.table = table;
  room.pool = Array.from({ length: totalTiles(room.settings) }, (_, i) => i).filter((id) => !used.has(id));
  room.turn = turn;
  room.melded = room.seats.map((_, i) => Boolean(melded[i]));
}

const added = (room, seat, play) => checkPlay(room.settings, { before: room.table, rack: room.racks[seat], proposed: play.table, melded: room.melded[seat], meld: room.settings.meld }).added;

test('pendingAction only fires for a computer player whose turn it is', () => {
  const { room } = playingRoom(2, { seed: 1, bots: true });
  assert.equal(room.seats[0].kind, 'human');
  room.turn = 0;
  assert.equal(pendingAction(room), null);
  room.turn = 1;
  assert.deepEqual(pendingAction(room), { type: 'turn', seat: 1 });
  room.phase = 'between';
  assert.equal(pendingAction(room), null);
});

test('before melding it plays only rack sets worth the threshold, all of them together', () => {
  const { room } = playingRoom(2, { seed: 1, bots: true });
  position(room, { racks: [[], [t(0, 2), t(0, 3), t(0, 4), t(1, 6), t(2, 6), t(3, 6), t(0, 13)]], turn: 1 });
  assert.equal(bestPlay(room, 1), null, 'the run (9) and the group (18) make 27');
  position(room, { racks: [[], [t(0, 2), t(0, 3), t(0, 4), t(1, 7), t(2, 7), t(3, 7), t(0, 13)]], turn: 1 });
  const play = bestPlay(room, 1);
  assert.ok(play, '9 + 21 is 30');
  assert.equal(added(room, 1, play).length, 6);
});

test('it melds when the sets add up, and uses jokers at their stand-in value', () => {
  const { room } = playingRoom(2, { seed: 1, bots: true });
  position(room, { racks: [[], [t(0, 9), t(0, 10), J(), t(1, 2), t(3, 12)]], turn: 1 });
  const play = bestPlay(room, 1);
  assert.ok(play, 'run 9-10-11 with a joker is worth 30');
  assert.equal(added(room, 1, play).length, 3);
  const low = playingRoom(2, { seed: 1, bots: true }).room;
  position(low, { racks: [[], [t(0, 1), t(0, 2), J(), t(3, 12)]], turn: 1 });
  assert.equal(bestPlay(low, 1), null, '1-2-3 is only 6');
  const custom = playingRoom(2, { seed: 1, bots: true, settings: { meld: 6 } }).room;
  position(custom, { racks: [[], [t(0, 1), t(0, 2), J(), t(3, 12)]], turn: 1 });
  assert.ok(bestPlay(custom, 1), 'with a threshold of 6 it is enough');
});

test('after melding it extends sets on the table', () => {
  const { room } = playingRoom(2, { seed: 1, bots: true });
  position(room, { racks: [[], [t(0, 7), t(1, 3)]], table: [[t(0, 4), t(0, 5), t(0, 6)]], turn: 1, melded: [false, true] });
  const play = bestPlay(room, 1);
  assert.deepEqual(added(room, 1, play), [t(0, 7)]);
});

test('it rearranges: borrows from a run to make a group', () => {
  const { room } = playingRoom(2, { seed: 1, bots: true });
  position(room, { racks: [[], [t(1, 6), t(2, 6)]], table: [[t(0, 3), t(0, 4), t(0, 5), t(0, 6)]], turn: 1, melded: [false, true] });
  const play = bestPlay(room, 1);
  assert.ok(play);
  assert.equal(added(room, 1, play).length, 2);
});

test('it replaces a joker on the table with the tile and reuses the joker', () => {
  const { room } = playingRoom(2, { seed: 1, bots: true });
  position(room, {
    racks: [[], [t(0, 5), t(1, 9), t(2, 9)]],
    table: [[t(0, 4), J(), t(0, 6)]],
    turn: 1,
    melded: [false, true],
  });
  const play = bestPlay(room, 1);
  assert.ok(play);
  assert.equal(added(room, 1, play).length, 3, 'the 5 goes in the run, the freed joker makes a group of 9s');
});

test('it draws when it cannot play, and never plays an invalid table', () => {
  const { room } = playingRoom(2, { seed: 1, bots: true });
  position(room, { racks: [[], [t(0, 1), t(1, 4), t(2, 8)]], table: [[t(0, 4), t(0, 5), t(0, 6)]], turn: 1, melded: [false, true] });
  assert.deepEqual(chooseTurn(room, 1), { type: 'draw' });
  const before = room.racks[1].length;
  runPending(room);
  assert.equal(room.racks[1].length, before + 1);
});

test('the search stops: a big table and a big rack are answered quickly', () => {
  const { room } = playingRoom(2, { seed: 21, bots: true, settings: { colours: 8, numbers: 20, wildcards: 8 } });
  const started = Date.now();
  for (let i = 0; i < 30 && room.phase === 'playing'; i++) driveStep(room);
  assert.ok(Date.now() - started < 20000);
  assertInvariants(room);
});

// ---- whole games, bots only, every size and a range of options ----
const SETTINGS = [
  {},
  { numbers: 8, colours: 3, wildcards: 0 },
  { numbers: 14, colours: 6, wildcards: 6 },
  { numbers: 5, colours: 5, wildcards: 1, meld: 10 },
  { numbers: 13, colours: 4, wildcards: 2, meld: 60 },
  { numbers: 4, colours: 2, wildcards: 4, meld: 0 },
  { numbers: 3, colours: 6, wildcards: 3, rounds: 2 },
];

for (const players of [2, 3, 4, 5, 6]) {
  test(`bot-only games with ${players} players always finish, conserve every tile and make only legal moves`, () => {
    let games = 0;
    let skipped = 0;
    SETTINGS.forEach((settings, index) => {
      const rng = seeded(players * 100 + index);
      const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'h', size: players, settings: { rounds: 1, ...settings } });
      game.fillWithBots(room, 1);
      const started = game.start(room, 1, rng);
      if (!started.ok) {
        skipped++;
        assert.match(started.error, /too few|no run or group/);
        return;
      }
      let turns = 0;
      while (room.phase !== 'finished') {
        if (room.phase === 'between') {
          assert.equal(game.forceNext(room, rng).ok, true);
          continue;
        }
        driveStep(room);
        assertInvariants(room, `${players}p settings ${index} turn ${turns}`);
        assert.ok(++turns < 6000, 'the game must end');
      }
      assert.ok(room.winners.length >= 1);
      assert.equal(room.history.length, room.settings.rounds);
      games++;
    });
    assert.ok(games >= 4, `played ${games}, skipped ${skipped}`);
  });
}

test('computer players with the pool exhausted still end the round', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const { room } = playingRoom(3, { seed, bots: true, settings: { numbers: 6, colours: 3, wildcards: 0, meld: 60 } });
    let turns = 0;
    while (room.phase === 'playing') {
      driveStep(room);
      assert.ok(++turns < 3000);
    }
    assert.equal(room.lastRound.reason, 'blocked', 'an unreachable first meld ends by everyone passing');
    assertInvariants(room);
  }
});
