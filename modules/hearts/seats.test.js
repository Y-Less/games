// Hearts for 3 to 7 players: the deals, the removed cards, the first lead, the passing rotations, scoring, the lobby
// setting, whole games for every count and the computer players at every table size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDeck } from '../../shared/cards.js';
import { seeded } from '../../shared/testkit.js';
import * as g from './game.js';
import { AIS } from './ai/index.js';
import { DEALS, deckFor, describePass, directionName, offsetFor, offsetOfDirection, openingCard } from './deals.js';
import { playGame } from './arena.js';

const COUNTS = [3, 4, 5, 6, 7];
const sorted = (cards) => [...cards].sort();

/** A lobby for `n` seats with one person (account 1) and computers in every other seat. */
function lobby(n, settings = {}) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: n, ...settings } });
  assert.equal(g.fillWithBots(room, 1).ok, true);
  return room;
}

function startedRoom(n, seed = 1, settings = {}) {
  const room = lobby(n, settings);
  assert.equal(g.start(room, 1, seeded(seed)).ok, true);
  return room;
}

test('the deal tables are consistent: the deck divides exactly, and the Queen, Jack and every heart stay', () => {
  for (const n of COUNTS) {
    const deal = DEALS[n];
    assert.equal(deckFor(n).length, n * deal.each, `${n} players: the whole deck is dealt`);
    assert.equal(52 - deal.removed.length, n * deal.each);
    for (const card of ['QS', 'JD', ...fullDeck().filter((c) => c.endsWith('H'))]) assert.ok(deckFor(n).includes(card), `${n} players keep ${card}`);
    assert.equal(deal.rotation.at(-1), 0, 'the rotation ends with no passing');
    assert.ok(deal.pass * 2 <= deal.each, 'you can pass cards you hold');
  }
  assert.deepEqual(DEALS[3].removed, ['2C']);
  assert.deepEqual(DEALS[4].removed, []);
  assert.deepEqual(DEALS[5].removed, ['2C', '2D']);
  assert.deepEqual(DEALS[6].removed, ['2C', '3C', '2D', '3D']);
  assert.deepEqual(DEALS[7].removed, ['2C', '2D', '3D']);
  assert.deepEqual(COUNTS.map((n) => [DEALS[n].each, DEALS[n].pass]), [[17, 3], [13, 3], [10, 3], [8, 2], [7, 2]]);
  assert.deepEqual(COUNTS.map(openingCard), ['3C', '2C', '3C', '4C', '3C']);
});

test('dealing: every remaining card goes to exactly one player and the removed cards are out of play', () => {
  for (const n of COUNTS) {
    const room = startedRoom(n, 10 + n);
    assert.equal(room.seats.length, n);
    assert.equal(room.hands.length, n);
    assert.ok(room.hands.every((h) => h.length === DEALS[n].each), `${n} players: equal hands`);
    assert.deepEqual(sorted(room.hands.flat()), sorted(deckFor(n)), `${n} players: each card exactly once`);
    for (const card of DEALS[n].removed) assert.ok(!room.hands.flat().includes(card), `${n} players: ${card} is out`);
    assert.equal(room.scores.length, n);
    assert.equal(room.tally.length, n);
    assert.equal(room.passes.length, n);
  }
});

test('the first lead is the lowest club still in the deck, must be led, and the message names it', () => {
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 6; seed++) {
      const room = lobby(n);
      g.start(room, 1, seeded(seed));
      // Skip any passing so the hand is straight into play (as on the "none" hand).
      while (room.phase === 'passing') g.runPending(room, seeded(seed)) ?? g.choosePass(room, 0, room.hands[0].slice(0, DEALS[n].pass));
      const opening = openingCard(n);
      assert.equal(room.phase, 'playing');
      assert.ok(room.hands[room.turn].includes(opening), `${n} players: the opening card holder is on turn`);
      assert.equal(room.tricksPlayed, 0);
      const other = room.hands[room.turn].find((c) => c !== opening);
      const refused = g.playCard(room, room.turn, other);
      assert.equal(refused.ok, false);
      assert.match(refused.error, /must lead the/);
      if (n !== 4) assert.ok(!refused.error.includes('2 of clubs'), 'it does not name the 2 of clubs');
      assert.equal(g.legalCards(room, room.turn).length, 1);
      assert.deepEqual(g.legalCards(room, room.turn), [opening]);
    }
  }
  const four = startedRoom(4);
  while (four.phase === 'passing') g.runPending(four) ?? g.choosePass(four, 0, four.hands[0].slice(0, 3));
  assert.match(g.playCard(four, four.turn, four.hands[four.turn].find((c) => c !== '2C')).error, /2 of clubs/);
  assert.equal(g.playCard(four, four.turn, '2C').ok, true);
});

test('pass directions: names, offsets and labels', () => {
  assert.deepEqual([0, 1, 2, 3].map((o) => directionName(4, o)), ['none', 'left', 'across', 'right']);
  assert.deepEqual([0, 1, 2].map((o) => directionName(3, o)), ['none', 'left', 'right']);
  assert.deepEqual([0, 1, 2, 3, 4].map((o) => directionName(5, o)), ['none', 'left', 'left2', 'right2', 'right']);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((o) => directionName(6, o)), ['none', 'left', 'left2', 'across', 'right2', 'right']);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((o) => directionName(7, o)), ['none', 'left', 'left2', 'left3', 'right3', 'right2', 'right']);
  for (const n of COUNTS) for (let o = 0; o < n; o++) assert.equal(offsetOfDirection(n, directionName(n, o)), o);
  assert.equal(describePass(4, 1).label, 'Passing 3 to the left');
  assert.equal(describePass(6, 2).label, 'Passing 2 to the left (2 places along)');
  assert.equal(describePass(5, 3).distance, 2);
  assert.equal(describePass(5, 3).side, 'right');
  assert.equal(describePass(6, 3).side, 'across');
  assert.equal(describePass(7, 0).label, 'No passing this hand');
  assert.equal(g.passTarget(2, 'left2', 5), 4);
  assert.equal(g.passSource(4, 'left2', 5), 2);
  assert.equal(g.passTarget(0, 'right', 3), 2);
});

test('passing: over a full rotation the right number of cards go to the right seat, for every count', () => {
  for (const n of COUNTS) {
    const deal = DEALS[n];
    const room = startedRoom(n, 40 + n);
    room.settings.target = 100000; // never ends during this test
    room.seats[0] = { kind: 'bot', id: 'bot:90', name: 'Zed', ai: 'standard' };
    const rng = seeded(n);
    const seen = [];
    for (let hand = 0; hand < deal.rotation.length * 2; hand++) {
      const offset = deal.rotation[hand % deal.rotation.length];
      assert.equal(room.handNumber, hand);
      assert.equal(room.passDirection, directionName(n, offset), `${n} players hand ${hand}`);
      seen.push(room.passDirection);
      if (offset === 0) assert.equal(room.phase, 'playing', 'no passing goes straight to play');
      else {
        assert.equal(room.phase, 'passing');
        const before = room.hands.map((h) => [...h]);
        const chosen = before.map((h) => h.slice(0, deal.pass));
        // A wrong number of cards is refused.
        assert.equal(g.choosePass(room, 0, before[0].slice(0, deal.pass + 1)).ok, false);
        assert.equal(g.choosePass(room, 0, before[0].slice(0, deal.pass - 1)).ok, false);
        for (let seat = 0; seat < n; seat++) assert.equal(g.choosePass(room, seat, chosen[seat]).ok, true);
        assert.equal(room.phase, 'playing');
        for (let seat = 0; seat < n; seat++) {
          const from = (seat - offset + n) % n;
          assert.deepEqual(sorted(room.received[seat]), sorted(chosen[from]), `${n} players hand ${hand}: seat ${seat} gets seat ${from}'s cards`);
          assert.equal(room.hands[seat].length, deal.each);
          assert.equal(room.received[seat].length, deal.pass);
        }
        assert.deepEqual(sorted(room.hands.flat()), sorted(deckFor(n)));
      }
      assert.ok(room.hands[room.turn].includes(openingCard(n)));
      while (room.phase === 'playing') g.runPending(room, rng);
      assert.equal(room.phase, 'handEnd');
      assert.equal(g.forceNextHand(room, rng).ok, true);
    }
    assert.deepEqual(seen.slice(0, deal.rotation.length), deal.rotation.map((o) => directionName(n, o)));
    assert.deepEqual(seen.slice(deal.rotation.length), seen.slice(0, deal.rotation.length), 'the rotation repeats');
  }
  // The rotations the host was promised.
  assert.deepEqual([0, 1, 2].map((h) => offsetFor(3, h)), [1, 2, 0]);
  assert.deepEqual([0, 1, 2, 3].map((h) => offsetFor(4, h)), [1, 3, 2, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map((h) => offsetFor(5, h)), [1, 2, 3, 4, 0]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((h) => offsetFor(6, h)), [1, 2, 3, 4, 5, 0]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((h) => offsetFor(7, h)), [1, 2, 3, 4, 5, 6, 0]);
});

test('scoring: a hand is 26 points for every count; a moon scores 26 for each other player (or -26)', () => {
  for (const n of COUNTS) {
    const deck = deckFor(n);
    const hearts = deck.filter((c) => c.endsWith('H'));
    assert.equal(hearts.length, 13);
    const split = (shooter) => Array.from({ length: n }, (_, s) => (s === shooter ? [...hearts, 'QS'] : []));
    const rest = deck.filter((c) => !hearts.includes(c) && c !== 'QS');
    const taken = split(1);
    taken[0] = rest; // the shooter's rivals hold the rest; the Jack of Diamonds is in there
    const others = g.scoreHand(taken, { jackOfDiamonds: false, moon: 'others' });
    assert.equal(others.moon, 1);
    assert.deepEqual(others.points, Array.from({ length: n }, (_, s) => (s === 1 ? 0 : 26)));
    const self = g.scoreHand(taken, { jackOfDiamonds: false, moon: 'self' });
    assert.deepEqual(self.points, Array.from({ length: n }, (_, s) => (s === 1 ? -26 : 0)));
    const jack = g.scoreHand(taken, { jackOfDiamonds: true, moon: 'others' });
    assert.deepEqual(jack.points, Array.from({ length: n }, (_, s) => (s === 1 ? 0 : 26) + (s === 0 ? g.JACK_POINTS : 0)));
    // No moon: the points are shared and add up to 26 (21 with the Jack).
    const spread = Array.from({ length: n }, () => []);
    deck.forEach((card, i) => spread[i % n].push(card));
    const plain = g.scoreHand(spread, { jackOfDiamonds: false, moon: 'others' });
    assert.equal(plain.moon, null);
    assert.equal(plain.points.reduce((a, b) => a + b, 0), g.HAND_POINTS);
    const withJack = g.scoreHand(spread, { jackOfDiamonds: true, moon: 'others' });
    assert.equal(withJack.points.reduce((a, b) => a + b, 0), g.HAND_POINTS + g.JACK_POINTS);
  }
});

test('lobby: the host chooses 3 to 7 seats, nothing else is accepted, and nobody seated is lost', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  assert.equal(room.seats.length, 4, 'four seats by default');
  assert.equal(g.viewFor(room, 1).seatCount, 4);
  assert.deepEqual([g.viewFor(room, 1).limits.minSeats, g.viewFor(room, 1).limits.maxSeats], [3, 7]);
  for (const n of [3, 5, 6, 7, 4]) {
    assert.equal(g.setSettings(room, 1, { seats: n }).ok, true);
    assert.equal(room.seats.length, n);
    assert.equal(g.viewFor(room, 1).seatCount, n);
    assert.equal(g.viewFor(room, 1).seats.length, n);
    assert.equal(g.viewFor(room, 1).deal.cardsEach, DEALS[n].each);
  }
  for (const bad of [2, 8, 0, -1, 4.5, '5', null, NaN, 100]) {
    const before = room.seats.length;
    assert.equal(g.setSettings(room, 1, { seats: bad }).ok, false, `${String(bad)} is refused`);
    assert.equal(room.seats.length, before);
  }
  assert.equal(g.setSettings(room, 2, { seats: 5 }).ok, false, 'only the host');
  // Settings are all-or-nothing.
  assert.equal(g.setSettings(room, 1, { seats: 6, target: 77 }).ok, false);
  assert.equal(room.seats.length, 4);
  // Cannot shrink below the people (and computers) seated.
  g.setSettings(room, 1, { seats: 6 });
  assert.equal(g.addHuman(room, 2, 'Bob').ok, true);
  assert.equal(g.addBot(room, 1, 5).ok, true);
  assert.equal(g.addBot(room, 1).ok, true);
  assert.equal(room.seats.filter(Boolean).length, 4);
  assert.equal(g.setSettings(room, 1, { seats: 3 }).ok, false);
  assert.equal(room.seats.length, 6);
  // Shrinking to exactly the seated count keeps everyone, closing the gaps.
  assert.equal(g.setSettings(room, 1, { seats: 4 }).ok, true);
  assert.equal(room.seats.length, 4);
  assert.ok(room.seats.every(Boolean));
  assert.equal(g.seatOf(room, 1), 0);
  assert.notEqual(g.seatOf(room, 2), -1);
  // Growing keeps them where they are; the new seats are empty.
  assert.equal(g.setSettings(room, 1, { seats: 7 }).ok, true);
  assert.equal(room.seats.filter((s) => !s).length, 3);
  // Seat numbers are checked against the room's size, and the game needs every seat filled.
  assert.equal(g.addBot(room, 1, 6).ok, true);
  assert.equal(g.addBot(room, 1, 7).ok, false);
  assert.equal(g.removeBot(room, 1, 6).ok, true);
  assert.equal(g.start(room, 1).ok, false);
  assert.match(g.start(room, 1).error, /All 7 seats/);
  g.fillWithBots(room, 1);
  assert.equal(room.seats.every(Boolean), true);
  assert.equal(g.start(room, 1, seeded(3)).ok, true);
  assert.equal(room.hands.length, 7);
  // Once started it cannot change.
  assert.equal(g.setSettings(room, 1, { seats: 5 }).ok, false);
});

test('creating a room with a seat count, and refusing a bad one', () => {
  for (const n of COUNTS) assert.equal(g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: n } }).seats.length, n);
  for (const bad of [2, 8, 'x']) assert.throws(() => g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: bad } }));
});

test('the view: seat count, deal, who passes to whom (with names), and nothing hidden', () => {
  for (const n of COUNTS) {
    const room = lobby(n);
    room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
    g.start(room, 1, seeded(5 + n));
    const view = g.viewFor(room, 1);
    assert.equal(view.seatCount, n);
    assert.equal(view.seats.length, n);
    assert.equal(view.hand.length, DEALS[n].each);
    assert.equal(view.deal.cardsEach, DEALS[n].each);
    assert.equal(view.deal.passCount, DEALS[n].pass);
    assert.deepEqual(view.deal.removed, DEALS[n].removed);
    assert.equal(view.deal.openingCard, openingCard(n));
    assert.equal(view.deal.handPoints, 26);
    assert.equal(view.deal.rotation.length, DEALS[n].rotation.length);
    assert.equal(view.pass.cards, DEALS[n].pass);
    assert.equal(view.pass.direction, directionName(n, DEALS[n].rotation[0]));
    assert.equal(view.pass.to, DEALS[n].rotation[0] % n);
    assert.equal(view.pass.toName, room.seats[view.pass.to].name);
    assert.equal(view.pass.from, (n - DEALS[n].rotation[0]) % n);
    assert.equal(view.pass.fromName, room.seats[view.pass.from].name);
    assert.equal(view.pass.targets.length, n);
    assert.ok(view.pass.label.startsWith('Passing'));
    // A hand of play numbers the tricks out of the right total.
    assert.equal(view.trickNumber, 1);
    for (const other of [2]) {
      const theirs = g.viewFor(room, other);
      assert.equal(theirs.you, 1);
      assert.deepEqual(theirs.hand.filter((c) => view.hand.includes(c)), []);
    }
  }
});

test('whole seeded games for every count: cards conserved, every hand 26 points, ending correctly', () => {
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 4; seed++) {
      const rng = seeded(seed * 100 + n);
      const settings = { seats: n, target: 50, jackOfDiamonds: seed % 2 === 0, moon: seed === 3 ? 'self' : 'others' };
      const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings });
      g.fillWithBots(room, 1);
      g.start(room, 1, rng);
      room.seats[0] = { kind: 'bot', id: 'bot:90', name: 'Zed', ai: 'standard' };
      const deck = sorted(deckFor(n));
      let steps = 0;
      while (room.phase !== 'finished') {
        if (++steps > 20000) assert.fail('the game did not end');
        if (room.phase === 'handEnd') {
          assert.deepEqual(sorted(room.taken.flat()), deck, 'every card was taken');
          assert.ok(room.taken.every((t) => t.length % n === 0), 'whole tricks only');
          assert.equal(room.taken.flat().length, deck.length);
          const total = room.lastHand.points.reduce((a, b) => a + b, 0);
          const jack = settings.jackOfDiamonds ? g.JACK_POINTS : 0;
          const moon = room.lastHand.moon !== null;
          const expected = (moon ? (settings.moon === 'self' ? -26 : 26 * (n - 1)) : 26) + jack;
          assert.equal(total, expected, `${n} players: a hand adds up`);
          assert.equal(g.forceNextHand(room, rng).ok, true);
          continue;
        }
        const action = g.runPending(room, rng);
        assert.ok(action, `something to do in ${room.phase}`);
        if (room.phase === 'playing') {
          assert.deepEqual(sorted([...room.hands.flat(), ...room.taken.flat(), ...room.trick.map((p) => p.card)]), deck, 'cards are conserved');
          assert.ok(room.trick.length <= n);
          assert.ok(room.tricksPlayed < DEALS[n].each);
        }
      }
      assert.ok(room.winners.length >= 1);
      assert.ok(room.scores.some((s) => s >= 50));
      assert.equal(Math.min(...room.scores), room.scores[room.winners[0]]);
      for (let s = 0; s < n; s++) assert.equal(room.scores[s], room.history.reduce((sum, h) => sum + h.points[s], 0));
      const hearts = room.tally.reduce((sum, t) => sum + t.heartsTaken, 0);
      assert.equal(hearts, 13 * room.history.length);
      assert.equal(room.tally.reduce((sum, t) => sum + t.queensTaken, 0), room.history.length);
    }
  }
});

test('every computer player plays whole games legally at every table size, passing the right number of cards', () => {
  for (const n of COUNTS) {
    for (const ai of AIS.map((a) => a.id)) {
      const { room, hands } = playGame({ ais: Array(n).fill(ai), seed: 7 * n, settings: { target: 50 } });
      assert.equal(room.phase, 'finished', `${ai} with ${n} players finishes`);
      assert.ok(hands.length >= 1);
      for (const h of hands) assert.equal(h.points.length, n);
    }
  }
});

test('mixed tables of computers at every size, and the first hands are passed by every AI with the right count', () => {
  const ids = AIS.map((a) => a.id);
  for (const n of COUNTS) {
    const ais = Array.from({ length: n }, (_, i) => ids[i % ids.length]);
    const { room } = playGame({ ais, seed: 900 + n, settings: { target: 50, jackOfDiamonds: true } });
    assert.equal(room.phase, 'finished');
  }
  for (const n of COUNTS) {
    for (const ai of ids) {
      const room = lobby(n);
      g.start(room, 1, seeded(n));
      room.seats.forEach((s) => (s.ai = ai));
      room.seats[0] = { kind: 'bot', id: 'bot:90', name: 'Zed', ai };
      if (room.phase === 'passing') {
        const pass = g.botPassFor(room, 0, seeded(2));
        assert.equal(pass.length, DEALS[n].pass);
        assert.equal(new Set(pass).size, pass.length);
        assert.ok(pass.every((c) => room.hands[0].includes(c)));
      }
    }
  }
});

test('Sharp stays quick: a whole seven-player game is played in reasonable time', () => {
  const started = Date.now();
  const { room } = playGame({ ais: Array(7).fill('sharp'), seed: 77, settings: { target: 50 } });
  const elapsed = Date.now() - started;
  assert.equal(room.phase, 'finished');
  const hands = room.history.length;
  assert.ok(elapsed / hands < 4000, `${hands} hands took ${elapsed} ms`);
});

test('a leaver is replaced by a computer at any table size and the game goes on', () => {
  for (const n of COUNTS) {
    const room = lobby(n);
    room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
    g.start(room, 1, seeded(n));
    const outcome = g.removeHuman(room, 2, seeded(1));
    assert.equal(outcome.ok, true);
    assert.equal(room.seats[1].kind, 'bot');
    assert.equal(room.seats.length, n);
    assert.equal(g.pendingAction(room) !== null || room.phase === 'passing' || room.turn === 0, true);
  }
});
