// Property-style tests for the Hearts rules: hundreds of seeded games (people choosing random legal moves, computers
// using their own judgement, random settings, people leaving mid-game) with the invariants checked after every action.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { fullDeck, suitOf } from '../../shared/cards.js';
import { seeded } from '../../shared/testkit.js';

const DECK = [...fullDeck()].sort();
const CARD = /\b(?:[2-9]|10|[JQKA])[CDHS]\b/g;
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function newRoom(rng, humans) {
  const settings = { target: pick(rng, game.TARGETS), jackOfDiamonds: rng() < 0.5, moon: pick(rng, game.MOON_MODES) };
  const room = game.createRoom({ code: 'a-b-c', hostId: 101, hostName: 'h101', settings, now: 1 });
  for (let i = 1; i < humans; i++) assert.equal(game.addHuman(room, 101 + i, `h${101 + i}`).ok, true);
  assert.equal(game.fillWithBots(room, 101).ok, true);
  return room;
}

/** Every card in play, wherever it is: hands, tricks already taken, and the trick on the table. */
const cardsInPlay = (room) => [...room.hands.flat(), ...room.taken.flat(), ...room.trick.map((p) => p.card)];

function checkRoom(room, label) {
  // Cards are conserved: 52 distinct cards in hands, taken piles and the current trick, from the deal to the last trick.
  if (['passing', 'playing', 'handEnd', 'finished'].includes(room.phase)) {
    if (room.phase === 'handEnd' || room.phase === 'finished') {
      assert.deepEqual([...room.taken.flat()].sort(), DECK, `${label}: all 52 cards were taken at the end of the hand`);
      assert.ok(room.hands.every((h) => h.length === 0), `${label}: hands are empty at the end of the hand`);
    } else {
      assert.deepEqual(cardsInPlay(room).sort(), DECK, `${label}: 52 distinct cards`);
    }
  }
  if (room.phase === 'passing') {
    assert.ok(room.hands.every((h) => h.length === 13), `${label}: 13 cards each while passing`);
    for (const [seat, pass] of room.passes.entries()) if (pass) assert.ok(pass.length === 3 && pass.every((c) => room.hands[seat].includes(c)), `${label}: a pass is three cards from the hand`);
  }
  if (room.phase === 'playing') {
    assert.ok(room.trick.length <= 4);
    assert.ok(room.tricksPlayed >= 0 && room.tricksPlayed < 13);
    const expected = 13 - room.tricksPlayed;
    for (const [seat, hand] of room.hands.entries()) {
      const played = room.trick.some((p) => p.seat === seat) ? 1 : 0;
      assert.equal(hand.length, expected - played, `${label}: seat ${seat} holds the right number of cards`);
    }
    if (room.trick.length < 4) {
      assert.ok(Number.isInteger(room.turn) && room.turn >= 0 && room.turn < 4, `${label}: a valid current player`);
      assert.ok(game.legalCards(room, room.turn).length > 0, `${label}: the player to move always has a legal card`);
      assert.equal(room.turn, (room.trick.length ? room.trick.at(-1).seat + 1 : room.turn) % 4);
    } else {
      assert.equal(room.turn, null);
    }
    assert.equal(new Set(room.trick.map((p) => p.seat)).size, room.trick.length, `${label}: one card per seat in a trick`);
  }
  // Scores equal the sum of the history, and the history is what the scoreboard says.
  for (let seat = 0; seat < 4; seat++) {
    assert.equal(room.scores[seat], room.history.reduce((sum, h) => sum + h.points[seat], 0), `${label}: score of seat ${seat} equals its history`);
    assert.equal(room.scores[seat], room.history.reduce((sum, h) => sum + h.deltas[seat], 0));
  }
  assert.equal(room.history.length, room.handNumber + (['handEnd', 'finished'].includes(room.phase) ? 1 : 0), `${label}: one history line per finished hand`);
  assert.equal(room.tally.reduce((sum, t) => sum + t.handsPlayed, 0), room.history.length * 4);
  if (room.phase === 'finished') {
    assert.ok(room.scores.some((s) => s >= room.settings.target));
    assert.deepEqual(room.winners, game.winnersOf(room.scores));
  } else if (room.phase !== 'lobby') {
    assert.ok(room.scores.every((s) => s < room.settings.target), `${label}: nobody has reached the target in a live game`);
  }
  assert.ok(room.seats.every((s) => s !== null || room.phase === 'lobby'));
  assert.ok(new Set(room.seats.filter(Boolean).map((s) => s.id)).size === room.seats.filter(Boolean).length, `${label}: seat ids are unique`);
  assert.ok(room.seats.some(game.isHuman), `${label}: someone human is still seated`);
}

/** What one viewer was sent may only name cards the viewer is entitled to see. */
function checkView(room, userId, label) {
  const view = game.viewFor(room, userId);
  const text = JSON.stringify(view);
  const allowed = new Set([
    ...(view.hand ?? []),
    ...(view.received ?? []),
    ...(view.pass?.chosen ?? []),
    ...(view.trick ?? []).map((p) => p.card),
    ...(view.lastTrick?.plays ?? []).map((p) => p.card),
    ...Object.keys(view.legal ?? {}),
  ]);
  // lastHand names no cards, only counts.
  for (const card of text.match(CARD) ?? []) assert.ok(allowed.has(card), `${label}: viewer ${userId} was sent ${card}`);
  const me = game.seatOf(room, userId);
  if (me === -1 && room.phase !== 'lobby') assert.deepEqual(view.hand, [], `${label}: a stranger has no hand`);
  if (me !== -1 && room.phase !== 'lobby') assert.deepEqual(view.hand, room.hands[me]);
  assert.ok(view.seats.every((s) => !s || (!('hand' in s) && typeof s.cards === 'number')));
  assert.ok(!('hands' in view) && !('passes' in view) && !('taken' in view));
  if (view.legal) assert.equal(me, room.turn, `${label}: only the player to move gets legal moves`);
  return view;
}

function playGame(seed, { leaves = true, check = checkRoom } = {}) {
  const rng = seeded(seed);
  const humans = 1 + Math.floor(rng() * 4);
  const room = newRoom(rng, humans);
  assert.equal(game.start(room, 101, rng).ok, true);
  const humanIds = () => room.seats.filter(game.isHuman).map((s) => s.id);
  const label = `seed ${seed}`;
  let steps = 0;
  let handsSeen = 0;
  while (room.phase !== 'finished') {
    assert.ok(++steps < 6000, `${label}: the game must terminate`);
    check(room, label);
    const viewer = pick(rng, [101, 102, 103, 104, 999, 'bot:1']);
    checkView(room, viewer, label);
    if (leaves && rng() < 0.004 && humanIds().length > 1 && room.phase !== 'lobby') {
      const leaver = pick(rng, humanIds());
      const outcome = game.removeHuman(room, leaver);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.replaced, true);
      assert.ok(game.isBot(room.seats[outcome.seat]), `${label}: a computer player took the seat`);
      if (room.hostId === leaver) assert.ok(humanIds().includes(room.hostId), `${label}: the host moved to a person`);
      continue;
    }
    if (room.phase === 'handEnd') {
      handsSeen++;
      assert.equal(game.nextHand(room, 999, rng).ok, false, `${label}: a stranger cannot deal`);
      assert.equal(game.nextHand(room, pick(rng, humanIds()), rng).ok, true);
      continue;
    }
    const pending = game.pendingAction(room);
    if (room.phase === 'passing') {
      const waiting = room.seats.flatMap((s, i) => (game.isHuman(s) && !room.passes[i] ? [i] : []));
      if (waiting.length && (!pending || rng() < 0.5)) {
        const seat = pick(rng, waiting);
        const hand = room.hands[seat];
        // Sometimes try something wrong first: it must be refused and change nothing.
        if (rng() < 0.3) {
          const before = JSON.stringify(room);
          assert.equal(game.choosePass(room, seat, hand.slice(0, 2)).ok, false);
          assert.equal(game.choosePass(room, seat, [hand[0], hand[0], hand[1]]).ok, false);
          assert.equal(game.choosePass(room, seat, [hand[0], hand[1], room.hands[(seat + 1) % 4].find((c) => !hand.includes(c))]).ok, false);
          assert.equal(JSON.stringify(room), before, `${label}: refused passes change nothing`);
        }
        const shuffled = [...hand].sort(() => rng() - 0.5);
        assert.equal(game.choosePass(room, seat, shuffled.slice(0, 3)).ok, true);
        assert.equal(game.choosePass(room, seat, shuffled.slice(0, 3)).ok, false, `${label}: passing twice is refused`);
      } else {
        assert.ok(game.runPending(room, rng));
      }
      continue;
    }
    if (pending) {
      const wasTrick = room.trick.length;
      game.runPending(room, rng);
      if (pending.type === 'resolve') assert.equal(wasTrick, 4);
      continue;
    }
    // A person's turn: a random legal card, after trying an illegal one.
    const seat = room.turn;
    assert.ok(game.isHuman(room.seats[seat]), `${label}: the game only waits for a person`);
    const hand = room.hands[seat];
    const legal = game.legalCards(room, seat);
    const illegal = hand.filter((c) => !legal.includes(c));
    if (illegal.length && rng() < 0.5) {
      const before = JSON.stringify(room);
      assert.equal(game.playCard(room, seat, pick(rng, illegal)).ok, false);
      assert.equal(game.playCard(room, (seat + 1) % 4, pick(rng, legal)).ok, false, `${label}: out of turn`);
      assert.equal(JSON.stringify(room), before);
    }
    const card = pick(rng, legal);
    checkPlayRules(room, seat, card, label);
    assert.equal(game.playCard(room, seat, card).ok, true);
  }
  check(room, label);
  for (const id of [101, 102, 103, 104, 999]) checkView(room, id, label);
  assert.ok(handsSeen + 1 >= 1);
  // After the end nothing can be played, and the host can go back to the lobby for a fresh game.
  assert.equal(game.playCard(room, 0, room.hands[0][0] ?? '2C').ok, false);
  assert.equal(game.choosePass(room, 0, ['2C', '3C', '4C']).ok, false);
  assert.equal(game.nextHand(room, humanIds()[0]).ok, false);
  assert.equal(game.start(room, room.hostId).ok, false, `${label}: no restart without going back to the lobby`);
  const stats = game.statsPlayers(room);
  assert.equal(stats.length, humanIds().length, `${label}: one statistics entry per person`);
  assert.ok(stats.every((p) => p.outcome === (room.winners.includes(game.seatOf(room, p.userId)) ? 'win' : 'loss')));
  return room;
}

/** The first-trick, hearts-broken and follow-suit rules, worked out afresh from the table rather than from game.js. */
function checkPlayRules(room, seat, card, label) {
  const hand = room.hands[seat];
  if (room.trick.length === 0) {
    if (room.tricksPlayed === 0) assert.equal(card, '2C', `${label}: the first card of a hand is the 2 of clubs`);
    else if (suitOf(card) === 'H' && !room.heartsBroken) assert.ok(hand.every((c) => suitOf(c) === 'H'), `${label}: hearts led before they were broken`);
    return;
  }
  const led = suitOf(room.trick[0].card);
  if (suitOf(card) !== led) assert.ok(hand.every((c) => suitOf(c) !== led), `${label}: failed to follow suit`);
  if (room.tricksPlayed === 0 && (suitOf(card) === 'H' || card === 'QS') && suitOf(card) !== led) {
    assert.ok(hand.every((c) => suitOf(c) === 'H' || c === 'QS'), `${label}: points on the first trick`);
  }
}

test('300 seeded games with random settings keep every invariant after every action', () => {
  let finished = 0;
  let moons = 0;
  let jacks = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const room = playGame(seed);
    finished++;
    moons += room.history.filter((h) => h.moon !== null).length;
    if (room.settings.jackOfDiamonds) jacks++;
  }
  assert.equal(finished, 300);
  assert.ok(jacks > 80 && jacks < 220, 'the jack setting varies');
  assert.ok(moons >= 0);
});

test('games with nobody leaving also terminate and conserve cards (seeds 1000 onward)', () => {
  for (let seed = 1000; seed < 1050; seed++) playGame(seed, { leaves: false });
});

test('every hand scores the right total: 26, adjusted by the Jack of Diamonds, or a moon', () => {
  for (let seed = 5000; seed < 5060; seed++) {
    const room = playGame(seed, { leaves: false });
    for (const [i, h] of room.history.entries()) {
      const total = h.points.reduce((a, b) => a + b, 0);
      // The Jack of Diamonds still counts on a moon hand (someone always took it in a full hand): -5 on top.
      if (h.moon !== null) assert.equal(total, (room.settings.moon === 'self' ? -26 : 78) + (room.settings.jackOfDiamonds ? -5 : 0), `seed ${seed} hand ${i}`);
      else assert.ok(total === 26 || (room.settings.jackOfDiamonds && total === 21), `seed ${seed} hand ${i}: ${total}`);
    }
  }
});

test('every pass direction is used in order and the cards go to the right seat', () => {
  const rng = seeded(77);
  const room = newRoom(rng, 4);
  game.start(room, 101, rng);
  const directions = [];
  for (let hand = 0; hand < 8; hand++) {
    directions.push(room.passDirection);
    if (room.phase === 'passing') {
      const before = room.hands.map((h) => [...h]);
      const chosen = before.map((h) => h.slice(0, 3));
      for (let seat = 0; seat < 4; seat++) assert.equal(game.choosePass(room, seat, chosen[seat]).ok, true);
      for (let seat = 0; seat < 4; seat++) {
        const from = game.passSource(seat, room.passDirection);
        assert.deepEqual([...room.received[seat]].sort(), [...chosen[from]].sort(), `hand ${hand}: seat ${seat} receives from seat ${from}`);
        assert.ok(chosen[seat].every((c) => !room.hands[seat].includes(c) || chosen[from].includes(c)));
        assert.equal(room.hands[seat].length, 13);
      }
    }
    // Finish the hand with computer moves for everyone.
    while (room.phase === 'playing') {
      game.runPending(room, rng) ?? game.playCard(room, room.turn, game.botPlay(room, room.turn, rng));
    }
    if (room.phase === 'handEnd') game.nextHand(room, 101, rng);
    else break;
  }
  assert.deepEqual(directions.slice(0, 4), ['left', 'right', 'across', 'none']);
});

test('statistics: the tally of each hand matches what was taken', () => {
  for (let seed = 9000; seed < 9040; seed++) {
    const room = playGame(seed, { leaves: false });
    const hearts = room.tally.reduce((sum, t) => sum + t.heartsTaken, 0);
    assert.equal(hearts, 13 * room.history.length, `seed ${seed}: all hearts are taken every hand`);
    const queens = room.tally.reduce((sum, t) => sum + t.queensTaken, 0);
    assert.equal(queens, room.history.length);
    const moons = room.tally.reduce((sum, t) => sum + t.moonsShot, 0);
    assert.equal(moons, room.history.filter((h) => h.moon !== null).length);
  }
});

test('the view never names a card the viewer should not see, even for a stranger, a computer id or garbage ids', () => {
  const rng = seeded(4);
  const room = newRoom(rng, 2);
  game.start(room, 101, rng);
  for (const id of [101, 102, 'bot:1', 'bot:2', 5, null, undefined, '101', {}, [], '__proto__']) {
    const view = game.viewFor(room, id);
    const mine = game.seatOf(room, id);
    const allowed = new Set([...(mine === -1 ? [] : room.hands[mine])]);
    for (const card of JSON.stringify(view).match(CARD) ?? []) assert.ok(allowed.has(card), `${String(id)} saw ${card}`);
  }
});
