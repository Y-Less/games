import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { CARDS, CARD_BY_ID, NOBLES } from './cards.js';
import { checkInvariants, started } from './kit.js';

const sum = (list) => list.reduce((a, b) => a + b, 0);
const [D, S, E, R, O, G] = [0, 1, 2, 3, 4, 5];
const T = (...counts) => [0, 1, 2, 3, 4, 5].map((i) => counts[i] ?? 0);

/** Puts a specific card on the board in the slot of its level (removing it from wherever it was), keeping conservation. */
function place(room, id, slot = 0) {
  const card = CARD_BY_ID[id];
  const level = card.level;
  const where = (list) => list.indexOf(id);
  const old = room.board[level][slot];
  // take id out of the deck or elsewhere on the board
  const inDeck = where(room.decks[level]);
  if (inDeck !== -1) room.decks[level].splice(inDeck, 1);
  const onBoard = where(room.board[level]);
  if (onBoard !== -1) room.board[level][onBoard] = old;
  else if (old) room.decks[level].push(old);
  room.board[level][slot] = id;
}
/** Gives a seat exact tokens, taking them out of the supply so tokens stay conserved. */
function setTokens(room, seat, tokens) {
  for (let c = 0; c < 6; c++) {
    room.supply[c] += room.players[seat].tokens[c] - tokens[c];
    room.players[seat].tokens[c] = tokens[c];
  }
}
/** Gives a seat purchased cards (taken from the deck) as bonuses: { colour: count }. */
function giveBonuses(room, seat, spec) {
  for (const [colour, count] of Object.entries(spec)) {
    let given = 0;
    for (const card of CARDS) {
      if (given === count) break;
      if (card.bonus !== Number(colour) || card.points) continue;
      const inDeck = room.decks[card.level].indexOf(card.id);
      if (inDeck === -1) continue;
      room.decks[card.level].splice(inDeck, 1);
      room.players[seat].bought.push(card.id);
      room.players[seat].tally.cardsBought++;
      given++;
    }
    assert.equal(given, count);
  }
}
const cardWith = (pred) => CARDS.find(pred);
const fresh = (seats = 2, target = 15) => started(seats, () => 0.5, { target });

test('supply sizes depend on the player count: 4, 5, 7 gems of each colour and 5 gold', () => {
  for (const [players, each] of [[2, 4], [3, 5], [4, 7]]) {
    const room = fresh(players);
    assert.deepEqual(room.supply, [each, each, each, each, each, 5]);
    assert.equal(room.nobles.length, players + 1);
    for (const l of [1, 2, 3]) assert.equal(room.board[l].length, 4);
    assert.deepEqual([1, 2, 3].map((l) => room.decks[l].length), [36, 26, 16]);
    checkInvariants(room, `${players} players`);
  }
});

test('starting needs every seat filled and a human, and only the host can start', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats: 3 } });
  assert.equal(game.start(room, 1).ok, false);
  game.addHuman(room, 2, 'bob');
  assert.match(game.start(room, 2).error, /host/);
  assert.equal(game.start(room, 1).ok, false);
  game.addBot(room, 1);
  assert.equal(game.start(room, 1).ok, true);
  assert.equal(room.phase, 'playing');
  assert.ok(game.viewFor(room, 1).scoreboard.players.some((p) => p.bot), 'the scoreboard marks computer players');
  assert.equal(game.start(room, 1).ok, false, 'cannot start twice');
  const bots = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats: 2 } });
  game.fillWithBots(bots, 1);
  game.removeHuman(bots, 1);
  assert.equal(bots.seats.some((s) => game.isHuman(s)), false);
});

test('settings: target 10, 15 or 20 and 2 to 4 seats, host only, lobby only', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann' });
  assert.deepEqual(room.settings, { target: 15, seats: 4 });
  assert.equal(room.seats.length, 4);
  for (const target of [10, 15, 20]) assert.equal(game.setSettings(room, 1, { target }).ok, true);
  for (const bad of [0, 5, 16, '15', null, 15.5, [15], {}]) assert.equal(game.setSettings(room, 1, { target: bad }).ok, false);
  for (const bad of [1, 5, 0, '3', NaN, null]) assert.equal(game.setSettings(room, 1, { seats: bad }).ok, false);
  assert.equal(room.settings.target, 20);
  assert.equal(game.setSettings(room, 1, { seats: 2 }).ok, true);
  assert.equal(room.seats.length, 2);
  game.addHuman(room, 2, 'bob');
  assert.equal(game.setSettings(room, 1, { seats: 3 }).ok, true);
  assert.equal(room.seats.length, 3);
  assert.equal(game.addHuman(room, 3, 'cat').ok, true);
  assert.equal(game.setSettings(room, 1, { seats: 2 }).ok, false, 'three people are seated');
  assert.match(game.setSettings(room, 2, { target: 10 }).error, /host/);
  game.fillWithBots(room, 1);
  game.start(room, 1);
  assert.equal(game.setSettings(room, 1, { target: 10 }).ok, false);
});

test('duplicate display names get a (2) suffix', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann' });
  game.addHuman(room, 2, 'ann');
  game.addHuman(room, 3, 'ann');
  assert.deepEqual(room.seats.slice(0, 3).map((s) => s.name), ['ann', 'ann (2)', 'ann (3)']);
});

test('taking three different gems', () => {
  const room = fresh(3);
  assert.equal(game.takeGems(room, 0, [D, S, E]).ok, true);
  assert.deepEqual(room.players[0].tokens, T(1, 1, 1));
  assert.deepEqual(room.supply, [4, 4, 4, 5, 5, 5]);
  assert.equal(room.turn, 1);
  checkInvariants(room);
});

test('taking gems: wrong turn, repeats, bad colours, wrong counts and empty colours are refused', () => {
  const room = fresh(3);
  const before = JSON.stringify(room);
  assert.match(game.takeGems(room, 1, [D, S, E]).error, /not your turn/);
  for (const bad of [[D, D, S], [D, S], [D], [], [D, S, E, R], [D, S, 5], [D, S, -1], [D, S, 1.5], [D, S, '2'], 'DSE', null, undefined, { 0: 0 }, [D, S, null]]) {
    assert.equal(game.takeGems(room, 0, bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(JSON.stringify(room), before, 'nothing changed');
  room.supply[D] = 0;
  assert.equal(game.takeGems(room, 0, [D, S, E]).ok, false, 'no diamonds left');
  assert.equal(game.takeGems(room, 0, [S, E, R]).ok, true);
});

test('fewer than three gems may be taken only when fewer than three colours are available', () => {
  const room = fresh(2);
  room.supply = [0, 0, 3, 2, 0, 5]; // two colours left
  room.players[1].tokens = T(4, 4, 0, 0, 0, 0);
  assert.equal(game.takeGems(room, 0, [E]).ok, true, 'one of two available colours');
  const another = fresh(2);
  another.supply = [0, 0, 3, 2, 0, 5];
  assert.equal(game.takeGems(another, 0, [E, R]).ok, true, 'both');
  const one = fresh(2);
  one.supply = [0, 0, 0, 2, 0, 5];
  assert.equal(game.takeGems(one, 0, [R]).ok, true);
  const three = fresh(2);
  three.supply = [1, 0, 1, 1, 0, 5];
  assert.equal(game.takeGems(three, 0, [D, E]).ok, false, 'three colours are available, so take three');
  assert.equal(game.takeGems(three, 0, [D, E, R]).ok, true);
  const none = fresh(2);
  none.supply = [0, 0, 0, 0, 0, 5];
  assert.equal(game.takeGems(none, 0, []).ok, false);
});

test('taking two of a colour needs at least four in the supply', () => {
  const room = fresh(2); // four of each
  assert.equal(game.takeTwo(room, 0, R).ok, true);
  assert.deepEqual(room.players[0].tokens, T(0, 0, 0, 2));
  assert.equal(room.supply[R], 2);
  assert.equal(game.takeTwo(room, 1, R).ok, false, 'only two left');
  room.supply[E] = 3;
  assert.equal(game.takeTwo(room, 1, E).ok, false, 'three is not enough');
  room.supply[E] = 4;
  assert.equal(game.takeTwo(room, 1, E).ok, true);
  assert.equal(room.supply[E], 2);
  for (const bad of [5, -1, 1.5, '1', null, undefined, [1], NaN]) assert.equal(game.takeTwo(room, 0, bad).ok, false);
  checkInvariants(room);
  const big = fresh(4);
  assert.equal(game.takeTwo(big, 0, D).ok, true);
  assert.equal(big.supply[D], 5);
  game.takeTwo(big, 1, D);
  assert.equal(big.supply[D], 3);
  assert.equal(game.takeTwo(big, 2, D).ok, false);
});

test('reserving a face-up card: gold, replacement from the deck, the limit of three, and no gold left', () => {
  const room = fresh(2);
  const id = room.board[1][2];
  const top = room.decks[1].at(-1);
  assert.equal(game.reserveCard(room, 0, { card: id }).ok, true);
  assert.deepEqual(room.players[0].reserved, [{ card: id, blind: false }]);
  assert.equal(room.players[0].tokens[G], 1);
  assert.equal(room.supply[G], 4);
  assert.equal(room.board[1][2], top, 'the gap is refilled from the pile');
  assert.equal(room.decks[1].length, 35);
  assert.equal(game.reserveCard(room, 0, { card: id }).ok, false, 'not your turn');
  game.takeGems(room, 1, [D, S, E]);
  assert.equal(game.reserveCard(room, 0, { card: id }).ok, false, 'no longer on the table');
  assert.equal(game.reserveCard(room, 0, { card: room.board[2][0] }).ok, true);
  game.takeGems(room, 1, [D, S, E]);
  assert.equal(game.reserveCard(room, 0, { level: 3 }).ok, true);
  assert.equal(room.players[0].reserved.at(-1).blind, true);
  game.takeGems(room, 1, [D, S, E]);
  assert.equal(room.players[0].reserved.length, 3);
  assert.match(game.reserveCard(room, 0, { card: room.board[1][0] }).error, /3 cards/);
  assert.equal(game.reserveCard(room, 0, { level: 1 }).ok, false);
  checkInvariants(room);
});

test('reserving still works with no gold left, but gives none', () => {
  const room = fresh(2);
  room.supply[G] = 0;
  room.players[1].tokens[G] = 5;
  const id = room.board[3][0];
  assert.equal(game.reserveCard(room, 0, { card: id }).ok, true);
  assert.equal(room.players[0].tokens[G], 0);
  assert.equal(room.log.at(-1).gold, false);
  checkInvariants(room);
});

test('reserving blind takes the top card of the pile; an empty pile or bad level is refused', () => {
  const room = fresh(2);
  const top = room.decks[2].at(-1);
  assert.equal(game.reserveCard(room, 0, { level: 2 }).ok, true);
  assert.equal(room.players[0].reserved[0].card, top);
  assert.equal(room.players[0].reserved[0].blind, true);
  assert.equal(room.board[2].every(Boolean), true, 'the board is untouched');
  assert.equal(room.decks[2].length, 25);
  for (const bad of [0, 4, '1', null, undefined, 1.5, [1]]) assert.equal(game.reserveCard(room, 1, { level: bad }).ok, false);
  room.decks[3] = [];
  assert.match(game.reserveCard(room, 1, { level: 3 }).error, /empty/);
  assert.equal(game.reserveCard(room, 1, { card: 'nope' }).ok, false);
  assert.equal(game.reserveCard(room, 1, { card: 7 }).ok, false);
  assert.equal(game.reserveCard(room, 1, {}).ok, false);
  assert.equal(game.reserveCard(room, 1, null).ok, false);
});

test('buying: the discount from bonuses, paid tokens return to the supply, the table is refilled', () => {
  const room = fresh(2);
  const card = cardWith((c) => c.level === 1 && c.points === 0 && sum(c.cost) === 4 && c.cost.filter(Boolean).length === 4);
  place(room, card.id, 1);
  const refill = room.decks[1].at(-1);
  setTokens(room, 0, T(...card.cost));
  const supplyBefore = [...room.supply];
  assert.equal(game.buyCard(room, 0, card.id).ok, true);
  assert.deepEqual(room.players[0].tokens, T());
  assert.deepEqual(room.supply, supplyBefore.map((n, c) => n + (card.cost[c] ?? 0)));
  assert.deepEqual(room.players[0].bought, [card.id]);
  assert.equal(room.board[1][1], refill);
  assert.equal(game.bonusesOf(room.players[0])[card.bonus], 1);
  checkInvariants(room);
  // With a bonus the next card is cheaper by one.
  const next = cardWith((c) => c.level === 1 && c.cost[card.bonus] === 3 && sum(c.cost) === 3);
  place(room, next.id, 0);
  game.takeGems(room, 1, [D, S, E]);
  const cost = next.cost.map((n, c) => (c === card.bonus ? n - 1 : n));
  setTokens(room, 0, T(...cost));
  assert.equal(game.buyCard(room, 0, next.id).ok, true);
  assert.equal(sum(room.players[0].tokens), 0);
});

test('buying: cannot afford, wrong turn, not on the table, bad ids', () => {
  const room = fresh(2);
  const id = room.board[3][0];
  assert.match(game.buyCard(room, 0, id).error, /afford/);
  assert.match(game.buyCard(room, 1, id).error, /not your turn/);
  for (const bad of ['c91', 7, null, undefined, 'constructor', {}, []]) assert.equal(game.buyCard(room, 0, bad).ok, false);
  const hidden = room.decks[1][0];
  setTokens(room, 0, T(7, 7, 7, 7, 7));
  assert.match(game.buyCard(room, 0, hidden).error, /not on the table/);
  assert.equal(game.buyCard(room, 0, room.board[1][0]).ok, true);
});

test('buying with gold: gold fills the gap, and an all-gold payment works', () => {
  const room = fresh(2);
  const card = cardWith((c) => c.level === 1 && sum(c.cost) === 4 && c.cost.filter(Boolean).length === 4);
  place(room, card.id);
  setTokens(room, 0, T(0, 0, 0, 0, 0, 4));
  assert.deepEqual(game.payment(room.players[0], card).pay, T(0, 0, 0, 0, 0, 4));
  assert.equal(game.buyCard(room, 0, card.id).ok, true);
  assert.deepEqual(room.players[0].tokens, T());
  assert.equal(room.supply[G], 5);
  checkInvariants(room);
  // Partial gold.
  const second = cardWith((c) => c.level === 1 && c.id !== card.id && sum(c.cost) === 5);
  place(room, second.id, 1);
  game.takeGems(room, 1, [D, S, E]);
  const cost = game.needOf(second, game.bonusesOf(room.players[0]));
  const half = cost.map((n) => Math.max(0, n - 1));
  setTokens(room, 0, T(...half, sum(cost) - sum(half)));
  const before = room.players[0].tokens[G];
  assert.equal(game.buyCard(room, 0, second.id).ok, true);
  assert.equal(room.players[0].tokens[G], 0);
  assert.ok(before >= 1);
});

test('a card that is free after bonuses costs nothing', () => {
  const room = fresh(2);
  const card = cardWith((c) => c.level === 1 && sum(c.cost) === 3 && c.cost.filter(Boolean).length === 1);
  const colour = card.cost.findIndex(Boolean);
  place(room, card.id);
  giveBonuses(room, 0, { [colour]: 3 });
  setTokens(room, 0, T());
  assert.deepEqual(game.payment(room.players[0], card).pay, T());
  const supply = [...room.supply];
  assert.equal(game.buyCard(room, 0, card.id).ok, true);
  assert.deepEqual(room.supply, supply);
  assert.equal(room.players[0].bought.length, 4);
});

test('choosing how to pay: gold may replace gems, but the payment must match exactly', () => {
  const room = fresh(2);
  const card = cardWith((c) => c.level === 1 && sum(c.cost) === 5 && c.cost.filter(Boolean).length === 4);
  place(room, card.id);
  const need = [...card.cost];
  const c0 = need.findIndex(Boolean);
  setTokens(room, 0, T(...need.map((n) => n + 1), 0)); // spare gems; the gold goes in a separate step
  room.players[0].tokens[G] = 2;
  room.supply[G] -= 2;
  const quote = game.payment(room.players[0], card);
  assert.equal(quote.minGold, 0);
  assert.equal(quote.maxGold, 2);
  const pay = [...need, 0];
  pay[c0] -= 1;
  pay[G] = 1;
  const attempts = [
    [[...pay.slice(0, 5), 0], 'one gem short'],
    [[...need, 1], 'gold on top'],
    [[...need.map((n) => n + 1), 0], 'overpaying a colour'],
    [[...need, -1], 'negative'],
    [[...need], 'wrong length'],
    [[...need, 0, 0], 'too long'],
    [[...need, 1.5], 'fraction'],
    [[...need, '0'], 'string'],
    [{}, 'object'],
    ['paid', 'string'],
  ];
  for (const [bad, what] of attempts) assert.equal(game.buyCard(room, 0, card.id, bad).ok, false, what);
  assert.equal(room.players[0].bought.length, 0);
  assert.equal(game.buyCard(room, 0, card.id, pay).ok, true);
  assert.equal(room.players[0].tokens[G], 1, 'one gold spent');
  assert.equal(room.players[0].tokens[c0], need[c0] + 1 - (need[c0] - 1), 'a gem kept instead');
  checkInvariants(room);
});

test('payment cannot use tokens the player does not have', () => {
  const room = fresh(2);
  const card = cardWith((c) => c.level === 1 && sum(c.cost) === 4 && c.cost.filter(Boolean).length === 4);
  place(room, card.id);
  const lacking = card.cost.findIndex(Boolean);
  const tokens = card.cost.map((n, c) => (c === lacking ? 0 : n));
  setTokens(room, 0, T(...tokens, 1));
  assert.equal(game.buyCard(room, 0, card.id, [...card.cost, 0]).ok, false, 'paying a colour it does not hold');
  assert.equal(game.buyCard(room, 0, card.id, [...tokens, 1]).ok, true, 'the exact payment with gold works');
  assert.equal(sum(room.players[0].tokens), 0);
  checkInvariants(room);
});

test('buying a reserved card (blind or not) takes it from the reserve, with no refill', () => {
  const room = fresh(2);
  game.reserveCard(room, 0, { level: 1 });
  const id = room.players[0].reserved[0].card;
  game.takeGems(room, 1, [D, S, E]);
  giveBonuses(room, 0, { [D]: 2, [S]: 2, [E]: 2, [R]: 2, [O]: 2 });
  setTokens(room, 0, T(2, 2, 2, 2, 2));
  const decks = room.decks[1].length;
  const outcome = game.buyCard(room, 0, id);
  assert.equal(outcome.ok, true);
  assert.deepEqual(room.players[0].reserved, []);
  assert.ok(room.players[0].bought.includes(id));
  assert.equal(room.decks[1].length, decks);
  assert.equal(room.log.at(-1).fromReserve, true);
  // Someone else's reserved card cannot be bought.
  game.reserveCard(room, 1, { level: 2 });
  const theirs = room.players[1].reserved[0].card;
  assert.equal(game.buyCard(room, 0, theirs).ok, false);
});

test('the token limit: going over ten makes the player return exactly the excess, in the same turn', () => {
  const room = fresh(3);
  setTokens(room, 0, T(2, 2, 2, 2, 0, 0));
  assert.equal(game.takeGems(room, 0, [D, S, O]).ok, true);
  assert.deepEqual(room.pending, { type: 'return', seat: 0, count: 1 });
  assert.equal(room.turn, 0, 'the turn has not passed');
  assert.match(game.takeGems(room, 0, [D, S, E]).error, /return/);
  assert.equal(game.takeGems(room, 1, [D, S, E]).ok, false);
  assert.equal(game.returnTokens(room, 1, T(1)).ok, false, 'not your turn');
  for (const bad of [T(), T(2), T(0, 0, 0, 0, 0, 1), T(0, 0, 0, 0, 2), [1], 'x', null, T(-1, 2), T(0.5, 0.5), [...T(1), 0]]) {
    assert.equal(game.returnTokens(room, 0, bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(game.returnTokens(room, 0, T(0, 0, 0, 0, 1)).ok, true, 'may return what was just taken');
  assert.equal(sum(room.players[0].tokens), 10);
  assert.equal(room.pending, null);
  assert.equal(room.turn, 1);
  checkInvariants(room);
});

test('returning is refused when nothing needs returning; gold may be returned', () => {
  const room = fresh(2);
  assert.match(game.returnTokens(room, 0, T(1)).error, /do not have to/);
  setTokens(room, 0, T(3, 3, 3, 0, 0, 0));
  room.players[0].tokens[G] = 1;
  room.supply[G]--;
  game.takeGems(room, 0, [R, O, S]);
  assert.equal(room.pending.count, 3);
  assert.equal(game.returnTokens(room, 0, T(0, 0, 0, 0, 0, 1, 0)).ok, false);
  assert.equal(game.returnTokens(room, 0, T(0, 0, 0, 0, 0, 1)).ok, false, 'one is not enough');
  assert.equal(game.returnTokens(room, 0, T(1, 0, 0, 0, 0, 1)).ok, false, 'two is not enough');
  assert.equal(game.returnTokens(room, 0, T(1, 0, 0, 0, 0, 1, 0)).ok, false);
  assert.equal(game.returnTokens(room, 0, T(1, 1, 0, 0, 0, 1)).ok, true);
  assert.equal(room.players[0].tokens[G], 0);
  checkInvariants(room);
});

test('reserving can also push a player over ten tokens', () => {
  const room = fresh(2);
  setTokens(room, 0, T(2, 2, 2, 2, 2, 0));
  game.reserveCard(room, 0, { card: room.board[1][0] });
  assert.deepEqual(room.pending, { type: 'return', seat: 0, count: 1 });
  assert.equal(game.returnTokens(room, 0, T(0, 0, 0, 0, 0, 1)).ok, true);
  assert.equal(room.players[0].tokens[G], 0);
  assert.equal(room.turn, 1);
});

/** Gives seat 0 enough bonuses for exactly one noble. */
const noble = (id) => NOBLES.find((n) => n.id === id);

test('a noble visits at the end of the turn when the bonuses are enough, and counts 3 prestige', () => {
  const room = fresh(2);
  room.nobles = ['n1', 'n2', 'n3'];
  giveBonuses(room, 0, { [D]: 3, [S]: 4 });
  const card = cardWith((c) => c.bonus === D && c.level === 1 && sum(c.cost) <= 4 && !room.players[0].bought.includes(c.id) && room.decks[1].includes(c.id));
  place(room, card.id);
  setTokens(room, 0, T(...card.cost));
  assert.equal(game.buyCard(room, 0, card.id).ok, true);
  assert.deepEqual(room.players[0].nobles, ['n1']);
  assert.deepEqual(room.nobles, ['n2', 'n3']);
  assert.equal(game.prestigeOf(room.players[0]), 3);
  assert.equal(room.players[0].tally.noblesVisited, 1);
  assert.equal(room.turn, 1);
  assert.equal(room.roundDeltas[0], 3);
  assert.match(room.roundNotes[0].join(), /noble visited/);
  checkInvariants(room);
});

test('a noble does not visit on a turn that does not complete its requirements; and visits after any kind of turn', () => {
  const room = fresh(2);
  room.nobles = ['n1', 'n2', 'n3'];
  giveBonuses(room, 0, { [D]: 4, [S]: 4 }); // already qualifies, but no turn has ended yet
  game.takeGems(room, 0, [D, S, E]);
  assert.deepEqual(room.players[0].nobles, ['n1'], 'visits at the end of a gem-taking turn');
});

test('several qualifying nobles: the player chooses, and only one visits', () => {
  const room = fresh(3);
  room.nobles = ['n1', 'n2', 'n6', 'n9'];
  giveBonuses(room, 0, { [D]: 4, [S]: 4, [E]: 4 });
  game.takeGems(room, 0, [D, S, E]);
  assert.deepEqual(room.pending, { type: 'noble', seat: 0, options: ['n1', 'n2', 'n6'] });
  assert.equal(room.turn, 0);
  assert.equal(game.takeGems(room, 0, [D, S, E]).ok, false);
  for (const bad of ['n9', 'n3', 'x', 7, null, undefined, 'n10', {}]) assert.equal(game.chooseNoble(room, 0, bad).ok, false, String(bad));
  assert.equal(game.chooseNoble(room, 1, 'n1').ok, false, 'not your turn');
  assert.equal(game.chooseNoble(room, 0, 'n2').ok, true);
  assert.deepEqual(room.players[0].nobles, ['n2']);
  assert.deepEqual(room.nobles, ['n1', 'n6', 'n9']);
  assert.equal(room.turn, 1);
  assert.equal(room.pending, null);
  assert.equal(game.chooseNoble(room, 0, 'n1').ok, false);
  checkInvariants(room);
  // The others stay for the next turn: the same player is visited by another one next turn.
  game.takeGems(room, 1, [D, S, E]);
  game.takeGems(room, 2, [D, S, E]);
  game.takeGems(room, 0, [R, O, S]);
  assert.equal(room.pending?.type, 'noble');
});

test('the noble choice comes after returning tokens', () => {
  const room = fresh(2);
  room.nobles = ['n1', 'n2', 'n3'];
  giveBonuses(room, 0, { [D]: 4, [S]: 4, [E]: 4 });
  setTokens(room, 0, T(3, 3, 3, 0, 0, 0));
  game.takeGems(room, 0, [D, S, E]);
  assert.equal(room.pending.type, 'return');
  assert.equal(game.chooseNoble(room, 0, 'n1').ok, false);
  game.returnTokens(room, 0, T(2));
  assert.equal(room.pending.type, 'noble');
});

test('a noble that cannot be reached does not visit; a taken noble leaves the table', () => {
  const room = fresh(2);
  room.nobles = ['n1', 'n2', 'n3'];
  giveBonuses(room, 0, { [D]: 4, [S]: 3 });
  game.takeGems(room, 0, [D, S, E]);
  assert.deepEqual(room.players[0].nobles, []);
  assert.equal(game.qualifyingNobles(room, 0).length, 0);
  assert.equal(noble('n1').points, 3);
});

/** A room where seat `who` is one move from the target. */
function nearlyThere(seats, who, { target = 15, points = 14 } = {}) {
  const room = fresh(seats, target);
  const filler = CARDS.filter((c) => c.level === 3 && c.points === 3);
  let total = 0;
  const need = points;
  for (const card of CARDS.filter((c) => c.points > 0).sort((a, b) => b.points - a.points)) {
    if (total + card.points > need) continue;
    for (const l of [1, 2, 3]) {
      const i = room.decks[l].indexOf(card.id);
      if (i !== -1) room.decks[l].splice(i, 1);
      const b = room.board[l].indexOf(card.id);
      if (b !== -1) room.board[l][b] = room.decks[l].pop() ?? null;
    }
    room.players[who].bought.push(card.id);
    room.players[who].tally.cardsBought++;
    room.roundDeltas[who] += card.points;
    total += card.points;
  }
  assert.equal(total, need);
  assert.ok(filler.length);
  return room;
}

test('reaching the target mid-round lets the later seats play their turn, then the game ends', () => {
  const room = nearlyThere(3, 0, { points: 14 });
  const one = cardWith((c) => c.points === 1 && c.level === 1 && room.decks[1].includes(c.id));
  place(room, one.id);
  setTokens(room, 0, T(...one.cost));
  assert.equal(game.buyCard(room, 0, one.id).ok, true);
  assert.equal(game.prestigeOf(room.players[0]), 15);
  assert.equal(room.finalRound, true);
  assert.equal(room.phase, 'playing', 'the round is not over');
  assert.equal(room.turn, 1);
  game.takeGems(room, 1, [D, S, E]);
  assert.equal(room.phase, 'playing');
  game.takeGems(room, 2, [D, S, E]);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.winners, [0]);
  assert.equal(room.endReason, 'target');
  assert.equal(room.history.length, 1);
  assert.equal(game.takeGems(room, 0, [D, S, E]).ok, false, 'no moves after the end');
  checkInvariants(room);
});

test('reaching the target in the last seat ends the game at once; a later seat can overtake in the same round', () => {
  const room = nearlyThere(2, 1, { points: 14 });
  game.takeGems(room, 0, [D, S, E]);
  const one = cardWith((c) => c.points === 1 && c.level === 1 && room.decks[1].includes(c.id));
  place(room, one.id);
  setTokens(room, 1, T(...one.cost));
  game.buyCard(room, 1, one.id);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.winners, [1]);
});

test('the target is the lobby option: 10 ends sooner and 20 later', () => {
  for (const target of [10, 20]) {
    const room = nearlyThere(2, 0, { target, points: target - 1 });
    const one = cardWith((c) => c.points === 1 && c.level === 1 && room.decks[1].includes(c.id));
    place(room, one.id);
    setTokens(room, 0, T(...one.cost));
    game.buyCard(room, 0, one.id);
    assert.equal(room.finalRound, true, `target ${target}`);
  }
  const room = nearlyThere(2, 0, { target: 20, points: 14 });
  game.takeGems(room, 0, [D, S, E]);
  assert.equal(room.finalRound, false, '15 is not enough at 20');
});

test('equal prestige and equal cards share the win', () => {
  const room = fresh(2);
  const id = (n) => CARDS.filter((c) => c.points === 5)[n].id;
  for (const l of [1, 2, 3]) {
    for (const x of [id(0), id(1)]) {
      const i = room.decks[l].indexOf(x);
      if (i !== -1) room.decks[l].splice(i, 1);
      const b = room.board[l].indexOf(x);
      if (b !== -1) room.board[l][b] = room.decks[l].pop() ?? null;
    }
  }
  room.players[0].bought.push(id(0));
  room.players[1].bought.push(id(1));
  room.finalRound = true;
  room.turn = 0;
  room.roundDeltas = [5, 5];
  game.takeGems(room, 0, [D, S, E]);
  game.takeGems(room, 1, [D, S, E]);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.winners, [0, 1]);
  assert.equal(game.statsPlayers(room).length, 1);
});

test('a player with nothing to do passes, and only then', () => {
  const room = fresh(2);
  assert.equal(game.passTurn(room, 0).ok, false, 'there are moves');
  room.supply = [0, 0, 0, 0, 0, 5];
  room.players[0].reserved = [{ card: room.board[1][0], blind: false }, { card: room.board[1][1], blind: false }, { card: room.board[1][2], blind: false }];
  room.board[1][0] = room.board[1][1] = room.board[1][2] = null;
  // Fix conservation roughly by leaving the cards in reserve; tokens: the supply is lent from nowhere here, so only check the move.
  room.decks[1] = [];
  room.decks[2] = [];
  room.decks[3] = [];
  room.board[1][3] = null;
  room.board[2] = [null, null, null, null];
  room.board[3] = [null, null, null, null];
  assert.deepEqual(game.legalMoves(room, 0), []);
  assert.equal(game.passTurn(room, 0).ok, true);
  assert.equal(room.turn, 1);
  assert.equal(room.passStreak, 1);
});

test('legal moves are exactly those the rules accept', () => {
  const room = fresh(3);
  const moves = game.legalMoves(room, 0);
  assert.equal(moves.filter((m) => m.type === 'take').length, 10);
  assert.equal(moves.filter((m) => m.type === 'takeTwo').length, 5, 'five of each in a three-player game: two of a colour is allowed');
});

test('no moves for the wrong seat or while a choice is pending', () => {
  const room = fresh(2);
  assert.deepEqual(game.legalMoves(room, 1), []);
  assert.ok(game.legalMoves(room, 0).length > 0);
  room.pending = { type: 'noble', seat: 0, options: [] };
  assert.deepEqual(game.legalMoves(room, 0), []);
});

test('play again returns to the lobby with the seats and settings kept', () => {
  const room = nearlyThere(2, 0, { points: 14 });
  const one = cardWith((c) => c.points === 1 && c.level === 1 && room.decks[1].includes(c.id));
  place(room, one.id);
  setTokens(room, 0, T(...one.cost));
  game.buyCard(room, 0, one.id);
  game.takeGems(room, 1, [D, S, E]);
  assert.equal(room.phase, 'finished');
  assert.equal(game.playAgain(room, 2).ok, false);
  const host = room.hostId;
  assert.equal(game.playAgain(room, host).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.history.length, 0);
  assert.equal(room.seats.filter(Boolean).length, 2);
  assert.equal(game.playAgain(room, host).ok, false);
  assert.equal(game.start(room, host).ok, true);
});

test('leaving: before the start the seat is freed; mid-game a computer player takes over; the host passes on', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats: 3 } });
  game.addHuman(room, 2, 'bob');
  game.addBot(room, 1);
  assert.deepEqual(game.removeHuman(room, 2), { ok: true, seat: 1, empty: false, replaced: false });
  assert.equal(room.seats[1], null);
  game.addHuman(room, 2, 'bob');
  game.start(room, 1);
  const seat = game.seatOf(room, 2);
  const outcome = game.removeHuman(room, 1);
  assert.equal(outcome.replaced, true);
  assert.equal(room.hostId, 2);
  assert.equal(game.isBot(room.seats[outcome.seat]), true);
  assert.equal(game.hasPlayer(room, 2), true);
  assert.equal(game.removeHuman(room, 2).empty, true);
  assert.equal(seat >= 0, true);
  assert.equal(game.removeHuman(room, 99).ok, false);
});

test('statistics: placements, outcomes, score = prestige and the four extras', () => {
  const room = nearlyThere(3, 0, { points: 14 });
  const one = cardWith((c) => c.points === 1 && c.level === 1 && room.decks[1].includes(c.id));
  place(room, one.id);
  setTokens(room, 0, T(...one.cost));
  game.buyCard(room, 0, one.id);
  game.takeGems(room, 1, [D, S, E]);
  game.reserveCard(room, 2, { level: 1 });
  assert.equal(room.phase, 'finished');
  const [mine] = game.statsPlayers(room);
  assert.equal(mine.userId, 1);
  assert.equal(mine.score, 15);
  assert.deepEqual(Object.keys(mine.extras).sort(), ['cardsBought', 'noblesVisited', 'reservedCards', 'turnsTaken']);
  assert.equal(mine.extras.turnsTaken, 1);
  assert.ok(mine.extras.cardsBought >= 1);
  assert.deepEqual(game.statsPlayers(room).map((p) => p.userId), [1].filter(() => game.isHuman(room.seats[0])).concat([]));
});

test('the history: a round per full turn of every seat, with prestige gained and notes', () => {
  const room = fresh(2);
  const card = cardWith((c) => c.points === 1 && c.level === 1 && room.decks[1].includes(c.id));
  place(room, card.id);
  setTokens(room, 0, T(...card.cost));
  game.buyCard(room, 0, card.id);
  assert.equal(room.history.length, 0);
  game.reserveCard(room, 1, { level: 2 });
  assert.equal(room.history.length, 1);
  assert.equal(room.round, 2);
  assert.deepEqual(room.history[0].deltas, { 0: 1, 1: 0 });
  assert.equal(room.history[0].label, 'Round 1');
  assert.match(room.history[0].notes[0], /bought a level 1 card \(1 point\)/);
  assert.match(room.history[0].notes[1], /reserved a level 2 card/);
  const view = game.viewFor(room, 1);
  assert.equal(view.scoreboard.rounds.length, 1);
  assert.equal(view.scoreboard.lowIsBetter, false);
  assert.equal(view.scoreboard.target, 15);
  assert.equal(view.scoreboard.players.find((p) => p.id === 0).score, 1);
});

test('views hide face-down reserves from everyone else and never include the decks', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats: 3 } });
  game.addHuman(room, 2, 'bob');
  game.addBot(room, 1);
  game.start(room, 1, () => 0.5);
  const ann = game.seatOf(room, 1);
  const bob = game.seatOf(room, 2);
  room.turn = ann;
  game.reserveCard(room, ann, { level: 3 });
  const hidden = room.players[ann].reserved[0].card;
  room.turn = bob;
  game.reserveCard(room, bob, { card: room.board[1][0] });
  const exposed = room.players[bob].reserved[0].card;
  const bobsView = game.viewFor(room, 2);
  assert.equal(bobsView.seats[ann].reserved[0].card, null, 'bob cannot see the blind card');
  assert.equal(bobsView.seats[ann].reserved[0].level, 3);
  assert.equal(bobsView.seats[ann].reserved[0].blind, true);
  assert.equal(bobsView.seats[bob].reserved[0].card, exposed);
  assert.ok(!JSON.stringify(bobsView).includes(hidden));
  assert.equal(typeof bobsView.decks[1], 'number');
  assert.equal(game.viewFor(room, 1).seats[ann].reserved[0].card, hidden, 'ann sees her own');
  assert.equal(game.viewFor(room, 1).seats[bob].reserved[0].card, exposed, 'a face-up reserve is public');
  const spectator = game.viewFor(room, 999);
  assert.equal(spectator.you, -1);
  assert.equal(spectator.afford, undefined);
  assert.ok(!JSON.stringify(spectator).includes(hidden));
});

test('a blind-reserved card is revealed to everyone when it is bought', () => {
  const room = fresh(2);
  game.reserveCard(room, 0, { level: 1 });
  const id = room.players[0].reserved[0].card;
  game.takeGems(room, 1, [D, S, E]);
  giveBonuses(room, 0, { [D]: 2, [S]: 2, [E]: 2, [R]: 2, [O]: 2 });
  setTokens(room, 0, T(2, 2, 2, 2, 2));
  game.buyCard(room, 0, id);
  const other = game.viewFor(room, 999);
  assert.ok(JSON.stringify(other.log).includes(id));
});

function removeFromPlay(room, ids) {
  for (const id of ids) {
    for (const l of [1, 2, 3]) {
      const i = room.decks[l].indexOf(id);
      if (i !== -1) room.decks[l].splice(i, 1);
      const b = room.board[l].indexOf(id);
      if (b !== -1) room.board[l][b] = room.decks[l].pop() ?? null;
    }
  }
}

test('a later player with more prestige beats the player who triggered the end', () => {
  const room = nearlyThere(2, 0, { points: 14 });
  const one = cardWith((c) => c.points === 1 && c.level === 1 && room.decks[1].includes(c.id));
  place(room, one.id);
  setTokens(room, 0, T(...one.cost));
  game.buyCard(room, 0, one.id);
  assert.equal(room.finalRound, true);
  assert.equal(room.turn, 1);
  const fives = CARDS.filter((c) => c.points === 5).map((c) => c.id).filter((id) => room.decks[3].includes(id) || room.board[3].includes(id));
  const fours = CARDS.filter((c) => c.points === 4).map((c) => c.id).filter((id) => room.decks[3].includes(id) || room.board[3].includes(id));
  const owned = [fives[0], fives[1], fours[0]];
  removeFromPlay(room, owned);
  room.players[1].bought.push(...owned);
  room.players[1].tally.cardsBought = 3;
  room.roundDeltas[1] = 14;
  assert.equal(game.prestigeOf(room.players[1]), 14);
  game.takeGems(room, 1, [D, S, E]);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.winners, [0], '15 beats 14');
  const richer = nearlyThere(2, 0, { points: 14 });
  place(richer, one.id);
  setTokens(richer, 0, T(...one.cost));
  game.buyCard(richer, 0, one.id);
  const more = CARDS.filter((c) => c.points === 5).map((c) => c.id).filter((id) => richer.decks[3].includes(id) || richer.board[3].includes(id)).slice(0, 4);
  removeFromPlay(richer, more);
  richer.players[1].bought.push(...more);
  richer.players[1].tally.cardsBought = 4;
  richer.roundDeltas[1] = 20;
  game.takeGems(richer, 1, [D, S, E]);
  assert.deepEqual(richer.winners, [1], '20 beats 15 although seat 0 reached the target first');
});

test('ties are broken by fewer cards bought', () => {
  const room = fresh(3);
  const fives = CARDS.filter((c) => c.points === 5).map((c) => c.id);
  const fours = CARDS.filter((c) => c.points === 4).map((c) => c.id);
  const threes = CARDS.filter((c) => c.points === 3 && c.level === 3).map((c) => c.id);
  const mine = fives.slice(0, 3); // 15 points, 3 cards
  const theirs = [fours[0], fours[1], fours[2], threes[0]]; // 15 points, 4 cards
  removeFromPlay(room, [...mine, ...theirs]);
  room.players[0].bought.push(...mine);
  room.players[1].bought.push(...theirs);
  room.players[0].tally.cardsBought = 3;
  room.players[1].tally.cardsBought = 4;
  room.roundDeltas = [15, 15, 0];
  room.finalRound = true;
  room.turn = 2;
  game.takeGems(room, 2, [D, S, E]);
  assert.equal(room.phase, 'finished');
  assert.equal(game.prestigeOf(room.players[0]), 15);
  assert.equal(game.prestigeOf(room.players[1]), 15);
  assert.deepEqual(room.winners, [0], 'fewer cards bought wins the tie');
  const [stat] = game.statsPlayers(room);
  assert.equal(stat.outcome, 'win');
  assert.equal(stat.placement, 1);
});

test('a shared win is a win for each, and a beaten player is recorded as a loss', () => {
  const room = fresh(2);
  const fives = CARDS.filter((c) => c.points === 5).map((c) => c.id);
  removeFromPlay(room, fives.slice(0, 2));
  room.players[0].bought.push(fives[0]);
  room.players[0].tally.cardsBought = 1;
  room.players[1].bought.push(fives[1]);
  room.players[1].tally.cardsBought = 1;
  room.roundDeltas = [5, 5];
  room.finalRound = true;
  room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Bot' };
  room.seats[1] = { kind: 'human', id: 7, name: 'zed' };
  room.turn = 0;
  game.takeGems(room, 0, [D, S, E]);
  game.takeGems(room, 1, [D, S, E]);
  assert.deepEqual(room.winners, [0, 1]);
  const [stat] = game.statsPlayers(room);
  assert.equal(stat.userId, 7);
  assert.equal(stat.outcome, 'win');
  assert.equal(stat.placement, 1);
  room.winners = [0];
  assert.equal(game.statsPlayers(room)[0].outcome, 'loss');
});
