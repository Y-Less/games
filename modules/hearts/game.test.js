// The rules of Hearts: legal plays, passing, tricks, scoring, the end of the game and the computer players.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDeck, suitOf } from '../../shared/cards.js';
import * as g from './game.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A started game: seat 0 is the human (account 1), the rest are computers. */
function started(settings = {}, rng = seeded(1)) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings });
  g.fillWithBots(room, 1);
  assert.equal(g.start(room, 1, rng).ok, true);
  return room;
}

/** A game in the middle of a hand with chosen hands (cards are given per seat); the first trick has been played. */
function midHand(hands, { settings = {}, turn = 0, trick = [], tricksPlayed = 1, heartsBroken = false, taken } = {}) {
  const room = started(settings);
  for (const seat of room.seats) if (seat?.kind === 'bot') seat.ai = 'standard'; // these tests pin down the standard AI
  room.phase = 'playing';
  room.passDirection = 'none';
  room.hands = hands.map((h) => [...h]);
  room.trick = trick;
  room.turn = turn;
  room.tricksPlayed = tricksPlayed;
  room.heartsBroken = heartsBroken;
  room.taken = taken ?? [[], [], [], []];
  room.moonBid = null;
  return room;
}

const botsOnly = (settings, rng) => {
  const room = started(settings, rng);
  return room;
};

/** Turns every seat into a computer and plays the whole game, checking every move. Returns the finished room. */
function simulate(settings, seed) {
  const rng = seeded(seed);
  const room = g.createRoom({ code: 'x-y-z', hostId: 1, hostName: 'Ann', settings });
  g.fillWithBots(room, 1);
  g.start(room, 1, rng);
  room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Zed' };
  for (let guard = 0; guard < 20000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'handEnd') {
      const points = room.lastHand.points;
      const jack = settings.jackOfDiamonds && room.lastHand.details.some((d) => d.jack) ? -5 : 0;
      const expected = (room.lastHand.moon === null ? 26 : settings.moon === 'self' ? -26 : 78) + jack;
      assert.equal(points.reduce((a, b) => a + b, 0), expected, 'a hand adds up');
      room.seats[0] = { kind: 'human', id: 1, name: 'Ann' };
      assert.equal(g.nextHand(room, 1, rng).ok, true);
      room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Zed' };
      continue;
    }
    assert.ok(g.runPending(room, rng), `something to do in ${room.phase}`);
  }
  assert.equal(room.phase, 'finished');
  return room;
}

// ---- settings and seats ----

test('a new room has the default settings and the host in the first seat', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 7, hostName: 'Ann' });
  assert.deepEqual(room.settings, { target: 100, jackOfDiamonds: false, moon: 'others' });
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.seats[0], { kind: 'human', id: 7, name: 'Ann' });
  assert.deepEqual(room.seats.slice(1), [null, null, null]);
});

test('settings are validated and only the host can change them, before the game starts', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  assert.equal(g.setSettings(room, 1, { target: 50, jackOfDiamonds: true, moon: 'self' }).ok, true);
  assert.deepEqual(room.settings, { target: 50, jackOfDiamonds: true, moon: 'self' });
  assert.equal(g.setSettings(room, 1, { target: 75 }).ok, false);
  assert.equal(g.setSettings(room, 1, { jackOfDiamonds: 'yes' }).ok, false);
  assert.equal(g.setSettings(room, 1, { moon: 'both' }).ok, false);
  assert.deepEqual(room.settings, { target: 50, jackOfDiamonds: true, moon: 'self' }, 'a bad change changes nothing');
  assert.equal(g.setSettings(room, 2, { target: 100 }).ok, false);
  g.fillWithBots(room, 1);
  g.start(room, 1);
  assert.equal(g.setSettings(room, 1, { target: 100 }).ok, false);
  assert.throws(() => g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { target: 3 } }));
});

test('humans take the first empty seat, and a full room is refused', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  assert.equal(g.addHuman(room, 2, 'Bob').seat, 1);
  assert.equal(g.addHuman(room, 2, 'Bob').seat, 1, 'joining twice is harmless');
  assert.equal(g.addHuman(room, 3, 'Cat').seat, 2);
  assert.equal(g.addHuman(room, 4, 'Dan').seat, 3);
  assert.equal(g.addHuman(room, 5, 'Eve').ok, false);
});

test('the host adds, removes and fills computer players; the game needs four seats and a person', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  assert.equal(g.start(room, 1).ok, false, 'three seats are empty');
  assert.equal(g.addBot(room, 2).ok, false, 'not the host');
  const added = g.addBot(room, 1);
  assert.equal(added.seat, 1);
  assert.equal(room.seats[1].kind, 'bot');
  assert.match(room.seats[1].id, /^bot:\d+$/);
  assert.equal(g.addBot(room, 1, 1).ok, false, 'the seat is taken');
  assert.equal(g.addBot(room, 1, 9).ok, false, 'no such seat');
  assert.equal(g.removeBot(room, 1, 0).ok, false, 'a person is not removed this way');
  assert.equal(g.removeBot(room, 1, 1).ok, true);
  assert.equal(room.seats[1], null);
  assert.equal(g.fillWithBots(room, 1).ok, true);
  assert.deepEqual(room.seats.map((s) => s.kind), ['human', 'bot', 'bot', 'bot']);
  assert.equal(new Set(room.seats.map((s) => s.name)).size, 4, 'names are distinct');
  assert.equal(new Set(room.seats.map((s) => s.id)).size, 4);
  assert.equal(g.addBot(room, 1).ok, false, 'every seat is taken');
  assert.equal(g.start(room, 2).ok, false, 'only the host starts');

  room.seats[0] = { kind: 'bot', id: 'bot:7', name: 'Nobody' };
  assert.equal(g.start(room, 1).ok, false, 'at least one person must play');
});

test('leaving the lobby frees the seat and passes on hosting; the last person out closes the room', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  g.addHuman(room, 2, 'Bob');
  g.addBot(room, 1);
  assert.deepEqual(g.removeHuman(room, 1), { ok: true, empty: false, seat: 0, replaced: false });
  assert.equal(room.seats[0], null);
  assert.equal(room.hostId, 2);
  assert.equal(g.removeHuman(room, 1).ok, false);
  assert.equal(g.removeHuman(room, 2).empty, true, 'only a computer player is left');
});

// ---- dealing and passing ----

test('a deal gives each seat 13 different cards, and the passing direction rotates', () => {
  const room = started();
  assert.equal(room.phase, 'passing');
  assert.deepEqual(room.hands.map((h) => h.length), [13, 13, 13, 13]);
  assert.deepEqual([...room.hands.flat()].sort(), [...fullDeck()].sort());
  const directions = [];
  for (let hand = 0; hand < 8; hand++) {
    room.handNumber = hand;
    g.deal(room, seeded(hand));
    directions.push(room.passDirection);
  }
  assert.deepEqual(directions, ['left', 'right', 'across', 'none', 'left', 'right', 'across', 'none']);
  assert.equal(room.phase, 'playing', 'with no pass the hand starts at once');
});

test('passing left, right and across goes to the right seat', () => {
  assert.equal(g.passTarget(0, 'left'), 1);
  assert.equal(g.passTarget(3, 'left'), 0);
  assert.equal(g.passTarget(0, 'right'), 3);
  assert.equal(g.passTarget(1, 'right'), 0);
  assert.equal(g.passTarget(1, 'across'), 3);
  assert.equal(g.passTarget(2, 'across'), 0);
  for (const direction of ['left', 'right', 'across']) for (let s = 0; s < 4; s++) assert.equal(g.passSource(g.passTarget(s, direction), direction), s);
});

test('everyone chooses three cards; once all have, they change hands and the 2 of clubs leads', () => {
  const room = started();
  const before = room.hands.map((h) => [...h]);
  const picks = before.map((h) => h.slice(0, 3));
  assert.equal(g.choosePass(room, 0, picks[0].slice(0, 2)).ok, false, 'two cards is too few');
  assert.equal(g.choosePass(room, 0, [picks[0][0], picks[0][0], picks[0][1]]).ok, false, 'the same card twice');
  assert.equal(g.choosePass(room, 0, [...picks[1]]).ok, false, 'cards from somebody else\'s hand');
  assert.equal(g.choosePass(room, 0, ['ZZ', picks[0][0], picks[0][1]]).ok, false);
  assert.equal(g.choosePass(room, 0, 'AS').ok, false);
  for (let seat = 0; seat < 4; seat++) assert.equal(g.choosePass(room, seat, picks[seat]).ok, seat < 4);
  assert.equal(g.choosePass(room, 0, picks[0]).ok, false, 'too late to pass again');
  assert.equal(room.phase, 'playing');
  for (let seat = 0; seat < 4; seat++) {
    const from = (seat + 3) % 4; // passing left: seat s sends to s + 1
    const expected = [...before[seat].filter((c) => !picks[seat].includes(c)), ...picks[from]].sort();
    assert.deepEqual([...room.hands[seat]].sort(), expected);
    assert.deepEqual([...room.received[seat]].sort(), [...picks[from]].sort());
  }
  assert.ok(room.hands[room.turn].includes('2C'));
  assert.equal(room.tricksPlayed, 0);
});

test('a pass cannot be chosen outside the passing phase', () => {
  const room = midHand([['2C'], ['3C'], ['4C'], ['5C']]);
  assert.equal(g.choosePass(room, 0, ['2C', '3C', '4C']).ok, false);
});

// ---- legal plays ----

test('the first trick is led with the 2 of clubs, and clubs must follow', () => {
  const room = started();
  room.phase = 'playing';
  room.passDirection = 'none';
  room.hands = [['2C', '5C', 'AH'], ['3C', 'KS', 'QS'], ['3D', 'AH', 'QS'], ['4D', '4S', '5H']];
  room.hands[2] = ['3D', 'AD', 'QS'];
  room.turn = 0;
  room.trick = [];
  room.tricksPlayed = 0;
  assert.deepEqual(g.legalCards(room, 0), ['2C']);
  assert.match(g.illegalReason(room, 0, '5C'), /2 of clubs/);
  assert.equal(g.playCard(room, 1, '3C').ok, false, 'not your turn');
  assert.equal(g.playCard(room, 0, '5C').ok, false);
  assert.equal(g.playCard(room, 0, '2C').ok, true);
  assert.deepEqual(g.legalCards(room, 1), ['3C'], 'must follow clubs');
  assert.match(g.illegalReason(room, 1, 'KS'), /follow suit \(clubs\)/);
});

test('no points on the first trick, unless every card is a point card', () => {
  const room = midHand([['2C'], ['KS', 'QS', 'AH', '3D'], ['QS', 'AH', '2H'], ['9D']], { tricksPlayed: 0, turn: 1, trick: [{ seat: 0, card: '2C' }] });
  assert.deepEqual(g.legalCards(room, 1), ['KS', '3D'], 'void in clubs: anything but hearts and the Queen of Spades');
  assert.match(g.illegalReason(room, 1, 'QS'), /first trick/);
  assert.match(g.illegalReason(room, 1, 'AH'), /first trick/);
  room.turn = 2;
  assert.deepEqual(g.legalCards(room, 2), ['QS', 'AH', '2H'], 'only point cards: any of them');
});

test('the Jack of Diamonds is not a point card on the first trick', () => {
  const room = midHand([['2C'], ['JD', 'QS']], { tricksPlayed: 0, turn: 1, trick: [{ seat: 0, card: '2C' }], settings: { jackOfDiamonds: true } });
  assert.deepEqual(g.legalCards(room, 1), ['JD']);
});

test('hearts cannot be led until broken, unless the hand is all hearts', () => {
  const room = midHand([['5C', 'AH', '3H'], ['2D'], ['2D'], ['2D']]);
  assert.deepEqual(g.legalCards(room, 0), ['5C']);
  assert.match(g.illegalReason(room, 0, 'AH'), /not been broken/);
  assert.equal(g.playCard(room, 0, 'AH').ok, false);
  room.heartsBroken = true;
  assert.deepEqual(g.legalCards(room, 0), ['5C', 'AH', '3H']);
  room.heartsBroken = false;
  room.hands[0] = ['AH', '3H'];
  assert.deepEqual(g.legalCards(room, 0), ['AH', '3H'], 'only hearts left');
});

test('the Queen of Spades does not break hearts, but any heart played does', () => {
  const room = midHand([['5C', 'AH'], ['2D', 'QS'], ['2D', '3H'], ['2D']], { trick: [{ seat: 0, card: '5S' }], turn: 1 });
  room.hands[1] = ['QS', '9C'];
  room.trick = [{ seat: 0, card: '5D' }];
  assert.equal(g.playCard(room, 1, 'QS').ok, true, 'void in diamonds, so the queen may go');
  assert.equal(room.heartsBroken, false);
  room.trick = [{ seat: 0, card: '5D' }, { seat: 1, card: '9S' }];
  room.hands[2] = ['3H', '2C'];
  room.turn = 2;
  assert.equal(g.playCard(room, 2, '3H').ok, true);
  assert.equal(room.heartsBroken, true);
});

test('you must follow suit when you can, and may play anything when you cannot', () => {
  const room = midHand([['5S'], ['2S', 'KD', 'AH'], ['2D', 'AH'], ['2D']], { turn: 1, trick: [{ seat: 0, card: '5S' }] });
  assert.deepEqual(g.legalCards(room, 1), ['2S']);
  room.hands[1] = ['KD', 'AH', 'QC'];
  assert.deepEqual(g.legalCards(room, 1), ['KD', 'AH', 'QC'], 'void in spades, past the first trick');
});

test('a card not in your hand or a non-card is refused', () => {
  const room = midHand([['5C'], ['2D'], ['2D'], ['2D']]);
  assert.equal(g.playCard(room, 0, '6C').ok, false);
  assert.equal(g.playCard(room, 0, 12).ok, false);
  assert.equal(g.playCard(room, 0, null).ok, false);
});

// ---- tricks ----

test('the highest card of the suit led wins, whatever else was played', () => {
  assert.equal(g.trickWinner([{ seat: 2, card: '5D' }, { seat: 3, card: 'AS' }, { seat: 0, card: '9D' }, { seat: 1, card: 'AH' }]), 0);
  assert.equal(g.trickWinner([{ seat: 3, card: '10C' }, { seat: 0, card: 'JC' }, { seat: 1, card: 'QH' }, { seat: 2, card: '2C' }]), 0);
  assert.equal(g.trickWinner([{ seat: 1, card: '3H' }, { seat: 2, card: '2H' }, { seat: 3, card: '4S' }, { seat: 0, card: 'AD' }]), 1);
});

test('a finished trick goes to its winner, who leads next', () => {
  const room = midHand([['5D', '9C'], ['AD', '9H'], ['6D', '9S'], ['2D', '9D']], { turn: 0 });
  assert.equal(g.playCard(room, 0, '5D').complete, false);
  g.playCard(room, 1, 'AD');
  g.playCard(room, 2, '6D');
  assert.equal(room.turn, 3);
  const last = g.playCard(room, 3, '2D');
  assert.equal(last.complete, true);
  assert.equal(room.turn, null, 'nobody plays while a trick waits to be cleared');
  assert.equal(g.playCard(room, 0, '9C').ok, false);
  assert.deepEqual(g.pendingAction(room), { type: 'resolve' });
  const outcome = g.resolveTrick(room);
  assert.deepEqual([outcome.winner, outcome.handOver], [1, false]);
  assert.deepEqual(room.taken[1].sort(), ['2D', '5D', '6D', 'AD']);
  assert.equal(room.turn, 1);
  assert.equal(room.tricksPlayed, 2);
  assert.deepEqual(room.trick, []);
  assert.equal(g.resolveTrick(room).ok, false);
});

// ---- scoring ----

const pile = (...cards) => cards;
const hearts = (n) => ['2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', '10H', 'JH', 'QH', 'KH', 'AH'].slice(0, n);
const allHearts = hearts(13);
const plain = { target: 100, jackOfDiamonds: false, moon: 'others' };

test('hearts are 1 point each and the Queen of Spades 13', () => {
  const r = g.scoreHand([pile(...hearts(5), '3C'), pile('QS', ...hearts(3)), pile(...hearts(5)), pile('JD')], plain);
  assert.deepEqual(r.points, [5, 16, 5, 0]);
  assert.equal(r.moon, null);
});

test('the Jack of Diamonds is -5 only when the setting is on', () => {
  const taken = [pile('JD', ...hearts(2)), pile('QS'), pile(...hearts(11)), pile()];
  assert.deepEqual(g.scoreHand(taken, plain).points, [2, 13, 11, 0]);
  assert.deepEqual(g.scoreHand(taken, { ...plain, jackOfDiamonds: true }).points, [-3, 13, 11, 0]);
});

test('shooting the moon: everyone else scores 26 by default', () => {
  const r = g.scoreHand([pile(), pile(...allHearts, 'QS', '3C'), pile(), pile()], plain);
  assert.equal(r.moon, 1);
  assert.deepEqual(r.points, [26, 0, 26, 26]);
});

test('shooting the moon: the shooter can score -26 instead', () => {
  const r = g.scoreHand([pile(), pile(), pile(...allHearts, 'QS'), pile()], { ...plain, moon: 'self' });
  assert.equal(r.moon, 2);
  assert.deepEqual(r.points, [0, 0, -26, 0]);
});

test('taking every heart without the Queen, or the Queen without every heart, is not the moon', () => {
  assert.equal(g.scoreHand([pile(...allHearts), pile('QS'), pile(), pile()], plain).moon, null);
  assert.deepEqual(g.scoreHand([pile(...allHearts), pile('QS'), pile(), pile()], plain).points, [13, 13, 0, 0]);
  assert.equal(g.scoreHand([pile(...hearts(12), 'QS'), pile('AH'), pile(), pile()], plain).moon, null);
});

test('with the Jack rule on, the moon needs only the hearts and the Queen, and the Jack still counts on a moon hand', () => {
  const on = { ...plain, jackOfDiamonds: true };
  const without = g.scoreHand([pile(...allHearts, 'QS'), pile('JD'), pile(), pile()], on);
  assert.equal(without.moon, 0, 'the Jack need not be taken to shoot the moon');
  assert.deepEqual(without.points, [0, 21, 26, 26], 'another player who took the Jack scores 21, not 26');
  const withJack = g.scoreHand([pile(...allHearts, 'QS', 'JD'), pile(), pile(), pile()], on);
  assert.deepEqual(withJack.points, [-5, 26, 26, 26], 'a shooter who also took the Jack scores its -5');
  assert.deepEqual(g.scoreHand([pile(...allHearts, 'QS', 'JD'), pile(), pile(), pile()], { ...on, moon: 'self' }).points, [-31, 0, 0, 0], 'the Jack deepens the shooter\'s -26 to -31');
  assert.deepEqual(g.scoreHand([pile(...allHearts, 'QS'), pile('JD'), pile(), pile()], { ...on, moon: 'self' }).points, [-26, -5, 0, 0], 'another player who took the Jack scores -5');
  assert.deepEqual(g.scoreHand([pile(...allHearts, 'QS'), pile('JD'), pile(), pile()], plain).points, [0, 26, 26, 26], 'with the Jack rule off it counts for nothing');
});

test('hand points shown while playing add up as the hand goes', () => {
  const room = started({ jackOfDiamonds: true });
  room.taken = [[...hearts(2), 'JD'], ['QS'], [], []];
  const view = g.viewFor(room, 1);
  assert.deepEqual(view.seats.map((s) => s.points), [-3, 13, 0, 0]);
});

// ---- hands and the end of the game ----

/** Plays out a hand where seat `taker` wins every trick by leading and playing high, to reach the end of the hand. */
function finishHand(room, rng = seeded(5)) {
  for (let guard = 0; guard < 500 && room.phase === 'playing'; guard++) g.runPending(room, rng);
}

test('after the thirteenth trick the hand is scored, tallied and the game goes on or ends', () => {
  const room = started({ target: 50 }, seeded(2));
  room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Zed' };
  let hands = 0;
  while (room.phase !== 'finished') {
    for (let guard = 0; guard < 500 && ['passing', 'playing'].includes(room.phase); guard++) g.runPending(room, seeded(hands + 10));
    hands++;
    const last = room.lastHand;
    assert.equal(last.hand, hands);
    assert.equal(room.history.length, hands);
    assert.deepEqual(last.totals, room.scores);
    if (room.phase === 'handEnd') {
      assert.ok(room.scores.every((s) => s < 50));
      room.seats[0] = { kind: 'human', id: 1, name: 'Ann' };
      assert.equal(g.nextHand(room, 1, seeded(hands)).ok, true);
      room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Zed' };
    }
  }
  assert.ok(room.scores.some((s) => s >= 50));
  assert.deepEqual(room.winners, g.winnersOf(room.scores));
  assert.equal(room.tally[0].handsPlayed, hands);
  assert.equal(room.tally.reduce((n, t) => n + t.heartsTaken, 0), hands * 13 - room.history.filter((h) => h.moon !== null).length * 0, 'every heart is taken by somebody');
});

test('the next hand cannot start until the hand is over, and only by a player', () => {
  const room = started();
  assert.equal(g.nextHand(room, 1).ok, false);
  room.phase = 'handEnd';
  assert.equal(g.nextHand(room, 99).ok, false);
  assert.equal(g.nextHand(room, 1).ok, true);
  assert.equal(room.handNumber, 1);
  assert.equal(room.passDirection, 'right');
});

test('the next hand is dealt once every person has closed the score pop-up, and not before', () => {
  const room = started();
  room.seats[1] = { kind: 'human', id: 2, name: 'Bea' };
  room.phase = 'handEnd';
  room.ready = [];
  assert.equal(g.nextHand(room, 1).ok, true);
  assert.equal(room.phase, 'handEnd', 'one of two people is not enough');
  assert.deepEqual(room.ready, [0]);
  assert.equal(g.nextHand(room, 1).ok, true, 'closing it twice is harmless');
  assert.equal(room.handNumber, 0);
  assert.equal(g.nextHand(room, 2).ok, true);
  assert.notEqual(room.phase, 'handEnd');
  assert.equal(room.handNumber, 1);
  assert.deepEqual(room.ready, []);
});

test('a person leaving at the end of a hand does not hold the others up, and the server can force the next hand', () => {
  const room = started();
  room.seats[1] = { kind: 'human', id: 2, name: 'Bea' };
  room.phase = 'handEnd';
  room.ready = [];
  g.nextHand(room, 1);
  assert.equal(g.removeHuman(room, 2).ok, true);
  assert.notEqual(room.phase, 'handEnd');
  room.phase = 'handEnd';
  room.ready = [];
  assert.equal(g.forceNextHand(room).ok, true);
  assert.notEqual(room.phase, 'handEnd');
  assert.equal(g.forceNextHand(room).ok, false);
});

test('the game ends only once somebody has reached the target, and the lowest score wins', () => {
  const finalHand = (scores, taken) => {
    const room = midHand([[], [], [], []], { tricksPlayed: 12, turn: 0, trick: [{ seat: 0, card: '2D' }, { seat: 1, card: '3D' }, { seat: 2, card: '4D' }, { seat: 3, card: '5D' }], taken });
    room.scores = scores;
    g.resolveTrick(room);
    return room;
  };
  const taken = () => [[], [], [], []];
  const under = finalHand([40, 30, 20, 10], taken());
  assert.equal(under.phase, 'handEnd');
  assert.equal(under.winners, null);

  const t = taken();
  t[0].push(...hearts(3));
  t[1].push('QS');
  const over = finalHand([99, 50, 20, 10], t);
  assert.equal(over.phase, 'finished', 'seat 0 went from 99 to 102');
  assert.deepEqual(over.scores, [102, 63, 20, 10]);
  assert.deepEqual(over.winners, [3]);
});

test('tied lowest scores all win, and a game can end with everyone over the target', () => {
  assert.deepEqual(g.winnersOf([100, 20, 20, 60]), [1, 2]);
  assert.deepEqual(g.winnersOf([-5, 3, -5, 9]), [0, 2]);
  assert.deepEqual(g.winnersOf([120, 130, 120, 130]), [0, 2]);
});

test('a hand where someone shoots the moon is scored and counted for them', () => {
  const taken = [[], [...allHearts, 'QS', '3C'], [], []];
  const room = midHand([[], [], [], []], { tricksPlayed: 12, turn: 0, trick: [{ seat: 0, card: '2D' }, { seat: 1, card: 'AD' }, { seat: 2, card: '4D' }, { seat: 3, card: '5D' }], taken });
  g.resolveTrick(room);
  assert.deepEqual(room.lastHand.points, [26, 0, 26, 26]);
  assert.equal(room.lastHand.moon, 1);
  assert.equal(room.tally[1].moonsShot, 1);
  assert.equal(room.tally[1].heartsTaken, 13);
  assert.equal(room.tally[1].queensTaken, 1);
  assert.equal(room.tally[0].moonsShot, 0);
  assert.equal(room.phase, 'handEnd', '26 points is under the default target');
});

test('play again resets the game for the host, keeping the seats and settings', () => {
  const room = simulate({ target: 50, jackOfDiamonds: true, moon: 'self' }, 4);
  room.seats[0] = { kind: 'human', id: 1, name: 'Ann' };
  assert.equal(g.playAgain(room, 2).ok, false);
  assert.equal(g.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.scores, [0, 0, 0, 0]);
  assert.deepEqual(room.history, []);
  assert.equal(room.recorded, false);
  assert.deepEqual(room.settings, { target: 50, jackOfDiamonds: true, moon: 'self' });
  assert.deepEqual(room.seats.map((s) => s.kind), ['human', 'bot', 'bot', 'bot']);
  assert.equal(g.start(room, 1, seeded(3)).ok, true);
  assert.equal(g.playAgain(room, 1).ok, false, 'not while playing');
});

// ---- leaving mid-game and statistics ----

test('a human who leaves mid-game is replaced by a computer player in the same seat', () => {
  const room = started();
  room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
  const outcome = g.removeHuman(room, 2);
  assert.deepEqual([outcome.ok, outcome.empty, outcome.replaced], [true, false, true]);
  assert.equal(room.seats[1].kind, 'bot');
  assert.notEqual(room.seats[1].name, 'Bob');
  assert.equal(new Set(room.seats.map((s) => s.id)).size, 4);
  assert.equal(room.phase, 'passing');
  assert.ok(g.pendingAction(room), 'the new computer player has to pass');
  assert.equal(g.removeHuman(room, 1).empty, true, 'nobody is left');
});

test('a leaver\'s chosen pass stays', () => {
  const room = started();
  room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
  const cards = room.hands[1].slice(0, 3);
  g.choosePass(room, 1, cards);
  g.removeHuman(room, 2);
  assert.deepEqual([...room.passes[1]].sort(), [...cards].sort());
});

test('the host passes on when the host leaves mid-game', () => {
  const room = started();
  room.seats[2] = { kind: 'human', id: 3, name: 'Cat' };
  g.removeHuman(room, 1);
  assert.equal(room.hostId, 3);
});

test('statistics: winners win, ties share a placement, computer players and replaced humans are left out', () => {
  const room = started();
  room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
  room.seats[2] = { kind: 'human', id: 3, name: 'Cat' };
  room.seats[3] = { kind: 'human', id: 4, name: 'Dan' };
  room.scores = [104, 30, 30, 60];
  room.winners = g.winnersOf(room.scores);
  room.tally[1] = { handsPlayed: 6, moonsShot: 1, queensTaken: 2, heartsTaken: 11 };
  g.removeHuman(room, 4); // a leaver is not recorded
  room.phase = 'finished';
  const players = g.statsPlayers(room);
  assert.deepEqual(players.map((p) => p.userId), [1, 2, 3]);
  assert.deepEqual(players.map((p) => [p.outcome, p.placement, p.score]), [['loss', 4, 104], ['win', 1, 30], ['win', 1, 30]]);
  assert.deepEqual(players[1].extras, { handsPlayed: 6, moonsShot: 1, queensTaken: 2, heartsTaken: 11 });
});

// ---- views ----

test('a view holds your hand and public information only', () => {
  const room = started();
  const view = g.viewFor(room, 1);
  assert.equal(view.you, 0);
  assert.deepEqual(view.hand, room.hands[0]);
  assert.ok(view.seats.every((s) => !('hand' in s)));
  const text = JSON.stringify(view);
  for (const card of room.hands[1].filter((c) => !room.hands[0].includes(c))) assert.ok(!text.includes(`"${card}"`), `${card} leaked`);
  assert.deepEqual(view.seats.map((s) => s.cards), [13, 13, 13, 13]);
  assert.equal(view.pass.direction, 'left');
  assert.equal(view.pass.to, 1);
  assert.equal(view.pass.from, 3);
  assert.equal(view.legal, null);
});

test('the legal map appears only on your turn, with a reason for each illegal card', () => {
  const room = midHand([['5C', 'AH', 'KH'], ['2D'], ['2D'], ['2D']]);
  const view = g.viewFor(room, 1);
  assert.deepEqual(view.legal, { '5C': null, AH: 'Hearts have not been broken yet.', KH: 'Hearts have not been broken yet.' });
  room.turn = 1;
  assert.equal(g.viewFor(room, 1).legal, null);
});

test('every view carries the standard scoreboard with the whole round history', () => {
  const room = started({ target: 50 }, seeded(8));
  room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
  room.taken = [[...hearts(13), 'QS'], [], [], []];
  room.phase = 'playing';
  room.tricksPlayed = 12;
  room.trick = [{ seat: 0, card: 'AD' }, { seat: 1, card: '2D' }, { seat: 2, card: '3D' }, { seat: 3, card: '4D' }];
  room.turn = null;
  g.resolveTrick(room);
  for (const id of [1, 2]) {
    const { scoreboard } = g.viewFor(room, id);
    assert.equal(scoreboard.lowIsBetter, true);
    assert.equal(scoreboard.target, 50);
    assert.deepEqual(scoreboard.players.map((p) => [p.id, p.score, p.isMe]), [[0, 0, id === 1], [1, 26, id === 2], [2, 26, false], [3, 26, false]]);
    assert.deepEqual(scoreboard.rounds, [{ label: 'Hand 1', deltas: { 0: 0, 1: 26, 2: 26, 3: 26 }, notes: { 0: 'shot the moon' } }]);
  }
});

// ---- computer players ----

test('computer passes are three different cards from the hand and shed danger', () => {
  const hand = ['2C', '5D', '9D', 'KD', '3S', '7S', 'QS', 'AS', '2H', 'AH', 'QH', '4H', '8C'];
  const pass = g.botPass(hand);
  assert.equal(new Set(pass).size, 3);
  assert.ok(pass.every((c) => hand.includes(c)));
  assert.ok(pass.includes('QS'), 'the Queen of Spades goes');
  assert.ok(pass.includes('AS'));
  assert.ok(pass.includes('AH'));
  const jack = g.botPass([...hand.slice(0, 12), 'JD'], { jackOfDiamonds: true });
  assert.ok(!jack.includes('JD'), 'a Jack worth -5 is kept');
});

test('a computer player dumps the Queen of Spades when it cannot follow suit', () => {
  const room = midHand([['5D'], ['9D', '2H', 'QS', '7C'], ['3D'], ['4D']], { turn: 1, trick: [{ seat: 0, card: '5D' }] });
  room.hands[1] = ['2H', 'QS', '7C'];
  assert.equal(g.botPlay(room, 1), 'QS');
});

test('a computer player ducks, and dumps the Queen under a higher spade', () => {
  let room = midHand([['5D'], ['3D', '9D', 'KD'], [], []], { turn: 1, trick: [{ seat: 0, card: '5D' }] });
  assert.equal(g.botPlay(room, 1), '3D', 'ducking under the five with the three');
  room = midHand([['KS'], ['2S', 'JS', 'QS'], [], []], { turn: 1, trick: [{ seat: 0, card: 'KS' }] });
  assert.equal(g.botPlay(room, 1), 'QS', 'the king will take it');
  room = midHand([['5S'], ['2S', 'JS', 'QS'], [], []], { turn: 1, trick: [{ seat: 0, card: '5S' }] });
  assert.equal(g.botPlay(room, 1), '2S', 'but not under a low spade');
});

test('a computer player that must take the trick plays high last, low otherwise', () => {
  let room = midHand([['2D'], ['3D'], ['4D'], ['9D', 'KD']], { turn: 3, trick: [{ seat: 0, card: '2D' }, { seat: 1, card: '3D' }, { seat: 2, card: '4D' }] });
  assert.equal(g.botPlay(room, 3), 'KD');
  room = midHand([['8D'], ['9D', 'KD'], [], []], { turn: 1, trick: [{ seat: 0, card: '8D' }] });
  room.hands[1] = ['9D', 'KD'];
  assert.equal(g.botPlay(room, 1), '9D');
});

test('a computer player leads low and flushes the Queen of Spades with a low spade', () => {
  let room = midHand([['2D', '9C', 'AS', '3S', 'AH'], [], [], []], { turn: 0 });
  assert.equal(g.botPlay(room, 0), '3S');
  room = midHand([['2D', '9C', 'AS', '3S', 'QS'], [], [], []], { turn: 0 });
  assert.notEqual(suitOf(g.botPlay(room, 0)), 'S', 'with the Queen in hand it avoids spades');
  room = midHand([['KC', '9C', 'AH', '3H'], [], [], []], { turn: 0, heartsBroken: true });
  assert.equal(g.botPlay(room, 0), '9C', 'hearts last');
});

test('a computer player with an overwhelming hand goes for the moon, and gives up when somebody else scores', () => {
  const strong = ['AH', 'KH', 'QH', 'JH', '10H', '9H', 'AS', 'KS', 'QS', 'AD', 'KD', 'AC', 'KC'];
  assert.equal(g.wantsMoon(strong), true);
  assert.equal(g.wantsMoon(['2H', '3H', '4H', '5H', '6H', '7H', '8H', 'AS', 'KS', 'QS', 'AD', 'KD', 'AC']), false);
  const room = midHand([['3C'], strong, [], []], { turn: 1, trick: [] });
  room.hands[1] = strong;
  room.moonBid = 1;
  assert.equal(g.botPlay(room, 1), 'AS', 'leads its highest card');
  room.taken[2] = ['AH'];
  room.trick = [];
  const hand = midHand([['2C'], ['3C'], ['4C'], ['5C']]);
  hand.moonBid = 0;
  hand.trick = [{ seat: 0, card: '2D' }, { seat: 1, card: '3D' }, { seat: 2, card: '4D' }, { seat: 3, card: 'AH' }];
  hand.turn = null;
  g.resolveTrick(hand);
  assert.equal(hand.moonBid, null);
});

test('computer moves are always legal: whole games of computers against computers', () => {
  let hands = 0;
  let moons = 0;
  const seen = { first: 0 };
  for (let seed = 1; seed <= 120; seed++) {
    const settings = { target: [50, 100, 150][seed % 3], jackOfDiamonds: seed % 2 === 0, moon: seed % 4 < 2 ? 'others' : 'self' };
    const room = simulate(settings, seed);
    hands += room.history.length;
    moons += room.history.filter((h) => h.moon !== null).length;
    assert.ok(room.scores.some((s) => s >= settings.target));
    assert.deepEqual(room.winners, g.winnersOf(room.scores));
    assert.equal(room.tally[0].handsPlayed, room.history.length);
    seen.first++;
  }
  assert.ok(hands > 1000, `${hands} hands played`);
  assert.ok(moons >= 0);
});

test('every legal-move check over thousands of random mid-hand positions', () => {
  const rng = seeded(99);
  let positions = 0;
  for (let n = 0; n < 4000; n++) {
    const room = started({ jackOfDiamonds: n % 2 === 0 }, rng);
    room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Zed' };
    const steps = Math.floor(rng() * 70);
    for (let i = 0; i < steps && ['passing', 'playing'].includes(room.phase); i++) g.runPending(room, rng);
    if (room.phase !== 'playing' || room.trick.length === 4) continue;
    const seat = room.turn;
    const legal = g.legalCards(room, seat);
    assert.ok(legal.length >= 1, 'there is always a legal card');
    const card = g.botPlay(room, seat, rng);
    assert.ok(legal.includes(card), `${card} is legal`);
    for (const c of room.hands[seat]) assert.equal(legal.includes(c), g.illegalReason(room, seat, c) === null);
    positions++;
  }
  assert.ok(positions > 1500, `${positions} positions checked`);
});

test('computer passes are always three different cards from the hand over thousands of hands', () => {
  const rng = seeded(7);
  for (let n = 0; n < 3000; n++) {
    const room = started({ jackOfDiamonds: n % 2 === 0 }, rng);
    for (const hand of room.hands) {
      const pass = g.botPass(hand, room.settings);
      assert.equal(pass.length, 3);
      assert.equal(new Set(pass).size, 3);
      assert.ok(pass.every((c) => hand.includes(c)));
    }
  }
});

test('a computer player does better than random: it takes fewer points than a player who always plays the first legal card', () => {
  let bot = 0;
  let naive = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed);
    const room = botsOnly({}, rng);
    room.settings.target = 1000;
    room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Zed' };
    for (let hand = 0; hand < 4; hand++) {
      while (['passing', 'playing'].includes(room.phase)) {
        const action = g.pendingAction(room);
        if (action.type === 'play' && action.seat === 0) g.playCard(room, 0, g.legalCards(room, 0)[0]);
        else g.runPending(room, rng);
      }
      if (hand < 3) {
        room.seats[0] = { kind: 'human', id: 1, name: 'Ann' };
        g.nextHand(room, 1, rng);
        room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Zed' };
      }
    }
    naive += room.scores[0];
    bot += (room.scores[1] + room.scores[2] + room.scores[3]) / 3;
  }
  assert.ok(bot < naive, `computers ${bot} against naive ${naive}`);
});
