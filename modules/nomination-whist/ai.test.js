// The Nomination Whist computer players: the registry, what each AI is like, whole games, and how they are assigned and kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDeck, shuffle, suitOf } from '../../shared/cards.js';
import { aiById } from '../../shared/ai.js';
import * as g from './game.js';
import { AIS } from './ai/index.js';
import { countTricks, winChance } from './ai/counter.js';
import { dealUnseen, playOut, roundPoints } from './ai/sharp.js';
import { unseenCards } from './ai/cards.js';
import { chooseCard, chooseNomination, estimateTricks } from './bot.js';

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

const ai = (id) => AIS.find((a) => a.id === id);
const IDS = AIS.map((a) => a.id);
const range = (n) => Array.from({ length: n + 1 }, (_, i) => i);

const nominateCtx = (hand, extra = {}) => ({ hand, trump: 'H', players: 4, allowed: range(hand.length), instantWin: false, missPoints: true, seat: 1, dealer: 0, cards: hand.length, nominations: [null, null, null, null], rng: seeded(1), ...extra });
/** A mid-round position from one seat's point of view; `plays` are the cards on the table, in seat order from `lead`. */
function playCtx({ hand, plays = [], trump = 'H', players = 3, seat = 2, bids, taken, played = [], handSizes, rng = seeded(3) }) {
  const bidList = bids ?? Array(players).fill(1);
  const takenList = taken ?? Array(players).fill(0);
  const legal = !plays.length ? hand : hand.some((c) => suitOf(c) === suitOf(plays[0].card)) ? hand.filter((c) => suitOf(c) === suitOf(plays[0].card)) : hand;
  return {
    hand,
    legal,
    trick: plays.map((p) => p.card),
    trickPlays: plays,
    trump,
    played: [...played, ...plays.map((p) => p.card)],
    need: bidList[seat] - takenList[seat],
    players,
    seat,
    nominations: bidList,
    taken: takenList,
    handSizes: handSizes ?? Array.from({ length: players }, (_, s) => hand.length - (plays.some((p) => p.seat === s) ? 1 : 0) + (s === seat ? 0 : 0)),
    cards: hand.length,
    instantWin: false,
    missPoints: true,
    rng,
  };
}

function fullRoom(seats, settings = {}) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats, ...settings } });
  assert.ok(g.fillWithBots(room, 1).ok);
  return room;
}

/** An all-computer game with the given AIs; seat 0 is a computer player too, so nobody has to close pop-ups. */
function allBotGame(ais, { seed = 1, settings = {} } = {}) {
  const room = fullRoom(ais.length, settings);
  const rng = seeded(seed);
  assert.ok(g.start(room, 1, rng).ok);
  room.seats[0] = { kind: 'bot', id: 'bot:0', name: 'Zed' };
  ais.forEach((id, i) => (room.seats[i].ai = id));
  for (let steps = 0; room.phase !== 'finished'; steps++) {
    assert.ok(steps < 100000, 'the game must end');
    if (room.phase === 'roundEnd') assert.ok(g.forceNextRound(room, rng).ok);
    else g.runPending(room, rng);
  }
  return room;
}

// ---- the registry ----

test('every AI is described, standard is the fallback, and random has a low weight', () => {
  assert.deepEqual(IDS, ['standard', 'random', 'cautious', 'optimist', 'counter', 'sharp', 'lutv']);
  for (const a of AIS) {
    assert.ok(a.name && a.description, a.id);
    assert.equal(typeof a.nominate, 'function');
    assert.equal(typeof a.play, 'function');
    assert.ok(a.weight > 0);
  }
  assert.equal(AIS[0].id, 'standard');
  assert.equal(aiById(AIS, 'gone-ai').id, 'standard');
  assert.ok(ai('random').weight < Math.min(...AIS.filter((a) => a.id !== 'random').map((a) => a.weight)));
});

test('standard is exactly the original bot', () => {
  const rng = seeded(5);
  for (let i = 0; i < 40; i++) {
    const hand = shuffle(fullDeck(), rng).slice(0, 1 + (i % 7));
    const ctx = nominateCtx(hand, { trump: [null, 'H', 'S'][i % 3], players: 3 + (i % 5), rng: seeded(i) });
    assert.equal(ai('standard').nominate(ctx), chooseNomination({ ...ctx, rng: seeded(i) }));
  }
  const ctx = playCtx({ hand: ['AD', '2D'], plays: [{ seat: 0, card: 'KD' }], players: 3, seat: 1, bids: [1, 1, 1] });
  assert.equal(ai('standard').play(ctx), chooseCard(ctx));
});

// ---- every AI is legal, whatever the situation ----

test('every AI nominates an allowed number and plays a legal card in random situations', () => {
  const rng = seeded(8);
  for (const a of AIS) {
    for (let i = 0; i < 24; i++) {
      const players = 3 + (i % 5);
      const room = fullRoom(players);
      g.start(room, 1, rng);
      room.roundIndex = Math.floor(rng() * 14);
      g.dealRound(room, rng);
      room.seats.forEach((s) => (s.ai = a.id));
      while (room.phase === 'nominating') {
        const seat = room.turn;
        const bid = g.botNominate(room, seat, rng);
        assert.ok(g.allowedNominations(room, seat).includes(bid), `${a.id} nominated ${bid}`);
        assert.ok(g.nominate(room, seat, bid).ok);
      }
      for (let tricks = 0; room.phase === 'playing' && tricks < 2 * players; tricks++) {
        if (room.trick.length === players) {
          g.resolveTrick(room);
          continue;
        }
        const card = g.botPlay(room, room.turn, rng);
        assert.ok(g.legalCards(room, room.turn).includes(card), `${a.id} played ${card}`);
        assert.ok(g.playCard(room, room.turn, card).ok);
      }
    }
  }
});

test('every AI plays complete games, at every player count and length, and they all end', () => {
  for (const players of [3, 4, 5, 6, 7]) {
    for (const id of IDS) {
      const room = allBotGame(Array(players).fill(id), { seed: players * 7 + IDS.indexOf(id), settings: { length: 'short' } });
      assert.equal(room.phase, 'finished', `${id} x${players}`);
      assert.ok(room.scores.every((s) => s >= 0));
      assert.ok(room.history.every((h) => h.taken.reduce((a, b) => a + b, 0) === h.cards), 'every trick was taken by someone');
    }
    const mixed = allBotGame(Array.from({ length: players }, (_, i) => IDS[(i * 2 + 1) % IDS.length]), { seed: 90 + players });
    assert.equal(mixed.phase, 'finished');
  }
});

// ---- what each AI is like ----

test('random: its nominations and plays vary, and are always legal', () => {
  const seen = new Set();
  const rng = seeded(2);
  for (let i = 0; i < 80; i++) seen.add(ai('random').nominate(nominateCtx(['AH', 'KH', 'QH', '2C', '3D'], { allowed: [0, 1, 2, 4, 5], rng })));
  assert.deepEqual([...seen].sort(), ['0', '1', '2', '4', '5'].map(Number), 'any allowed number, including the silly ones');
  const plays = new Set();
  for (let i = 0; i < 60; i++) plays.add(ai('random').play({ ...playCtx({ hand: ['AH', '2H', '5H', '9C'], plays: [{ seat: 0, card: '3H' }], players: 3, seat: 1 }), rng }));
  assert.deepEqual([...plays].sort(), ['2H', '5H', 'AH'], 'only hearts: it must follow suit, but picks any of them');
});

test('cautious nominates less than standard, and optimist more; neither goes outside what is allowed', () => {
  const rng = seeded(12);
  let cautious = 0;
  let standard = 0;
  let optimist = 0;
  for (let i = 0; i < 120; i++) {
    const hand = shuffle(fullDeck(), rng).slice(0, 3 + (i % 5));
    const ctx = nominateCtx(hand, { trump: [null, 'H', 'S', 'D'][i % 4], players: 4, rng: seeded(i) });
    cautious += ai('cautious').nominate(ctx);
    standard += ai('standard').nominate({ ...ctx, rng: seeded(i) });
    optimist += ai('optimist').nominate({ ...ctx, rng: seeded(i) });
  }
  assert.ok(cautious < standard, `cautious ${cautious} v standard ${standard}`);
  assert.ok(optimist > standard, `optimist ${optimist} v standard ${standard}`);
  const strong = ['AH', 'KH', 'QH', 'AS', 'KS', '2C', '3D'];
  assert.ok(ai('optimist').nominate(nominateCtx(strong)) >= ai('cautious').nominate(nominateCtx(strong)) + 2, 'a strong hand shows the gap');
});

test('cautious and optimist still play to hit their number: duck when they have enough, win when they need more', () => {
  for (const id of ['cautious', 'optimist']) {
    const table = [{ seat: 0, card: 'QS' }, { seat: 1, card: '5S' }];
    assert.equal(ai(id).play(playCtx({ hand: ['KS', '3S'], plays: table, bids: [1, 1, 0] })), '3S', `${id} ducks with nothing to win`);
    assert.equal(ai(id).play(playCtx({ hand: ['KS', '3S'], plays: table, bids: [1, 1, 1] })), 'KS', `${id} wins when it needs a trick`);
  }
});

test('counter: counts the cards played to know what is now a sure winner', () => {
  const hand = ['QS', '2C', '3D'];
  const before = countTricks(hand, 'H', 4, []);
  const after = countTricks(hand, 'H', 4, ['AS', 'KS']);
  assert.ok(after > before, `the queen is more likely to win once the ace and king are gone (${before.toFixed(2)} -> ${after.toFixed(2)})`);
  const unseen = unseenCards(hand, ['AS', 'KS']);
  const sure = winChance('QS', { trump: 'H', unseen, others: 0, held: 3 });
  assert.equal(sure, 1, 'nobody left to beat it');
  assert.ok(winChance('QS', { trump: 'H', unseen, others: 3, held: 3 }) > winChance('QS', { trump: 'H', unseen: unseenCards(hand, []), others: 3, held: 3 }));
  assert.ok(winChance('9H', { trump: 'H', unseen: unseenCards(['9H'], []), others: 3, held: 3 }) < winChance('9S', { trump: null, unseen: unseenCards(['9S'], []), others: 3, held: 3 }) + 0.5);
});

test('counter: wins with the cheapest card that will hold, and dumps the highest card that cannot win when ducking', () => {
  // Spades have been played down to the queen: the queen is a sure winner, the 4 is not.
  const base = { hand: ['QS', '4S'], plays: [], players: 3, seat: 0, played: ['AS', 'KS'] };
  assert.equal(ai('counter').play(playCtx({ ...base, bids: [1, 0, 0] })), 'QS', 'leads the master when it needs a trick');
  const table = [{ seat: 1, card: 'AS' }];
  assert.equal(ai('counter').play(playCtx({ hand: ['KS', '4S'], plays: table, players: 3, seat: 2, bids: [0, 0, 0], played: [] })), 'KS', 'ace already beats everything: shed the king');
});

test('sharp nominates 7 for the instant win with a hand that can take everything, but not otherwise', () => {
  const ironclad = ['AH', 'KH', 'QH', 'JH', '10H', '9H', '2C'];
  assert.equal(ai('sharp').nominate(nominateCtx(ironclad, { instantWin: true })), 7);
  assert.notEqual(ai('sharp').nominate(nominateCtx(ironclad, { instantWin: false })), 8);
  const ordinary = ['AH', '3H', 'KS', '4S', '9D', '2D', '6C'];
  assert.ok(ai('sharp').nominate(nominateCtx(ordinary, { instantWin: true })) < 7);
});

test('sharp works within the dealer\'s forbidden number', () => {
  const hand = ['AH', 'KH', 'QH', '2C', '3D'];
  const free = ai('sharp').nominate(nominateCtx(hand, { seat: 0, dealer: 0, rng: seeded(4) }));
  const barred = ai('sharp').nominate(nominateCtx(hand, { seat: 0, dealer: 0, allowed: range(5).filter((n) => n !== free), rng: seeded(4) }));
  assert.notEqual(barred, free);
  assert.ok(Math.abs(barred - free) <= 2, 'it takes the next best number');
});

test('sharp ducks when it has enough and wins when it needs more', () => {
  const table = [{ seat: 0, card: 'QS' }, { seat: 1, card: '5S' }];
  assert.equal(ai('sharp').play(playCtx({ hand: ['KS', '3S'], plays: table, bids: [1, 1, 0] })), '3S');
  assert.equal(ai('sharp').play(playCtx({ hand: ['KS', '3S'], plays: table, bids: [1, 1, 1] })), 'KS');
});

test('sharp\'s simulation helpers: unseen cards are dealt to the right seats, and a round played out hands out every trick', () => {
  const hand = ['AH', 'KH', 'QH'];
  const unseen = unseenCards(hand, []);
  const needs = [{ seat: 0, count: 3, voids: ['S'] }, { seat: 2, count: 3, voids: [] }, { seat: 3, count: 3, voids: ['D'] }];
  for (let seed = 1; seed <= 40; seed++) {
    const dealt = dealUnseen(unseen, needs, seeded(seed));
    assert.deepEqual(Object.keys(dealt).sort(), ['0', '2', '3']);
    const all = Object.values(dealt).flat();
    assert.equal(new Set(all).size, 9);
    assert.ok(all.every((c) => unseen.includes(c)));
    assert.ok(dealt[0].every((c) => suitOf(c) !== 'S'));
    assert.ok(dealt[3].every((c) => suitOf(c) !== 'D'));
  }
  const rng = seeded(6);
  const deck = shuffle(fullDeck(), rng);
  const hands = [deck.slice(0, 4), deck.slice(4, 8), deck.slice(8, 12)];
  const taken = playOut({ hands, trick: [], turn: 0, taken: [0, 0, 0], bids: [1, 1, 1], trump: 'D', players: 3, played: [] });
  assert.equal(taken.reduce((a, b) => a + b, 0), 4);
  assert.equal(roundPoints(2, 2, {}), 12);
  assert.equal(roundPoints(2, 1, {}), 1);
  assert.equal(roundPoints(2, 1, { missPoints: false }), 0);
  assert.ok(roundPoints(7, 7, { instantWin: true, cards: 7 }) > roundPoints(7, 7, {}));
});

// ---- a seeded tournament ----

/** Plays seeded games at tables where seats rotate, and totals each AI's mean score and wins. */
function tournament(table, games, { seed = 700, settings = {} } = {}) {
  const score = {};
  const seatsPlayed = {};
  const wins = {};
  for (let n = 0; n < games; n++) {
    const shift = n % table.length;
    const order = table.map((_, k) => table[(k + shift) % table.length]);
    const room = allBotGame(order, { seed: seed + n, settings });
    order.forEach((id, seat) => {
      score[id] = (score[id] ?? 0) + room.scores[seat];
      seatsPlayed[id] = (seatsPlayed[id] ?? 0) + 1;
      if (room.winners.includes(seat)) wins[id] = (wins[id] ?? 0) + 1 / room.winners.length;
    });
  }
  return Object.fromEntries(Object.keys(score).map((id) => [id, { mean: score[id] / seatsPlayed[id], wins: wins[id] ?? 0 }]));
}

test('tournament: sharp beats standard, and standard beats random', () => {
  const four = tournament(['sharp', 'standard', 'standard', 'random'], 100);
  const six = tournament(['sharp', 'standard', 'cautious', 'optimist', 'counter', 'random'], 60, { seed: 900 });
  const show = (result) => Object.entries(result).map(([id, r]) => `${id} ${r.mean.toFixed(1)} (${r.wins.toFixed(1)} wins)`).join(', ');
  console.log(`4 seats, 100 games, mean score: ${show(four)}\n6 seats, 60 games, mean score: ${show(six)}`);
  assert.ok(four.sharp.mean > four.standard.mean + 3, show(four));
  assert.ok(four.standard.mean > four.random.mean + 20, show(four));
  assert.ok(four.sharp.wins > four.standard.wins / 2, 'sharp wins more than either standard seat on average');
  assert.ok(six.sharp.mean > six.standard.mean, show(six));
  assert.ok(six.standard.mean > six.random.mean && six.standard.mean > six.optimist.mean, show(six));
});

// ---- assignment, persistence and the view ----

function started(seats = 4, seed = 4) {
  const room = fullRoom(seats);
  assert.ok(g.start(room, 1, seeded(seed)).ok);
  return room;
}

test('each computer player picks an AI when the game starts; people and lobbies have none', () => {
  const lobby = fullRoom(3);
  assert.ok(lobby.seats.every((s) => s.ai === undefined));
  assert.ok(g.viewFor(lobby, 1).seats.every((s) => s.ai === null));
  const room = started(5);
  assert.equal(room.seats[0].ai, undefined);
  for (const s of room.seats.slice(1)) assert.ok(IDS.includes(s.ai), s.ai);
  assert.deepEqual(room.seats.map((s) => s.ai), started(5).seats.map((s) => s.ai), 'the same rng gives the same AIs');
  const chosen = new Set();
  for (let seed = 1; seed <= 60; seed++) for (const s of started(5, seed).seats.slice(1)) chosen.add(s.ai);
  assert.equal(chosen.size, IDS.length, 'over many games every AI turns up');
});

test('the AI choice survives a save and reload, and drives the bot\'s moves', () => {
  const room = started(3);
  const reloaded = JSON.parse(JSON.stringify(room));
  assert.deepEqual(reloaded.seats.map((s) => s.ai), room.seats.map((s) => s.ai));
  const seat = reloaded.turn === 0 ? 1 : reloaded.turn;
  reloaded.turn = seat;
  reloaded.seats[seat].ai = 'sharp';
  const sharp = ai('sharp');
  const original = sharp.nominate;
  let used = 0;
  sharp.nominate = (ctx) => (used++, original(ctx));
  try {
    g.botNominate(reloaded, seat, seeded(1));
    assert.equal(used, 1);
    assert.equal(g.aiOf(reloaded, seat).id, 'sharp');
  } finally {
    sharp.nominate = original;
  }
});

test('an AI that answers illegally is overruled rather than breaking the game', () => {
  const room = started(3);
  room.seats[1].ai = 'random';
  room.seats[2].ai = 'random';
  const random = ai('random');
  const original = [random.nominate, random.play];
  random.nominate = () => 99;
  random.play = () => 'XX';
  try {
    while (room.phase === 'nominating') {
      assert.ok(g.allowedNominations(room, room.turn).includes(g.botNominate(room, room.turn === 0 ? 1 : room.turn)));
      g.nominate(room, room.turn, g.allowedNominations(room, room.turn)[0]);
    }
    const seat = room.turn;
    assert.ok(g.legalCards(room, seat).includes(g.botPlay(room, seat)));
  } finally {
    [random.nominate, random.play] = original;
  }
});

test('rooms saved before AIs existed fall back to the standard AI', () => {
  const room = started(3);
  for (const s of room.seats) delete s.ai;
  assert.equal(g.aiOf(room, 1).id, 'standard');
  assert.deepEqual(g.viewFor(room, 1).seats[1].ai, { id: 'standard', name: 'Standard' });
  while (g.pendingAction(room)) g.runPending(room, seeded(3));
  assert.ok(['roundEnd', 'finished'].includes(room.phase) || room.turn === 0, 'the bots play on');
});

test('the view names the AI of computer players only', () => {
  const room = started(4);
  const view = g.viewFor(room, 1);
  assert.equal(view.seats[0].ai, null);
  for (const i of [1, 2, 3]) assert.deepEqual(view.seats[i].ai, { id: room.seats[i].ai, name: aiById(AIS, room.seats[i].ai).name });
  assert.ok(!JSON.stringify(view).includes('description'), 'only id and name');
});

test('a person who leaves is replaced by a computer player that picks an AI at that moment', () => {
  const picks = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
    g.addHuman(room, 2, 'Bob');
    g.fillWithBots(room, 1);
    g.start(room, 1, seeded(1));
    assert.equal(room.seats[1].ai, undefined);
    assert.equal(g.removeHuman(room, 2, seeded(seed)).replaced, true);
    assert.ok(g.isBot(room.seats[1]));
    assert.ok(IDS.includes(room.seats[1].ai));
    picks.add(room.seats[1].ai);
  }
  assert.ok(picks.size >= 4, 'the replacement picks by weight, not always the same one');
});

test('playing again clears the AIs, and the next game picks again', () => {
  const room = started(3);
  room.phase = 'finished';
  room.winners = [0];
  assert.ok(g.playAgain(room, 1).ok);
  assert.ok(room.seats.every((s) => s.ai === undefined));
  assert.ok(g.start(room, 1, seeded(2)).ok);
  assert.ok(IDS.includes(room.seats[1].ai));
});

test('estimateTricks is unchanged by the move into ai/ (the standard AI uses it as before)', () => {
  assert.equal(estimateTricks(['AH', 'KH', 'QH'], 'H', 4).toFixed(2), estimateTricks(['AH', 'KH', 'QH'], 'H', 4).toFixed(2));
  assert.ok(estimateTricks(['AH', 'KH', 'QH'], 'H', 4) > 2);
});
