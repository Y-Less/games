import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDeck, isCard, shuffle } from '../../shared/cards.js';
import { chooseDiscard, choosePlay } from './bot.js';
import * as game from './game.js';
import { pipValue } from './scoring.js';

function seeded(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A started room: seat 0 is a person (user 1), the others computer players. */
function started(seats, { target = 121, seed = 5 } = {}) {
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, name: 'Alex', target, seats });
  assert.ok(game.fillBots(room, 1).ok);
  assert.ok(game.start(room, 1, seeded(seed)).ok);
  return room;
}

/** A room in the play with chosen hands (one list per seat), dealer 0, nothing scored. */
function inPlay(hands, { target = 121, starter = '2D', crib = ['KC', 'KD', 'QC', 'QD'], scores = [] } = {}) {
  const room = started(hands.length, { target });
  room.dealer = 0;
  room.phase = 'play';
  room.hands = hands.map((h) => [...h]);
  room.kept = hands.map((h) => [...h]);
  room.crib = crib;
  room.starter = starter;
  room.log = [];
  room.history = [];
  room.handDeltas = {};
  room.play = { count: 0, sequence: [], turn: 1, last: null, said: [], previous: [] };
  room.seats.forEach((s, i) => Object.assign(s, { score: scores[i] ?? 0, back: 0, discarded: true }));
  return room;
}

const play = (room, seat, card) => {
  const result = game.playCard(room, seat, card);
  assert.ok(result.ok, result.error);
};
const logText = (room) => room.log.map((l) => l.text);

test('lobby: seats, settings, computer players and starting', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'Alex' });
  assert.equal(room.seatCount, 2);
  assert.equal(room.target, 121);
  assert.equal(game.start(room, 1).ok, false, 'a seat is empty');
  assert.equal(game.addBot(room, 2).ok, false, 'only the host');
  assert.ok(game.setSettings(room, 1, { seats: 4, target: 61 }).ok);
  assert.equal(game.setSettings(room, 1, { seats: 5 }).ok, false);
  assert.equal(game.setSettings(room, 1, { target: 100 }).ok, false);
  assert.ok(game.addBot(room, 1).ok);
  assert.equal(game.setSettings(room, 1, { seats: 2 }).ok, true);
  assert.deepEqual(game.viewFor(room, 1).scoreboard.players.map((p) => p.bot), [false, true], 'the scoreboard marks computer players');
  assert.equal(game.addBot(room, 1).ok, false, 'full');
  assert.equal(game.setSettings(room, 1, { seats: 3 }).ok, true);
  assert.ok(game.fillBots(room, 1).ok);
  assert.deepEqual(room.seats.map((s) => s.bot), [false, true, true]);
  assert.equal(new Set(room.seats.map((s) => s.name)).size, 3, 'distinct names');
  assert.equal(game.setSettings(room, 1, { seats: 2 }).ok, false, 'cannot drop below the occupied seats');
  assert.ok(game.removeBot(room, 1, 2).ok);
  assert.equal(game.removeBot(room, 1, 0).ok, false, 'a person is not a computer player');
  assert.equal(game.start(room, 1).ok, false);
  assert.ok(game.setSettings(room, 1, { seats: 2 }).ok);
  assert.ok(game.start(room, 1).ok);
  assert.equal(game.addHuman(room, 9, 'Late').ok, false, 'already started');
});

test('lobby: names are made unique, a second person can join and the host passes on', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'Alex', seats: 3 });
  game.addHuman(room, 2, 'Alex');
  assert.deepEqual(room.seats.map((s) => s.name), ['Alex', 'Alex (2)']);
  assert.equal(game.addHuman(room, 2, 'Alex').ok, true, 'joining twice is harmless');
  assert.equal(room.seats.length, 2);
  assert.deepEqual(game.removeHuman(room, 1), { ok: true, empty: false });
  assert.equal(room.hostId, 2);
  assert.deepEqual(game.removeHuman(room, 2), { ok: true, empty: true });
});

test('dealing by player count: 6 each; 5 each plus one to the crib; 5 each', () => {
  const expectations = [
    [2, { hand: 6, crib: 0, discards: 2 }],
    [3, { hand: 5, crib: 1, discards: 1 }],
    [4, { hand: 5, crib: 0, discards: 1 }],
  ];
  for (const [seats, want] of expectations) {
    const room = started(seats);
    assert.equal(room.phase, 'discard');
    assert.ok(room.hands.every((h) => h.length === want.hand), `${seats} players: ${want.hand} each`);
    assert.equal(room.crib.length, want.crib);
    assert.equal(game.viewFor(room, 1).need, want.discards);
    const everything = [...room.hands.flat(), ...room.crib, ...room.deck];
    assert.equal(new Set(everything).size, 52, 'no card dealt twice');
    assert.equal(everything.length, 52);
  }
});

test('discarding: validated, builds the crib, then the starter is cut and the play begins', () => {
  for (const seats of [2, 3, 4]) {
    const room = started(seats);
    const need = game.dealRules(seats).discards;
    const given = [];
    assert.equal(game.discard(room, 0, room.hands[0].slice(0, need - 1)).ok, false, 'too few');
    assert.equal(game.discard(room, 0, room.hands[0].slice(0, need + 1)).ok, false, 'too many');
    if (need === 2) assert.equal(game.discard(room, 0, [room.hands[0][0], room.hands[0][0]]).ok, false, 'duplicates are refused');
    const other = room.deck[0];
    assert.equal(game.discard(room, 0, [other, ...room.hands[0]].slice(0, need)).ok, false, 'not in your hand');
    const mine = room.hands[0].slice(0, need);
    assert.ok(game.discard(room, 0, mine).ok);
    given.push(...mine);
    assert.equal(game.discard(room, 0, room.hands[0].slice(0, need)).ok, false, 'only once');
    assert.equal(game.playCard(room, 1, room.hands[1][0]).ok, false, 'not time to play');
    for (let i = 1; i < seats; i++) {
      const cards = room.hands[i].slice(0, need);
      given.push(...cards);
      assert.ok(game.discard(room, i, cards).ok);
    }
    assert.equal(room.phase, 'play');
    assert.ok(room.hands.every((h) => h.length === 4));
    assert.equal(room.crib.length, 4);
    for (const card of given) assert.ok(room.crib.includes(card), 'crib holds the discards');
    assert.ok(isCard(room.starter));
    assert.equal(room.play.turn, (room.dealer + 1) % seats, 'the player left of the dealer leads');
    assert.equal(room.deck.length, 52 - seats * game.dealRules(seats).dealt - game.dealRules(seats).extraToCrib - 1);
  }
});

test('a jack as the starter gives the dealer two for his heels', () => {
  const room = started(3);
  room.deck = ['JH', ...room.deck.filter((c) => c !== 'JH')];
  for (let i = 0; i < 3; i++) room.hands[i] = room.hands[i].filter((c) => c !== 'JH');
  for (let i = 0; i < 3; i++) assert.ok(game.discard(room, i, [room.hands[i][0]], () => 0).ok);
  assert.equal(room.starter, 'JH');
  assert.equal(room.seats[room.dealer].score, 2);
  assert.ok(logText(room).some((t) => /his heels for 2/.test(t)));
  room.seats.forEach((s, i) => i !== room.dealer && assert.equal(s.score, 0));
});

test('the play, two players: go, then last card, and the lead after a go', () => {
  const room = inPlay([['9S', '5C'], ['10H', '10D']]);
  play(room, 1, '10H');
  assert.equal(game.playCard(room, 1, '10D').ok, false, 'not your turn');
  play(room, 0, '9S');
  assert.equal(game.playCard(room, 1, '10H').ok, false, 'already played');
  play(room, 1, '10D');
  assert.equal(room.play.count, 0, 'the count started again');
  assert.equal(room.play.turn, 0, 'the player after the last to play leads');
  assert.deepEqual(logText(room), [`${room.seats[0].name}: go`, `${room.seats[1].name}: go for 1`]);
  assert.equal(room.seats[1].stats.pegPoints, 1);
  play(room, 0, '5C');
  assert.ok(logText(room).includes(`${room.seats[0].name}: last card for 1`));
  assert.equal(room.phase, 'show');
  assert.equal(room.seats[0].stats.pegPoints, 1);
});

test('thirty-one scores two and no go point, and the next player leads', () => {
  const room = inPlay([['QS', '6C'], ['KH', '5D']]);
  play(room, 1, 'KH');
  play(room, 0, 'QS');
  play(room, 1, '5D');
  play(room, 0, '6C');
  assert.equal(room.seats[0].stats.pegPoints, 2);
  assert.ok(logText(room).some((t) => /thirty-one for 2/.test(t)));
  assert.ok(!logText(room).some((t) => /go|last card/.test(t)), 'no go or last card after thirty-one');
  assert.equal(room.phase, 'show');
});

test('cards that would pass thirty-one cannot be played', () => {
  const room = inPlay([['AC'], ['KH', '2H']]);
  room.play.count = 25;
  assert.deepEqual(game.playableCards(room, 1), ['2H']);
  assert.equal(game.playCard(room, 1, 'KH').ok, false);
  assert.equal(room.hands[1].length, 2, 'nothing was played');
});

test('three players: players who cannot play are passed, the last to play gets the go', () => {
  const room = inPlay([['9C', 'KS'], ['10H'], ['10D', '4C']]);
  room.dealer = 0;
  play(room, 1, '10H');
  play(room, 2, '10D');
  assert.equal(room.seats[2].stats.pegPoints, 2, 'a pair');
  play(room, 0, '9C');
  assert.equal(room.play.count, 0, 'nobody could play: the count restarted');
  assert.ok(logText(room).includes(`${room.seats[2].name}: go`));
  assert.ok(logText(room).includes(`${room.seats[0].name}: go for 1`));
  assert.equal(room.play.turn, 2, 'leads: next player after the last to play with cards (seat 1 has none)');
  play(room, 2, '4C');
  play(room, 0, 'KS');
  assert.equal(room.seats[0].stats.pegPoints, 2, 'go and then the last card');
  assert.equal(room.phase, 'show');
});

test('four players: one player cannot play but the others carry on', () => {
  const room = inPlay([['6H'], ['10H', '2D'], ['KD'], ['9C']]);
  play(room, 1, '10H');
  play(room, 2, 'KD');
  play(room, 3, '9C');
  assert.equal(room.play.turn, 1, 'seat 0 cannot play a six at 29, so seat 1 goes again');
  assert.ok(logText(room).includes(`${room.seats[0].name}: go`));
  play(room, 1, '2D');
  assert.equal(room.seats[1].stats.pegPoints, 2, 'thirty-one');
  assert.equal(room.play.turn, 0);
  play(room, 0, '6H');
  assert.equal(room.seats[0].stats.pegPoints, 1, 'last card');
  assert.equal(room.phase, 'show');
});

test('the play scores fifteens, pairs and runs as they happen', () => {
  const room = inPlay([['3S', '9C'], ['6H', '4D', 'KD']]);
  play(room, 1, '6H');
  play(room, 0, '3S');
  play(room, 1, '4D');
  assert.equal(room.seats[1].stats.pegPoints, 0);
  play(room, 0, '9C');
  assert.equal(room.seats[1].score, 0);
  const second = inPlay([['5S', '4C'], ['6H', 'KD', '5D']]);
  play(second, 1, '6H');
  play(second, 0, '4C');
  play(second, 1, '5D');
  assert.equal(second.seats[1].score, 5, 'a run of three and fifteen');
  assert.ok(logText(second).includes(`${second.seats[1].name}: run of 3 for 3`));
});

test('the game ends the instant the target is reached in the play', () => {
  const room = inPlay([['5S', '4C'], ['6H', '5D', 'KD']], { target: 61, scores: [0, 59] });
  play(room, 1, '6H');
  play(room, 0, '5S');
  play(room, 1, '5D');
  assert.equal(room.phase, 'finished');
  assert.equal(room.winner, 1);
  assert.equal(room.seats[1].score, 61);
  assert.equal(game.playCard(room, 0, '4C').ok, false);
  assert.equal(room.show, null, 'no show');
  assert.deepEqual(room.history.length, 1);
  assert.equal(room.history[0].deltas[1], 2);
});

test('the game ends mid-show: the earliest to reach the target wins and the rest is not counted', () => {
  const room = inPlay([[], ['4H']], { target: 61, scores: [50, 50], starter: '5C' });
  room.kept = [['5H', '5D', '5S', 'JC'], ['5H', '5D', '5S', 'JC']];
  play(room, 1, '4H');
  assert.equal(room.phase, 'finished');
  assert.equal(room.winner, 1, 'the player left of the dealer counts first');
  assert.equal(room.show.entries.length, 1);
  assert.equal(room.seats[0].score, 50);
  assert.equal(room.seats[1].score, 61);
  const stats = game.statsPlayers(room);
  assert.deepEqual(stats.map((p) => p.userId), [1], 'the computer player is not recorded');
  assert.equal(stats[0].outcome, 'loss');
  assert.equal(stats[0].placement, 2);
  assert.equal(stats[0].score, 50);
});

test('the show: hands from the dealer\'s left, the dealer last, then the crib, with the starter', () => {
  const room = inPlay([[], [], ['4H']], { starter: '9S', crib: ['2H', '2D', '7C', '8C'] });
  room.dealer = 1;
  room.play.turn = 2;
  room.kept = [['AH', 'AD', '4C', '9C'], ['KH', 'KD', 'QC', 'JC'], ['6H', '7H', '8H', '9H']];
  play(room, 2, '4H');
  assert.equal(room.phase, 'show');
  assert.deepEqual(room.show.entries.map((e) => [e.kind, e.seat]), [['hand', 2], ['hand', 0], ['hand', 1], ['crib', 1]]);
  assert.equal(room.show.entries[0].total, room.show.entries[0].items.reduce((s, i) => s + i.points, 0));
  assert.equal(room.show.entries[0].items.some((i) => i.kind === 'flush'), true);
  assert.equal(room.seats[2].stats.bestHand, room.show.entries[0].total);
  assert.equal(room.seats[1].stats.bestHand, room.show.entries[2].total, 'the crib is not a best hand');
});

test('ready: the next hand is dealt, and the dealer moves clockwise, when every person is ready', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'A', seats: 3 });
  game.addHuman(room, 2, 'B');
  game.addBot(room, 1);
  game.start(room, 1, seeded(3));
  room.phase = 'show';
  room.show = { entries: [] };
  const dealer = room.dealer;
  assert.ok(game.ready(room, 0).ok);
  assert.equal(room.phase, 'show', 'still waiting for the other person');
  assert.equal(game.viewFor(room, 1).seats[2].ready, true, 'computer players are always ready');
  assert.ok(game.ready(room, 1, seeded(4)).ok);
  assert.equal(room.phase, 'discard');
  assert.equal(room.handNo, 2);
  assert.equal(room.dealer, (dealer + 1) % 3);
  assert.equal(game.ready(room, 0).ok, false);
  assert.ok(room.seats.every((s) => s.stats.handsPlayed === 2));
});

test('views: only your own hand, never the others or the crib; the show reveals them', () => {
  const room = started(2);
  const mine = game.viewFor(room, 1);
  const text = JSON.stringify(mine);
  assert.deepEqual(mine.hand, room.hands[0]);
  for (const card of room.hands[1]) assert.ok(!mine.hand.includes(card));
  assert.equal(mine.seats[1].cards, 6);
  assert.ok(!('deck' in mine) && !('hands' in mine) && !('crib' in mine));
  for (const card of room.deck) assert.ok(!text.includes(`"${card}"`) || mine.hand.includes(card), 'deck cards are not exposed');
  for (const card of room.hands[1]) assert.ok(!text.includes(`"${card}"`), `opponent card ${card} not in my view`);
  const discards = room.hands[0].slice(0, 2);
  game.discard(room, 0, discards);
  assert.deepEqual(game.viewFor(room, 1).hand, room.hands[0], 'my hand is now four cards');
  const cribText = JSON.stringify(game.viewFor(room, 1));
  for (const card of discards) assert.ok(!cribText.includes(`"${card}"`), 'my own discards are not echoed either');
  assert.equal(game.viewFor(room, 1).cribCount, 2);
  assert.equal(game.viewFor(room, 99).you, -1, 'a stranger sees no hand');
  assert.deepEqual(game.viewFor(room, 99).hand, []);
});

test('leaving: a person is replaced by a computer player; with nobody left the room is empty', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'A', seats: 3 });
  game.addHuman(room, 2, 'B');
  game.addBot(room, 1);
  game.start(room, 1, seeded(9));
  assert.deepEqual(game.removeHuman(room, 2), { ok: true, empty: false });
  assert.equal(room.seats[1].bot, true);
  assert.equal(room.seats[1].userId, null);
  assert.equal(game.pendingBot(room).seat === 1 || game.pendingBot(room).seat === 2, true);
  room.seats[0].score = 10;
  assert.deepEqual(game.removeHuman(room, 1), { ok: true, empty: true });
  assert.equal(game.removeHuman(room, 1).ok, false);
});

test('a person leaving the show lets the hand move on', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'A', seats: 2 });
  game.addHuman(room, 2, 'B');
  game.start(room, 1, seeded(2));
  room.phase = 'show';
  room.show = { entries: [] };
  game.ready(room, 0);
  game.removeHuman(room, 2, seeded(3));
  assert.equal(room.phase, 'discard');
});

test('kick: the lobby host removes people, in a game only people who are away', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'A', seats: 3 });
  game.addHuman(room, 2, 'B');
  assert.equal(game.kick(room, 2, 0).ok, false, 'only the host');
  assert.equal(game.kick(room, 1, 0).ok, false, 'not yourself');
  assert.equal(game.kick(room, 1, 1).userId, 2);
  game.addHuman(room, 2, 'B');
  game.fillBots(room, 1);
  game.start(room, 1);
  assert.equal(game.kick(room, 1, 1).ok, false, 'still here');
  assert.equal(game.kick(room, 1, 1, { away: true }).userId, 2);
  assert.equal(room.seats[1].bot, true);
});

/** Plays whole games with the computer players, checking every move is legal. */
function playWholeGame(seats, seed, target = 61) {
  const room = started(seats, { target, seed });
  const rng = seeded(seed + 100);
  room.seats[0].bot = true;
  let steps = 0;
  while (room.phase !== 'finished') {
    assert.ok(steps++ < 50000, 'the game must end');
    if (room.phase === 'show') {
      room.seats.forEach((s) => (s.ready = true));
      game.ready(room, 0, rng);
      continue;
    }
    const before = JSON.stringify(room.seats.map((s) => s.score));
    const result = game.botMove(room, rng);
    assert.ok(result.ok, result.error);
    assert.ok(room.seats.every((s) => s.score >= 0 && s.score <= target), before);
  }
  return room;
}

test('whole games with computer players end with one winner, and the history adds up to the scores', () => {
  for (const seats of [2, 3, 4]) {
    for (let seed = 1; seed <= 12; seed++) {
      const target = seed % 2 ? 61 : 121;
      const room = playWholeGame(seats, seed, target);
      assert.equal(room.seats[room.winner].score, target);
      assert.equal(room.seats.filter((s) => s.score >= target).length, 1, 'only the winner reached the target');
      const sums = room.seats.map((_, i) => room.history.reduce((total, hand) => total + (hand.deltas[i] ?? 0), 0));
      assert.deepEqual(sums, room.seats.map((s) => s.score));
      assert.equal(room.history.length, room.handNo);
      assert.deepEqual(room.history.map((h) => h.label), room.history.map((_, i) => `Hand ${i + 1}`));
      const view = game.viewFor(room, 1);
      assert.deepEqual(view.scoreboard.rounds, room.history);
      assert.deepEqual(view.scoreboard.players.map((p) => p.score), room.seats.map((s) => s.score));
      assert.equal(view.scoreboard.target, target);
      assert.equal(view.scoreboard.lowIsBetter, false);
    }
  }
});

test('statistics: placements share ties, skunks need an opponent under the line, extras are numbers', () => {
  const room = playWholeGame(3, 4, 121);
  room.seats[0].userId = 1;
  room.seats[0].bot = false;
  room.seats[1].userId = 2;
  room.seats[1].bot = false;
  room.winner = 0;
  Object.assign(room.seats[0], { score: 121 });
  room.seats[1].score = 85;
  room.seats[2].score = 85;
  const players = game.statsPlayers(room);
  assert.deepEqual(players.map((p) => [p.userId, p.outcome, p.placement, p.score]), [[1, 'win', 1, 121], [2, 'loss', 2, 85]]);
  assert.equal(players[0].extras.skunks, 1);
  assert.equal(players[1].extras.skunks, 0);
  room.seats[1].score = 91;
  room.seats[2].score = 91;
  assert.equal(game.statsPlayers(room)[0].extras.skunks, 0, '91 is not a skunk');
  room.target = 61;
  room.seats.forEach((s, i) => (s.score = [61, 30, 40][i]));
  assert.equal(game.statsPlayers(room)[0].extras.skunks, 1, 'under 31 in the short game');
  for (const p of players) for (const value of Object.values(p.extras)) assert.ok(Number.isFinite(value));
});

test('rematch returns to the lobby with the same seats and fresh scores', () => {
  const room = playWholeGame(2, 3);
  assert.equal(game.returnToLobby(room, 2).ok, false, 'host only');
  room.seats[0].bot = false;
  assert.ok(game.returnToLobby(room, 1).ok);
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.history, []);
  assert.ok(room.seats.every((s) => s.score === 0 && s.stats.handsPlayed === 0));
  assert.ok(game.start(room, 1).ok);
});

test('computer players: discards are always legal, keep the best hand, and are sensible', () => {
  const rng = seeded(11);
  for (let i = 0; i < 1500; i++) {
    const deck = shuffle(fullDeck(), rng);
    const twoPlayers = i % 3 === 0;
    const hand = deck.slice(0, twoPlayers ? 6 : 5);
    const discards = chooseDiscard(hand, { discardCount: twoPlayers ? 2 : 1, isDealer: i % 2 === 0 });
    assert.equal(discards.length, twoPlayers ? 2 : 1);
    assert.equal(new Set(discards).size, discards.length);
    assert.ok(discards.every((c) => hand.includes(c)));
  }
  const keeps = (discards, hand) => hand.filter((c) => !discards.includes(c));
  const fives = ['5H', '5D', '5S', '5C', '10H', '2D'];
  assert.deepEqual(keeps(chooseDiscard(fives, { discardCount: 2, isDealer: false }), fives).sort(), ['5C', '5D', '5H', '5S']);
  const run = ['4H', '5D', '6S', 'KC', 'KD', '9C'];
  const kept = keeps(chooseDiscard(run, { discardCount: 2, isDealer: true }), run);
  assert.ok(['4H', '5D', '6S'].every((c) => kept.includes(c)), 'the run is kept');
});

test('computer players: plays are always legal and prefer points', () => {
  const rng = seeded(21);
  for (let i = 0; i < 6000; i++) {
    const deck = shuffle(fullDeck(), rng);
    const sequence = [];
    let count = 0;
    for (const card of deck.slice(0, Math.floor(rng() * 6))) {
      if (count + pipValue(card) > 31) break;
      sequence.push(card);
      count += pipValue(card);
    }
    const hand = deck.slice(10, 10 + 1 + Math.floor(rng() * 4));
    const legal = hand.filter((c) => count + pipValue(c) <= 31);
    const choice = choosePlay(hand, { count, sequence });
    if (!legal.length) assert.equal(choice, null);
    else assert.ok(legal.includes(choice), `${choice} is legal at ${count}`);
  }
  assert.equal(choosePlay(['5D', '2C'], { count: 10, sequence: ['10H'] }), '5D', 'fifteen');
  assert.equal(choosePlay(['5D', '6C'], { count: 0, sequence: [] }), '6C', 'does not lead a five');
  assert.equal(choosePlay(['KD'], { count: 25, sequence: [] }), null);
  assert.equal(choosePlay(['9H', '4S'], { count: 9, sequence: ['9D'] }), '9H', 'a pair beats a quiet card');
});
