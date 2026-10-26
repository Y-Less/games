// The rules of Gaudi with no sockets: lobby, windows, rounds and turns, every tool, scoring and tie-breaks, views.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { COLOURS, COLS, PATTERNS, PATTERN_CARDS, bagSize, emptyGrid, poolSize, patternOf } from './rules.js';
import { botStep } from './bot.js';
import { assertInvariants, die, driveStep, playingRoom, seeded, setWindow, viewLeaks } from './testing.js';

const at = (r, c) => r * COLS + c;
const SIZES = [2, 3, 4, 5];

// A window with no restrictions, and one with a coloured and a numbered space, for hand-built positions.
PATTERNS['test.blank'] = { pid: 'test.blank', card: 99, face: 0, name: 'Test blank', difficulty: 3, rows: Array(4).fill('.....'), cells: Array(20).fill('.') };
const mixCells = Array(20).fill('.');
mixCells[at(1, 1)] = 'S';
mixCells[at(1, 2)] = '4';
PATTERNS['test.mix'] = { pid: 'test.mix', card: 99, face: 1, name: 'Test mix', difficulty: 3, rows: [], cells: mixCells };

const snapshot = (room) => JSON.stringify(room);

/** A started game of n people where seat 0 is to move with a hand-picked pool, window and tokens. */
function lab(n = 2, { pid = 'test.blank', pool = [], tokens = 5, tools = ['lathe', 'exchange', 'refire'], seed = 3 } = {}) {
  const { room, rng } = playingRoom(n, { seed });
  for (let seat = 0; seat < n; seat++) setWindow(room, seat, pid);
  room.tokens = room.tokens.map(() => tokens);
  room.tools = tools;
  room.spent = tools.map(() => 0);
  room.tokenTotal = room.tokens.reduce((a, b) => a + b, 0);
  room.pool = pool;
  return { room, rng };
}
const fillWindow = (room, seat, dice) => dice.forEach(([r, c, colour, shade], i) => (room.grids[seat][at(r, c)] = die(colour, shade, 800 + seat * 50 + i)));
const failsAtomically = (room, action, pattern) => {
  const before = snapshot(room);
  const result = action();
  assert.equal(result.ok, false);
  if (pattern) assert.match(result.error, pattern);
  assert.equal(snapshot(room), before, 'a failed action changes nothing');
  return result;
};

// ---- the lobby ----

test('creating a room: sizes 2 to 5 only, the host in seat 0', () => {
  for (const size of SIZES) {
    const room = game.createRoom({ code: 'a-b-c', hostId: 7, hostName: 'Host', size });
    assert.equal(room.seats.length, size);
    assert.deepEqual(room.seats[0], { kind: 'human', id: 7, name: 'Host' });
    assert.ok(room.seats.slice(1).every((s) => s === null));
    assert.equal(room.phase, 'lobby');
    assert.deepEqual(room.settings, { badPrivate: false });
  }
  assert.equal(game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'H' }).size, 4, 'four by default');
  for (const bad of [1, 6, 0, -1, 2.5, '3', null, NaN]) assert.throws(() => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'H', size: bad }));
  assert.throws(() => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'H', settings: { badPrivate: 'yes' } }));
  assert.equal(game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'H', settings: { badPrivate: true } }).settings.badPrivate, true);
});

test('seat count: only the host, only in the lobby, keeping everyone seated', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 5 });
  assert.equal(game.addHuman(room, 2, 'B').ok, true);
  assert.equal(game.addBot(room, 1, 4).ok, true);
  assert.deepEqual(game.viewFor(room, 1).scoreboard.players.map((p) => p.bot), [false, false, true], 'the scoreboard marks computer players');
  assert.equal(game.setSize(room, 2, 3).ok, false, 'not the host');
  assert.equal(game.setSize(room, 1, 6).ok, false);
  assert.equal(game.setSize(room, 1, 1).ok, false);
  assert.equal(game.setSize(room, 1, 'x').ok, false);
  assert.equal(game.setSize(room, 1, 2).ok, false, 'three people are seated');
  assert.equal(game.setSize(room, 1, 3).ok, true);
  assert.equal(room.seats.length, 3);
  assert.deepEqual(room.seats.map((s) => s?.name), ['A', 'B', 'Gaudi'], 'compacted in order');
  assert.equal(game.setSize(room, 1, 5).ok, true);
  assert.equal(room.seats.length, 5);
  assert.equal(game.addHuman(room, 3, 'C').ok, true);
  assert.equal(room.seats[3].name, 'C');
  game.fillWithBots(room, 1);
  game.start(room, 1);
  assert.equal(game.setSize(room, 1, 4).ok, false, 'not once the game has started');
});

test('seats and computer players: fill, add, remove, kick, start conditions', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 3 });
  assert.equal(game.start(room, 1).ok, false, 'empty seats');
  assert.equal(game.addBot(room, 2).ok, false, 'not the host');
  assert.equal(game.addBot(room, 1, 9).ok, false);
  assert.equal(game.addBot(room, 1, 0).ok, false, 'taken');
  assert.equal(game.addBot(room, 1, '1').ok, false);
  assert.equal(game.addBot(room, 1, 1.5).ok, false);
  assert.equal(game.addBot(room, 1).ok, true);
  assert.equal(room.seats[1].kind, 'bot');
  assert.match(room.seats[1].id, /^bot:\d+$/);
  assert.equal(game.removeBot(room, 1, 0).ok, false, 'a person is not a computer player');
  assert.equal(game.removeBot(room, 1, 1).ok, true);
  assert.equal(game.fillWithBots(room, 1).ok, true);
  assert.ok(room.seats.every(Boolean));
  assert.equal(new Set(room.seats.map((s) => s.name)).size, 3);
  assert.equal(game.addBot(room, 1).ok, false, 'full');
  assert.equal(game.addHuman(room, 2, 'B').ok, false, 'full');
  assert.equal(game.kick(room, 1, 1).ok, false, 'that is a computer player');
  assert.equal(game.kick(room, 1, 0).ok, false, 'the host cannot kick themselves');
  const other = game.createRoom({ code: 'd-e-f', hostId: 1, hostName: 'A', size: 2 });
  game.addHuman(other, 2, 'B');
  assert.equal(game.kick(other, 2, 0).ok, false, 'only the host');
  assert.deepEqual(game.kick(other, 1, 1), { ok: true, userId: 2, replaced: false });
  assert.equal(other.seats[1], null);
  assert.equal(game.kick(other, 1, 7).ok, false);
});

test('a game needs a person: all computer players cannot be started', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 2 });
  game.fillWithBots(room, 1);
  room.seats[0] = { kind: 'bot', id: 'bot:50', name: 'Robot' };
  assert.equal(game.start(room, 1).ok, false);
});

test('duplicate display names get (2), (3)', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Sam', size: 5 });
  game.addHuman(room, 2, 'Sam');
  game.addHuman(room, 3, 'Sam');
  game.addHuman(room, 4, 'Gaudi');
  game.addBot(room, 1);
  assert.deepEqual(room.seats.map((s) => s.name), ['Sam', 'Sam (2)', 'Sam (3)', 'Gaudi', 'Jujol']);
});

test('bad private scoring: a host option, lobby only, validated', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 2 });
  game.addHuman(room, 2, 'B');
  assert.equal(room.settings.badPrivate, false, 'off by default');
  assert.equal(game.setSettings(room, 2, { badPrivate: true }).ok, false, 'only the host');
  assert.equal(room.settings.badPrivate, false);
  for (const bad of ['true', 1, 0, null, {}, []]) assert.equal(game.setSettings(room, 1, { badPrivate: bad }).ok, false, `value ${JSON.stringify(bad)}`);
  assert.equal(game.setSettings(room, 1, {}).ok, true, 'nothing to change');
  assert.equal(game.setSettings(room, 1, { badPrivate: true, hostId: 5, extra: 1 }).ok, true);
  assert.deepEqual(room.settings, { badPrivate: true });
  assert.equal(game.setSettings(room, 1, { badPrivate: false }).ok, true);
  assert.equal(room.settings.badPrivate, false);
  game.setSettings(room, 1, { badPrivate: true });
  game.start(room, 1);
  assert.equal(game.setSettings(room, 1, { badPrivate: false }).ok, false, 'fixed once started');
  assert.equal(room.settings.badPrivate, true);
  assert.equal(game.viewFor(room, 2).settings.badPrivate, true, 'every player is told which rule applies');
  assert.equal(game.viewFor(room, 1).settings.badPrivate, true);
});

test('leaving: a seat is freed in the lobby, a computer takes over mid-game, the host passes on', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 3 });
  game.addHuman(room, 2, 'B');
  game.addHuman(room, 3, 'C');
  assert.equal(game.removeHuman(room, 99).ok, false);
  assert.deepEqual(game.removeHuman(room, 1), { ok: true, empty: false, seat: 0, replaced: false });
  assert.equal(room.seats[0], null);
  assert.equal(room.hostId, 2);
  game.addBot(room, 2);
  game.start(room, 2);
  assert.equal(room.phase, 'windows');
  const outcome = game.removeHuman(room, 3);
  assert.equal(outcome.replaced, true);
  assert.equal(room.seats[2].kind, 'bot', 'a computer player took the seat');
  assert.equal(game.removeHuman(room, 2).empty, true, 'nobody left');
});

// ---- windows ----

test('every player is dealt four windows from two distinct cards, for two to five players', () => {
  for (const n of SIZES) for (let seed = 1; seed <= 40; seed++) {
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: n });
    game.fillWithBots(room, 1);
    game.start(room, 1, seeded(seed));
    assert.equal(room.phase, 'windows');
    const all = room.options.flat();
    assert.equal(room.options.length, n);
    assert.ok(room.options.every((o) => o.length === 4));
    assert.equal(new Set(all).size, 4 * n, 'no window dealt twice');
    for (const options of room.options) {
      const cards = new Set(options.map((pid) => patternOf(pid).card));
      assert.equal(cards.size, 2, 'two double-sided cards');
    }
    assert.equal(new Set(all.map((pid) => patternOf(pid).card)).size, 2 * n, 'no card dealt twice');
  }
  assert.ok(PATTERN_CARDS.length >= 10);
});

test('choosing a window: your own four only, once, and the game starts when all have chosen', () => {
  const rng = seeded(5);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 3 });
  game.addHuman(room, 2, 'B');
  game.addHuman(room, 3, 'C');
  game.start(room, 1, rng);
  const [mine, theirs] = [room.options[0], room.options[1]];
  for (const bad of [undefined, null, 5, '', '__proto__', '99.9', {}, [], theirs[0], 'test.blank']) {
    const result = game.chooseWindow(room, 0, bad);
    assert.equal(result.ok, false);
    assert.ok(!result.error.includes(theirs[0]) && !JSON.stringify(result).includes(room.options[2][0]), 'no leak in the error');
  }
  assert.equal(game.chooseWindow(room, 0, mine[2]).ok, true);
  assert.equal(game.chooseWindow(room, 0, mine[1]).ok, false, 'only once');
  assert.equal(room.phase, 'windows');
  assert.equal(game.placeDie(room, 0, { die: 1, cell: 0 }).ok, false, 'the game has not begun');
  assert.equal(game.chooseWindow(room, 2, room.options[2][3]).ok, true);
  assert.equal(room.phase, 'windows');
  assert.equal(game.chooseWindow(room, 1, theirs[0], rng).ok, true);
  assert.equal(room.phase, 'playing');
  assert.equal(room.patterns[0], mine[2]);
  assert.deepEqual(room.tokens, room.patterns.map((p) => patternOf(p).difficulty), 'favour tokens = difficulty');
});

// ---- setting up a game ----

test('a started game: pool size, exact bag, tools, objectives, private colours, tokens', () => {
  for (const n of SIZES) {
    const { room } = playingRoom(n, { seed: n });
    assert.equal(room.round, 1);
    assert.equal(room.pool.length, poolSize(n));
    assert.equal(room.pool.length, 2 * n + 1);
    assert.equal(room.bag.length, bagSize(n) - poolSize(n));
    assert.ok(room.pool.every((d) => d.v >= 1 && d.v <= 6));
    assert.equal(new Set(room.tools).size, 3);
    assert.ok(room.tools.every((id) => game.toolOf(id)));
    assert.equal(new Set(room.publicIds).size, 3);
    assert.equal(new Set(room.privateColours).size, n, 'one private colour each, no repeats');
    assert.ok(room.privateColours.every((c) => COLOURS.includes(c)));
    assert.deepEqual(room.order, game.snakeOrder(0, n));
    assert.equal(room.turn.seat, 0);
    assertInvariants(room, `n=${n}`);
  }
  assert.equal(new Set(playingRoom(5).room.privateColours).size, 5, 'five players use all five colours');
});

test('twelve tools, ten objectives, every tool described', () => {
  assert.equal(game.TOOLS.length, 12);
  assert.equal(new Set(game.TOOL_IDS).size, 12);
  for (const t of game.TOOLS) assert.ok(t.name && t.text && t.how && typeof t.prepare === 'function');
});

// ---- turns and rounds ----

/** Ends every turn without doing anything, recording whose turn it was. */
function passRound(room, rng) {
  const seen = [];
  const round = room.round;
  while (room.round === round && room.phase === 'playing') {
    seen.push(room.turn.seat);
    assert.equal(game.endTurn(room, room.turn.seat, rng).ok, true);
  }
  return seen;
}

test('snake turn order and first-player rotation over a whole game, for two to five players', () => {
  for (const n of SIZES) {
    const { room, rng } = playingRoom(n, { seed: 10 + n });
    for (let round = 1; round <= game.ROUNDS; round++) {
      assert.equal(room.round, round);
      assert.equal(room.first, (round - 1) % n, `first player of round ${round}`);
      const expected = game.snakeOrder((round - 1) % n, n);
      assert.equal(room.pool.length, poolSize(n), 'a fresh pool every round');
      assert.deepEqual(passRound(room, rng), expected);
      if (round < game.ROUNDS) assertInvariants(room, `n=${n} round ${round}`);
    }
    assert.equal(room.phase, 'finished');
    assertInvariants(room, `n=${n} finished`);
    assert.equal(room.history.length, game.ROUNDS + 1);
  }
});

test('with nobody placing, the whole bag ends up on the round track: exact exhaustion', () => {
  for (const n of SIZES) {
    const { room, rng } = playingRoom(n, { seed: 20 + n });
    for (let round = 1; round <= game.ROUNDS; round++) {
      assert.equal(room.bag.length, bagSize(n) - round * poolSize(n), `n=${n} round ${round}: the bag shrinks by one pool a round`);
      passRound(room, rng);
    }
    assert.equal(room.bag.length, 0, `n=${n}: no leftovers`);
    assert.equal(room.track.length, game.ROUNDS);
    assert.ok(room.track.every((dice) => dice.length === poolSize(n)));
    assert.equal(room.track.flat().length, bagSize(n));
  }
});

test('leftover dice go to the round track in order, placed dice do not', () => {
  const { room, rng } = playingRoom(2, { seed: 4 });
  const first = room.pool.map((d) => d.id);
  const target = room.pool[0];
  const cell = [0, 1, 2, 3, 4].find((c) => game.placeDie(structuredClone(room), 0, { die: target.id, cell: c }).ok);
  assert.equal(game.placeDie(room, 0, { die: target.id, cell }).ok, true);
  assert.equal(room.turn.seat, 0, 'a turn goes on until the player ends it');
  passRound(room, rng);
  assert.deepEqual(room.track[0].map((d) => d.id).sort(), first.filter((id) => id !== target.id).sort());
  assert.equal(room.grids[0][cell].id, target.id);
});

test('placing a die: whose turn, which die, which space, once per turn', () => {
  const { room, rng } = lab(2, { pool: [die('ruby', 3, 501), die('jade', 5, 502), die('topaz', 3, 503)] });
  failsAtomically(room, () => game.placeDie(room, 1, { die: 501, cell: 0 }), /not your turn/);
  for (const bad of [{}, { die: 999, cell: 0 }, { die: '501', cell: 0 }, { die: 501 }, { die: 501, cell: -1 }, { die: 501, cell: 20 }, { die: 501, cell: 1.5 }, { die: 501, cell: '0' }, { die: null, cell: null }]) {
    failsAtomically(room, () => game.placeDie(room, 0, bad));
  }
  failsAtomically(room, () => game.placeDie(room, 0, { die: 501, cell: at(1, 2) }), /edge or corner/);
  assert.equal(game.placeDie(room, 0, { die: 501, cell: 0 }, rng).ok, true);
  failsAtomically(room, () => game.placeDie(room, 0, { die: 502, cell: 1 }), /already placed/);
  assert.equal(room.tally[0].dicePlaced, 1);
  assert.equal(game.endTurn(room, 0, rng).ok, true);
  failsAtomically(room, () => game.endTurn(room, 0), /not your turn/);
  assert.equal(room.turn.seat, 1);
  // Seat 1's window is empty: its first die is on an edge, like everybody's.
  failsAtomically(room, () => game.placeDie(room, 1, { die: 502, cell: at(1, 1) }), /edge/);
});

test('a turn ends by itself once the die has been placed and a tool used', () => {
  const { room, rng } = lab(2, { pool: [die('ruby', 3, 501), die('jade', 5, 502)] });
  assert.equal(game.useTool(room, 0, { tool: 'lathe', params: { die: 502, delta: -1 } }, rng).ok, true);
  assert.equal(room.turn.seat, 0, 'the die is still to place');
  assert.equal(game.placeDie(room, 0, { die: 501, cell: 0 }, rng).ok, true);
  assert.equal(room.turn.seat, 1);
  assert.equal(room.turnIndex, 1);
});

test('actions outside the game or its phases fail cleanly', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 2 });
  assert.equal(game.placeDie(room, 0, { die: 1, cell: 0 }).ok, false);
  assert.equal(game.useTool(room, 0, { tool: 'lathe', params: {} }).ok, false);
  assert.equal(game.endTurn(room, 0).ok, false);
  assert.equal(game.chooseWindow(room, 0, '0.0').ok, false);
  assert.equal(game.playAgain(room, 1).ok, false, 'the game is not over');
  for (const junk of [undefined, null, 5, 'x', [], {}]) {
    assert.equal(game.placeDie(room, 0, junk).ok, false);
    assert.equal(game.useTool(room, 0, junk).ok, false);
  }
});

// ---- tools ----

test('tool cost: 1 favour token the first time, 2 every time after, tokens sit on the card', () => {
  const { room, rng } = lab(2, { pool: [die('ruby', 3, 501), die('jade', 5, 502)], tokens: 6 });
  assert.equal(game.toolCost(room, 0), 1);
  assert.deepEqual(game.useTool(room, 0, { tool: 'lathe', params: { die: 501, delta: 1 } }, rng), { ok: true, cost: 1 });
  assert.equal(room.tokens[0], 5);
  assert.deepEqual(room.spent, [1, 0, 0]);
  assert.equal(game.toolCost(room, 0), 2, 'now it costs two');
  assert.equal(game.toolCost(room, 1), 1, 'other cards are untouched');
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'refire', params: { die: 501 } }), /already used a tool/);
  game.endTurn(room, 0, rng);
  game.endTurn(room, 1, rng);
  game.endTurn(room, 1, rng);
  assert.equal(room.turn.seat, 0);
  room.pool = [die('ruby', 3, 501)];
  assert.equal(game.useTool(room, 0, { tool: 'lathe', params: { die: 501, delta: 1 } }, rng).cost, 2, 'a later use, by anybody, costs two');
  assert.equal(room.tokens[0], 3);
  assert.deepEqual(room.spent, [3, 0, 0]);
  // The other player pays 2 as well for a card somebody has used.
  game.endTurn(room, 0, rng); // the round ends; seat 1 starts round 2
  assert.equal(room.turn.seat, 1);
  room.pool = [die('ruby', 3, 501)];
  assert.equal(game.useTool(room, 1, { tool: 'lathe', params: { die: 501, delta: -1 } }, rng).cost, 2);
  assert.equal(room.tokens[1], 4);
  assert.deepEqual(room.spent, [5, 0, 0]);
  assert.equal(room.tokens.reduce((a, b) => a + b, 0) + room.spent.reduce((a, b) => a + b, 0), room.tokenTotal, 'tokens are conserved');
});

test('a tool you cannot afford, or that is not in the game, changes nothing', () => {
  const { room } = lab(2, { pool: [die('ruby', 3, 501)], tokens: 0 });
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'lathe', params: { die: 501, delta: 1 } }), /costs 1 favour token and you have 0/);
  room.tokens[0] = 1;
  room.spent[0] = 1;
  room.tokenTotal++;
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'lathe', params: { die: 501, delta: 1 } }), /costs 2 favour tokens and you have 1/);
  for (const tool of ['mirror', 'nonsense', '', '__proto__', 'constructor', 5, null, undefined, {}, []]) failsAtomically(room, () => game.useTool(room, 0, { tool, params: {} }));
  failsAtomically(room, () => game.useTool(room, 1, { tool: 'refire', params: { die: 501 } }), /not your turn/);
});

test('Lathe: one shade up or down, never wrapping', () => {
  const { room } = lab(2, { pool: [die('ruby', 6, 501), die('jade', 1, 502), die('topaz', 3, 503)] });
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'lathe', params: { die: 501, delta: 1 } }), /6 cannot go up/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'lathe', params: { die: 502, delta: -1 } }), /1 cannot go down/);
  for (const delta of [0, 2, -2, '1', null, undefined, 1.5, NaN]) failsAtomically(room, () => game.useTool(room, 0, { tool: 'lathe', params: { die: 503, delta } }), /raise or to lower/);
  for (const die of [900, '503', undefined, null]) failsAtomically(room, () => game.useTool(room, 0, { tool: 'lathe', params: { die, delta: 1 } }), /pool/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'lathe', params: null }));
  assert.equal(game.useTool(room, 0, { tool: 'lathe', params: { die: 501, delta: -1 } }).ok, true);
  assert.equal(room.pool[0].v, 5);
});

test('Exchange: swaps a pool die with a round-track die', () => {
  const { room } = lab(2, { pool: [die('ruby', 3, 501), die('jade', 5, 502)] });
  room.track = [[die('topaz', 2, 601), die('sapphire', 6, 602)], [die('amethyst', 1, 603)]];
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'exchange', params: { die: 501, trackDie: 999 } }), /round track/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'exchange', params: { die: 502, trackDie: 502 } }), /round track/, 'a pool die is not on the track');
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'exchange', params: { die: 999, trackDie: 601 } }), /pool/);
  assert.equal(game.useTool(room, 0, { tool: 'exchange', params: { die: 501, trackDie: 603 } }).ok, true);
  assert.deepEqual(room.pool.map((d) => d.id), [603, 502]);
  assert.deepEqual(room.track[1].map((d) => d.id), [501]);
  assert.equal(room.pool[0].c, 'amethyst');
  assert.equal(room.track[1][0].v, 3, 'dice keep their faces');
  const { room: empty } = lab(2, { pool: [die('ruby', 3, 501)] });
  failsAtomically(empty, () => game.useTool(empty, 0, { tool: 'exchange', params: { die: 501, trackDie: 1 } }), /round track/);
});

test('Re-fire: rolls one die again, others untouched', () => {
  const { room } = lab(2, { pool: [die('ruby', 3, 501), die('jade', 5, 502)] });
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'refire', params: { die: 9 } }), /pool/);
  assert.equal(game.useTool(room, 0, { tool: 'refire', params: { die: 501 } }, () => 0.99).ok, true);
  assert.deepEqual(room.pool.map((d) => d.v), [6, 5]);
  const again = lab(2, { pool: [die('ruby', 3, 501)] });
  game.useTool(again.room, 0, { tool: 'refire', params: { die: 501 } }, () => 0);
  assert.equal(again.room.pool[0].v, 1);
});

test('Great Kiln: all dice again, only on the second turn, before placing', () => {
  const { room, rng } = lab(2, { pool: [die('ruby', 3, 501), die('jade', 5, 502)], tools: ['kiln', 'lathe', 'refire'] });
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'kiln', params: {} }), /second turn/);
  game.endTurn(room, 0, rng);
  game.endTurn(room, 1, rng);
  assert.equal(room.turn.number, 2);
  assert.equal(room.turn.seat, 1);
  room.pool = [die('ruby', 3, 501), die('jade', 5, 502)];
  assert.equal(game.placeDie(room, 1, { die: 501, cell: 0 }).ok, true);
  failsAtomically(room, () => game.useTool(room, 1, { tool: 'kiln', params: {} }), /before you place/);
  game.endTurn(room, 1, rng);
  assert.equal(room.turn.seat, 0);
  assert.equal(room.turn.number, 2);
  assert.equal(game.useTool(room, 0, { tool: 'kiln', params: {} }, () => 0.5).ok, true);
  assert.deepEqual(room.pool.map((d) => d.v), [4]);
  const empty = lab(2, { pool: [], tools: ['kiln', 'lathe', 'refire'] });
  empty.room.turn.number = 2;
  failsAtomically(empty.room, () => game.useTool(empty.room, 0, { tool: 'kiln', params: {} }), /no dice/);
});

test('Mirror: the opposite face', () => {
  const { room } = lab(2, { pool: [die('ruby', 1, 501), die('jade', 2, 502), die('topaz', 3, 503), die('sapphire', 4, 504), die('amethyst', 5, 505), die('ruby', 6, 506)], tools: ['mirror', 'lathe', 'refire'] });
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'mirror', params: { die: 1 } }), /pool/);
  assert.equal(game.useTool(room, 0, { tool: 'mirror', params: { die: 502 } }).ok, true);
  assert.deepEqual(room.pool.map((d) => d.v), [1, 5, 3, 4, 5, 6]);
  for (const [v, opposite] of [[1, 6], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]]) {
    const one = lab(2, { pool: [die('ruby', v, 501)], tools: ['mirror', 'lathe', 'refire'] });
    game.useTool(one.room, 0, { tool: 'mirror', params: { die: 501 } });
    assert.equal(one.room.pool[0].v, opposite);
  }
});

const THREE = [[0, 0, 'ruby', 1], [0, 1, 'jade', 2], [0, 2, 'topaz', 3]];

test('Slide Rule: moves one die, obeying every placement rule', () => {
  const { room } = lab(2, { tools: ['slide', 'twin', 'tint'] });
  fillWindow(room, 0, THREE);
  const grid = () => room.grids[0].map((d) => d?.id ?? null);
  const before = grid();
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'slide', params: { from: at(3, 3), to: at(1, 0) } }), /no die/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'slide', params: { from: at(0, 0), to: at(0, 1) } }), /already holds/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'slide', params: { from: at(0, 0), to: at(3, 4) } }), /touch/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'slide', params: { from: at(0, 2), to: at(0, 2) } }), /different space/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'slide', params: { from: 'a', to: 1 } }));
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'slide', params: {} }));
  assert.deepEqual(grid(), before);
  assert.equal(game.useTool(room, 0, { tool: 'slide', params: { from: at(0, 2), to: at(1, 2) } }).ok, true);
  assert.equal(room.grids[0][at(1, 2)].id, 802);
  assert.equal(room.grids[0][at(0, 2)], null);
  assert.equal(room.tokens[0], 4);
});

test('Slide Rule cannot break the colour or shade restrictions or the like-dice rule', () => {
  const { room } = lab(2, { pid: 'test.mix', tools: ['slide', 'twin', 'tint'] });
  fillWindow(room, 0, [[0, 0, 'ruby', 1], [0, 1, 'jade', 2], [0, 2, 'topaz', 3]]);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'slide', params: { from: at(0, 1), to: at(1, 1) } }), /Sapphire/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'slide', params: { from: at(0, 1), to: at(1, 2) } }), /showing 4/);
  fillWindow(room, 0, [[1, 0, 'amethyst', 2]]);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'slide', params: { from: at(0, 2), to: at(1, 1) } }), /Sapphire/);
});

test('Twin Slide: exactly two moves, one after the other, all or nothing', () => {
  const { room } = lab(2, { tools: ['twin', 'slide', 'tint'] });
  fillWindow(room, 0, THREE);
  const move = (from, to) => ({ from, to });
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'twin', params: { moves: [move(at(0, 2), at(1, 2))] } }), /exactly 2 dice/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'twin', params: { moves: [move(at(0, 2), at(1, 2)), move(at(0, 0), at(1, 0)), move(at(0, 1), at(1, 1))] } }), /exactly 2/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'twin', params: { moves: 'x' } }));
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'twin', params: { moves: [move(at(0, 2), at(1, 2)), 5] } }));
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'twin', params: { moves: [move(at(0, 2), at(1, 2)), move(at(0, 0), at(3, 4))] } }), /touch/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'twin', params: { moves: [move(at(0, 2), at(1, 2)), move(at(1, 2), at(1, 3))] } }), /only be moved once/);
  assert.equal(game.useTool(room, 0, { tool: 'twin', params: { moves: [move(at(0, 2), at(1, 2)), move(at(0, 0), at(1, 0))] } }).ok, true);
  assert.deepEqual([at(1, 2), at(1, 0), at(0, 1)].map((i) => room.grids[0][i]?.id), [802, 800, 801]);
  assert.equal(room.grids[0].filter(Boolean).length, 3);
});

test('Twin Slide: the second move sees the window after the first (order matters)', () => {
  const { room } = lab(2, { tools: ['twin', 'slide', 'tint'] });
  fillWindow(room, 0, [[0, 0, 'ruby', 1], [0, 1, 'jade', 2]]);
  // Moving (0,1) away first leaves (0,0) alone; then moving (0,0) next to... the first die's new place works.
  const ok = game.useTool(structuredClone(room), 0, { tool: 'twin', params: { moves: [{ from: at(0, 1), to: at(1, 1) }, { from: at(0, 0), to: at(0, 1) }] } });
  assert.equal(ok.ok, true, 'a die can move into the gap the other one left');
  const bad = game.useTool(structuredClone(room), 0, { tool: 'twin', params: { moves: [{ from: at(0, 1), to: at(3, 4) }, { from: at(0, 0), to: at(1, 0) }] } });
  assert.equal(bad.ok, false);
});

test('Tint Shifter ignores the colour of the new space only', () => {
  const { room } = lab(2, { pid: 'test.mix', tools: ['tint', 'gauge', 'slide'] });
  fillWindow(room, 0, [[0, 0, 'ruby', 1], [0, 1, 'jade', 2]]);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'tint', params: { from: at(0, 1), to: at(1, 2) } }), /showing 4/, 'the shade of (1,2) still counts');
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'tint', params: { from: at(0, 1), to: at(3, 4) } }), /touch/);
  assert.equal(game.useTool(room, 0, { tool: 'tint', params: { from: at(0, 1), to: at(1, 1) } }).ok, true, 'a jade die on the sapphire space');
  assert.equal(room.grids[0][at(1, 1)].c, 'jade');
});

test('Gauge Breaker ignores the shade of the new space only', () => {
  const { room } = lab(2, { pid: 'test.mix', tools: ['gauge', 'tint', 'slide'] });
  fillWindow(room, 0, THREE);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'gauge', params: { from: at(0, 1), to: at(1, 1) } }), /Sapphire/, 'the colour of (1,1) still counts');
  assert.equal(game.useTool(room, 0, { tool: 'gauge', params: { from: at(0, 1), to: at(1, 2) } }).ok, true, 'a 2 on the 4 space');
  assert.equal(room.grids[0][at(1, 2)].v, 2);
  const like = lab(2, { pid: 'test.mix', tools: ['gauge', 'tint', 'slide'] });
  fillWindow(like.room, 0, [[0, 0, 'ruby', 1], [0, 1, 'jade', 2], [0, 2, 'topaz', 3], [1, 3, 'sapphire', 2]]);
  failsAtomically(like.room, () => game.useTool(like.room, 0, { tool: 'gauge', params: { from: at(0, 1), to: at(1, 2) } }), /showing 2 cannot sit beside/, 'like shades beside still count');
});

test('Track Echo: one or two dice of a colour that is on the round track', () => {
  const { room } = lab(2, { tools: ['echo', 'tint', 'slide'] });
  fillWindow(room, 0, [[0, 0, 'ruby', 1], [0, 1, 'jade', 2], [0, 3, 'ruby', 4]]);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'echo', params: { moves: [{ from: at(0, 0), to: at(1, 0) }] } }), /no Ruby die on the round track/);
  room.track = [[die('ruby', 5, 700), die('topaz', 2, 701)]];
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'echo', params: { moves: [{ from: at(0, 1), to: at(1, 1) }] } }), /no Jade die/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'echo', params: { moves: [{ from: at(0, 0), to: at(1, 0) }, { from: at(0, 1), to: at(1, 1) }] } }), /same colour/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'echo', params: { moves: [] } }), /1 to 2/);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'echo', params: { moves: [{ from: at(0, 0), to: at(1, 0) }, { from: at(0, 3), to: at(1, 3) }, { from: at(0, 0), to: at(2, 0) }] } }), /1 to 2/);
  assert.equal(game.useTool(room, 0, { tool: 'echo', params: { moves: [{ from: at(0, 0), to: at(1, 0) }, { from: at(0, 3), to: at(1, 2) }] } }).ok, true);
  assert.deepEqual([at(1, 0), at(1, 2)].map((i) => room.grids[0][i]?.c), ['ruby', 'ruby']);
});

test('Free Pane: places a die without the touching rule, as the turn\'s die', () => {
  const { room, rng } = lab(2, { tools: ['free-pane', 'lathe', 'refire'], pool: [die('ruby', 3, 501), die('jade', 5, 502)] });
  assert.equal(game.useTool(room, 0, { tool: 'free-pane', params: { die: 501, cell: at(2, 2) } }, rng).ok, true, 'the middle, as a first die');
  assert.equal(room.grids[0][at(2, 2)].id, 501);
  assert.equal(room.turn.seat, 1, 'die and tool both used: the turn ended');
  assert.deepEqual(room.pool.map((d) => d.id), [502]);
  assert.equal(room.tally[0].dicePlaced, 1);
  // Not as the second die of a turn, and neighbours still matter.
  const again = lab(2, { tools: ['free-pane', 'lathe', 'refire'], pool: [die('ruby', 3, 501), die('ruby', 4, 502)] });
  fillWindow(again.room, 0, [[2, 2, 'ruby', 1]]);
  failsAtomically(again.room, () => game.useTool(again.room, 0, { tool: 'free-pane', params: { die: 501, cell: at(2, 3) } }), /Ruby die cannot sit beside/);
  failsAtomically(again.room, () => game.useTool(again.room, 0, { tool: 'free-pane', params: { die: 501, cell: at(2, 2) } }), /already holds/);
  assert.equal(game.useTool(again.room, 0, { tool: 'free-pane', params: { die: 501, cell: at(3, 4) } }, rng).ok, true, 'far from everything is fine');
});

test('Free Pane cannot be used after the turn\'s die has been placed', () => {
  const { room } = lab(2, { tools: ['free-pane', 'lathe', 'refire'], pool: [die('ruby', 3, 501), die('jade', 5, 502)] });
  assert.equal(game.placeDie(room, 0, { die: 501, cell: 0 }).ok, true);
  failsAtomically(room, () => game.useTool(room, 0, { tool: 'free-pane', params: { die: 502, cell: at(3, 4) } }), /already placed/);
});

test('every tool leaves the dice, tokens and windows consistent (random uses over random games)', () => {
  const rng = seeded(77);
  for (let g = 0; g < 40; g++) {
    const n = 2 + (g % 4);
    const { room } = playingRoom(n, { seed: 500 + g });
    for (let step = 0; step < 400 && room.phase === 'playing'; step++) {
      const seat = room.turn.seat;
      const choice = Math.floor(rng() * 4);
      if (choice === 0 && room.pool.length) {
        const d = room.pool[Math.floor(rng() * room.pool.length)];
        game.placeDie(room, seat, { die: d.id, cell: Math.floor(rng() * 20) }, rng);
      } else if (choice === 1) {
        const tool = room.tools[Math.floor(rng() * 3)];
        const d = room.pool[Math.floor(rng() * room.pool.length)];
        const filled = room.grids[seat].flatMap((x, i) => (x ? [i] : []));
        const pick = () => filled[Math.floor(rng() * filled.length)];
        const params = { die: d?.id, delta: rng() < 0.5 ? 1 : -1, trackDie: room.track.flat()[0]?.id, from: pick(), to: Math.floor(rng() * 20), cell: Math.floor(rng() * 20), moves: [{ from: pick(), to: Math.floor(rng() * 20) }, { from: pick(), to: Math.floor(rng() * 20) }] };
        game.useTool(room, seat, { tool, params }, rng);
      } else if (choice === 2) game.endTurn(room, seat, rng);
      assertInvariants(room, `g${g}`);
    }
  }
});

// ---- scoring and tie-breaks ----

/** A finished-position room: all window states set by hand, then finalTable() reads it. */
function endRoom(n, { publicIds = ['deep-pairs', 'full-palette', 'colour-chains'], badPrivate = false, first = 0 } = {}) {
  const { room } = playingRoom(n, { seed: 1 });
  room.publicIds = publicIds;
  room.settings.badPrivate = badPrivate;
  room.first = first;
  room.order = game.snakeOrder(first, n);
  room.privateColours = COLOURS.slice(0, n);
  room.grids = room.seats.map(() => emptyGrid());
  room.tokens = room.seats.map(() => 0);
  return room;
}

test('final scoring: public + private + favour tokens - empty spaces, with a full breakdown', () => {
  const room = endRoom(2, { publicIds: ['rainbow-rows', 'pale-pairs', 'colour-chains'] });
  // Seat 0 (private colour ruby): row 0 = five colours, shades 1 2 3 4 5; ruby at (0,0) = 1.
  fillWindow(room, 0, [[0, 0, 'ruby', 1], [0, 1, 'topaz', 2], [0, 2, 'jade', 3], [0, 3, 'sapphire', 4], [0, 4, 'amethyst', 5]]);
  room.tokens[0] = 3;
  const table = game.finalTable(room);
  const row = table.rows[0];
  assert.equal(row.publicTotal, 6 + 2, 'rainbow row 6 + one pale pair 2, no chains');
  assert.equal(row.privatePoints, 1);
  assert.equal(row.empty, 15);
  assert.equal(row.total, 8 + 1 + 3 - 15);
  assert.deepEqual(row.publics.map((p) => [p.id, p.points]), [['rainbow-rows', 6], ['pale-pairs', 2], ['colour-chains', 0]]);
  assert.equal(table.rows[1].total, 0 + 0 + 0 - 20);
  assert.deepEqual(table.winners, [0]);
  assert.equal(row.placement, 1);
  assert.equal(table.rows[1].placement, 2);
});

test('final scoring with each private rule: 6, 2 and 4 are 12, or 9 with bad private scoring', () => {
  for (const [bad, expected] of [[false, 12], [true, 9]]) {
    const room = endRoom(3, { badPrivate: bad });
    fillWindow(room, 1, [[0, 0, 'topaz', 6], [0, 2, 'topaz', 2], [1, 1, 'topaz', 4], [0, 1, 'ruby', 5]]);
    room.privateColours = ['ruby', 'topaz', 'jade'];
    const table = game.finalTable(room);
    assert.equal(table.rows[1].privatePoints, expected);
    assert.equal(table.rows[0].privatePoints, 0, 'no ruby dice in that window');
    assert.equal(table.rows[1].total, table.rows[1].publicTotal + expected - 16);
  }
});

test('tie-break 1: more points wins', () => {
  const room = endRoom(3);
  room.tokens = [5, 3, 4];
  assert.deepEqual(game.finalTable(room).winners, [0]);
  assert.deepEqual(game.finalTable(room).rows.map((r) => r.placement), [1, 3, 2]);
});

test('tie-break 2: equal points, the higher private objective wins', () => {
  for (const bad of [false, true]) {
    const room = endRoom(3, { badPrivate: bad });
    room.privateColours = ['jade', 'ruby', 'topaz'];
    // Seat 0 has a jade 6 (private); seat 1 an amethyst 6 (not its colour). Tokens even the totals out.
    fillWindow(room, 0, [[0, 0, 'jade', 6]]);
    fillWindow(room, 1, [[0, 0, 'amethyst', 6]]);
    const worth = bad ? 3 : 6;
    room.tokens = [4, 4 + worth, 0];
    const table = game.finalTable(room);
    assert.equal(table.rows[0].total, table.rows[1].total, `totals are level (bad private scoring ${bad})`);
    assert.ok(table.rows[0].privatePoints > table.rows[1].privatePoints);
    assert.deepEqual(table.winners, [0], 'the higher private score wins even with fewer tokens');
  }
});

test('tie-break 3: equal points and private, the player with more favour tokens wins', () => {
  const room = endRoom(3);
  fillWindow(room, 0, [[0, 0, 'amethyst', 6], [3, 4, 'topaz', 2]]); // two dice, no private colour for seat 0 (ruby)
  fillWindow(room, 1, [[0, 0, 'amethyst', 6]]); // one die (jade private: none)
  room.tokens = [3, 4, 0];
  const table = game.finalTable(room);
  assert.equal(table.rows[0].total, table.rows[1].total);
  assert.equal(table.rows[0].privatePoints, table.rows[1].privatePoints);
  assert.deepEqual(table.winners, [1]);
});

test('tie-break 4: a complete tie goes to whoever is last in the final round\'s turn order', () => {
  for (const [n, first, last] of [[2, 0, 0], [3, 0, 0], [3, 1, 1], [3, 2, 2], [4, 3, 3], [5, 2, 2], [5, 0, 0]]) {
    const room = endRoom(n, { first });
    const table = game.finalTable(room);
    assert.deepEqual(table.winners, [last], `${n} players, first player ${first}: the first player also moves last in a snake`);
    assert.equal(game.snakeOrder(first, n).at(-1), last);
  }
});

test('ties among the leaders only: placements and winners', () => {
  const room = endRoom(4);
  room.tokens = [5, 5, 2, 1];
  const table = game.finalTable(room);
  assert.deepEqual(table.winners, [0], 'seat 0 moves last in the final round (first player 0)');
  assert.deepEqual(table.rows.map((r) => r.placement), [1, 2, 3, 4]);
});

test('the winner list is never empty and never more than the tied seats', () => {
  for (let g = 0; g < 200; g++) {
    const n = 2 + (g % 4);
    const rng = seeded(g);
    const room = endRoom(n, { first: g % n, badPrivate: g % 2 === 0 });
    room.tokens = room.tokens.map(() => Math.floor(rng() * 4));
    const table = game.finalTable(room);
    assert.ok(table.winners.length >= 1 && table.winners.length <= n);
    const top = Math.max(...table.rows.map((r) => r.total));
    assert.ok(table.winners.every((s) => table.rows[s].total === top));
  }
});

// ---- whole games ----

test('the scoreboard history: Round 1 to 10, then the private objectives; the winner is noted', async () => {
  const bot = await import('./bot.js');
  for (const n of SIZES) {
    const { room } = playingRoom(n, { seed: 900 + n });
    room.seats = room.seats.map((_, i) => ({ kind: 'bot', id: `bot:${i}`, name: `Bot ${i}` }));
    let rounds = 0;
    for (let guard = 0; bot.pendingAction(room) && guard < 5000; guard++) {
      bot.runPending(room);
      if (room.history.length !== rounds) {
        rounds = room.history.length;
        if (room.phase === 'playing') {
          const view = game.viewFor(room, 1);
          const sums = Object.fromEntries(view.scoreboard.players.map((p) => [p.id, view.scoreboard.rounds.reduce((s, r) => s + r.deltas[p.id], 0)]));
          for (const p of view.scoreboard.players) assert.equal(p.score, sums[p.id], 'at the end of a round the bar equals the table');
          assert.equal(view.scoreboard.rounds.at(-1).label, `Round ${rounds}`);
        }
      }
    }
    assert.equal(room.phase, 'finished');
    const view = game.viewFor(room, 1);
    assert.equal(view.scoreboard.rounds.length, 11);
    assert.deepEqual(view.scoreboard.rounds.map((r) => r.label), [...Array.from({ length: 10 }, (_, i) => `Round ${i + 1}`), 'Private objectives']);
    for (const p of view.scoreboard.players) {
      assert.equal(p.score, room.final.players[p.id].total);
      assert.equal(view.scoreboard.rounds.reduce((s, r) => s + r.deltas[p.id], 0), p.score, 'the table adds up to the final score');
    }
    assert.equal(view.scoreboard.provisional, false);
    assert.ok(room.winners.every((s) => view.scoreboard.rounds.at(-1).notes[s] === 'wins'));
  }
});

test('stats: wins, placements, scores and the declared extras', () => {
  const room = endRoom(3);
  room.seats = [{ kind: 'human', id: 11, name: 'A' }, { kind: 'bot', id: 'bot:1', name: 'B' }, { kind: 'human', id: 12, name: 'C' }];
  fillWindow(room, 0, [[0, 0, 'amethyst', 6]]);
  room.grids[2] = Array.from({ length: 20 }, (_, i) => die('ruby', 1, 3000 + i)); // a "perfect" window for the extras
  room.tokens = [9, 0, 0];
  room.tally = [{ dicePlaced: 7, toolsUsed: 2 }, { dicePlaced: 1, toolsUsed: 0 }, { dicePlaced: 20, toolsUsed: 1 }];
  const table = game.finalTable(room);
  room.final = { players: table.rows };
  room.winners = table.winners;
  const stats = game.statsPlayers(room);
  assert.equal(stats.length, 2, 'the computer player is not recorded');
  const a = stats.find((s) => s.userId === 11);
  const c = stats.find((s) => s.userId === 12);
  assert.equal(a.extras.dicePlaced, 7);
  assert.equal(a.extras.toolsUsed, 2);
  assert.equal(a.extras.perfectWindows, 0);
  assert.equal(c.extras.perfectWindows, 1);
  assert.equal(a.score, table.rows[0].total);
  assert.equal(a.outcome, table.winners.includes(0) ? 'win' : 'loss');
  assert.ok(Object.values(a.extras).every(Number.isFinite));
  for (const key of game.STAT_KEYS) assert.ok(key in a.extras);
});

// ---- what each player sees ----

test('views never contain the bag, other private objectives or other players\' window choices', () => {
  for (const n of SIZES) {
    const rng = seeded(n);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: n });
    for (let i = 2; i <= n; i++) game.addHuman(room, i, `P${i}`);
    game.start(room, 1, rng);
    for (let seat = 0; seat < n; seat++) {
      const view = game.viewFor(room, seat + 1);
      assert.equal(view.options.length, 4);
      assert.deepEqual(view.options.map((o) => o.pid), room.options[seat]);
      assert.deepEqual(viewLeaks(room, view), []);
    }
    assert.deepEqual(viewLeaks(room, game.viewFor(room, 999)), [], 'a stranger sees nothing');
    assert.equal(game.viewFor(room, 999).options.length, 0);
    for (let seat = 0; seat < n; seat++) game.chooseWindow(room, seat, room.options[seat][seat % 4], rng);
    assert.equal(room.phase, 'playing');
    for (let seat = 0; seat < n; seat++) {
      const view = game.viewFor(room, seat + 1);
      assert.deepEqual(viewLeaks(room, view), []);
      assert.equal(view.privateObjective.colour, room.privateColours[seat], 'your own private colour');
      assert.equal(view.bagCount, room.bag.length, 'only how many are left');
      assert.ok(!('bag' in view));
      assert.equal(view.pool.length, poolSize(n));
    }
    const stranger = game.viewFor(room, 999);
    assert.equal(stranger.privateObjective, null);
    assert.equal(stranger.you, -1);
  }
});

test('during the window phase nobody learns what the others chose; afterwards windows are public', () => {
  const rng = seeded(8);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'A', size: 2 });
  game.addHuman(room, 2, 'B');
  game.start(room, 1, rng);
  game.chooseWindow(room, 0, room.options[0][1], rng);
  const theirs = game.viewFor(room, 2);
  assert.equal(theirs.seats[0].picked, true);
  assert.equal(theirs.seats[0].window, null, 'the choice stays secret');
  assert.ok(!JSON.stringify(theirs).includes(`"${room.options[0][1]}"`));
  assert.equal(theirs.seats[1].picked, false);
  assert.equal(game.viewFor(room, 1).chosen, room.options[0][1]);
  assert.equal(game.viewFor(room, 2).chosen, null);
  game.chooseWindow(room, 1, room.options[1][0], rng);
  const after = game.viewFor(room, 2);
  assert.equal(after.seats[0].window.pid, room.options[0][1]);
  assert.ok(after.seats[0].window.rows.length === 4);
});

test('the final view reveals every private objective and the breakdown; earlier views do not', () => {
  const { room } = playingRoom(3, { seed: 3 });
  assert.equal(game.viewFor(room, 1).final, null);
  assert.ok(!/privateColour/.test(JSON.stringify(game.viewFor(room, 1))));
  const rng = seeded(3);
  while (room.phase === 'playing') game.endTurn(room, room.turn.seat, rng);
  const view = game.viewFor(room, 2);
  assert.equal(view.final.players.length, 3);
  assert.deepEqual(view.final.players.map((p) => p.privateColour), room.privateColours);
  assert.equal(view.privateObjective, null);
  assert.deepEqual(view.winners, room.winners);
});

test('play again returns to the lobby and keeps the seats and the setting', () => {
  const { room, rng } = playingRoom(2, { seed: 6 });
  room.settings.badPrivate = true;
  while (room.phase === 'playing') game.endTurn(room, room.turn.seat, rng);
  assert.equal(game.playAgain(room, 2).ok, false, 'only the host');
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.history.length, 0);
  assert.equal(room.settings.badPrivate, true);
  assert.equal(room.seats.length, 2);
  assert.deepEqual(room.final, null);
});

// ---- Swift Hand: a whole extra turn straight after the current one, then the later second turn is skipped ----

const swiftLab = (n, { tokens = 5, seed = 3 } = {}) => {
  const { room, rng } = lab(n, { tools: ['swift-hand', 'lathe', 'refire'], tokens, seed, pool: [] });
  room.pool = Array.from({ length: 2 * n + 1 }, (_, i) => die(['ruby', 'topaz', 'jade', 'sapphire', 'amethyst'][i % 5], 1 + (i % 6), 500 + i));
  return { room, rng };
};
const swift = (room, seat, rng) => game.useTool(room, seat, { tool: 'swift-hand', params: {} }, rng);
/** Plays out the round with every player ending at once, and returns the turns taken as 'seat:number' (x = extra turn). */
function turnsOfRound(room, rng, { onTurn = null } = {}) {
  const taken = [];
  const round = room.round;
  while (room.round === round && room.phase === 'playing') {
    const { seat, number, extra } = room.turn;
    taken.push(`${seat}:${number}${extra ? 'x' : ''}`);
    onTurn?.(room.turn);
    if (room.turn.seat === seat && room.turn.number === number && room.turn.extra === extra) assert.equal(game.endTurn(room, seat, rng).ok, true);
  }
  return taken;
}

test('Swift Hand: finishing the turn starts a fresh full turn for the same player, with everything usable again', () => {
  const { room, rng } = swiftLab(3);
  const user = room.turn.seat;
  assert.equal(swift(room, user, rng).ok, true);
  assert.equal(room.turn.toolUsed, true);
  assert.equal(game.placeDie(room, user, { die: room.pool[0].id, cell: 0 }, rng).ok, true);
  // die and tool are both used, so the turn ended by itself and the extra turn began
  assert.equal(room.turn.seat, user);
  assert.equal(room.turn.extra, true);
  assert.deepEqual([room.turn.placements, room.turn.toolUsed, room.turn.number], [0, false, 1]);
  const view = game.viewFor(room, 1).turn;
  assert.deepEqual([view.extra, view.allowed, view.placements], [true, 1, 0]);
  assert.ok(room.log.some((l) => /takes an extra turn/.test(l.text)));
  // a full second turn: another die and another tool (1 token, since refire was never used)
  assert.equal(game.placeDie(room, user, { die: room.pool[0].id, cell: 1 }, rng).ok, true);
  assert.equal(room.turn.seat, user, 'the tool is still to come');
  assert.equal(game.useTool(room, user, { tool: 'refire', params: { die: room.pool[0].id } }, rng).ok, true);
  assert.notEqual(room.turn.seat, user, 'only after the extra turn does anyone else move');
  assert.equal(room.tokens[user], 5 - 1 - 1);
});

test('Swift Hand: placing first, then using the tool also gives the extra turn', () => {
  const { room, rng } = swiftLab(2);
  const user = room.turn.seat;
  assert.equal(game.placeDie(room, user, { die: room.pool[0].id, cell: 0 }, rng).ok, true);
  assert.equal(room.turn.seat, user);
  assert.equal(swift(room, user, rng).ok, true, 'the tool still works after the die');
  // die and tool are both used, so the turn ends by itself and the extra turn begins
  assert.deepEqual([room.turn.seat, room.turn.extra, room.turn.placements], [user, true, 0]);
  assert.equal(game.endTurn(room, user, rng).ok, true, 'the extra turn can be ended without doing anything');
  assert.notEqual(room.turn.seat, user);
});

test('Swift Hand: End turn alone is enough, and it cannot be used again in the extra turn', () => {
  const { room, rng } = swiftLab(2, { tokens: 9 });
  const user = room.turn.seat;
  assert.equal(swift(room, user, rng).ok, true);
  assert.equal(game.endTurn(room, user, rng).ok, true);
  assert.equal(room.turn.extra, true);
  failsAtomically(room, () => swift(room, user, rng), /already taking an extra turn/);
  assert.equal(room.tokens[user], 8);
});

test('Swift Hand: the extra turn is followed by the normal order and the later second turn is skipped, at every position and size', () => {
  for (const n of [2, 3, 4, 5]) {
    for (let position = 0; position < n; position++) {
      const { room, rng } = swiftLab(n, { seed: 20 + n });
      const forward = Array.from({ length: n }, (_, i) => (room.first + i) % n);
      const user = forward[position];
      const normal = [...forward.map((s) => `${s}:1`), ...forward.slice().reverse().map((s) => `${s}:2`)];
      const expected = normal.flatMap((turn) => (turn === `${user}:1` ? [turn, `${user}:1x`] : turn === `${user}:2` ? [] : [turn]));
      let used = false;
      const taken = turnsOfRound(room, rng, {
        onTurn: (turn) => {
          if (!used && turn.seat === user && turn.number === 1 && !turn.extra) {
            used = true;
            assert.equal(swift(room, user, rng).ok, true);
          }
        },
      });
      assert.deepEqual(taken, expected, `${n} players, user in position ${position + 1}`);
      assert.equal(room.round, 2, 'the round ended and the next began');
      assert.equal(room.skip.some(Boolean), false, 'the skip does not carry on');
      assert.equal(room.log.filter((l) => /skips their second turn/.test(l.text)).length, 1);
    }
  }
});

test('Swift Hand: the player at the turn of the snake order whose second turn directly follows the first gets exactly two turns in a row', () => {
  const { room, rng } = swiftLab(3);
  const last = (room.first + 2) % 3;
  const taken = turnsOfRound(room, rng, {
    onTurn: (turn) => {
      if (turn.seat === last && turn.number === 1 && !turn.extra) assert.equal(swift(room, last, rng).ok, true);
    },
  });
  assert.deepEqual(taken.filter((t) => t.startsWith(`${last}:`)), [`${last}:1`, `${last}:1x`]);
  assert.equal(taken.length, 6);
});

test('Swift Hand: when the round ends the pool is rolled once and the first player moves on', () => {
  const { room, rng } = swiftLab(2);
  const user = room.turn.seat;
  const before = room.first;
  swift(room, user, rng);
  turnsOfRound(room, rng);
  assert.equal(room.round, 2);
  assert.equal(room.pool.length, 5);
  assert.notEqual(room.first, before);
  assert.equal(room.turn.extra, false);
  assert.equal(room.track.length, 1);
});

test('Swift Hand: a failed use changes nothing, a repeat is refused, and it is only for the first turn', () => {
  const poor = swiftLab(2, { tokens: 0 });
  failsAtomically(poor.room, () => swift(poor.room, poor.room.turn.seat, poor.rng), /costs 1 favour/);
  assert.equal(poor.room.turn.swift, false);
  const rich = swiftLab(2);
  assert.equal(swift(rich.room, rich.room.turn.seat, rich.rng).ok, true);
  failsAtomically(rich.room, () => swift(rich.room, rich.room.turn.seat, rich.rng), /already used a tool/);
  failsAtomically(rich.room, () => swift(rich.room, 1 - rich.room.turn.seat, rich.rng), /not your turn/);
  const second = swiftLab(2);
  game.endTurn(second.room, second.room.turn.seat, second.rng);
  game.endTurn(second.room, second.room.turn.seat, second.rng);
  assert.equal(second.room.turn.number, 2);
  failsAtomically(second.room, () => swift(second.room, second.room.turn.seat, second.rng), /first turn/);
});

test('Swift Hand: a game saved and restored mid-extra-turn carries on, and a player who leaves is replaced by a computer that finishes it', () => {
  const { room, rng } = swiftLab(2);
  const user = room.turn.seat;
  swift(room, user, rng);
  game.endTurn(room, user, rng);
  assert.equal(room.turn.extra, true);
  const restored = JSON.parse(JSON.stringify(room));
  assert.deepEqual(restored.turn, room.turn);
  assert.equal(game.viewFor(restored, 1).turn.extra, true);
  assert.equal(game.placeDie(restored, user, { die: restored.pool[0].id, cell: 0 }, rng).ok, true);
  const taken = turnsOfRound(restored, rng);
  assert.deepEqual(taken.filter((t) => t.startsWith(`${user}:`)), [`${user}:1x`], 'the skipped second turn never comes');
  assert.equal(restored.round, 2);

  const left = swiftLab(2);
  const seat = left.room.turn.seat;
  swift(left.room, seat, left.rng);
  game.endTurn(left.room, seat, left.rng);
  assert.equal(game.removeHuman(left.room, left.room.seats[seat].id, left.rng).ok, true);
  assert.equal(left.room.turn.extra, true);
  assert.equal(game.isBot(left.room.seats[seat]), true);
  assert.ok(['place', 'tool', 'end'].includes(botStep(left.room, seat, left.rng).type));
});

test('Swift Hand: a computer player that has it takes the extra turn, and whole games with it on the table stay consistent', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { room, rng } = playingRoom(2 + (seed % 3), { seed });
    room.seats.forEach((s) => (s.bot = true));
    room.tools = ['swift-hand', 'lathe', 'refire'];
    room.spent = [0, 0, 0];
    const user = room.turn.seat;
    assert.equal(swift(room, user, rng).ok, true);
    for (let i = 0; i < 10 && !room.turn.extra; i++) driveStep(room, rng);
    assert.equal(room.turn.extra, true, 'the computer player ended its first turn and the extra one began');
    assert.equal(room.turn.seat, user);
    for (let i = 0; i < 10 && room.turn.seat === user; i++) driveStep(room, rng);
    assert.notEqual(room.turn.seat, user, 'and finished it');
    for (let i = 0; i < 4000 && room.phase !== 'finished'; i++) driveStep(room, rng);
    assert.equal(room.phase, 'finished');
    assertInvariants(room, 'bots with swift hand, seed ' + seed);
  }
});

// ---- the window-choice phase: what is dealt before the windows, and who has chosen ----

function windowsRoomOf(n, seed = 5) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'p1', size: n });
  for (let i = 2; i <= n; i++) game.addHuman(room, i, `p${i}`);
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(room.phase, 'windows');
  return { room, rng };
}

test('window choice: each viewer sees their own private objective, and the public objectives and tools, before choosing', () => {
  const { room } = windowsRoomOf(3);
  for (let seat = 0; seat < 3; seat++) {
    const view = game.viewFor(room, seat + 1);
    assert.equal(view.phase, 'windows');
    assert.deepEqual(view.privateObjective, { colour: room.privateColours[seat], points: 0 });
    assert.equal(view.publicObjectives.length, 3);
    assert.deepEqual(view.publicObjectives.map((o) => o.id), room.publicIds);
    assert.equal(view.tools.length, 3);
    assert.ok(view.tools.every((t) => t.text && t.how && t.cost === 1));
    const others = room.privateColours.filter((_, i) => i !== seat);
    assert.equal(JSON.stringify(view).includes('privateColour'), false);
    assert.equal(game.viewFor(room, seat + 1).privateObjective.colour === others[0], false, 'a different colour for each player');
  }
  assert.equal(game.viewFor(room, 99).privateObjective, null, 'a spectator has none');
  assert.equal(game.viewFor(room, 99).publicObjectives.length, 3, 'the public cards are public');
});

test('window choice: nobody else\'s private objective, choice or window is in a view; the same cards carry into the game', () => {
  const { room, rng } = windowsRoomOf(2);
  const first = room.options[0][1];
  assert.equal(game.chooseWindow(room, 0, first, rng).ok, true);
  const theirs = JSON.parse(JSON.stringify(game.viewFor(room, 2)));
  assert.equal(JSON.stringify(theirs).includes(first), false, 'their view does not show which window was chosen');
  assert.equal(theirs.seats[0].window, null);
  assert.equal(theirs.privateObjective.colour, room.privateColours[1]);
  const before = { tools: room.tools.slice(), publics: room.publicIds.slice(), colours: room.privateColours.slice() };
  assert.equal(game.chooseWindow(room, 1, room.options[1][0], rng).ok, true);
  assert.equal(room.phase, 'playing');
  assert.deepEqual({ tools: room.tools, publics: room.publicIds, colours: room.privateColours }, before, 'what was seen before choosing is what is played');
  assert.equal(game.viewFor(room, 1).privateObjective.colour, before.colours[0]);
});

test('window choice: the objectives and the choices survive a restart', () => {
  const { room, rng } = windowsRoomOf(3);
  game.chooseWindow(room, 1, room.options[1][2], rng);
  const restored = JSON.parse(JSON.stringify(room));
  for (let seat = 0; seat < 3; seat++) assert.deepEqual(game.viewFor(restored, seat + 1).privateObjective, game.viewFor(room, seat + 1).privateObjective);
  assert.deepEqual(game.viewFor(restored, 1).seats.map((s) => s.picked), [false, true, false]);
});

test('window choice: every seat in the view says whether it has chosen, for everybody, and the viewer is told which was theirs', () => {
  const { room, rng } = windowsRoomOf(4);
  for (const viewer of [1, 2, 3, 4]) assert.deepEqual(game.viewFor(room, viewer).seats.map((s) => s.picked), [false, false, false, false]);
  game.chooseWindow(room, 2, room.options[2][3], rng);
  game.chooseWindow(room, 0, room.options[0][0], rng);
  for (const viewer of [1, 2, 3, 4]) assert.deepEqual(game.viewFor(room, viewer).seats.map((s) => s.picked), [true, false, true, false]);
  assert.equal(game.viewFor(room, 3).chosen, room.options[2][3]);
  assert.equal(game.viewFor(room, 2).chosen, null);
  assert.equal(game.viewFor(room, 1).seats[2].window, null, 'who chose what stays hidden until everyone has chosen');
});
