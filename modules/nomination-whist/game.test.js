// The rules of Nomination Whist, without sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDeck, isCard, suitOf } from '../../shared/cards.js';
import { totalsFromRounds } from '../../shared/scores.js';
import * as g from './game.js';
import { canTakeAllSeven, chooseNomination, estimateTricks, winningCard } from './bot.js';

/** A small deterministic random number generator. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A room with one human (id 1) as host and computer players in every other seat, ready to start. */
function fullRoom(seats = 4, settings = {}) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats, ...settings } });
  assert.ok(g.fillWithBots(room, 1).ok);
  return room;
}

/** Plays a whole game for every seat with the computer's judgement. */
function playOut(room, rng) {
  for (let guard = 0; guard < 100000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'roundEnd') {
      for (const seat of room.seats) if (seat?.kind === 'human') assert.ok(g.nextRound(room, seat.id, rng).ok);
    }
    else {
      const seat = room.phase === 'nominating' || room.trick.length < room.seats.length ? room.turn : null;
      if (seat === null) assert.ok(g.resolveTrick(room).ok);
      else if (room.phase === 'nominating') assert.ok(g.nominate(room, seat, g.botNominate(room, seat, rng)).ok);
      else assert.ok(g.playCard(room, seat, g.botPlay(room, seat)).ok);
    }
  }
  assert.equal(room.phase, 'finished');
}

test('the hand sizes run 7 down to 1 and back up, or 7 down to 1 only', () => {
  assert.deepEqual(g.FULL_SCHEDULE, [7, 6, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(g.roundCount({ length: 'full' }), 14);
  assert.equal(g.roundCount({ length: 'short' }), 7);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => g.handSize({ length: 'short' }, i)), [7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(g.DEFAULT_SETTINGS, { seats: 4, length: 'full', missPoints: true, instantWin: true, jokers: false });
});

test('the trump suit repeats hearts, clubs, diamonds, spades, no trumps across all 14 rounds', () => {
  const trumps = Array.from({ length: 14 }, (_, i) => g.trumpOf(i));
  assert.deepEqual(trumps, ['H', 'C', 'D', 'S', null, 'H', 'C', 'D', 'S', null, 'H', 'C', 'D', 'S']);
  assert.equal(g.trumpName(null), 'no trumps');
  assert.equal(g.trumpName('D'), 'diamonds');
  assert.equal(g.roundLabel({ length: 'full' }, 2), 'Round 3: 5 cards, diamonds');
  assert.equal(g.roundLabel({ length: 'full' }, 6), 'Round 7: 1 card, clubs');
});

test('the dealer rotates clockwise each round', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, r) => g.dealerFor(2, r, 5)), [2, 3, 4, 0, 1, 2, 3, 4]);
  const room = fullRoom(4);
  assert.ok(g.start(room, 1, seeded(1)).ok);
  const first = room.dealer;
  assert.equal(room.turn, (first + 1) % 4, 'the player to the dealer\'s left nominates first');
  const dealers = [first];
  for (let round = 1; round < 6; round++) {
    room.phase = 'roundEnd';
    assert.ok(g.nextRound(room, 1).ok);
    dealers.push(room.dealer);
  }
  assert.deepEqual(dealers, [0, 1, 2, 3, 4, 5].map((i) => (first + i) % 4));
});

test('dealing gives every seat the right number of distinct cards, including 7 players with 7 cards', () => {
  for (let seats = 3; seats <= 7; seats++) {
    for (const round of [0, 3, 6, 7, 13]) {
      const room = fullRoom(seats);
      room.roundIndex = round;
      g.dealRound(room, seeded(seats * 100 + round));
      const cards = g.handSize(room.settings, round);
      assert.ok(room.hands.every((hand) => hand.length === cards));
      const all = room.hands.flat();
      assert.equal(new Set(all).size, seats * cards);
      assert.ok(all.every(isCard));
    }
  }
  const room = fullRoom(7);
  g.dealRound(room, seeded(7));
  assert.equal(room.hands.flat().length, 49);
});

test('a game needs every seat filled and a human, and only the host starts it', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  assert.match(g.start(room, 1).error, /Every seat/);
  assert.ok(g.addBot(room, 1).ok);
  assert.ok(g.addBot(room, 1, 3).ok);
  assert.match(g.start(room, 1).error, /Every seat/);
  assert.ok(g.addHuman(room, 2, 'Bob').ok);
  assert.equal(g.start(room, 2).error, 'Only the host can do that.');
  assert.ok(g.start(room, 1).ok);
  assert.equal(room.phase, 'nominating');
  assert.equal(g.start(room, 1).ok, false);
  assert.equal(g.addHuman(room, 3, 'Cat').ok, false, 'no joining after the start');
});

test('lobby seats: the number of seats, adding, removing and filling computer players', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  assert.equal(room.seats.length, 4);
  assert.ok(g.setSettings(room, 1, { seats: 7 }).ok);
  assert.equal(room.seats.length, 7);
  assert.equal(g.viewFor(room, 1).seats.length, 7, 'the lobby view copes with the new seats');
  assert.ok(g.addBot(room, 1, 6).ok);
  assert.equal(g.viewFor(room, 1).seats[6].bot, true);
  assert.equal(g.setSettings(room, 1, { seats: 8 }).ok, false);
  assert.equal(g.setSettings(room, 1, { seats: 2 }).ok, false);
  assert.equal(g.setSettings(room, 1, { seats: 4.5 }).ok, false);
  assert.equal(g.setSettings(room, 2, { seats: 5 }).ok, false, 'only the host');
  assert.ok(g.fillWithBots(room, 1).ok);
  assert.ok(room.seats.every(Boolean));
  assert.ok(g.setSettings(room, 1, { seats: 3 }).ok);
  assert.equal(room.seats.length, 3);
  assert.equal(room.seats[0].kind, 'human', 'the host keeps a seat');
  assert.deepEqual(room.seats.map((s) => s.kind), ['human', 'bot', 'bot']);
  assert.ok(g.removeBot(room, 1, 2).ok);
  assert.equal(g.removeBot(room, 1, 0).ok, false, 'a person is not a computer player');
  assert.equal(g.addBot(room, 1, 0).ok, false);
  assert.equal(g.addBot(room, 1, 9).ok, false);
  assert.ok(g.addBot(room, 1).ok);
  assert.equal(g.addBot(room, 1).ok, false, 'full');
  const names = room.seats.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(g.addHuman(room, 2, 'Ann').ok === false, 'full');
  g.removeBot(room, 1, 1);
  assert.ok(g.addHuman(room, 2, 'Ann').ok);
  assert.notEqual(room.seats[1].name, 'Ann', 'names are made distinct');
  assert.equal(g.setSettings(room, 1, { length: 'weird' }).ok, false);
  assert.equal(g.setSettings(room, 1, { missPoints: 'yes' }).ok, false);
  assert.ok(g.setSettings(room, 1, { length: 'short', missPoints: false }).ok);
  assert.deepEqual(room.settings, { seats: 3, length: 'short', missPoints: false, instantWin: true, jokers: false });
});

test('too many people cannot be squeezed into fewer seats', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  g.addHuman(room, 2, 'Bob');
  g.addHuman(room, 3, 'Cat');
  g.addHuman(room, 4, 'Dan');
  assert.match(g.setSettings(room, 1, { seats: 3 }).error, /Too many people/);
  assert.equal(room.seats.length, 4);
});

test('follow-suit legality', () => {
  const room = fullRoom(4);
  g.start(room, 1, seeded(3));
  room.phase = 'playing';
  room.turn = 0;
  room.hands = [['2H', '9H', '3C', 'AS'], ['KH', '5D'], ['4C', '6D'], ['7S', '8S']];
  room.trick = [];
  assert.equal(g.legalCards(room, 0).length, 4, 'anything may be led, trumps included');
  room.trick = [{ seat: 3, card: '5H' }];
  assert.deepEqual(g.legalCards(room, 0), ['2H', '9H']);
  assert.match(g.illegalReason(room, 0, '3C'), /follow suit \(hearts\)/);
  assert.equal(g.playCard(room, 0, '3C').ok, false);
  assert.equal(g.playCard(room, 1, 'KH').ok, false, 'not your turn');
  room.trick = [{ seat: 3, card: '5S' }];
  room.hands[0] = ['2H', '9H', '3C'];
  assert.equal(g.legalCards(room, 0).length, 3, 'void in spades: anything, trumps too');
  assert.match(g.illegalReason(room, 0, 'AS'), /not in your hand/);
  assert.equal(g.playCard(room, 0, 12).ok, false);
});

test('trick winners: highest trump, else highest of the suit led, and the no-trump round', () => {
  const trick = (...cards) => cards.map((card, seat) => ({ seat, card }));
  assert.equal(g.trickWinner(trick('5H', 'KH', 'AH', '2H'), 'H'), 2);
  assert.equal(g.trickWinner(trick('5C', 'KC', 'AD', '2H'), 'H'), 3, 'a low trump beats a high card of the suit led');
  assert.equal(g.trickWinner(trick('5C', '2H', 'AD', '9H'), 'H'), 3, 'the highest trump');
  assert.equal(g.trickWinner(trick('5C', 'KC', 'AD', '2S'), 'H'), 1, 'no trump played: highest of the suit led');
  assert.equal(g.trickWinner(trick('5C', 'AH', 'AD', 'AS'), null), 0, 'no trumps: only the suit led counts');
  assert.equal(g.trickWinner(trick('5C', '9C', 'AD', 'AS'), null), 1);
  assert.equal(g.trickWinner(trick('9S', '10S'), 'S'), 1);
  assert.equal(g.trickWinner(trick('9S', '10S', 'JS'), 'D'), 2);
  assert.equal(winningCard(['5C', 'KC', 'AD', '2H'], 'H'), '2H');
});

test('the dealer\'s forbidden nomination, in every combination', () => {
  for (let cards = 1; cards <= 7; cards++) {
    for (let others = 0; others <= 8; others++) {
      const expected = others <= cards ? cards - others : null;
      assert.equal(g.forbiddenNomination(cards, others), others <= cards ? expected : null);
    }
  }
  // others already total more than the tricks: nothing is forbidden
  assert.equal(g.forbiddenNomination(3, 5), null);

  for (const seats of [3, 4, 5, 6, 7]) {
    for (const cards of [1, 2, 3, 5, 7]) {
      const bidsSets = [Array(seats - 1).fill(0), Array(seats - 1).fill(cards), Array.from({ length: seats - 1 }, (_, i) => (i === 0 ? 1 : 0))];
      for (const bids of bidsSets) {
        const room = fullRoom(seats);
        room.roundIndex = g.FULL_SCHEDULE.indexOf(cards);
        g.start(room, 1, seeded(5));
        room.roundIndex = g.FULL_SCHEDULE.indexOf(cards);
        g.dealRound(room, seeded(5));
        for (let i = 0; i < seats - 1; i++) {
          const seat = (room.dealer + 1 + i) % seats;
          assert.equal(room.turn, seat);
          assert.equal(g.forbiddenNow(room), null, 'only on the dealer\'s turn');
          assert.ok(g.nominate(room, seat, Math.min(bids[i], cards)).ok);
        }
        const total = bids.reduce((a, b) => a + Math.min(b, cards), 0);
        const forbidden = g.forbiddenNow(room);
        assert.equal(forbidden, total <= cards ? cards - total : null);
        const allowed = g.allowedNominations(room, room.dealer);
        assert.equal(allowed.includes(forbidden), false);
        assert.equal(allowed.length, cards + (forbidden === null ? 1 : 0));
        if (forbidden !== null) {
          const refused = g.nominate(room, room.dealer, forbidden);
          assert.equal(refused.ok, false);
          assert.match(refused.error, /cannot nominate/);
          assert.equal(room.phase, 'nominating');
        }
        for (const n of allowed) {
          const copy = structuredClone(room);
          assert.ok(g.nominate(copy, copy.dealer, n).ok);
          assert.equal(copy.phase, 'playing');
          assert.notEqual(copy.nominations.reduce((a, b) => a + b, 0), cards, 'the nominations never add up to the tricks');
        }
      }
    }
  }
});

test('nominations are validated and taken in order, from the dealer\'s left to the dealer', () => {
  const room = fullRoom(4);
  g.start(room, 1, seeded(9));
  const first = room.turn;
  assert.equal(g.nominate(room, (first + 1) % 4, 1).ok, false, 'not your turn');
  assert.equal(g.nominate(room, first, -1).ok, false);
  assert.equal(g.nominate(room, first, 8).ok, false);
  assert.equal(g.nominate(room, first, 1.5).ok, false);
  assert.equal(g.nominate(room, first, '2').ok, false);
  assert.ok(g.nominate(room, first, 2).ok);
  assert.equal(g.nominate(room, first, 2).ok, false);
  assert.equal(g.playCard(room, (first + 1) % 4, room.hands[(first + 1) % 4][0]).ok, false, 'no playing before everyone nominated');
  g.nominate(room, (first + 1) % 4, 0);
  g.nominate(room, (first + 2) % 4, 0);
  assert.equal(room.turn, room.dealer);
  assert.equal(room.dealer, (first + 3) % 4);
  assert.ok(g.nominate(room, room.dealer, 0).ok);
  assert.equal(room.phase, 'playing');
  assert.equal(room.turn, first, 'the player to the dealer\'s left leads');
});

test('scoring: exact hits, misses, zero nominations and the miss option', () => {
  const on = { missPoints: true };
  const off = { missPoints: false };
  assert.equal(g.scoreRound(0, 0, on), 10);
  assert.equal(g.scoreRound(0, 0, off), 10);
  assert.equal(g.scoreRound(3, 3, on), 13);
  assert.equal(g.scoreRound(7, 7, off), 17);
  assert.equal(g.scoreRound(1, 1, off), 11);
  assert.equal(g.scoreRound(3, 2, on), 2, 'a miss scores the tricks taken');
  assert.equal(g.scoreRound(3, 2, off), 0);
  assert.equal(g.scoreRound(2, 5, on), 5);
  assert.equal(g.scoreRound(2, 5, off), 0);
  assert.equal(g.scoreRound(0, 3, on), 3);
  assert.equal(g.scoreRound(0, 3, off), 0);
  assert.equal(g.scoreRound(4, 0, on), 0);
});

/** Plays one round (2 cards, hearts trump) with scripted nominations; `taken` says how many tricks each seat wins. */
function scriptedRound(settings, bids, taken) {
  const room = fullRoom(3, settings);
  g.start(room, 1, seeded(1));
  room.roundIndex = 5;
  room.dealer = 0;
  g.dealRound(room, seeded(2));
  assert.equal(g.cardsThisRound(room), 2);
  const winners = taken.flatMap((count, seat) => Array(count).fill(seat));
  assert.equal(winners.length, 2);
  const rank = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const plays = winners.map((winner, t) => [0, 1, 2].map((seat) => `${rank[seat === winner ? 12 - t : t * 3 + seat]}H`));
  room.hands = [0, 1, 2].map((seat) => plays.map((trick) => trick[seat]));
  room.nominations = [...bids];
  room.phase = 'playing';
  room.turn = 1;
  for (let t = 0; t < 2; t++) {
    const leader = room.turn;
    for (let i = 0; i < 3; i++) {
      const seat = (leader + i) % 3;
      assert.ok(g.playCard(room, seat, plays[t][seat]).ok);
    }
    assert.equal(g.resolveTrick(room).winner, winners[t]);
  }
  return room;
}

test('a round is scored from the nominations and the tricks actually taken', () => {
  const room = scriptedRound({ missPoints: true }, [1, 1, 0], [1, 1, 0]);
  assert.equal(room.phase, 'roundEnd');
  assert.deepEqual(room.history[0].points, [11, 11, 10]);
  assert.deepEqual(room.history[0].taken, [1, 1, 0]);
  assert.deepEqual(room.scores, [11, 11, 10]);

  const miss = scriptedRound({ missPoints: true }, [2, 0, 1], [0, 2, 0]);
  assert.deepEqual(miss.history[0].points, [0, 2, 0], 'misses score the tricks taken');
  const missOff = scriptedRound({ missPoints: false }, [2, 0, 1], [0, 2, 0]);
  assert.deepEqual(missOff.history[0].points, [0, 0, 0]);
  const mixed = scriptedRound({ missPoints: true }, [1, 2, 0], [1, 1, 0]);
  assert.deepEqual(mixed.history[0].points, [11, 1, 10]);
  assert.deepEqual(mixed.tally.map((t) => t.bidsMade), [1, 0, 1]);
  assert.deepEqual(mixed.tally.map((t) => t.tricksWon), [1, 1, 0]);
  const view = g.viewFor(mixed, 1);
  assert.deepEqual(view.rounds[0].notes, { 0: 'bid 1, took 1', 1: 'bid 2, took 1', 2: 'bid 0, took 0' });
  assert.equal(view.rounds[0].label, 'Round 6: 2 cards, hearts');
});

test('the tally counts a nomination of zero that was made, and a round where only you were right', () => {
  const both = scriptedRound({ missPoints: true }, [1, 2, 0], [1, 1, 0]);
  assert.deepEqual(both.tally.map((t) => t.zeroBidsMade), [0, 0, 1], 'seat 2 nominated nothing and took nothing');
  assert.deepEqual(both.tally.map((t) => t.singledOut), [0, 0, 0], 'two people were right, so nobody was singled out');
  const alone = scriptedRound({ missPoints: true }, [0, 1, 2], [1, 1, 0]);
  assert.deepEqual(alone.tally.map((t) => t.singledOut), [0, 1, 0], 'only seat 1 was right');
  assert.deepEqual(alone.tally.map((t) => t.zeroBidsMade), [0, 0, 0], 'seat 0 nominated nothing but took a trick');
  const stats = g.statsPlayers({ ...alone, seats: alone.seats.map((seat, i) => ({ kind: 'human', id: i + 1, name: String(i) })), winners: [1] });
  assert.equal(stats[1].extras.singledOut, 1);
});

test('whole games: the history sums to the scores, the game ends after the last round, with legal computer play', () => {
  for (const [seats, length, missPoints] of [[3, 'full', true], [4, 'short', false], [5, 'full', false], [7, 'full', true], [7, 'short', true], [6, 'short', true]]) {
    const room = fullRoom(seats, { length, missPoints });
    const rng = seeded(seats * 31 + length.length);
    assert.ok(g.start(room, 1, rng).ok);
    playOut(room, rng);
    assert.equal(room.history.length, g.roundCount(room.settings));
    assert.deepEqual(room.history.map((h) => h.cards), g.scheduleFor(room.settings));
    assert.deepEqual(room.history.map((h) => h.trump), g.scheduleFor(room.settings).map((_, i) => g.TRUMP_ORDER[i % 5]));
    const totals = totalsFromRounds(g.roundsView(room), room.seats.map((_, i) => i));
    assert.deepEqual(room.scores, room.scores.map((_, i) => totals[i]));
    for (const h of room.history) {
      assert.equal(h.taken.reduce((a, b) => a + b, 0), h.cards, 'every trick was taken by somebody');
      assert.notEqual(h.bids.reduce((a, b) => a + b, 0), h.cards, 'screw the dealer: somebody always misses');
      h.bids.forEach((bid, seat) => assert.equal(h.points[seat], g.scoreRound(bid, h.taken[seat], room.settings)));
    }
    const dealers = room.history.map((h) => h.dealer);
    dealers.forEach((d, i) => assert.equal(d, (dealers[0] + i) % seats));
    assert.ok(room.winners.length >= 1);
    assert.deepEqual(room.winners, room.scores.flatMap((s, i) => (s === Math.max(...room.scores) ? [i] : [])));
    assert.equal(room.tally[0].roundsPlayed, g.roundCount(room.settings));
    assert.equal(room.tally.reduce((sum, t) => sum + t.tricksWon, 0), room.history.reduce((sum, h) => sum + h.cards, 0));
    assert.equal(g.nextRound(room, 1).ok, false);
  }
});

test('the game ends with ties shared, and the statistics use placements', () => {
  const room = fullRoom(4);
  g.start(room, 1, seeded(4));
  room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
  room.scores = [30, 30, 12, 40];
  room.winners = g.winnersOf(room.scores);
  room.phase = 'finished';
  assert.deepEqual(room.winners, [3]);
  room.scores = [40, 30, 12, 40];
  room.winners = g.winnersOf(room.scores);
  assert.deepEqual(room.winners, [0, 3]);
  const stats = g.statsPlayers(room);
  assert.deepEqual(stats.map((s) => s.userId), [1, 2], 'only the accounts');
  assert.deepEqual(stats.map((s) => [s.outcome, s.placement, s.score]), [['win', 1, 40], ['loss', 3, 30]]);
  for (const key of ['roundsPlayed', 'bidsMade', 'tricksWon', 'perfectGames']) assert.ok(key in stats[0].extras);
  room.tally[0] = { roundsPlayed: 14, bidsMade: 14, tricksWon: 49 };
  assert.equal(g.statsPlayers(room)[0].extras.perfectGames, 1);
  room.tally[0].bidsMade = 13;
  assert.equal(g.statsPlayers(room)[0].extras.perfectGames, 0);
  // Scored over 100: strictly more than 100 in the game.
  room.scores = [101, 100, 12, 40];
  assert.deepEqual(g.statsPlayers(room).map((s) => s.extras.scoredOver100), [1, 0]);
});

test('leaving: a computer player takes the seat mid-game, the host passes on, an empty room is abandoned', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  g.addHuman(room, 2, 'Bob');
  assert.equal(g.removeHuman(room, 1).replaced, false);
  assert.equal(room.seats[0], null);
  assert.equal(room.hostId, 2);
  g.addHuman(room, 1, 'Ann');
  g.fillWithBots(room, 2);
  g.start(room, 2, seeded(1));
  const outcome = g.removeHuman(room, 2);
  assert.deepEqual([outcome.ok, outcome.empty, outcome.replaced], [true, false, true]);
  assert.equal(g.isBot(room.seats[1]), true);
  assert.equal(room.hostId, 1);
  assert.equal(g.removeHuman(room, 2).ok, false);
  assert.equal(g.removeHuman(room, 1).empty, true);
});

test('the next round is dealt once every person has closed the score pop-up, and not before', () => {
  const room = fullRoom(4);
  g.start(room, 1, seeded(3));
  room.seats[1] = { kind: 'human', id: 2, name: 'Bea' };
  room.phase = 'roundEnd';
  room.ready = [];
  assert.ok(g.nextRound(room, 1).ok);
  assert.equal(room.phase, 'roundEnd', 'one of two people is not enough');
  assert.ok(g.nextRound(room, 1).ok, 'closing it twice is harmless');
  assert.equal(g.viewFor(room, 1).seats[0].ready, true);
  assert.equal(g.viewFor(room, 1).seats[1].ready, false);
  assert.equal(g.viewFor(room, 1).seats[2].ready, true, 'computer players are always ready');
  assert.ok(g.nextRound(room, 2).ok);
  assert.notEqual(room.phase, 'roundEnd');
  assert.deepEqual(room.ready, []);
});

test('a person leaving at the end of a round does not hold the others up, and the server can force the next round', () => {
  const room = fullRoom(4);
  g.start(room, 1, seeded(3));
  room.seats[1] = { kind: 'human', id: 2, name: 'Bea' };
  room.phase = 'roundEnd';
  room.ready = [];
  g.nextRound(room, 1);
  assert.ok(g.removeHuman(room, 2).ok);
  assert.notEqual(room.phase, 'roundEnd');
  room.phase = 'roundEnd';
  assert.ok(g.forceNextRound(room).ok);
  assert.notEqual(room.phase, 'roundEnd');
  assert.equal(g.forceNextRound(room).ok, false);
});

test('leaving after the game ended keeps the final table intact until the host plays again', () => {
  const room = fullRoom(3, { length: 'short' });
  g.addHuman(room, 2, 'Bob');
  const rng = seeded(11);
  room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
  g.start(room, 1, rng);
  playOut(room, rng);
  const names = room.seats.map((s) => s.name);
  g.removeHuman(room, 2);
  assert.deepEqual(room.seats.map((s) => s.name), names);
  assert.equal(g.viewFor(room, 1).seats[1].away, true);
  assert.ok(g.playAgain(room, 1).ok);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.seats[1], null);
  assert.deepEqual(room.history, []);
});

test('the view hides everyone else\'s cards and shows the legal cards with reasons on your turn', () => {
  const room = fullRoom(5);
  g.start(room, 1, seeded(8));
  for (let seat = 0; seat < 5; seat++) if (seat !== room.dealer) { /* nominations in order below */ }
  while (room.phase === 'nominating') {
    const seat = room.turn;
    assert.ok(g.nominate(room, seat, g.botNominate(room, seat, seeded(1))).ok);
  }
  room.seats[room.turn] = { kind: 'human', id: 1, name: 'Ann' };
  room.seats[0] = { kind: 'bot', id: 'bot:9', name: 'Zed' };
  const view = g.viewFor(room, 1);
  assert.equal(view.you, room.turn);
  assert.deepEqual(view.hand, room.hands[view.you]);
  assert.equal(JSON.stringify(view).match(/"(?:[2-9]|10|[JQKA])[CDHS]"/g).length, view.hand.length * 2, 'the hand and the legal map only');
  assert.ok(view.seats.every((s) => s.cards === 7));
  assert.equal(view.round.cards, 7);
  assert.equal(view.round.trump, 'H');
  assert.deepEqual(Object.keys(view.legal), view.hand);
  assert.equal(g.viewFor(room, 99).hand.length, 0, 'a stranger sees no hand');
});

test('the computer player is always legal and respects the dealer rule across thousands of rounds', () => {
  const rng = seeded(2024);
  let rounds = 0;
  let exact = 0;
  let tries = 0;
  while (rounds < 3000) {
    const seats = 3 + Math.floor(rng() * 5);
    const room = fullRoom(seats, { length: rng() < 0.5 ? 'short' : 'full' });
    g.start(room, 1, rng);
    room.roundIndex = Math.floor(rng() * g.roundCount(room.settings));
    g.dealRound(room, rng);
    room.dealer = Math.floor(rng() * seats);
    room.turn = (room.dealer + 1) % seats;
    const cards = g.cardsThisRound(room);
    while (room.phase === 'nominating') {
      const seat = room.turn;
      const allowed = g.allowedNominations(room, seat);
      const bid = g.botNominate(room, seat, rng);
      assert.ok(allowed.includes(bid), `bid ${bid} not in ${allowed}`);
      assert.ok(g.nominate(room, seat, bid).ok);
    }
    assert.notEqual(room.nominations.reduce((a, b) => a + b, 0), cards);
    while (room.phase === 'playing') {
      if (room.trick.length === seats) {
        g.resolveTrick(room);
        continue;
      }
      const seat = room.turn;
      const card = g.botPlay(room, seat);
      assert.ok(room.hands[seat].includes(card));
      assert.ok(g.legalCards(room, seat).includes(card), `${card} is illegal for ${room.hands[seat]} on ${JSON.stringify(room.trick)}`);
      assert.ok(g.playCard(room, seat, card).ok);
    }
    for (let i = 0; i < seats; i++) {
      tries++;
      if (room.nominations[i] === room.taken[i]) exact++;
    }
    rounds++;
  }
  assert.ok(exact / tries > 0.3, `the computer players should often hit their nomination (${exact}/${tries})`);
});

test('computer players nominate sensibly: strong hands more than weak ones', () => {
  assert.ok(estimateTricks(['AH', 'KH', 'QH', 'AS', 'AD', '2C', '3C'], 'H', 4) > 3.5);
  assert.ok(estimateTricks(['2H', '3D', '4C', '5S', '6C', '7D', '3S'], 'H', 4) < 1);
  assert.ok(estimateTricks(['AC'], null, 4) > estimateTricks(['2C'], null, 4));
  assert.ok(estimateTricks(['AH', 'AS', 'AD', 'AC', 'KH', 'KS', 'KD'], null, 3) > estimateTricks(['AH', 'AS', 'AD', 'AC', 'KH', 'KS', 'KD'], null, 7));
  assert.ok(estimateTricks(['2H', '3H', '4H', '5H', '5D'], 'H', 4) > estimateTricks(['2S', '3S', '4S', '5S', '5D'], 'H', 4), 'trumps count');
});

test('a computer player plays to hit its nomination: wins while under, ducks at the number', () => {
  const room = fullRoom(3);
  g.start(room, 1, seeded(1));
  room.roundIndex = 1; // clubs
  room.phase = 'playing';
  room.hands = [['2D', 'AD', '7C'], ['5D', 'KD', '3S'], ['4H', '9D', '2S']];
  room.trick = [{ seat: 1, card: '5D' }];
  room.played = ['5D'];
  room.turn = 2;
  room.nominations = [1, 1, 0];
  room.taken = [0, 0, 0];
  assert.equal(g.botPlay(room, 2), '9D', 'at zero: play the highest card that does not win... or the lowest forced');
  room.nominations[2] = 1;
  assert.equal(g.botPlay(room, 2), '9D', 'needs a trick: the cheapest card that beats the table');
  room.turn = 0;
  room.trick = [{ seat: 2, card: '9D' }, { seat: 1, card: 'KD' }];
  room.played = ['9D', 'KD'];
  room.nominations[0] = 0;
  assert.equal(g.botPlay(room, 0), '2D', 'ducks under the king');
  room.nominations[0] = 1;
  assert.equal(g.botPlay(room, 0), 'AD', 'takes the trick with the ace');
  room.taken[0] = 1;
  assert.equal(g.botPlay(room, 0), '2D', 'already has its trick: ducks');
  room.trick = [];
  room.hands[0] = ['2D', 'AD', '7C'];
  room.nominations[0] = 1;
  room.taken[0] = 0;
  assert.equal(g.botPlay(room, 0), 'AD', 'leads a sure winner while it needs tricks');
  room.taken[0] = 1;
  assert.equal(g.botPlay(room, 0), '2D', 'leads low once it has enough');
});

test('pending actions: computers nominate, play and resolve tricks; people are waited for', () => {
  const room = fullRoom(3);
  room.seats[0] = { kind: 'human', id: 1, name: 'Ann' };
  g.start(room, 1, seeded(1));
  while (g.pendingAction(room)) g.runPending(room, seeded(3));
  assert.equal(room.phase, 'nominating');
  assert.equal(room.turn, 0, 'waiting for the person');
  assert.equal(g.pendingAction(room), null);
  g.nominate(room, 0, g.allowedNominations(room, 0)[0]);
  while (g.pendingAction(room)) g.runPending(room, seeded(3));
  assert.equal(room.phase, 'playing');
  assert.equal(room.turn, 0);
  assert.equal(g.runPending(room), null);
  const deck = new Set(fullDeck());
  assert.ok(room.hands.flat().every((c) => deck.has(c) && suitOf(c)));
});

// ---- instant win on a 7 ----

const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

/**
 * A 3-seat game at `round` (0-based, 7-card rounds only) where `holder` has the seven top trumps, so it wins every
 * trick whatever anybody plays. `bids` are the nominations; the dealer is seat 2, so seat 0 leads.
 */
function stackedRound(settings, round, { bids = [7, 0, 0], holder = 0, scores = [0, 0, 0] } = {}) {
  const room = fullRoom(3, settings);
  assert.ok(g.start(room, 1, seeded(1)).ok);
  room.roundIndex = round;
  room.dealer = 2;
  g.dealRound(room, seeded(2));
  const trump = g.trumpOf(round) ?? 'H';
  const stack = RANKS.slice(0, 7).map((r) => `${r}${trump}`);
  const rest = fullDeck().filter((c) => !stack.includes(c));
  room.hands = [0, 1, 2].map((seat) => (seat === holder ? stack : rest.splice(0, 7)));
  room.nominations = [...bids];
  room.scores = [...scores];
  room.phase = 'playing';
  room.turn = 0;
  for (let guard = 0; guard < 100 && room.phase === 'playing'; guard++) {
    if (room.trick.length === 3) assert.ok(g.resolveTrick(room).ok);
    else assert.ok(g.playCard(room, room.turn, g.legalCards(room, room.turn)[0]).ok);
  }
  return room;
}

const withPeople = (room) => {
  room.seats[1] = { kind: 'human', id: 2, name: 'Bob' };
  room.seats[2] = { kind: 'human', id: 3, name: 'Cat' };
  return room;
};

test('only the first round, and the last round when it has 7 cards, can end the game instantly', () => {
  const full = { length: 'full' };
  const short = { length: 'short' };
  assert.deepEqual(Array.from({ length: 14 }, (_, i) => g.isInstantWinRound(full, i)), [true, ...Array(12).fill(false), true]);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => g.isInstantWinRound(short, i)), [true, ...Array(6).fill(false)], 'the last short round has 1 card');
  assert.equal(g.DEFAULT_SETTINGS.instantWin, true);
});

test('nominating 7 and winning all 7 tricks in the first round wins the whole game at once', () => {
  const room = stackedRound({}, 0);
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.winners, [0]);
  assert.equal(room.instantWin, 0);
  assert.equal(room.history.length, 1, 'the round is still in the history');
  assert.equal(room.history[0].instantWin, 0);
  assert.deepEqual(room.history[0].points, [17, 10, 10]);
  assert.deepEqual(room.scores, [17, 10, 10]);
  assert.equal(g.nextRound(room, 1).ok, false, 'no more rounds');
  const view = g.viewFor(room, 1);
  assert.equal(view.instantWin, 0);
  assert.equal(view.rounds[0].instantWin, 0);
  assert.deepEqual(view.winners, [0]);
});

test('the same in the last round of a full game, whatever the totals; the others are ranked by theirs', () => {
  const room = stackedRound({}, 13, { scores: [50, 200, 120] });
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.winners, [0], 'the instant winner is the only winner despite the lowest total');
  assert.deepEqual(room.scores, [67, 210, 130]);
  const stats = g.statsPlayers(withPeople(room));
  assert.deepEqual(stats.map((s) => [s.userId, s.outcome, s.placement]), [[1, 'win', 1], [2, 'loss', 2], [3, 'loss', 3]]);
  assert.deepEqual(stats.map((s) => s.extras.instantWins), [1, 0, 0]);
  assert.deepEqual(stats.map((s) => s.extras.roundsPlayed), [1, 1, 1]);
});

test('tied others share a place below the instant winner', () => {
  const room = withPeople(stackedRound({}, 13, { scores: [0, 100, 100] }));
  assert.deepEqual(g.statsPlayers(room).map((s) => s.placement), [1, 2, 2]);
});

test('nominating 7 in the short game works in round 1 too', () => {
  const room = stackedRound({ length: 'short' }, 0);
  assert.equal(room.phase, 'finished');
  assert.equal(room.instantWin, 0);
});

test('with the option off a 7 won in the first or last round scores normally', () => {
  const first = stackedRound({ instantWin: false }, 0);
  assert.equal(first.phase, 'roundEnd');
  assert.equal(first.winners, null);
  assert.equal(first.instantWin, null);
  assert.deepEqual(first.scores, [17, 10, 10]);
  const last = stackedRound({ instantWin: false }, 13, { scores: [50, 200, 120] });
  assert.equal(last.phase, 'finished');
  assert.deepEqual(last.winners, [1], 'ordinary scoring decides it');
  assert.equal(last.instantWin, null);
  assert.equal(g.statsPlayers(last)[0].extras.instantWins, 0);
});

test('a 7 that fails scores normally, and nominating less than 7 never triggers it', () => {
  const failed = stackedRound({}, 0, { bids: [7, 0, 0], holder: 1 });
  assert.equal(failed.phase, 'roundEnd');
  assert.deepEqual(failed.history[0].taken, [0, 7, 0]);
  assert.deepEqual(failed.history[0].points, [0, 7, 10]);
  assert.equal(failed.instantWin, null);
  const modest = stackedRound({}, 0, { bids: [6, 0, 0] });
  assert.equal(modest.phase, 'roundEnd', 'taking 7 after nominating 6 is no instant win');
  assert.deepEqual(modest.history[0].points, [7, 10, 10]);
  const failedLast = stackedRound({}, 13, { bids: [7, 0, 0], holder: 1, scores: [10, 10, 10] });
  assert.equal(failedLast.phase, 'finished');
  assert.deepEqual(failedLast.winners, [2], 'normal scoring: the 0-nominator who got 0 scores 10');
});

test('only one seat can take all 7 tricks, so only one can win instantly', () => {
  const room = stackedRound({}, 0, { bids: [7, 7, 0] });
  assert.equal(room.instantWin, 0);
  assert.deepEqual(room.winners, [0]);
});

test('the instant win option is a host setting, on by default, switched off in the lobby, and refused if not a boolean', () => {
  const room = fullRoom(3);
  assert.equal(room.settings.instantWin, true);
  assert.equal(g.setSettings(room, 2, { instantWin: false }).ok, false, 'only the host');
  assert.equal(g.setSettings(room, 1, { instantWin: 'no' }).ok, false);
  assert.ok(g.setSettings(room, 1, { instantWin: false }).ok);
  assert.equal(room.settings.instantWin, false);
  assert.ok(g.setSettings(room, 1, { seats: 4 }).ok);
  assert.equal(room.settings.instantWin, false, 'other changes keep it');
  assert.equal(g.instantWinOn({ seats: 4, length: 'full', missPoints: true }), true, 'a game saved before the option existed has it on');
});

test('play again clears the instant win', () => {
  const room = stackedRound({}, 0);
  assert.ok(g.playAgain(room, 1).ok);
  assert.equal(room.instantWin, null);
  assert.equal(room.phase, 'lobby');
});

test('computer players nominate 7 only with a hand that can plausibly take every trick, and only when it is on offer', () => {
  const run = (cards) => cards.split(' ');
  const strong = run('AH KH QH JH 10H 9H 3S');
  const withAces = run('AH KH QH JH 10H AS AD');
  const patchy = run('AH KH QH JH 10H 3S 4D');
  const gappy = run('AH KH QH JH 9H 8H 7H');
  assert.equal(canTakeAllSeven(strong, 'H'), true);
  assert.equal(canTakeAllSeven(withAces, 'H'), true);
  assert.equal(canTakeAllSeven(patchy, 'H'), false);
  assert.equal(canTakeAllSeven(gappy, 'H'), false);
  assert.equal(canTakeAllSeven(strong, null), false, 'no trump suit');
  assert.equal(canTakeAllSeven(strong, 'S'), false);
  assert.equal(canTakeAllSeven(strong.slice(0, 5), 'H'), false, 'only for 7-card hands');
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  const nominate = (hand, extra) => chooseNomination({ hand, trump: 'H', players: 4, allowed: all, rng: () => 0.5, ...extra });
  assert.equal(nominate(strong, { instantWin: true }), 7);
  assert.ok(nominate(strong, { instantWin: false }) < 7, 'the old judgement when the rule is off or the round does not count');
  assert.ok(nominate(patchy, { instantWin: true }) < 7);
  assert.notEqual(nominate(strong, { instantWin: true, allowed: all.filter((n) => n !== 7) }), 7, 'the dealer may not be allowed 7');
});

test('a computer player in a qualifying round nominates 7 from a stacked hand, and not when the rule is off or the round does not count', () => {
  const room = fullRoom(3);
  assert.ok(g.start(room, 1, seeded(1)).ok);
  room.roundIndex = 0;
  room.dealer = 2;
  g.dealRound(room, seeded(2));
  const stack = RANKS.slice(0, 7).map((r) => `${r}H`);
  const rest = fullDeck().filter((c) => !stack.includes(c));
  room.hands = [stack, rest.splice(0, 7), rest.splice(0, 7)];
  assert.equal(g.botNominate(room, 0, seeded(3)), 7);
  room.settings.instantWin = false;
  assert.ok(g.botNominate(room, 0, seeded(3)) < 7);
  room.settings.instantWin = true;
  room.roundIndex = 3;
  room.hands = [stack.slice(0, 4), rest.splice(0, 4), rest.splice(0, 4)];
  assert.ok(g.botNominate(room, 0, seeded(3)) <= 4, 'only 4 cards that round, and it does not qualify');
});

test('whole computer games with the rule on and off stay consistent, and any instant win is a genuine 7 for 7', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const instantWin = seed % 2 === 0;
    const room = fullRoom(3 + (seed % 5), { instantWin, length: seed % 3 ? 'full' : 'short' });
    const rng = seeded(seed);
    assert.ok(g.start(room, 1, rng).ok);
    playOut(room, rng);
    if (room.instantWin === null) assert.equal(room.history.length, g.roundCount(room.settings));
    else {
      assert.ok(instantWin);
      const last = room.history.at(-1);
      assert.equal(last.bids[room.instantWin], 7);
      assert.equal(last.taken[room.instantWin], 7);
      assert.ok(g.isInstantWinRound(room.settings, room.history.length - 1));
      assert.deepEqual(room.winners, [room.instantWin]);
    }
  }
});

test('the tally counts a nomination of seven that was made', () => {
  const room = fullRoom(3, {});
  g.start(room, 1, seeded(1));
  room.roundIndex = 0;
  room.dealer = 0;
  g.dealRound(room, seeded(2));
  assert.equal(g.cardsThisRound(room), 7);
  room.nominations = [7, 0, 0];
  room.taken = [6, 0, 0];
  room.tricksPlayed = 6;
  room.trick = [{ seat: 0, card: 'AH' }, { seat: 1, card: '2H' }, { seat: 2, card: '3H' }];
  room.phase = 'playing';
  assert.equal(g.resolveTrick(room).roundOver, true);
  assert.deepEqual(room.tally.map((t) => t.sevenMade), [1, 0, 0]);
  assert.equal(g.statsPlayers(room)[0].extras.sevenMade, 1);
});
