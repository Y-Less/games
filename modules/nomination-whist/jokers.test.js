// The Jokers option: the two Jokers are shuffled in; a Joker may be led, or played when you cannot follow suit; it wins the
// trick (even over trumps) unless the other Joker is in the same trick, when both lose, except that a second Joker beats a
// Joker that led.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deckFor, isJoker, JOKERS, sortHand } from '../../shared/cards.js';
import * as g from './game.js';
import { ledSuit, legalCards, winningCard } from './trick.js';
import { AIS } from './ai/index.js';

const seeded = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};
const [BLACK, RED] = JOKERS;

test('the Jokers are cards of no suit that rank above everything and sort to the end of a hand', () => {
  assert.deepEqual(JOKERS, ['JK1', 'JK2']);
  assert.ok(JOKERS.every(isJoker) && !isJoker('JH') && !isJoker('AS'));
  assert.equal(deckFor(false).length, 52);
  assert.equal(deckFor(true).length, 54);
  assert.equal(new Set(deckFor(true)).size, 54);
  assert.deepEqual(sortHand(['JK2', 'AH', '2C', 'JK1', '5S']), ['2C', '5S', 'AH', 'JK1', 'JK2']);
});

test('a Joker may be led or played when you cannot follow suit, never while you can', () => {
  const hand = ['5H', 'KS', BLACK];
  assert.deepEqual(legalCards(hand, []), hand, 'leading: anything, the Joker included');
  assert.deepEqual(legalCards(hand, ['2H']), ['5H'], 'holding a heart you must play it, not the Joker');
  assert.deepEqual(legalCards(hand, ['2C']), hand, 'void in clubs: anything, the Joker included');
  assert.deepEqual(legalCards(['5H', RED], ['JK1']), ['5H', RED], 'a Joker led leaves no suit to follow');
  assert.equal(ledSuit(['JK1', '2H']), null);
  assert.equal(ledSuit(['2H', 'JK1']), 'H');
});

test('a lone Joker wins the trick, over trumps and aces', () => {
  assert.equal(winningCard(['AH', '2C', BLACK, 'KH'], 'C'), BLACK, 'over trumps and aces');
  assert.equal(winningCard(['AH', BLACK], null), BLACK);
  assert.equal(winningCard([BLACK, 'AH', 'KS'], 'H'), BLACK, 'a Joker that led wins if nobody beats it');
  assert.equal(winningCard(['2H', RED], 'C'), RED);
});

test('two Jokers in one trick both lose, and the rest of the trick decides as usual', () => {
  assert.equal(winningCard(['5H', BLACK, 'KH', RED], null), 'KH', 'highest of the suit led');
  assert.equal(winningCard(['5H', RED, '2C', BLACK], 'C'), '2C', 'a trump among the rest still beats the suit led');
  assert.equal(winningCard(['AS', RED, BLACK], 'H'), 'AS', 'with three players the card that led wins');
  assert.equal(winningCard(['9D', 'QH', 'JD', BLACK, RED], 'S'), 'JD', 'the highest diamond: a heart is not the suit led');
});

test('if a Joker led, the second Joker played on top wins instead', () => {
  assert.equal(winningCard([BLACK, 'AH', RED], 'H'), RED);
  assert.equal(winningCard([RED, 'AH', 'KS', BLACK], null), BLACK);
  assert.equal(winningCard([BLACK, RED], null), RED);
});

test('a trick in progress is judged by what is on the table so far', () => {
  assert.equal(winningCard(['5H'], null), '5H');
  assert.equal(winningCard(['5H', BLACK], null), BLACK, 'provisionally the Joker');
  assert.equal(winningCard(['5H', BLACK, RED], null), '5H', 'and then the other Joker cancels it');
});

test('trickWinner gives the seat of the winning card', () => {
  const trick = [{ seat: 2, card: '5H' }, { seat: 3, card: RED }, { seat: 0, card: 'AH' }, { seat: 1, card: BLACK }];
  assert.equal(g.trickWinner(trick, null), 0, 'the Jokers cancel and the ace of the suit led wins');
  assert.equal(g.trickWinner([{ seat: 1, card: BLACK }, { seat: 2, card: 'AH' }, { seat: 0, card: RED }], 'H'), 0, 'the second Joker beats the one that led');
  assert.equal(g.trickWinner([{ seat: 1, card: 'KC' }, { seat: 2, card: 'AH' }, { seat: 0, card: RED }], 'H'), 0, 'a lone Joker beats a trump');
});

test('the option is a setting, off by default, and only a boolean is accepted', () => {
  assert.equal(g.DEFAULT_SETTINGS.jokers, false);
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  assert.equal(room.settings.jokers, false);
  assert.ok(g.setSettings(room, 1, { jokers: true }).ok);
  assert.equal(room.settings.jokers, true);
  assert.equal(g.viewFor(room, 1).settings.jokers, true);
  const refused = g.setSettings(room, 1, { jokers: 'yes' });
  assert.equal(refused.ok, false);
  assert.equal(room.settings.jokers, true, 'a bad value changes nothing');
});

/** A started game with Ann (user 1) as the only person and computer players elsewhere. */
function started(seats, jokers, seed) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats, jokers } });
  assert.ok(g.fillWithBots(room, 1).ok);
  assert.ok(g.start(room, 1, seeded(seed)).ok);
  return room;
}

test('with the option on the Jokers are dealt (and only then); every card dealt is distinct', () => {
  let withJokers = 0;
  let dealtWithout = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const seats = 3 + (seed % 5);
    const on = started(seats, true, seed);
    const all = on.hands.flat();
    assert.equal(new Set(all).size, all.length);
    assert.ok(all.every((card) => deckFor(true).includes(card)));
    withJokers += all.filter(isJoker).length;
    dealtWithout += started(seats, false, seed).hands.flat().filter(isJoker).length;
  }
  assert.ok(withJokers > 20, `the Jokers turn up (${withJokers})`);
  assert.equal(dealtWithout, 0);
});

test('the server refuses a Joker while you can follow suit, with a reason, and offers it when you cannot', () => {
  const room = started(4, true, 1);
  // Build the situation by hand: seat `a` leads a heart, seat `b` holds a heart and a Joker.
  const a = room.turn;
  const b = (a + 1) % 4;
  room.phase = 'playing';
  room.hands[a] = ['9H', '2C'];
  room.hands[b] = ['5H', BLACK];
  room.turn = a;
  assert.ok(g.playCard(room, a, '9H').ok);
  assert.match(g.illegalReason(room, b, BLACK), /only play a Joker when you cannot follow suit \(hearts\)/);
  assert.equal(g.playCard(room, b, BLACK).ok, false);
  assert.deepEqual(g.legalCards(room, b), ['5H']);
  // Had seat b no heart, the Joker would be fine.
  room.hands[b] = ['5C', BLACK];
  assert.equal(g.illegalReason(room, b, BLACK), null);
  assert.ok(g.playCard(room, b, BLACK).ok);
});

test('whole games with Jokers, for every live AI and every number of seats, play legally to the end', () => {
  const rng = seeded(77);
  for (const [index, ai] of AIS.entries()) {
    const seats = 3 + (index % 5);
    const room = started(seats, true, 100 + index);
    room.seats.forEach((seat) => {
      if (seat.kind === 'bot') seat.ai = ai.id;
    });
    for (let guard = 0; guard < 100000 && room.phase !== 'finished'; guard++) {
      if (room.phase === 'roundEnd') g.forceNextRound(room, rng);
      else if (g.runPending(room, rng) === null) {
        // Ann is a person: play her seat with the computer's judgement too
        const seat = room.turn;
        const done = room.phase === 'nominating' ? g.nominate(room, seat, g.botNominate(room, seat, rng)) : g.playCard(room, seat, g.botPlay(room, seat, rng));
        assert.ok(done.ok, `${ai.id}: ${done.error}`);
      }
      if (room.phase === 'roundEnd' || room.phase === 'finished') {
        const last = room.history.at(-1);
        assert.equal(last.taken.reduce((a, b) => a + b, 0), last.cards, `every trick is won (${ai.id})`);
      }
    }
    assert.equal(room.phase, 'finished', `${ai.id} finished the game`);
  }
});

test('with Jokers the suggested nomination is not offered, and without them it still is', () => {
  const rng = seeded(3);
  for (const jokers of [true, false]) {
    const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 4, jokers } });
    g.fillWithBots(room, 1);
    g.start(room, 1, rng);
    while (room.phase === 'nominating' && room.turn !== 0) g.runPending(room, rng);
    assert.equal(g.viewFor(room, 1).suggestion === null, jokers);
  }
});
