// The cribbage computer players: the registry, what each AI is like, whole games, and how they are assigned and kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDeck, shuffle } from '../../shared/cards.js';
import { aiById } from '../../shared/ai.js';
import * as game from './game.js';
import { AIS } from './ai/index.js';
import { peggingValues } from './ai/pegger.js';
import { pipValue } from './scoring.js';
import { chooseDiscard, choosePlay } from './bot.js';

function seeded(seed = 1) {
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
const discardCtx = (hand, extra = {}) => ({ hand, discardCount: hand.length === 6 ? 2 : 1, isDealer: false, players: 2, scores: [0, 0], me: 0, target: 121, rng: seeded(1), ...extra });
const playCtx = (hand, sequence = [], extra = {}) => ({
  hand,
  count: sequence.reduce((sum, c) => sum + pipValue(c), 0),
  sequence,
  played: sequence,
  starter: '2D',
  players: 2,
  me: 0,
  isDealer: false,
  cardsLeft: [hand.length, 4],
  scores: [0, 0],
  target: 121,
  rng: seeded(2),
  ...extra,
});

/** Every seat is a computer player; `ais` names each seat's AI. Returns the finished room. */
function allBotGame(ais, { seed = 1, target = 61 } = {}) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'Alex', target, seats: ais.length });
  game.fillBots(room, 1);
  const rng = seeded(seed);
  assert.ok(game.start(room, 1, rng).ok);
  room.seats[0].bot = true;
  ais.forEach((id, i) => (room.seats[i].ai = id));
  for (let steps = 0; room.phase !== 'finished'; steps++) {
    assert.ok(steps < 20000, 'the game must end');
    if (room.phase === 'show') {
      room.seats.forEach((s) => (s.ready = true));
      game.ready(room, 0, rng);
      continue;
    }
    const result = game.botMove(room, rng);
    assert.ok(result.ok, result.error);
  }
  return room;
}

// ---- the registry ----

test('every AI is described, standard is the fallback, and random has a low weight', () => {
  assert.deepEqual(IDS, ['standard', 'random', 'greedy', 'balanced', 'pegger', 'sharp']);
  for (const a of AIS) {
    assert.ok(a.name && a.description, a.id);
    assert.equal(typeof a.discard, 'function');
    assert.equal(typeof a.play, 'function');
    assert.ok(a.weight > 0);
  }
  assert.equal(AIS[0].id, 'standard');
  assert.equal(aiById(AIS, 'gone-ai').id, 'standard');
  assert.ok(ai('random').weight < Math.min(...AIS.filter((a) => a.id !== 'random').map((a) => a.weight)));
});

test('standard is exactly the original bot', () => {
  const rng = seeded(5);
  for (let i = 0; i < 30; i++) {
    const deck = shuffle(fullDeck(), rng);
    const hand = deck.slice(0, i % 2 ? 6 : 5);
    const ctx = discardCtx(hand, { isDealer: i % 3 === 0 });
    assert.deepEqual(ai('standard').discard(ctx), chooseDiscard(hand, ctx));
    const sequence = deck.slice(10, 10 + (i % 3));
    const pctx = playCtx(hand.slice(0, 4), sequence);
    assert.equal(ai('standard').play(pctx), choosePlay(pctx.hand, pctx));
  }
});

// ---- every AI is legal, whatever the situation ----

test('every AI discards and plays legal cards in random situations', () => {
  const rng = seeded(9);
  for (const a of AIS) {
    for (let i = 0; i < 25; i++) {
      const deck = shuffle(fullDeck(), rng);
      const hand = deck.slice(0, i % 2 ? 6 : 5);
      const need = hand.length === 6 ? 2 : 1;
      const cards = a.discard(discardCtx(hand, { isDealer: i % 2 === 0, players: hand.length === 6 ? 2 : 3, rng }));
      assert.equal(cards.length, need, a.id);
      assert.equal(new Set(cards).size, need);
      assert.ok(cards.every((c) => hand.includes(c)));
      const sequence = deck.slice(10, 10 + Math.floor(rng() * 5));
      const own = deck.slice(20, 20 + 1 + Math.floor(rng() * 4));
      const ctx = playCtx(own, sequence, { rng });
      if (ctx.count > 31) continue;
      const card = a.play(ctx);
      const legal = own.filter((c) => ctx.count + pipValue(c) <= 31);
      if (legal.length) assert.ok(legal.includes(card), `${a.id} played ${card}`);
      else assert.equal(card, null);
    }
  }
});

test('every AI plays complete games, at every player count, and they all end', () => {
  for (const players of [2, 3, 4]) {
    for (const id of IDS) {
      const room = allBotGame(Array(players).fill(id), { seed: players * 10 + IDS.indexOf(id) });
      assert.equal(room.phase, 'finished');
      assert.ok(room.seats[room.winner].score >= room.target, `${id} x${players}`);
    }
    const mixed = allBotGame(Array.from({ length: players }, (_, i) => IDS[(i * 2 + 1) % IDS.length]), { seed: 77 + players, target: 121 });
    assert.equal(mixed.phase, 'finished');
  }
});

// ---- what each AI is like ----

test('random: its discards and plays vary, and it only plays what is legal', () => {
  const hand = ['AH', '5D', '5C', 'JS', '9H', 'KD'];
  const seen = new Set();
  const rng = seeded(3);
  for (let i = 0; i < 80; i++) seen.add(ai('random').discard(discardCtx(hand, { rng })).sort().join());
  assert.ok(seen.size >= 10, `only ${seen.size} different discards out of 15`);
  const plays = new Set();
  for (let i = 0; i < 60; i++) plays.add(ai('random').play(playCtx(['KD', '9H', '4S', '2C'], ['10H', '5S', 'QC'], { rng })));
  assert.deepEqual([...plays].sort(), ['2C', '4S'], 'at a count of 25 only the 4 and the 2 fit, and both get played');
  assert.equal(ai('random').play(playCtx(['KD'], ['10H', '5S', 'QC'])), null);
});

test('greedy: keeps the best-scoring hand even when that feeds an opponent\'s crib', () => {
  const hand = ['QH', '2S', '3D', 'AC', '9D', '5H'];
  const greedy = ai('greedy').discard(discardCtx(hand, { isDealer: false }));
  assert.deepEqual([...greedy].sort(), ['5H', 'QH'], 'throws a five and a ten to the opponent');
  assert.equal(ai('greedy').play(playCtx(['5D', '4C'])), '5D', 'with nothing to score it plays the highest card, ignoring the risk');
  assert.equal(ai('greedy').play(playCtx(['4H', '9S'], ['6D'])), '9S', 'takes the fifteen');
});

test('balanced: starves an opponent\'s crib but feeds its own', () => {
  const hand = ['QH', '2S', '3D', 'AC', '9D', '5H'];
  const asPone = ai('balanced').discard(discardCtx(hand, { isDealer: false }));
  assert.ok(!asPone.includes('5H'), 'keeps the five rather than giving it away');
  const pair = ['QS', 'JD', 'QH', '2D', '4D', '9C'];
  const asDealer = ai('balanced').discard(discardCtx(pair, { isDealer: true }));
  assert.deepEqual([...asDealer].sort(), ['QH', 'QS'], 'a pair of queens into its own crib');
  assert.ok(!ai('balanced').discard(discardCtx(pair, { isDealer: false })).every((c) => c.startsWith('Q')), 'but not into an opponent\'s');
});

test('pegger: counts the cards out and does not set up easy scores', () => {
  assert.equal(ai('pegger').play(playCtx(['5D', '4C'])), '4C', 'does not lead a five into a crowd of tens');
  // Over many positions the pegger hands back fewer points than the greedy player does.
  const rng = seeded(31);
  let pegger = 0;
  let greedy = 0;
  for (let i = 0; i < 150; i++) {
    const deck = shuffle(fullDeck(), rng);
    const sequence = deck.slice(10, 10 + Math.floor(rng() * 3));
    const ctx = playCtx(deck.slice(0, 3), sequence, { cardsLeft: [3, 3] });
    if (ctx.count > 20) continue;
    const reply = (card) => peggingValues(ctx).find((v) => v.card === card).reply;
    pegger += reply(ai('pegger').play(ctx));
    greedy += reply(ai('greedy').play(ctx));
  }
  assert.ok(pegger < greedy, `pegger gives back ${pegger.toFixed(1)}, greedy ${greedy.toFixed(1)}`);
});

test('pegger: goes for fifteen and thirty-one when they are on offer', () => {
  assert.equal(ai('pegger').play(playCtx(['5D', '2C'], ['10H'])), '5D', 'fifteen');
  assert.equal(ai('pegger').play(playCtx(['6D', '2C', 'KD'], ['10H', '10S', '5C'])), '6D', 'thirty-one');
});

test('sharp: takes a winning peg, and avoids a card that leaves the opponent a winner', () => {
  const sharp = ai('sharp');
  assert.equal(sharp.play(playCtx(['9S', '2C'], ['6D'], { scores: [119, 100] })), '9S', 'a fifteen for two wins the game from 119');
  assert.equal(sharp.play(playCtx(['9S', '2C'], ['6D'], { scores: [0, 0] })), '9S', 'and normally takes the points too');
  assert.equal(sharp.play(playCtx(['5D', '4C'], [], { scores: [50, 119], cardsLeft: [2, 4] })), '4C', 'a five would hand a fifteen to an opponent on 119');
});

test('sharp: looks at the board when it discards', () => {
  const hand = ['9D', 'KH', '6D', 'QD', '4C', '8C'];
  const early = ai('sharp').discard(discardCtx(hand, { isDealer: false, scores: [0, 0] }));
  const late = ai('sharp').discard(discardCtx(hand, { isDealer: false, scores: [115, 60] }));
  assert.notDeepEqual([...early].sort(), [...late].sort(), 'near home as the pone it stops worrying about the opponent\'s crib');
});

test('sharp discards the same way for the same cards', () => {
  const hand = ['9D', 'KH', '6D', 'QD', '4C', '8C'];
  assert.deepEqual(ai('sharp').discard(discardCtx(hand)), ai('sharp').discard(discardCtx(hand, { rng: seeded(99) })));
});

// ---- a seeded tournament ----

/** Two-player matches between `a` and `b`, swapping seats each game; returns each side's wins and mean final score. */
function tournament(a, b, games, target = 121) {
  const wins = { [a]: 0, [b]: 0 };
  const score = { [a]: 0, [b]: 0 };
  for (let g = 0; g < games; g++) {
    const order = g % 2 ? [b, a] : [a, b];
    const room = allBotGame(order, { seed: 5000 + g, target });
    wins[order[room.winner]]++;
    order.forEach((id, i) => (score[id] += room.seats[i].score));
  }
  return { wins, mean: { [a]: score[a] / games, [b]: score[b] / games } };
}

test('tournament: sharp beats standard, and standard beats random', () => {
  const report = [];
  const sharpStandard = tournament('sharp', 'standard', 200);
  report.push(`sharp v standard (200 games to 121): wins ${sharpStandard.wins.sharp}-${sharpStandard.wins.standard}, mean score ${sharpStandard.mean.sharp.toFixed(1)}-${sharpStandard.mean.standard.toFixed(1)}`);
  const standardRandom = tournament('standard', 'random', 40);
  report.push(`standard v random (40 games): wins ${standardRandom.wins.standard}-${standardRandom.wins.random}, mean score ${standardRandom.mean.standard.toFixed(1)}-${standardRandom.mean.random.toFixed(1)}`);
  const sharpRandom = tournament('sharp', 'random', 40);
  report.push(`sharp v random (40 games): wins ${sharpRandom.wins.sharp}-${sharpRandom.wins.random}`);
  console.log(report.join('\n'));
  assert.ok(sharpStandard.wins.sharp > sharpStandard.wins.standard, report[0]);
  assert.ok(sharpStandard.mean.sharp > sharpStandard.mean.standard);
  assert.ok(standardRandom.wins.standard > standardRandom.wins.random * 3, report[1]);
  assert.ok(sharpRandom.wins.sharp > sharpRandom.wins.random * 3, report[2]);
});

// ---- assignment, persistence and the view ----

function newRoom(seats = 4, seed = 4) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'Alex', seats });
  game.fillBots(room, 1);
  game.start(room, 1, seeded(seed));
  return room;
}

test('each computer player picks an AI when the game starts; people and lobbies have none', () => {
  const lobby = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'Alex', seats: 3 });
  game.fillBots(lobby, 1);
  assert.ok(lobby.seats.every((s) => s.ai === undefined));
  assert.ok(game.viewFor(lobby, 1).seats.every((s) => s.ai === null));
  const room = newRoom(4);
  assert.equal(room.seats[0].ai, undefined);
  for (const s of room.seats.slice(1)) assert.ok(IDS.includes(s.ai), s.ai);
  assert.deepEqual(room.seats.map((s) => s.ai), newRoom(4).seats.map((s) => s.ai), 'the same rng gives the same AIs');
  const chosen = new Set();
  for (let seed = 1; seed <= 60; seed++) for (const s of newRoom(4, seed).seats.slice(1)) chosen.add(s.ai);
  assert.equal(chosen.size, IDS.length, 'over many games every AI turns up');
});

test('the AI choice survives a save and reload, and drives the bot\'s moves', () => {
  const room = newRoom(2);
  const reloaded = JSON.parse(JSON.stringify(room));
  assert.equal(reloaded.seats[1].ai, room.seats[1].ai);
  let used = 0;
  const target = ai('sharp');
  const original = target.discard;
  target.discard = (ctx) => (used++, original(ctx));
  try {
    reloaded.seats[1].ai = 'sharp';
    game.discard(reloaded, 0, [reloaded.hands[0][0], reloaded.hands[0][1]]);
    assert.ok(game.botMove(reloaded).ok);
    assert.equal(used, 1);
    assert.equal(game.aiOf(reloaded, 1).id, 'sharp');
  } finally {
    target.discard = original;
  }
});

test('an AI that answers illegally is overruled rather than breaking the game', () => {
  const room = newRoom(2);
  room.seats[1].ai = 'random';
  const target = ai('random');
  const original = [target.discard, target.play];
  target.discard = () => ['XX', 'YY'];
  target.play = () => 'XX';
  try {
    game.discard(room, 0, [room.hands[0][0], room.hands[0][1]]);
    assert.ok(game.botMove(room).ok);
    assert.equal(room.phase, 'play');
    room.play.turn = 1;
    assert.ok(game.botMove(room).ok);
  } finally {
    [target.discard, target.play] = original;
  }
});

test('rooms saved before AIs existed fall back to the standard AI', () => {
  const room = newRoom(2);
  for (const s of room.seats) delete s.ai;
  assert.equal(game.aiOf(room, 1).id, 'standard');
  assert.deepEqual(game.viewFor(room, 1).seats[1].ai, { id: 'standard', name: 'Standard' });
  assert.ok(game.botMove(room).ok);
});

test('the view names the AI of computer players only', () => {
  const room = newRoom(3);
  const view = game.viewFor(room, 1);
  assert.equal(view.seats[0].ai, null);
  for (const i of [1, 2]) assert.deepEqual(view.seats[i].ai, { id: room.seats[i].ai, name: aiById(AIS, room.seats[i].ai).name });
  assert.ok(!JSON.stringify(view).includes('description'), 'only id and name');
});

test('a person who leaves is replaced by a computer player that picks an AI at that moment', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'A', seats: 3 });
  game.addHuman(room, 2, 'B');
  game.addBot(room, 1);
  game.start(room, 1, seeded(9));
  assert.equal(room.seats[1].ai, undefined);
  game.removeHuman(room, 2, seeded(12));
  assert.equal(room.seats[1].bot, true);
  assert.ok(IDS.includes(room.seats[1].ai));
  const picks = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const r = game.createRoom({ code: 'a-b-c', hostId: 1, name: 'A', seats: 2 });
    game.addHuman(r, 2, 'B');
    game.start(r, 1, seeded(1));
    game.removeHuman(r, 2, seeded(seed));
    picks.add(r.seats[1].ai);
  }
  assert.ok(picks.size >= 4, 'the replacement picks by weight, not always the same one');
});

test('going back to the lobby clears the AIs, and the next game picks again', () => {
  const room = newRoom(2);
  room.phase = 'finished';
  assert.ok(game.returnToLobby(room, 1).ok);
  assert.ok(room.seats.every((s) => s.ai === undefined));
  assert.ok(game.start(room, 1, seeded(2)).ok);
  assert.ok(IDS.includes(room.seats[1].ai));
});
