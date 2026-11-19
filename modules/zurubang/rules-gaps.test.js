// The rulings.  The Zurubang rulebook describes itself as "unpolished, a little bit buggy", and it is: there are
// about twenty questions it does not answer, and a few it answers wrongly.  README.md says what this game does about
// each of them and why; this file is one test per ruling, named after it, so that none of them can be changed by
// accident and all of them can be found by somebody arguing about one.
//
// The rulings tested in duel.test.js instead, because they are about one fight: the order of the checks, two
// Zurubangs, "power 4 or less", the Dragon against shooting, shooting against flying, the counts the Elementals, the
// Dark Warlord and Melody make, the Carrot Knight's even power, the indestructible card's point, the Ki-Rin's draw,
// the Basilisk, the empty graveyard, and where five of a kind would decide both ways.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { POSITIONS, fightAt, pickUp } from './duel.js';
import { seeded } from '../../shared/random.js';

const rng = () => seeded(11);
const other = (seat) => (seat === 0 ? 1 : 0);

function table({ target = 30, turn = 0 } = {}) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { target }, now: 0 });
  game.addHuman(room, 2, 'Bob');
  game.start(room, 1, seeded(3));
  room.turn = turn;
  room.marker = turn;
  return room;
}

/** Lays a duel out with chosen hands and takes it as far as the start of the revealing. */
function laidOut(room, mine, theirs, { challenger = 0, starter = challenger } = {}) {
  room.hands = [[...mine], [...theirs]];
  room.turn = challenger;
  assert.equal(game.challenge(room, challenger).ok, true);
  assert.equal(game.answer(room, other(challenger), true).ok, true);
  assert.equal(game.chooseStarter(room, other(challenger), starter).ok, true);
  for (let placed = 0; placed < 10; placed++) {
    const next = game.placer(room);
    assert.equal(game.place(room, next.seat, room.hands[next.seat][0]).ok, true);
  }
}

test('ruling: the last card of a duel is the second player\'s, and it is forced', () => {
  const room = table();
  room.hands = [
    ['white-06', 'white-07', 'white-08', 'green-17', 'green-19'],
    ['red-03', 'red-05', 'red-09', 'red-12', 'red-17'],
  ];
  game.challenge(room, 0);
  game.answer(room, 1, true);
  game.chooseStarter(room, 1, 0);
  const order = [];
  while (game.placer(room)) {
    const next = game.placer(room);
    order.push(next.seat);
    game.place(room, next.seat, room.hands[next.seat][0]);
  }
  assert.equal(order.at(-1), 1, 'the player who did not start puts the last card down');
  assert.deepEqual(order.filter((seat) => seat === 0).length, 5);
});

test('ruling: after a declined challenge the next turn is the decliner\'s', () => {
  const room = table({ turn: 1 });
  game.challenge(room, 1);
  game.answer(room, 0, false);
  assert.equal(room.turn, 0);
  assert.equal(room.seats[1].score, 5);
});

test('ruling: the Duel card belongs to the challenged player from the moment they accept', () => {
  const room = table({ turn: 0 });
  assert.equal(room.marker, 0);
  game.challenge(room, 0);
  game.answer(room, 1, true);
  assert.equal(room.marker, 1, 'and whoever holds it acts and draws first');
});

test('ruling: on your own turn you choose the stack, and a stack you cannot draw from is not used', () => {
  const room = table({ turn: 0 });
  room.stacks = [['white-22'], ['green-02'], []];
  const wanted = room.stacks[1].at(-1);
  assert.equal(game.swapOne(room, 0, room.hands[0][0], 1, rng()).ok, true);
  assert.ok(room.hands[0].includes(wanted), 'the card came off the stack that was asked for');

  const empty = table({ turn: 0 });
  empty.stacks = [['white-22'], ['green-02'], []];
  assert.equal(game.swapOne(empty, 0, empty.hands[0][0], 2, rng()).ok, true);
  assert.ok(empty.hands[0].includes('white-22'), 'an empty stack falls back to the fullest one');
});

test('ruling: a card drawn in the middle of a duel comes off the fullest stack, with nobody asked', () => {
  const battle = {
    placed: [Array(POSITIONS).fill('blue-02'), Array(POSITIONS).fill('white-21')],
    stacks: [['a1'], ['b1', 'b2', 'b3'], ['c1', 'c2']],
    graveyard: [],
    fiveBack: [null, null],
    at: 0,
    fights: [],
    points: [0, 0],
    marker: 0,
  };
  fightAt(battle, () => 0); // the Jellyfish Pixie destroys, so a replacement is drawn
  assert.equal(battle.placed[1][0], 'b3', 'the top of the fullest stack');
});

test('ruling: when every stack has run dry a turn draws from the shuffled graveyard instead of failing', () => {
  const room = table({ turn: 0 });
  room.stacks = [[], [], []];
  room.graveyard = ['white-22', 'green-02', 'red-03'];
  const thrown = room.hands[0][0];
  assert.equal(game.swapOne(room, 0, thrown, 0, rng()).ok, true);
  assert.equal(room.hands[0].length, 5);
  assert.deepEqual(room.graveyard, [thrown], 'the old graveyard became the stacks, and only the discard is left');
});

test('ruling: five drawn sudden deaths in a row settle nothing, and nobody banks', () => {
  const room = table();
  const same = ['white-06', 'white-07', 'white-08', 'green-17', 'green-19'];
  laidOut(room, same, same);
  while (room.phase === 'revealing') game.revealNext(room, rng());
  assert.equal(room.phase, 'sudden', 'ten identical cards make five drawn fights');
  for (let round = 0; round < POSITIONS; round++) {
    assert.equal(game.suddenPick(room, 0, round, rng()).ok, true);
    assert.equal(game.suddenPick(room, 1, round, rng()).ok, true);
  }
  assert.equal(room.phase, 'duelOver');
  assert.equal(room.duel.result.winner, null);
  assert.deepEqual(
    room.seats.map((seat) => seat.score),
    [0, 0],
  );
});

test('ruling: a card already out of the sudden death cannot be chosen again', () => {
  const room = table();
  const same = ['white-06', 'white-07', 'white-08', 'green-17', 'green-19'];
  laidOut(room, same, same);
  while (room.phase === 'revealing') game.revealNext(room, rng());
  game.suddenPick(room, 0, 2, rng());
  game.suddenPick(room, 1, 2, rng());
  assert.equal(room.duel.sudden.round, 2);
  assert.equal(game.suddenPick(room, 0, 2, rng()).error, 'cardIsOut');
});

test('ruling: what five of a kind and a rainbow are worth is settled when the duel starts, and nothing later changes it', () => {
  const room = table();
  // Five white backs, one of which the Mercy Twister opposite will throw away before a card is even fought.
  laidOut(room, ['white-03', 'white-06', 'white-07', 'white-08', 'white-09'], ['white-04', 'red-03', 'red-05', 'red-09', 'red-12'], { challenger: 1, starter: 1 });
  assert.equal(room.duel.special[0], 'fiveOfAKind');
  while (room.phase === 'revealing') game.revealNext(room, rng());
  assert.equal(room.duel.special[0], 'fiveOfAKind', 'the hand was five of a kind when the duel began, and that is that');
});

test('ruling: the swap moves whatever is standing in the two places, even when the swapping card was destroyed', () => {
  const battle = {
    // The Voodoo Priestess swaps; the Jellyfish Pixie opposite destroys her.
    placed: [['black-06', null, null, null, null], ['blue-02', null, null, null, null]],
    stacks: [['white-22'], [], []],
    graveyard: [],
    fiveBack: [null, null],
    at: 0,
    fights: [],
    points: [0, 0],
    marker: 0,
  };
  const fight = fightAt(battle, () => 0);
  assert.equal(fight.swap, true);
  assert.equal(battle.placed[0][0], 'white-22', 'something took the destroyed Priestess\'s place');
  assert.deepEqual(pickUp(battle), [['blue-02'], ['white-22']], 'and the two places changed owners all the same');
});

test('ruling: the Beast Kid adds what he draws to his own four, and a Zurubang drawn adds nothing', () => {
  const build = (top) => ({
    placed: [['green-09', null, null, null, null], ['white-21', null, null, null, null]],
    stacks: [[top], [], []],
    graveyard: [],
    fiveBack: [null, null],
    at: 0,
    fights: [],
    points: [0, 0],
    marker: 0,
  });
  assert.equal(fightAt(build('white-11'), () => 0).powers[0], 9, 'his four and the Hill Dwarf\'s five');
  assert.equal(fightAt(build('white-02'), () => 0).powers[0], 4, 'and a Zurubang has no number to add');
});

test('ruling: the graveyard is face down, so a view gives its size and never its cards', () => {
  const room = table({ turn: 0 });
  game.swapOne(room, 0, room.hands[0][0], 0, rng());
  const view = game.viewFor(room, 2);
  assert.equal(view.graveyard, 1);
  assert.equal(JSON.stringify(view).includes(room.graveyard[0]), false, 'and the card itself is nowhere in it');
});

test('ruling: a card that replaced a destroyed one is face down again, even where the duel has already been', () => {
  const room = table();
  // Bob leads with the Jellyfish Pixie, which destroys whatever Ann puts opposite it.
  laidOut(room, ['white-21', 'white-06', 'white-07', 'white-08', 'green-17'], ['blue-02', 'red-03', 'red-05', 'red-09', 'red-12'], { challenger: 0, starter: 0 });
  game.revealNext(room, rng());
  const bob = game.viewFor(room, 2);
  assert.equal(bob.duel.placed[0][0].id, undefined, 'Ann\'s first card was destroyed, and what stands there now is a back');
  assert.ok(bob.duel.fights[0].cards.includes('white-21'), 'though the card that fought is on the record for ever');
});
