// Property-style tests for the Nomination Whist rules: hundreds of seeded games (people choosing random legal moves,
// computers using their own judgement, random settings and table sizes, people leaving mid-game), with the
// invariants checked after every action.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { suitOf } from '../../shared/cards.js';
import { seeded } from '../../shared/testkit.js';

const CARD = /\b(?:[2-9]|10|[JQKA])[CDHS]\b/g;
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function newRoom(rng) {
  const settings = { seats: game.MIN_SEATS + Math.floor(rng() * (game.MAX_SEATS - game.MIN_SEATS + 1)), length: pick(rng, game.LENGTHS), missPoints: rng() < 0.5 };
  const room = game.createRoom({ code: 'a-b-c', hostId: 101, hostName: 'h101', settings, now: 1 });
  const humans = 1 + Math.floor(rng() * Math.min(3, settings.seats));
  for (let i = 1; i < humans; i++) assert.equal(game.addHuman(room, 101 + i, `h${101 + i}`).ok, true);
  assert.equal(game.fillWithBots(room, 101).ok, true);
  return room;
}

function checkRoom(room, label) {
  const n = room.seats.length;
  assert.equal(n, room.settings.seats);
  if (['nominating', 'playing'].includes(room.phase)) {
    const cards = game.cardsThisRound(room);
    const all = [...room.hands.flat(), ...room.played];
    assert.equal(all.length, n * cards, `${label}: every dealt card is in a hand or played`);
    assert.equal(new Set(all).size, all.length, `${label}: no card twice`);
    assert.equal(room.taken.reduce((a, b) => a + b, 0), room.tricksPlayed, `${label}: tricks taken equal tricks played`);
    assert.equal(room.played.length, room.tricksPlayed * n + room.trick.length);
    assert.ok(room.hands.every((h) => h.length <= cards));
  }
  if (room.phase === 'nominating') {
    assert.ok(Number.isInteger(room.turn) && room.turn >= 0 && room.turn < n);
    assert.ok(game.allowedNominations(room, room.turn).length >= 1, `${label}: someone may always nominate`);
    assert.ok(room.nominations.every((b) => b === null || (b >= 0 && b <= game.cardsThisRound(room))));
    assert.ok(room.hands.every((h) => h.length === game.cardsThisRound(room)));
  }
  if (room.phase === 'playing') {
    const cards = game.cardsThisRound(room);
    assert.ok(room.nominations.every((b) => Number.isInteger(b) && b >= 0 && b <= cards), `${label}: everyone has nominated`);
    assert.notEqual(room.nominations.reduce((a, b) => a + b, 0), cards, `${label}: the nominations never total the tricks`);
    assert.ok(room.trick.length <= n && room.tricksPlayed < cards);
    if (room.trick.length < n) {
      assert.ok(Number.isInteger(room.turn) && room.turn >= 0 && room.turn < n);
      assert.ok(game.legalCards(room, room.turn).length > 0, `${label}: the player to move has a legal card`);
    } else assert.equal(room.turn, null);
    assert.equal(new Set(room.trick.map((p) => p.seat)).size, room.trick.length);
  }
  const rounds = room.history.length;
  for (let seat = 0; seat < n; seat++) {
    assert.equal(room.scores[seat], room.history.reduce((sum, h) => sum + h.points[seat], 0), `${label}: score of seat ${seat} equals its history`);
  }
  for (const [i, h] of room.history.entries()) {
    assert.equal(h.round, i + 1);
    assert.equal(h.cards, game.handSize(room.settings, i));
    assert.equal(h.taken.reduce((a, b) => a + b, 0), h.cards, `${label}: the tricks of round ${i + 1} add up`);
    assert.equal(h.trump, game.trumpOf(i));
    assert.equal(h.dealer, (room.history[0].dealer + i) % n, 'the deal passes round the table');
    h.points.forEach((p, seat) => assert.equal(p, game.scoreRound(h.bids[seat], h.taken[seat], room.settings)));
  }
  assert.equal(room.tally.reduce((sum, t) => sum + t.roundsPlayed, 0), rounds * n);
  assert.equal(room.tally.reduce((sum, t) => sum + t.tricksWon, 0), room.history.reduce((sum, h) => sum + h.cards, 0));
  assert.equal(room.tally.reduce((sum, t) => sum + t.bidsMade, 0), room.history.reduce((sum, h) => sum + h.bids.filter((b, s) => b === h.taken[s]).length, 0));
  if (room.phase === 'finished') {
    assert.equal(rounds, game.roundCount(room.settings), `${label}: every round was played`);
    assert.deepEqual(room.winners, game.winnersOf(room.scores));
  }
  if (room.phase === 'roundEnd') assert.ok(rounds < game.roundCount(room.settings));
  assert.ok(room.seats.some(game.isHuman), `${label}: a person is still seated`);
  assert.equal(new Set(room.seats.map((s) => s.id)).size, n, `${label}: seat ids are unique`);
}

function checkView(room, userId, label) {
  const view = game.viewFor(room, userId);
  const me = game.seatOf(room, userId);
  const allowed = new Set([...(view.hand ?? []), ...(view.trick ?? []).map((p) => p.card), ...(view.lastTrick?.plays ?? []).map((p) => p.card), ...Object.keys(view.legal ?? {})]);
  for (const card of JSON.stringify(view).match(CARD) ?? []) assert.ok(allowed.has(card), `${label}: viewer ${userId} was sent ${card}`);
  if (room.phase !== 'lobby') assert.deepEqual(view.hand, me === -1 ? [] : room.hands[me]);
  assert.ok(view.seats.every((s) => !s || (!('hand' in s) && typeof s.cards === 'number')));
  assert.ok(!('hands' in view) && !('played' in view));
  if (view.legal) assert.equal(me, room.turn);
  if (view.forbidden !== null && view.forbidden !== undefined) assert.equal(room.turn, room.dealer, `${label}: the forbidden number is only shown on the dealer's turn`);
}

function playGame(seed, { leaves = true } = {}) {
  const rng = seeded(seed);
  const room = newRoom(rng);
  assert.equal(game.start(room, 101, rng).ok, true);
  const label = `seed ${seed}`;
  const firstDealer = room.dealer;
  const humanIds = () => room.seats.filter(game.isHuman).map((s) => s.id);
  let steps = 0;
  while (room.phase !== 'finished') {
    assert.ok(++steps < 20000, `${label}: must terminate`);
    checkRoom(room, label);
    if (room.history[0]) assert.equal(room.history[0].dealer, firstDealer);
    checkView(room, pick(rng, [101, 102, 103, 999, 'bot:1']), label);
    if (leaves && rng() < 0.003 && humanIds().length > 1) {
      const leaver = pick(rng, humanIds());
      const outcome = game.removeHuman(room, leaver);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.replaced, true);
      assert.ok(game.isBot(room.seats[outcome.seat]));
      if (room.hostId === leaver) assert.ok(humanIds().includes(room.hostId));
      continue;
    }
    if (room.phase === 'roundEnd') {
      assert.equal(game.nextRound(room, 999, rng).ok, false);
      assert.equal(game.nextRound(room, pick(rng, humanIds()), rng).ok, true);
      continue;
    }
    const pending = game.pendingAction(room);
    if (pending) {
      game.runPending(room, rng);
      continue;
    }
    const seat = room.turn;
    assert.ok(game.isHuman(room.seats[seat]), `${label}: waiting only for a person`);
    if (room.phase === 'nominating') {
      const allowed = game.allowedNominations(room, seat);
      const cards = game.cardsThisRound(room);
      const forbidden = seat === room.dealer ? game.forbiddenNow(room) : null;
      if (rng() < 0.4) {
        const before = JSON.stringify(room);
        for (const bad of [-1, cards + 1, 0.5, '1', null, undefined, NaN]) assert.equal(game.nominate(room, seat, bad).ok, false);
        if (forbidden !== null) assert.equal(game.nominate(room, seat, forbidden).ok, false, `${label}: the dealer's forbidden number`);
        assert.equal(game.nominate(room, (seat + 1) % room.seats.length, allowed[0]).ok, false, 'out of turn');
        assert.equal(JSON.stringify(room), before, `${label}: refused nominations change nothing`);
      }
      assert.equal(game.nominate(room, seat, pick(rng, allowed)).ok, true);
    } else {
      const hand = room.hands[seat];
      const legal = game.legalCards(room, seat);
      const illegal = hand.filter((c) => !legal.includes(c));
      if (illegal.length && rng() < 0.5) {
        const before = JSON.stringify(room);
        assert.equal(game.playCard(room, seat, pick(rng, illegal)).ok, false);
        assert.equal(game.playCard(room, (seat + 1) % room.seats.length, pick(rng, legal)).ok, false);
        assert.equal(JSON.stringify(room), before);
      }
      const card = pick(rng, legal);
      if (room.trick.length) {
        const led = suitOf(room.trick[0].card);
        if (suitOf(card) !== led) assert.ok(hand.every((c) => suitOf(c) !== led), `${label}: failed to follow suit`);
      }
      assert.equal(game.playCard(room, seat, card).ok, true);
    }
  }
  checkRoom(room, label);
  for (const id of [101, 102, 999]) checkView(room, id, label);
  assert.equal(game.playCard(room, 0, 'AS').ok, false);
  assert.equal(game.nominate(room, 0, 0).ok, false);
  assert.equal(game.nextRound(room, humanIds()[0]).ok, false);
  assert.equal(game.start(room, room.hostId).ok, false);
  assert.equal(game.statsPlayers(room).length, humanIds().length);
  return room;
}

test('250 seeded games with random settings and table sizes keep every invariant after every action', () => {
  const sizes = new Set();
  let short = 0;
  for (let seed = 1; seed <= 250; seed++) {
    const room = playGame(seed);
    sizes.add(room.seats.length);
    if (room.settings.length === 'short') short++;
  }
  assert.equal(sizes.size, 5, 'every table size from 3 to 7 was played');
  assert.ok(short > 70 && short < 180);
});

test('games with nobody leaving also terminate (seeds 1000 onward) and end with the right winners', () => {
  for (let seed = 1000; seed < 1060; seed++) {
    const room = playGame(seed, { leaves: false });
    const best = Math.max(...room.scores);
    assert.deepEqual(room.winners, room.scores.flatMap((s, i) => (s === best ? [i] : [])));
  }
});

test('scoring: a hit is 10 plus the nomination; a miss is the tricks taken, or nothing without miss points', () => {
  for (const missPoints of [true, false]) {
    for (let bid = 0; bid <= 7; bid++) {
      for (let taken = 0; taken <= 7; taken++) {
        const expected = bid === taken ? 10 + bid : missPoints ? taken : 0;
        assert.equal(game.scoreRound(bid, taken, { missPoints }), expected);
      }
    }
  }
});

test('the dealer is never allowed to make the nominations total the tricks, and always has some number left', () => {
  for (let cards = 1; cards <= 7; cards++) {
    for (let others = 0; others <= cards * 6; others++) {
      const forbidden = game.forbiddenNomination(cards, others);
      assert.ok(forbidden === null || (forbidden >= 0 && forbidden <= cards));
      assert.equal(forbidden === null, others > cards);
    }
  }
});
