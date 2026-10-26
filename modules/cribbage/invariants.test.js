// Property-style tests for the Cribbage rules: hundreds of seeded games (people choosing random legal moves, computers
// using their own judgement, two to five seats, both targets, people leaving mid-game) with the invariants checked
// after every action.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { fullDeck } from '../../shared/cards.js';
import { pipValue } from './scoring.js';
import { seeded } from '../../shared/testkit.js';

const DECK = [...fullDeck()].sort();
const CARD = /\b(?:[2-9]|10|[JQKA])[CDHS]\b/g;
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function newRoom(rng) {
  const seats = 2 + Math.floor(rng() * 4);
  const room = game.createRoom({ code: 'a-b-c', hostId: 101, name: 'h101', target: pick(rng, game.TARGETS), seats, now: 1 });
  const humans = 1 + Math.floor(rng() * Math.min(3, seats));
  for (let i = 1; i < humans; i++) assert.equal(game.addHuman(room, 101 + i, `h${101 + i}`).ok, true);
  assert.equal(game.fillBots(room, 101).ok, true);
  return room;
}

function checkRoom(room, label, handsSeen) {
  const n = room.seats.length;
  if (room.phase === 'discard') {
    const cards = [...room.hands.flat(), ...room.crib, ...room.deck];
    assert.deepEqual(cards.sort(), DECK, `${label}: 52 cards in hands, crib and deck while discarding`);
    for (const [i, s] of room.seats.entries()) {
      const rules = game.dealRules(n, i === room.dealer);
      assert.equal(room.hands[i].length, rules.dealt - (s.discarded ? rules.discards : 0));
    }
  }
  if (room.phase === 'play') {
    const kept = room.kept.flat();
    assert.equal(room.crib.length, 4, `${label}: the crib has four cards`);
    assert.deepEqual([...kept, ...room.crib, room.starter, ...room.deck].sort(), DECK, `${label}: 52 cards: kept hands, crib, starter and deck`);
    for (const [i, hand] of room.hands.entries()) assert.ok(hand.every((c) => room.kept[i].includes(c)), `${label}: a hand only holds kept cards`);
    const p = room.play;
    assert.equal(p.count, p.sequence.reduce((sum, x) => sum + pipValue(x.card), 0), `${label}: the count is the sum of the sequence`);
    assert.ok(p.count >= 0 && p.count <= 31);
    assert.ok(room.hands[p.turn].length > 0 && game.playableCards(room, p.turn).length > 0, `${label}: the player to move can play`);
    const played = room.kept.flat().length - room.hands.flat().length;
    assert.ok(played >= p.sequence.length);
  }
  if (room.phase === 'show') {
    assert.ok(room.hands.every((h) => h.length === 0), `${label}: all cards played before the show`);
    assert.equal(room.show.entries.length, n + 1);
  }
  // Scores: what is on the board equals the history plus the hand being played.
  for (let i = 0; i < n; i++) {
    const history = room.history.reduce((sum, h) => sum + (h.deltas[i] ?? 0), 0);
    const live = room.phase === 'discard' || room.phase === 'play' || room.phase === 'show' ? 0 : 0;
    const inHand = room.phase === 'finished' ? 0 : room.handDeltas[i] ?? 0;
    assert.equal(room.seats[i].score, history + inHand + live, `${label}: seat ${i} score equals its history`);
    assert.ok(room.seats[i].score <= room.target);
    assert.ok(room.seats[i].back <= room.seats[i].score);
  }
  const atTarget = room.seats.filter((s) => s.score >= room.target).length;
  if (room.phase === 'finished') {
    assert.equal(atTarget, 1, `${label}: exactly one winner at the target`);
    assert.equal(room.seats[room.winner].score, room.target);
    assert.equal(room.history.length, room.handNo);
  } else if (room.phase !== 'lobby') assert.equal(atTarget, 0, `${label}: nobody at the target in a live game`);
  assert.ok(room.seats.some((s) => !s.bot && !s.left), `${label}: a person is still seated`);
  assert.equal(room.handNo, handsSeen, `${label}: hand numbers go up by one`);
  assert.equal(new Set(room.seats.map((s) => s.name.toLowerCase())).size, n, `${label}: unique names`);
}

function checkView(room, userId, label) {
  const view = game.viewFor(room, userId);
  const me = game.seatOf(room, userId);
  if (room.phase === 'discard' || room.phase === 'play') {
    const allowed = new Set([...view.hand, view.starter, ...(view.play?.sequence ?? []).map((p) => p.card), ...(view.play?.previous ?? []), ...(view.play?.playable ?? [])].filter(Boolean));
    for (const card of JSON.stringify({ ...view, show: null }).match(CARD) ?? []) assert.ok(allowed.has(card), `${label}: viewer ${userId} was sent ${card}`);
    assert.deepEqual(view.hand, me === -1 ? [] : room.hands[me]);
    assert.ok(view.seats.every((s) => typeof s.cards === 'number' && !('hand' in s)));
    assert.ok(!('hands' in view) && !('crib' in view) && !('deck' in view) && !('kept' in view));
    assert.equal(view.deckCount, room.deck.length);
    assert.ok(!view.log.some((l) => (JSON.stringify(l).match(CARD) ?? []).length), 'the log names no cards');
  }
  if (view.play?.playable.length) assert.equal(me, room.play.turn);
}

function playGame(seed, { leaves = true } = {}) {
  const rng = seeded(seed);
  const room = newRoom(rng);
  const label = `seed ${seed}`;
  assert.equal(game.start(room, 101, rng).ok, true);
  const humanIds = () => room.seats.filter((s) => !s.bot && !s.left).map((s) => s.userId);
  let handsSeen = 1;
  let steps = 0;
  while (room.phase !== 'finished') {
    assert.ok(++steps < 20000, `${label}: must terminate`);
    checkRoom(room, label, handsSeen);
    checkView(room, pick(rng, [101, 102, 103, 999, null]), label);
    const before = room.handNo;
    if (leaves && rng() < 0.004 && humanIds().length > 1) {
      const leaver = pick(rng, humanIds());
      const outcome = game.removeHuman(room, leaver, rng);
      assert.equal(outcome.ok, true);
      if (room.hostId === leaver) assert.ok(humanIds().includes(room.hostId));
      handsSeen += room.handNo - before;
      continue;
    }
    if (game.pendingBot(room)) {
      assert.equal(game.botMove(room, rng).ok, true, `${label}: a computer move is always legal`);
      handsSeen += room.handNo - before;
      continue;
    }
    if (room.phase === 'discard') {
      const waiting = room.seats.flatMap((s, i) => (!s.bot && !s.discarded ? [i] : []));
      const seat = pick(rng, waiting);
      const { discards } = game.dealRules(room.seats.length, seat === room.dealer);
      const hand = room.hands[seat];
      if (rng() < 0.3) {
        const snap = JSON.stringify(room);
        assert.equal(game.discard(room, seat, hand.slice(0, discards + 1), rng).ok, false);
        assert.equal(game.discard(room, seat, ['ZZ', 'YY', 'XX'].slice(0, discards), rng).ok, false);
        assert.equal(game.discard(room, seat, room.deck.slice(0, discards), rng).ok, false, 'cards still in the deck are not in the hand');
        assert.equal(JSON.stringify(room), snap, `${label}: refused discards change nothing`);
      }
      const chosen = [...hand].sort(() => rng() - 0.5).slice(0, discards);
      assert.equal(game.discard(room, seat, chosen, rng).ok, true);
      assert.equal(game.discard(room, seat, chosen, rng).ok, false, 'a second discard is refused');
    } else if (room.phase === 'play') {
      const seat = room.play.turn;
      assert.ok(!room.seats[seat].bot);
      const playable = game.playableCards(room, seat);
      const unplayable = room.hands[seat].filter((c) => !playable.includes(c));
      if (rng() < 0.4) {
        const snap = JSON.stringify(room);
        if (unplayable.length) assert.equal(game.playCard(room, seat, pick(rng, unplayable)).ok, false);
        assert.equal(game.playCard(room, (seat + 1) % room.seats.length, pick(rng, playable)).ok, false);
        assert.equal(game.playCard(room, seat, 'ZZ').ok, false);
        assert.equal(JSON.stringify(room), snap);
      }
      assert.equal(game.playCard(room, seat, pick(rng, playable)).ok, true);
    } else if (room.phase === 'show') {
      const waiting = room.seats.flatMap((s, i) => (!s.bot && !s.ready ? [i] : []));
      assert.ok(waiting.length, `${label}: the show waits only for people`);
      assert.equal(game.ready(room, pick(rng, waiting), rng).ok, true);
    } else assert.fail(`${label}: unexpected phase ${room.phase}`);
    handsSeen += room.handNo - before;
    assert.ok(room.handNo - before <= 1);
  }
  checkRoom(room, label, handsSeen);
  for (const id of [101, 102, 999]) checkView(room, id, label);
  assert.equal(game.playCard(room, 0, 'AS').ok, false);
  assert.equal(game.discard(room, 0, ['AS', 'KS']).ok, false);
  assert.equal(game.ready(room, 0).ok, false);
  assert.equal(game.start(room, room.hostId).ok, false);
  const stats = game.statsPlayers(room);
  assert.equal(stats.length, humanIds().length);
  assert.ok(stats.every((p) => p.score <= room.target));
  return room;
}

test('200 seeded games with 2 to 5 seats and both targets keep every invariant after every action', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const room = playGame(seed);
    seen.add(`${room.seats.length}/${room.target}`);
  }
  assert.equal(seen.size, 8, 'every combination of seats and target was played');
});

test('games with nobody leaving also terminate (seeds 1000 onward)', () => {
  for (let seed = 1000; seed < 1060; seed++) playGame(seed, { leaves: false });
});

test('the show entries of every hand add up to what the board says', () => {
  for (let seed = 3000; seed < 3040; seed++) {
    const rng = seeded(seed);
    const room = newRoom(rng);
    game.start(room, 101, rng);
    let hands = 0;
    while (room.phase !== 'finished' && hands < 12) {
      if (game.pendingBot(room)) game.botMove(room, rng);
      else if (room.phase === 'discard') {
        for (const [i, s] of room.seats.entries()) if (!s.bot && !s.discarded) game.discard(room, i, room.hands[i].slice(0, game.dealRules(room.seats.length, i === room.dealer).discards), rng);
      } else if (room.phase === 'play') {
        const seat = room.play.turn;
        game.playCard(room, seat, game.playableCards(room, seat)[0]);
      } else if (room.phase === 'show') {
        for (const [i, s] of room.seats.entries()) if (!s.bot && !s.ready) game.ready(room, i, rng);
        hands++;
      }
      if (room.phase === 'show') {
        for (const e of room.show.entries) assert.ok(e.total >= 0 && e.after <= room.target);
      }
    }
  }
});

test('the crib always has four cards and the starter is never a card anybody holds', () => {
  for (let seed = 4000; seed < 4040; seed++) {
    const rng = seeded(seed);
    const room = newRoom(rng);
    game.start(room, 101, rng);
    let guard = 0;
    while (room.phase !== 'finished' && guard++ < 3000) {
      if (game.pendingBot(room)) game.botMove(room, rng);
      else if (room.phase === 'discard') {
        for (const [i, s] of room.seats.entries()) if (!s.bot && !s.discarded) game.discard(room, i, room.hands[i].slice(0, game.dealRules(room.seats.length, i === room.dealer).discards), rng);
      } else if (room.phase === 'play') {
        const seat = room.play.turn;
        assert.ok(!room.hands.flat().includes(room.starter));
        game.playCard(room, seat, game.playableCards(room, seat)[0]);
      } else if (room.phase === 'show') {
        assert.equal(room.crib.length, 4);
        for (const [i, s] of room.seats.entries()) if (!s.bot && !s.ready) game.ready(room, i, rng);
      }
    }
    assert.equal(room.phase, 'finished');
  }
});
