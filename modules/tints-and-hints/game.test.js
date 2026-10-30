// The rules of Tints and Hints, without sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { COLS, ROWS, cellColour, cellName, fromOldCell, fromEarlierCell, fromV4Cell, isCell, isClose, parseCell } from './grid.js';

const sequence = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

/** A room of the given user ids, started with the first player as the first hinter and "M4" as the tint. */
function started(ids = [1, 2, 3], { turnsEach = 2 } = {}) {
  const room = game.createRoom({ code: 'boss-aware-you', hostId: ids[0] });
  for (const id of ids.slice(1)) assert.ok(game.addPlayer(room, id).ok);
  assert.ok(game.setTurnsEach(room, ids[0], turnsEach).ok);
  // rng: first value picks the first hinter (0 = first player), the next picks the column (M), then the row (4, the fourth).
  assert.ok(game.start(room, ids[0], sequence(0, 12.5 / 52, 3.5 / 24)).ok);
  assert.equal(room.tint, 'M4');
  return room;
}

/** Every person closes the scores pop-up at the reveal. */
const closeReveal = (room) => room.players.forEach((p) => game.ready(room, p.id));
/** The hinter gives the (mandatory) first hint, so guessing can begin. */
const hint = (room, text = 'warm') => assert.ok(game.setHint(room, room.hinter, text).ok);
const score = (room, id) => room.players.find((p) => p.id === id).score;

test('the grid has 52 columns and 24 rows, and close means within one square', () => {
  assert.equal(COLS.length, 52);
  assert.equal(COLS[25] + COLS[26] + COLS[51], 'ZAAAZ');
  assert.equal(ROWS.length, 24);
  assert.equal(new Set(COLS.flatMap((c) => ROWS.map((r) => c + r))).size, 1248, 'every name is distinct');
  assert.deepEqual(parseCell('AC14'), { col: 28, row: 13 });
  assert.ok(isCell('A1') && isCell('AZ24'));
  for (const bad of ['BA1', 'A', 'A25', 'A0', 'a1', 'AA', 'A01', 'A1 ', '1A', '', null, 12, ['A1']]) assert.equal(isCell(bad), false, String(bad));
  // Colours are evenly spread in OKLCH: hue along the columns, lightness down the rows.
  const rgb = (cell) => /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(cellColour(cell)).slice(1).map((h) => parseInt(h, 16));
  for (const c of ['A1', 'M12', 'AZ24']) assert.match(cellColour(c), /^#[0-9a-f]{6}$/, c);
  const brightness = (cell) => { const [r, g, b] = rgb(cell).map((v) => (v / 255) ** 2.2); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const c of COLS) for (let r = 1; r < ROWS.length; r++) assert.ok(brightness(c + (r + 1)) > brightness(c + r) - 0.004, `${c}${r + 1} is no darker than ${c}${r}`);
  assert.ok(brightness('M1') < 0.06 && brightness('M24') > 0.8, 'dark at the top, pale at the bottom');
  const spread = new Set(COLS.map((c) => cellColour(c + '12')));
  assert.equal(spread.size, COLS.length, 'every column in a row is a different colour');
  assert.notEqual(cellColour('A12'), cellColour('AZ12'));

  for (const near of ['M4', 'L3', 'L4', 'L5', 'M3', 'M5', 'N3', 'N4', 'N5']) assert.ok(isClose(near, 'M4'), near);
  for (const far of ['K4', 'O4', 'M2', 'M6', 'K2', 'O6', 'L2']) assert.equal(isClose(far, 'M4'), false, far);
  assert.equal(isClose('AZ4', 'A4'), false, 'the hue does not wrap round');
  assert.equal(isClose('Z4', 'AA4'), true, 'neighbours across the single to double letter step');
  assert.equal(fromOldCell('X9'), 'AU23', 'the old grid first becomes the 48 x 24 grid');
  assert.equal(fromV4Cell('AU23'), 'AY23', 'and then this one');
  assert.equal(fromV4Cell('A1'), 'A1');
  assert.equal(fromEarlierCell('M4', 4), 'M8');
  assert.equal(fromEarlierCell('M20', 4), 'M24');
  assert.equal(fromEarlierCell('M21', 4), null);
  assert.equal(fromOldCell('Y0'), null);
  assert.equal(cellName(0, 23), 'A24');
  assert.equal(isClose('A1', 'B1'), true);
});

test('a lobby: colours are unique, the host sets the turns and the game needs two players', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  assert.equal(game.start(room, 1).ok, false, 'one player is not enough');
  game.addPlayer(room, 2);
  assert.notEqual(room.players[0].colour, room.players[1].colour);
  assert.equal(game.setColour(room, 2, room.players[0].colour).ok, false);
  assert.equal(game.setColour(room, 2, '#123456').ok, false);
  assert.ok(game.setColour(room, 2, game.COLOURS[7]).ok);
  assert.equal(room.players[1].colour, game.COLOURS[7]);

  assert.equal(game.setTurnsEach(room, 2, 3).ok, false, 'only the host');
  for (const bad of [0, 6, 1.5, '2', null]) assert.equal(game.setTurnsEach(room, 1, bad).ok, false, String(bad));
  assert.ok(game.setTurnsEach(room, 1, 5).ok);
  assert.equal(game.start(room, 2).ok, false, 'only the host starts');
  assert.ok(game.start(room, 1).ok);
  assert.equal(room.turnsTotal, 10);
  assert.equal(game.addPlayer(room, 3).ok, false, 'no joining once started');
  assert.ok(game.addPlayer(room, 2).ok, 'but a member is still a member');
});

test('a game holds at most eight players', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  for (let id = 2; id <= 8; id++) assert.ok(game.addPlayer(room, id).ok);
  assert.equal(game.addPlayer(room, 9).ok, false);
  assert.equal(new Set(room.players.map((p) => p.colour)).size, 8);
});

test('guessing: the hinter cannot guess, each person guesses once a round, and squares are checked', () => {
  const room = started();
  assert.equal(room.hinter, 1);
  hint(room);
  assert.equal(game.guess(room, 1, 'A1').ok, false, 'the hinter');
  assert.equal(game.guess(room, 9, 'A1').ok, false, 'a stranger');
  assert.equal(game.guess(room, 2, 'BA9').ok, false, 'not on the grid');
  assert.ok(game.guess(room, 2, 'A1').ok);
  assert.equal(game.guess(room, 2, 'B1').ok, false, 'only one guess');
  assert.equal(game.advance(room, 1).ok, false, 'not everyone has guessed');
  assert.equal(game.advance(room, 2).ok, false, 'only the hinter continues');
  assert.ok(game.guess(room, 3, 'B1').ok);
  assert.ok(game.advance(room, 1).ok);
  assert.equal(room.phase, 'guessing2');
  assert.ok(game.guess(room, 2, 'C1').ok, 'a fresh guess in the second round');
  assert.equal(game.advance(room, 1).ok, false);
});

test('scoring follows the original code: 5 and 2 first, 4 and 1 second, 3 per person who found it', () => {
  const room = started([1, 2, 3, 4]);
  hint(room);
  game.guess(room, 2, 'M4'); // exact first: 5
  game.guess(room, 3, 'N5'); // close first: 2
  game.guess(room, 4, 'A1'); // miss
  game.advance(room, 1);
  game.guess(room, 2, 'M4'); // exact again in round two: 4 (and the hinter still only counts them once)
  game.guess(room, 3, 'M4'); // exact second: 4
  game.guess(room, 4, 'L4'); // close second: 1
  game.advance(room, 1);
  assert.equal(room.phase, 'reveal');
  assert.equal(score(room, 2), 9);
  assert.equal(score(room, 3), 6);
  assert.equal(score(room, 4), 1);
  assert.equal(score(room, 1), 6, 'two people found it, 3 each');
  assert.deepEqual(room.result.entries.map((e) => [e.id, e.round, e.kind, e.points]), [
    [2, 1, 'exact', 5], [3, 1, 'close', 2], [4, 1, 'miss', 0], [2, 2, 'exact', 4], [3, 2, 'exact', 4], [4, 2, 'close', 1],
  ]);
  assert.equal(room.result.hinterPoints, 6);
  const [p1, p2, p3, p4] = room.players;
  assert.deepEqual([p2.exactGuesses, p2.closeGuesses, p3.exactGuesses, p3.closeGuesses, p4.exactGuesses, p4.closeGuesses], [2, 0, 1, 1, 0, 1]);
  assert.equal(p1.hintsGiven, 1);
});

test('turns rotate in joining order until everyone has had the set number of turns, then the game finishes', () => {
  const room = started([1, 2, 3], { turnsEach: 2 });
  const hinters = [];
  for (let turn = 0; turn < 6; turn++) {
    hinters.push(room.hinter);
    hint(room);
    for (const p of room.players.filter((q) => q.id !== room.hinter)) game.guess(room, p.id, 'A1');
    game.advance(room, room.hinter);
    for (const p of room.players.filter((q) => q.id !== room.hinter)) game.guess(room, p.id, 'A1');
    assert.ok(game.advance(room, room.hinter).ok);
    assert.equal(room.phase, 'reveal');
    assert.equal(game.advance(room, room.hinter).ok, false, 'the reveal is closed with ready, not advance');
    assert.equal(game.ready(room, 99).ok, false, 'a stranger cannot be ready');
    let next;
    for (const p of room.players) {
      assert.equal(room.phase, 'reveal', 'the turn waits until everyone is ready');
      next = game.ready(room, p.id);
      assert.ok(next.ok);
    }
    assert.equal(next.finished, turn === 5);
  }
  assert.deepEqual(hinters, [1, 2, 3, 1, 2, 3]);
  assert.equal(room.phase, 'finished');
  assert.equal(game.advance(room, 1).ok, false);
  assert.equal(game.guess(room, 2, 'A1').ok, false);
});

test('the reveal waits for every person to be ready; computer players always are; leavers and a forced move do not block it', () => {
  const room = started([1, 2, 3, 4]);
  for (let round = 0; round < 2; round++) {
    if (round === 0) hint(room);
    for (const p of room.players.filter((q) => q.id !== 1)) game.guess(room, p.id, 'A1');
    game.advance(room, 1);
  }
  assert.equal(room.phase, 'reveal');
  assert.equal(game.viewFor(room, 2).players.find((p) => p.id === 3).ready, false);
  assert.equal(game.ready(room, 2).ok, true);
  assert.equal(game.ready(room, 2).ok, true, 'being ready twice is harmless');
  assert.equal(game.viewFor(room, 3).players.find((p) => p.id === 2).ready, true);
  assert.equal(game.viewFor(room, 3).scoreboard.players.find((p) => p.id === 2).ready, true);
  game.ready(room, 1);
  game.ready(room, 3);
  assert.equal(room.phase, 'reveal');
  assert.equal(game.removePlayer(room, 4).ok, true, 'the one who has not closed the scores leaves');
  assert.equal(room.phase, 'guessing1', 'so the others were all ready and the next turn starts');
  assert.deepEqual(room.ready, []);
  assert.equal(game.ready(room, 2).ok, false, 'not at the reveal any more');
  assert.equal(game.forceNext(room).ok, false);
  for (let round = 0; round < 2; round++) {
    if (round === 0) hint(room);
    for (const p of room.players.filter((q) => q.id !== room.hinter)) game.guess(room, p.id, 'A1');
    game.advance(room, room.hinter);
  }
  assert.equal(game.forceNext(room).ok, true, 'the server moves on after a wait, whoever is away');
  assert.equal(room.phase, 'guessing1');
});

test('the hint is typed by the hinter only, trimmed and limited in length', () => {
  const room = started();
  assert.equal(game.setHint(room, 2, 'nope').ok, false);
  assert.ok(game.setHint(room, 1, `  warm   sunset ${'x'.repeat(200)}`).ok);
  assert.equal(room.hints.first.length, game.HINT_LENGTH);
  assert.match(room.hints.first, /^warm sunset x/);
  for (const id of [2, 3]) game.guess(room, id, 'A1');
  game.advance(room, 1);
  game.setHint(room, 1, 'a bit more orange');
  assert.equal(room.hints.second, 'a bit more orange');
  assert.match(room.hints.first, /^warm/);
});

test('ties: every tied leader wins and placements are shared', () => {
  const room = started([1, 2, 3, 4]);
  Object.assign(room.players[0], { score: 10 });
  Object.assign(room.players[1], { score: 10 });
  Object.assign(room.players[2], { score: 7 });
  Object.assign(room.players[3], { score: 7 });
  const stats = game.statsPlayers(room);
  assert.deepEqual(stats.map((s) => [s.userId, s.outcome, s.placement, s.score]), [[1, 'win', 1, 10], [2, 'win', 1, 10], [3, 'loss', 3, 7], [4, 'loss', 3, 7]]);
  assert.deepEqual(Object.keys(stats[0].extras), ['exactGuesses', 'closeGuesses', 'hintsGiven', 'missGuesses', 'firstExact', 'leeks', 'distance']);
});

test('leaving: in the lobby, the host passes on; the last one out empties the room', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  game.addPlayer(room, 2);
  assert.deepEqual(game.removePlayer(room, 1), { ok: true, empty: false, abandoned: false, finished: false });
  assert.equal(room.hostId, 2);
  assert.equal(game.removePlayer(room, 2).empty, true);
});

test('leaving mid-game: the hinter leaving skips the turn, and too few players abandons the game', () => {
  const room = started([1, 2, 3, 4]);
  hint(room);
  game.guess(room, 2, 'M4');
  const left = game.removePlayer(room, 1);
  assert.equal(left.abandoned, false);
  assert.equal(room.hostId, 2, 'the host passes on');
  assert.equal(room.hinter, 2, 'the next player in order becomes the hinter');
  assert.equal(room.phase, 'guessing1');
  assert.equal(room.first.length, 0, 'a fresh turn');
  assert.equal(room.turn, 1, 'the cancelled turn still counts');

  game.removePlayer(room, 4); // a guesser: no one is waiting for them now
  hint(room);
  game.guess(room, 3, 'A1');
  assert.ok(game.advance(room, 2).ok);
  assert.equal(room.players.length, 2);
  assert.equal(game.removePlayer(room, 3).abandoned, true);
  assert.equal(room.phase, 'abandoned');
  assert.equal(game.advance(room, 2).ok, false);
});

test('rotation carries on in order when someone before the next hinter leaves', () => {
  const room = started([1, 2, 3, 4]);
  game.removePlayer(room, 1);
  assert.equal(room.hinter, 2);
  assert.equal(room.players[room.nextIdx].id, 3);
  game.removePlayer(room, 4);
  assert.equal(room.players[room.nextIdx].id, 3);
});

test('a game that runs out of turns because the hinter left finishes', () => {
  const room = started([1, 2, 3], { turnsEach: 1 });
  room.turn = 2;
  assert.equal(game.removePlayer(room, 1).finished, true);
  assert.equal(room.phase, 'finished');
});

test('views: only the hinter sees the tint until the reveal, and same-round guesses are hidden from other guessers', () => {
  const room = started([1, 2, 3]);
  hint(room);
  game.guess(room, 2, 'B1');
  game.guess(room, 3, 'C2');
  const view = (id) => game.viewFor(room, id, { nameOf: (n) => `player ${n}` });

  assert.equal(view(1).tint, 'M4');
  for (const id of [2, 3]) {
    const v = view(id);
    assert.equal(v.tint, null);
    assert.equal(v.result, null);
    assert.deepEqual(v.guesses.map((g) => g.id), [id], 'only their own guess');
    assert.ok(!JSON.stringify(v).includes('M4'));
  }
  assert.equal(view(1).guesses.length, 2, 'the hinter sees everything');
  assert.equal(view(2).players.find((p) => p.id === 3).guessed, true, 'but everyone sees who has guessed');

  game.advance(room, 1);
  assert.equal(view(2).guesses.length, 2, 'first guesses open up for the second round');
  game.guess(room, 2, 'D3');
  assert.equal(view(3).guesses.filter((g) => g.round === 2).length, 0);
  assert.equal(view(3).tint, null);
  game.guess(room, 3, 'D3');
  game.advance(room, 1);
  assert.equal(room.phase, 'reveal');
  const revealed = view(3);
  assert.equal(revealed.tint, 'M4');
  assert.equal(revealed.guesses.length, 4);
  assert.equal(revealed.result.entries[0].name, 'player 2');
  assert.equal(revealed.result.hinterName, 'player 1');
  closeReveal(room);
  assert.equal(view(3).tint, null, 'hidden again for the next turn');
  assert.equal(view(3).result, null);
});

test('history: each scored turn appends its deltas and notes, and the totals equal the scores', () => {
  const room = started([1, 2, 3]);
  const nameOf = (id) => `player ${id}`;
  const view = (id) => game.viewFor(room, id, { nameOf });
  const sums = (v) => Object.fromEntries(v.scoreboard.players.map((p) => [p.id, v.scoreboard.rounds.reduce((n, r) => n + (r.deltas[p.id] ?? 0), 0)]));

  assert.deepEqual(view(2).scoreboard.rounds, []);
  hint(room);
  game.guess(room, 2, 'M4');
  game.guess(room, 3, 'N5');
  game.advance(room, 1, Math.random, nameOf);
  game.guess(room, 2, 'M4');
  game.guess(room, 3, 'A1');
  assert.deepEqual(view(3).scoreboard.rounds, [], 'nothing before the reveal');
  game.advance(room, 1, Math.random, nameOf);
  const v = view(3);
  assert.equal(v.scoreboard.rounds.length, 1);
  assert.deepEqual(v.scoreboard.rounds[0], {
    label: 'Turn 1: player 1',
    deltas: { 1: 3, 2: 9, 3: 2 },
    notes: { 1: '1 found it', 2: 'exact in round 1, exact in round 2', 3: 'close in round 1' },
  });
  assert.deepEqual(v.scoreboard.players.map((p) => [p.id, p.score, p.isMe]), [[1, 3, false], [2, 9, false], [3, 2, true]]);
  assert.equal(v.scoreboard.lowIsBetter, false);
  assert.deepEqual(sums(v), { 1: 3, 2: 9, 3: 2 });

  closeReveal(room);
  assert.equal(view(2).scoreboard.rounds.length, 1, 'the new turn adds nothing until it is revealed');
  assert.equal(JSON.stringify(view(2).scoreboard).includes(room.tint), false);
  hint(room);
  game.guess(room, 1, 'A1');
  game.guess(room, 3, 'A1');
  game.advance(room, 2);
  game.guess(room, 1, 'A1');
  game.guess(room, 3, 'A1');
  game.advance(room, 2, Math.random, nameOf);
  assert.equal(view(1).scoreboard.rounds[1].label, 'Turn 2: player 2');
  assert.equal(view(1).scoreboard.rounds[1].notes[2], 'nobody found it');
  assert.deepEqual(sums(view(1)), Object.fromEntries(room.players.map((p) => [p.id, p.score])));
});

test('history: a turn skipped because its hinter left adds nothing, and totals still match', () => {
  const room = started([1, 2, 3, 4], { turnsEach: 2 });
  hint(room);
  game.guess(room, 2, 'M4');
  game.guess(room, 3, 'M4');
  game.guess(room, 4, 'M4');
  game.advance(room, 1);
  game.guess(room, 2, 'M4');
  game.guess(room, 3, 'M4');
  game.guess(room, 4, 'M4');
  game.advance(room, 1);
  closeReveal(room);
  game.removePlayer(room, room.hinter);
  assert.equal(room.history.length, 1);
  assert.equal(room.phase, 'guessing1');
  const v = game.viewFor(room, 3);
  const totals = Object.fromEntries(v.scoreboard.players.map((p) => [p.id, v.scoreboard.rounds.reduce((n, r) => n + (r.deltas[p.id] ?? 0), 0)]));
  for (const p of v.scoreboard.players) assert.equal(totals[p.id], p.score);
});

test('migrate: an old room without a history gets one, with the earlier points as a single entry', () => {
  const room = started([1, 2, 3]);
  room.players[1].score = 9;
  room.players[0].score = 3;
  delete room.history;
  game.migrate(room);
  assert.deepEqual(room.history, [{ label: 'Earlier turns', deltas: { 1: 3, 2: 9 }, notes: {} }]);
  const v = game.viewFor(room, 2);
  assert.equal(v.scoreboard.rounds.length, 1);
  game.migrate(room);
  assert.equal(room.history.length, 1, 'migrating twice changes nothing');
  const legacy = started([1, 2]);
  delete legacy.history;
  assert.deepEqual(game.viewFor(legacy, 1).scoreboard.rounds, [], 'a view of an unmigrated room still works');
});

test('the first hint is mandatory: an empty or blank one is refused and changes nothing', () => {
  const room = started();
  for (const bad of ['', '   ', '\n\t ', null, undefined]) {
    assert.equal(game.setHint(room, 1, bad).ok, false, JSON.stringify(bad));
    assert.equal(room.hints.first, '');
    assert.equal(room.phase, 'guessing1');
  }
  assert.deepEqual(room.first, []);
  assert.ok(game.setHint(room, 1, 'warm').ok);
  assert.equal(game.setHint(room, 1, '  ').ok, false, 'blanking it again is refused too');
  assert.equal(room.hints.first, 'warm', 'and the hint given stays');
});

test('nobody can guess before the first hint, and everyone can once it is given', () => {
  const room = started([1, 2, 3]);
  for (const id of [1, 2, 3, 9]) assert.equal(game.guess(room, id, 'A1').ok, false, 'player ' + id);
  assert.equal(room.first.length, 0);
  assert.equal(game.advance(room, 1).ok, false);
  hint(room);
  assert.ok(game.guess(room, 2, 'A1').ok);
  assert.ok(game.guess(room, 3, 'B1').ok);
  assert.equal(game.guess(room, 1, 'C1').ok, false, 'the hinter still cannot');
  assert.ok(game.advance(room, 1).ok);
});

test('the second hint stays optional', () => {
  const room = started();
  hint(room);
  for (const id of [2, 3]) game.guess(room, id, 'A1');
  assert.ok(game.advance(room, 1).ok);
  assert.equal(room.phase, 'guessing2');
  assert.ok(game.setHint(room, 1, '').ok, 'an empty second hint is allowed');
  assert.equal(room.hints.second, '');
  assert.equal(room.hints.first, 'warm');
  assert.ok(game.guess(room, 2, 'A1').ok);
  assert.ok(game.guess(room, 3, 'A1').ok);
  assert.ok(game.advance(room, 1).ok);
  assert.equal(room.phase, 'reveal');
});

test('a computer guesser waits for a human hinter to give the first hint', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  assert.ok(game.addPlayer(room, 2).ok);
  assert.ok(game.addBot(room, 1).ok);
  assert.ok(game.start(room, 1, sequence(0, 12.5 / 52, 3.5 / 24)).ok);
  assert.equal(room.hinter, 1);
  assert.equal(game.pendingBotAction(room), null, 'no guess before the hint');
  hint(room);
  assert.equal(game.pendingBotAction(room)?.type, 'guess', 'then it may guess');
});

test('marker colours: a default is used when free, any colour needs the unlock, and colours stay unique', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, colour: '#6a00ff' });
  assert.equal(room.players[0].colour, '#6a00ff', 'the host gets their default');
  assert.equal(game.createRoom({ code: 'a-b-c', hostId: 1 }).players[0].colour, game.COLOURS[0], 'no default: the first colour');
  assert.ok(game.addPlayer(room, 2, '#6a00ff').ok);
  assert.equal(room.players[1].colour, game.COLOURS[0], 'the default is taken: the first free colour');
  assert.ok(game.addPlayer(room, 3, '#123456').ok);
  assert.ok(game.addPlayer(room, 4, '#123456').ok);
  assert.equal(room.players[3].colour, game.COLOURS[1], 'colours are unique, even custom ones');
  assert.equal(game.setColour(room, 2, '#abcdef').ok, false, 'a custom colour needs the unlock');
  assert.ok(game.setColour(room, 2, '#ABCDEF', true).ok);
  assert.equal(room.players[1].colour, '#abcdef', 'kept in lower case');
  assert.equal(game.setColour(room, 3, '#abcdef', true).ok, false, 'someone else has it');
  assert.equal(game.setColour(room, 3, 'red', true).ok, false);
  assert.ok(game.setColour(room, 2, game.COLOURS[2]).ok, 'back to a free one without the unlock');
  assert.equal(game.viewFor(room, 1).canCustomColour, false);
  assert.equal(game.viewFor(room, 1, { canCustom: true }).canCustomColour, true);
  const bot = game.addBot(room, 1);
  assert.ok(bot.ok && room.players.at(-1).colour, 'a computer player gets a free colour too');
});
