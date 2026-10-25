// The computer players: always legal over thousands of random positions, and hundreds of whole games that always end
// with every invariant holding after every single action.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import * as bot from './bot.js';
import { assertViewIsClean, botsOnly, checkInvariants, started } from './kit.js';
import { seeded } from '../../shared/testkit.js';

/** Plays one random legal action (including any return or noble choice that follows) for whoever is on turn. */
function randomStep(room, rng) {
  const seat = room.pending?.seat ?? room.turn;
  if (room.pending?.type === 'return') {
    const give = [0, 0, 0, 0, 0, 0];
    const have = [...room.players[seat].tokens];
    for (let k = 0; k < room.pending.count; k++) {
      const options = have.flatMap((n, c) => (n > 0 ? [c] : []));
      const c = options[Math.floor(rng() * options.length)];
      have[c]--;
      give[c]++;
    }
    return game.returnTokens(room, seat, give);
  }
  if (room.pending?.type === 'noble') return game.chooseNoble(room, seat, room.pending.options[Math.floor(rng() * room.pending.options.length)]);
  const moves = game.legalMoves(room, seat);
  if (!moves.length) return game.passTurn(room, seat);
  const move = moves[Math.floor(rng() * moves.length)];
  if (move.type === 'buy' && rng() < 0.5) {
    // Also exercise payments that use gold on purpose.
    const quote = game.payment(room.players[seat], { ...CARD(move.card) });
    const swap = Math.min(quote.maxGold - quote.minGold, 1);
    if (swap > 0) {
      const colour = quote.pay.findIndex((n, c) => c < 5 && n > 0);
      if (colour !== -1) {
        const pay = [...quote.pay];
        pay[colour]--;
        pay[5]++;
        return game.buyCard(room, seat, move.card, pay);
      }
    }
  }
  return game.applyMove(room, seat, move);
}
import { CARD_BY_ID } from './cards.js';
const CARD = (id) => CARD_BY_ID[id];

test('the computer player picks a legal move in thousands of random positions', () => {
  const rng = seeded(7);
  let checked = 0;
  let kinds = { take: 0, takeTwo: 0, reserve: 0, buy: 0, pass: 0 };
  for (let g = 0; g < 120; g++) {
    const seats = 2 + (g % 3);
    const room = botsOnly(seats, rng, { target: [10, 15, 20][g % 3] });
    const stop = 5 + Math.floor(rng() * 90);
    for (let step = 0; step < stop && room.phase === 'playing'; step++) {
      // A random player makes the random moves; then ask the computer player for its move on a clone.
      const result = randomStep(room, rng);
      assert.equal(result.ok, true, result.error);
      checkInvariants(room, `random step ${step}`);
      if (room.phase !== 'playing' || room.pending) continue;
      const clone = structuredClone(room);
      const seat = clone.turn;
      const move = bot.chooseMove(clone, seat, rng);
      kinds[move.type]++;
      const legal = game.legalMoves(clone, seat);
      if (move.type !== 'pass') assert.ok(legal.some((m) => JSON.stringify(m) === JSON.stringify(move)), `a legal move: ${JSON.stringify(move)}`);
      else assert.equal(legal.length, 0);
      assert.equal(game.applyMove(clone, seat, move).ok, true);
      if (clone.pending?.type === 'return') {
        const give = bot.chooseReturn(clone, seat);
        assert.equal(game.returnTokens(clone, seat, give).ok, true);
      }
      if (clone.pending?.type === 'noble') assert.equal(game.chooseNoble(clone, seat, bot.chooseNoble(clone, seat)).ok, true);
      checkInvariants(clone, 'after the computer move');
      checked++;
    }
  }
  assert.ok(checked > 2500, `checked ${checked} positions`);
  assert.ok(kinds.take > 0 && kinds.buy > 0 && kinds.reserve > 0, JSON.stringify(kinds));
});

test('the computer player returns exactly the excess and prefers to keep what it needs', () => {
  const room = botsOnly(2, () => 0.5);
  room.turn = 0;
  room.players[0].tokens = [2, 2, 2, 2, 1, 2];
  room.supply = [2, 2, 2, 2, 3, 3];
  room.pending = { type: 'return', seat: 0, count: 1 };
  const give = bot.chooseReturn(room, 0);
  assert.equal(give.reduce((a, b) => a + b, 0), 1);
  assert.equal(give[5], 0, 'gold is the last to go');
  assert.equal(game.returnTokens(room, 0, give).ok, true);
});

test('a computer player buys an affordable card rather than collecting gems', () => {
  const room = botsOnly(2, () => 0.5);
  const id = room.board[1][0];
  const card = CARD_BY_ID[id];
  room.players[0].tokens = [...card.cost, 0];
  room.supply = room.supply.map((n, c) => (c < 5 ? n - card.cost[c] : n));
  assert.deepEqual(bot.chooseMove(room, 0, () => 0.5).type, 'buy');
});

test('the computer players never read the draw piles (their choices do not change when the piles are reordered)', () => {
  const rng = seeded(11);
  for (let g = 0; g < 30; g++) {
    const room = botsOnly(3, rng);
    for (let step = 0; step < 40 && room.phase === 'playing'; step++) {
      if (!room.pending) {
        const a = structuredClone(room);
        const b = structuredClone(room);
        for (const l of [1, 2, 3]) b.decks[l].reverse();
        assert.deepEqual(bot.chooseMove(a, a.turn, seeded(step)), bot.chooseMove(b, b.turn, seeded(step)), 'same public position, same move');
      }
      assert.equal(randomStep(room, rng).ok, true);
    }
  }
});

function playOut(room, rng, label, { viewer = null } = {}) {
  let steps = 0;
  checkInvariants(room, `${label} start`);
  while (room.phase === 'playing') {
    const action = bot.runPending(room, rng);
    assert.ok(action, `${label}: somebody has to act`);
    steps++;
    assert.ok(steps < 1000, `${label}: the game must end`);
    checkInvariants(room, `${label} step ${steps}`);
    if (viewer) for (let seat = 0; seat < room.seats.length; seat++) assertViewIsClean(room, `bot:x${seat}`, seat, label);
  }
  return steps;
}

test('hundreds of computer-only games end, with every invariant holding after every action', () => {
  const rng = seeded(2024);
  const ended = { target: 0, other: 0 };
  let games = 0;
  for (let g = 0; g < 360; g++) {
    const seats = 2 + (g % 3);
    const room = botsOnly(seats, rng, { target: [10, 15, 20][Math.floor(g / 3) % 3] });
    playOut(room, rng, `game ${g}`);
    games++;
    assert.equal(room.phase, 'finished');
    assert.ok(room.winners.length >= 1);
    const best = Math.max(...room.players.map(game.prestigeOf));
    assert.ok(best >= room.settings.target || room.endReason !== 'target');
    // Everyone has had the same number of turns.
    const turns = room.players.map((p) => p.tally.turnsTaken);
    assert.ok(turns.every((t) => t === turns[0]), `equal turns ${turns}`);
    // The winners are exactly the best by prestige and then fewest cards.
    const key = (p) => [game.prestigeOf(p), -p.bought.length];
    const top = room.players.map(key).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
    assert.deepEqual([...room.winners].sort(), room.players.flatMap((p, i) => (key(p)[0] === top[0] && key(p)[1] === top[1] ? [i] : [])));
    ended[room.endReason === 'target' ? 'target' : 'other']++;
  }
  assert.equal(games, 360);
  assert.ok(ended.target >= 350, `almost every game ends by someone reaching the target (${JSON.stringify(ended)})`);
});

test('views are clean at every step of a game with a person seated', () => {
  const rng = seeded(5);
  for (let g = 0; g < 8; g++) {
    const room = started(2 + (g % 3), rng);
    // Seat the human at the turn order position it was dealt; the person plays randomly.
    const human = game.seatOf(room, 1);
    let steps = 0;
    while (room.phase === 'playing') {
      const seat = room.pending?.seat ?? room.turn;
      const result = seat === human ? randomStep(room, rng) : (bot.runPending(room, rng), { ok: true });
      assert.equal(result.ok, true, result.error);
      checkInvariants(room, `view game ${g}`);
      assertViewIsClean(room, 1, human, `game ${g} step ${steps}`);
      assert.ok(++steps < 1500);
    }
    const view = game.viewFor(room, 1);
    assert.equal(view.scoreboard.rounds.length, room.round);
    for (const p of view.scoreboard.players) {
      assert.equal(p.score, view.scoreboard.rounds.reduce((sum, r) => sum + r.deltas[p.id], 0), 'history sums to the final score');
    }
  }
});

test('a game in which nobody can move ends instead of hanging', () => {
  const room = botsOnly(2, () => 0.5);
  // A contrived position (so token and card conservation are not asserted): nothing to take, reserve or buy.
  for (const l of [1, 2, 3]) {
    room.decks[l] = [];
    room.board[l] = [null, null, null, null];
  }
  room.supply = [0, 0, 0, 0, 0, 0];
  room.players[0].tokens = [3, 3, 2, 1, 1, 0];
  room.players[1].tokens = [1, 1, 2, 3, 3, 0];
  let steps = 0;
  while (room.phase === 'playing') {
    const result = game.passTurn(room, room.turn);
    assert.equal(result.ok, true, result.error);
    assert.ok(++steps < 10);
  }
  assert.equal(room.endReason, 'stalled');
  assert.equal(steps, 2, 'one full round of passing');
  assert.deepEqual(room.winners, [0, 1]);
});

test('a game that reaches the round limit ends and is scored', () => {
  const room = botsOnly(2, () => 0.5);
  room.round = game.MAX_ROUNDS;
  room.turn = 1;
  room.roundDeltas = [0, 0];
  game.takeGems(room, 1, [0, 1, 2]);
  assert.equal(room.phase, 'finished');
  assert.equal(room.endReason, 'limit');
});
