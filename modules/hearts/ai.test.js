// The Hearts computer players: every AI plays complete legal games, each has a trait that can be measured, and the AI a
// bot seat was given is kept in the room (saved, restored, hidden from other players' cards, replaced when a human leaves).
// Everything is seeded, so the numbers are the same every run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullDeck, suitOf } from '../../shared/cards.js';
import { AIS } from './ai/index.js';
import { observe } from './ai/util.js';
import { moonAlive } from './ai/moon.js';
import * as g from './game.js';
import { playGame, seeded, versus } from './arena.js';

const ids = AIS.map((ai) => ai.id);
const byId = Object.fromEntries(AIS.map((ai) => [ai.id, ai]));
const rate = (count, total) => count / total;

/**
 * A mid-hand position for one seat, as the plain context an AI decides from. `taken` is given per seat; the rest of the
 * cards that must already be gone (so that the hand sizes add up) are filled in with harmless ones, never with a card in
 * `unseen`, which stays hidden in the other hands.
 */
function position({ seat, hand, trick = [], taken = [[], [], [], []], tricksPlayed, unseen = [], settings = {}, direction = 'none', heartsBroken = true, rng = seeded(1) }) {
  assert.equal(hand.length, 13 - tricksPlayed, 'the hand matches the number of tricks played');
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings });
  g.fillWithBots(room, 1);
  g.start(room, 1, rng);
  const used = new Set([...hand, ...trick.map((p) => p.card), ...taken.flat()]);
  const filler = fullDeck().filter((c) => !used.has(c) && !unseen.includes(c) && !g.isPointCard(c) && c !== 'JD');
  const need = 4 * tricksPlayed - taken.flat().length;
  assert.ok(need >= 0 && filler.length >= need, 'enough harmless cards to fill');
  const full = taken.map((cards) => [...cards]);
  full[(seat + 2) % 4].push(...filler.slice(0, need));
  Object.assign(room, {
    phase: 'playing',
    passDirection: direction,
    hands: [[], [], [], []].map((_, s) => (s === seat ? [...hand] : [])),
    trick,
    taken: full,
    trickLog: [],
    tricksPlayed,
    heartsBroken,
    turn: seat,
    moonBid: null,
    passes: [null, null, null, null],
    received: [[], [], [], []],
  });
  return g.aiContext(room, seat, rng);
}

// ---- the registry for Hearts ----

test('Hearts offers standard first, then the rest; standard and sharp are the commonest', () => {
  assert.equal(AIS[0].id, 'standard');
  assert.deepEqual([...ids].sort(), ['avoider', 'jack', 'moon', 'random', 'sharp', 'standard']);
  for (const ai of AIS) {
    assert.ok(ai.name && ai.description, `${ai.id} has a name and description`);
    assert.equal(typeof ai.choosePass, 'function');
    assert.equal(typeof ai.choosePlay, 'function');
  }
  const weight = (id) => byId[id].weight ?? 1;
  for (const other of ['moon', 'jack', 'avoider', 'random']) {
    assert.ok(weight('standard') > weight(other) && weight('sharp') > weight(other), `standard and sharp outweigh ${other}`);
  }
  assert.ok(weight('random') < 1, 'random is rare');
});

// ---- every AI plays whole games legally ----

for (const id of ids) {
  test(`${id} plays complete games legally and the games finish (Jack on and off, both moon modes, 4 seats)`, () => {
    let hands = 0;
    for (const [seed, jackOfDiamonds, moon] of [[1, false, 'others'], [2, true, 'others'], [3, false, 'self'], [4, true, 'self'], [5, true, 'others'], [6, false, 'others']]) {
      const { room, hands: played } = playGame({ ais: [id, id, id, id], seed, settings: { jackOfDiamonds, moon, target: seed % 2 ? 50 : 100 } });
      assert.equal(room.phase, 'finished');
      assert.ok(room.scores.some((score) => score >= room.settings.target));
      assert.deepEqual(room.winners, g.winnersOf(room.scores));
      hands += played.length;
    }
    assert.ok(hands >= 12, `${hands} hands played`);
  });

  test(`${id} always passes three different cards from its hand and plays one of its legal cards`, () => {
    const rng = seeded(40);
    for (let n = 0; n < 60; n++) {
      const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { jackOfDiamonds: n % 2 === 0 } });
      g.fillWithBots(room, 1);
      g.start(room, 1, rng);
      for (const seat of room.seats) seat.ai = id;
      for (let guard = 0; guard < 80 && ['passing', 'playing'].includes(room.phase); guard++) {
        const action = g.pendingAction(room);
        if (!action) break;
        if (action.type === 'pass') {
          const cards = byId[id].choosePass(g.aiContext(room, action.seat, rng));
          assert.equal(new Set(cards).size, 3);
          assert.ok(cards.every((c) => room.hands[action.seat].includes(c)));
        } else if (action.type === 'play') {
          const card = byId[id].choosePlay(g.aiContext(room, action.seat, rng));
          assert.ok(g.legalCards(room, action.seat).includes(card), `${id} chose an illegal ${card}`);
        }
        g.runPending(room, rng);
      }
    }
  });
}

test('an AI is only ever given what its own seat may know', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  g.fillWithBots(room, 1);
  g.start(room, 1, seeded(3));
  const ctx = g.aiContext(room, 1, seeded(1));
  assert.deepEqual(ctx.hand, room.hands[1]);
  const json = JSON.stringify({ ...ctx, rng: undefined });
  for (const other of [0, 2, 3]) {
    for (const card of room.hands[other]) assert.ok(!ctx.hand.includes(card));
  }
  assert.ok(!('hands' in ctx) && !('seats' in ctx), json.slice(0, 80));
  assert.equal(typeof ctx.rng, 'function');
});

// ---- the traits ----

const GAMES = 200;

test('moon shoots the moon far more often than standard does', () => {
  const standard = versus({ subject: 'standard', field: 'standard', games: GAMES });
  const moon = versus({ subject: 'moon', field: 'standard', games: GAMES });
  const standardRate = rate(standard.subjectMoons, standard.subjectHands);
  const moonRate = rate(moon.subjectMoons, moon.subjectHands);
  console.log(`  moon AI shot ${(moonRate * 100).toFixed(1)}% of hands, standard ${(standardRate * 100).toFixed(1)}%`);
  assert.ok(moonRate > 0.1, `moon rate ${moonRate}`);
  assert.ok(moonRate > standardRate * 8, `moon ${moonRate} against standard ${standardRate}`);
});

test('moon passes its weakest cards, leads winners from side suits and gives up once somebody else has a point', () => {
  const hand = ['2C', '3D', '4S', 'AH', 'KH', 'QH', 'JH', '10H', '9H', 'AS', 'KS', 'AD', 'AC'];
  const pass = byId.moon.choosePass({ hand, settings: {} });
  assert.deepEqual([...pass].sort(), ['2C', '3D', '4S']);

  const live = position({ seat: 0, tricksPlayed: 4, hand: ['AS', 'KS', 'AD', 'AH', 'KH', 'QH', 'JH', '10H', '9H'].slice(0, 9), unseen: [] });
  assert.equal(moonAlive(live), true);
  const lead = byId.moon.choosePlay(live);
  assert.ok(!lead.endsWith('H'), `${lead} is not a heart: winners from the side suits are cashed first`);
  assert.ok(['AS', 'AD'].includes(lead));

  const dead = position({ seat: 0, tricksPlayed: 4, hand: ['AS', 'KS', '3D', 'AH', 'KH', 'QH', 'JH', '10H', '9H'], taken: [[], ['2H'], [], []] });
  assert.equal(moonAlive(dead), false, 'another seat has a heart');
  assert.equal(byId.moon.choosePlay(dead), byId.standard.choosePlay({ ...dead, moonBid: null }), 'it then plays like standard');
});

test('moon wins the tricks that carry points and never gives a heart away while the attempt is alive', () => {
  // Following a trick with a heart in it, able to win: it wins (cheapest sure winner when last).
  const win = position({
    seat: 3,
    tricksPlayed: 8,
    hand: ['AH', 'KH', '9H', '2C', '3C'],
    trick: [{ seat: 0, card: '5H' }, { seat: 1, card: '8H' }, { seat: 2, card: '6H' }],
    unseen: [],
  });
  assert.equal(byId.moon.choosePlay(win), '9H', 'the lowest card that wins when last');
  // Void in the suit led: sheds a non-point card, keeping its hearts.
  const shed = position({
    seat: 3,
    tricksPlayed: 8,
    hand: ['AH', 'KH', '9H', '2C', '3C'],
    trick: [{ seat: 0, card: '5D' }, { seat: 1, card: '8D' }, { seat: 2, card: '6D' }],
  });
  assert.ok(['2C', '3C'].includes(byId.moon.choosePlay(shed)));
});

test('avoider is not worse than standard in a mixed table, and ducks and dumps by its rules', () => {
  const standard = versus({ subject: 'standard', field: 'standard', games: GAMES });
  const avoider = versus({ subject: 'avoider', field: 'standard', games: GAMES });
  console.log(`  avoider averages ${(avoider.subjectScore / GAMES).toFixed(1)} against standard ${(standard.subjectScore / GAMES).toFixed(1)} (field ${(avoider.fieldScore / GAMES).toFixed(1)})`);
  assert.ok(avoider.subjectScore / GAMES <= standard.subjectScore / GAMES + 4, 'not meaningfully worse than standard');
  assert.ok(avoider.subjectScore <= avoider.fieldScore + 4 * GAMES, 'and no worse than the standard players it sits with');

  // Cannot follow: the Queen goes first, then the highest heart.
  const dump = position({ seat: 1, tricksPlayed: 5, hand: ['QS', 'AH', '3H', '7C', '9D', '2D', '8S', '4C'], trick: [{ seat: 0, card: '5D' }] });
  assert.equal(byId.avoider.choosePlay({ ...dump, hand: ['QS', 'AH', '3H', '7C', '4C', '8S', '2S', 'JS'], legal: ['QS', 'AH', '3H', '7C', '4C', '8S', '2S', 'JS'] }), 'QS');
  assert.equal(byId.avoider.choosePlay({ ...dump, hand: ['AH', '3H', '7C', '4C', '8S', '2S', 'JS', '9S'], legal: ['AH', '3H', '7C', '4C', '8S', '2S', 'JS', '9S'] }), 'AH');
  // Ducks with the highest card that stays under the winner.
  const duck = position({ seat: 1, tricksPlayed: 7, hand: ['3D', '9D', 'KD', '2C', '4C', '6C'], trick: [{ seat: 0, card: '10D' }] });
  assert.equal(byId.avoider.choosePlay(duck), '9D');
  // Passes hearts and the Queen away, but keeps low hearts.
  const pass = byId.avoider.choosePass({ hand: ['2C', '5D', '9D', 'KD', '3S', '7S', 'QS', 'AS', '2H', 'AH', 'QH', '4H', '8C'], settings: {} });
  assert.ok(pass.includes('QS') && pass.includes('AH') && !pass.includes('2H'));
});

test('jack collects the Jack of Diamonds far more often than standard, and is exactly standard with the option off', () => {
  const settings = { jackOfDiamonds: true };
  const standard = versus({ subject: 'standard', field: 'standard', games: GAMES, settings });
  const jack = versus({ subject: 'jack', field: 'standard', games: GAMES, settings });
  const standardRate = rate(standard.subjectJacks, standard.subjectHands);
  const jackRate = rate(jack.subjectJacks, jack.subjectHands);
  console.log(`  jack AI took the Jack in ${(jackRate * 100).toFixed(1)}% of hands, standard ${(standardRate * 100).toFixed(1)}%`);
  assert.ok(jackRate > standardRate * 1.3, `jack ${jackRate} against standard ${standardRate}`);

  // With the option off every decision matches standard's, through whole games.
  const rng = seeded(21);
  let compared = 0;
  for (let n = 0; n < 6; n++) {
    const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { jackOfDiamonds: false } });
    g.fillWithBots(room, 1);
    g.start(room, 1, rng);
    room.seats.forEach((seat, i) => (seat.ai = i % 2 ? 'jack' : 'standard'));
    allBots(room);
    for (let guard = 0; guard < 400 && ['passing', 'playing'].includes(room.phase); guard++) {
      const action = g.pendingAction(room);
      if (!action) break;
      if (action.type === 'pass') {
        const ctx = g.aiContext(room, action.seat, seeded(guard));
        assert.deepEqual(byId.jack.choosePass(ctx), byId.standard.choosePass(ctx));
      } else if (action.type === 'play') {
        const a = byId.jack.choosePlay(g.aiContext(room, action.seat, seeded(guard)));
        const b = byId.standard.choosePlay(g.aiContext(room, action.seat, seeded(guard)));
        assert.equal(a, b);
        compared++;
      }
      g.runPending(room, rng);
    }
  }
  assert.ok(compared > 100, `${compared} decisions compared`);
});

test('the jack hunter keeps its diamonds when passing', () => {
  const hand = ['AD', 'KD', 'JD', '2C', '3C', '5S', '6S', '9S', 'AS', 'KS', 'QS', 'AH', 'KH'];
  const pass = byId.jack.choosePass({ hand, settings: { jackOfDiamonds: true } });
  assert.ok(pass.every((c) => suitOf(c) !== 'D'), `${pass} keeps every diamond`);
});

test('random picks any legal card: it varies, and it loses to standard', () => {
  const ctx = position({ seat: 0, tricksPlayed: 4, hand: ['2C', '5C', '9C', 'KC', 'AD', '3D', '4S', '7S', 'QH'], rng: seeded(1) });
  const seen = new Set();
  const rng = seeded(8);
  for (let i = 0; i < 80; i++) seen.add(byId.random.choosePlay({ ...ctx, rng }));
  assert.ok(seen.size >= 6, `${seen.size} different leads`);
  const result = versus({ subject: 'random', field: 'standard', games: 100 });
  assert.ok(result.subjectScore / 100 > result.fieldScore / 100 + 15, 'random scores far worse');
});

// ---- sharp ----

test('sharp counts cards: it knows who is out of which suit and what is left', () => {
  const ctx = position({
    seat: 0,
    tricksPlayed: 2,
    hand: ['2C', '5C', '9C', 'KC', 'AD', '3D', '4S', '7S', 'QH', '6H', '2D'],
    trick: [{ seat: 1, card: '8D' }, { seat: 2, card: '9H' }],
    taken: [[], [], [], []],
  });
  ctx.history = [{ plays: [{ seat: 3, card: '3C' }, { seat: 0, card: '4C' }, { seat: 1, card: '8H' }, { seat: 2, card: '6C' }], winner: 2 }];
  const know = observe(ctx);
  assert.ok(know.voids[1].has('C'), 'seat 1 played a heart on a club');
  assert.ok(know.voids[2].has('D'), 'seat 2 played a heart on a diamond');
  assert.ok(!know.voids[3].size && !know.voids[0].size);
  assert.ok(!know.unseen.has('9H') && !know.unseen.has('2C'), 'played and held cards are not unseen');
  assert.ok(know.unseen.has('AH'));
  assert.deepEqual(know.sizes, [11, 10, 10, 11]);
});

test('sharp dumps the Queen of Spades on the player who will win the trick', () => {
  const ctx = position({
    seat: 2,
    tricksPlayed: 6,
    hand: ['QS', '3C', '9C', '4S', '7H', '2H', '8C'],
    trick: [{ seat: 0, card: 'AD' }, { seat: 1, card: '3D' }],
    unseen: ['KD', 'QD'],
  });
  assert.equal(byId.sharp.choosePlay(ctx), 'QS');
});

test('sharp flushes the Queen out safely and never leads a high spade that would catch it while it is unseen', () => {
  const ctx = position({
    seat: 0,
    tricksPlayed: 4,
    hand: ['AS', 'KS', '3S', '4C', '9C', 'JC', '2D', '6D', '10D'],
    unseen: ['QS'],
  });
  const card = byId.sharp.choosePlay(ctx);
  assert.ok(!['AS', 'KS'].includes(card), `${card}`);
});

test('sharp holds back its high hearts and the Queen while one other player owns every point so far', () => {
  // Seat 0 has taken five hearts and nobody else has taken a point: a moon is possible. Seat 0 is winning this trick and
  // seat 2 cannot follow diamonds: giving them more points would help the moon, so the hearts and the Queen stay home.
  const base = {
    seat: 2,
    tricksPlayed: 8,
    hand: ['AH', 'QH', 'QS', '7C', '2S'],
    trick: [{ seat: 0, card: 'KD' }, { seat: 1, card: '3D' }],
    unseen: ['7H', '8H', '9H'],
  };
  const lone = position({ ...base, taken: [['2H', '3H', '4H', '5H', '6H'], [], [], []] });
  for (const id of ['sharp', 'avoider']) {
    const card = byId[id].choosePlay(lone);
    assert.ok(!['AH', 'QH', 'QS'].includes(card), `${id} played ${card} onto the lone point owner`);
  }
  // Two players have points, so a moon is impossible: the same hand now sheds its most dangerous cards freely.
  const two = position({ ...base, taken: [['2H', '3H', '4H', '5H', '6H'], [], [], ['8C']].map((cards, i) => (i === 3 ? ['JH'] : cards)) });
  for (const id of ['sharp', 'avoider']) {
    const card = byId[id].choosePlay(two);
    assert.ok(['AH', 'QH', 'QS'].includes(card), `${id} played ${card} instead of dumping`);
  }
});

test('sharp beats standard in a tournament of seeded games', () => {
  const games = 120;
  const sharp = versus({ subject: 'sharp', field: 'standard', games, seedBase: 1000 });
  const averageSharp = sharp.subjectScore / games;
  const averageField = sharp.fieldScore / games;
  const winRate = sharp.subjectWins / games;
  console.log(`  sharp vs three standard over ${games} games: sharp averages ${averageSharp.toFixed(1)}, standard ${averageField.toFixed(1)}, sharp wins ${(winRate * 100).toFixed(1)}% (fair share 25%)`);
  assert.ok(averageSharp < averageField - 8, `sharp ${averageSharp} against standard ${averageField}`);
  assert.ok(winRate > 0.35, `win rate ${winRate}`);
  // It also beats the other AIs when they sit together.
  const mixed = versus({ subject: 'sharp', field: ['avoider', 'standard', 'jack'], games: 60, seedBase: 2000 });
  assert.ok(mixed.subjectScore < mixed.fieldScore, 'sharp does best against a mixed table too');
});

// ---- assigning, saving and restoring AIs ----

/** Turns the human in seat 0 into a computer too (after the game has started), so that the game plays itself. */
function allBots(room, ai) {
  room.seats[0] = { kind: 'bot', id: 'bot:90', name: 'Zed', ai: ai ?? room.seats[0].ai };
  return room;
}
const botSeats = (room) => room.seats.flatMap((seat, i) => (g.isBot(seat) ? [i] : []));
function lobbyWithBots() {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  g.fillWithBots(room, 1);
  return room;
}

test('starting a game gives each bot seat an AI id (not the humans), repeatably for a seeded rng', () => {
  const room = lobbyWithBots();
  assert.ok(botSeats(room).every((i) => room.seats[i].ai === undefined), 'nothing is chosen in the lobby');
  assert.equal(g.start(room, 1, seeded(9)).ok, true);
  assert.equal(room.seats[0].ai, undefined, 'a human has no AI');
  for (const i of botSeats(room)) assert.ok(ids.includes(room.seats[i].ai), `seat ${i} has ${room.seats[i].ai}`);
  const again = lobbyWithBots();
  g.start(again, 1, seeded(9));
  assert.deepEqual(again.seats.map((s) => s.ai), room.seats.map((s) => s.ai));
  const other = lobbyWithBots();
  g.start(other, 1, seeded(10));
  const everything = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    const r = lobbyWithBots();
    g.start(r, 1, seeded(seed));
    botSeats(r).forEach((i) => everything.add(r.seats[i].ai));
  }
  assert.deepEqual([...everything].sort(), [...ids].sort(), 'every AI turns up with enough games');
});

test('the AIs are drawn by weight: standard and sharp are the commonest', () => {
  const counts = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let seed = 1; seed <= 400; seed++) {
    const room = lobbyWithBots();
    g.start(room, 1, seeded(seed));
    for (const i of botSeats(room)) counts[room.seats[i].ai]++;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const id of ['standard', 'sharp']) for (const other of ['moon', 'jack', 'avoider', 'random']) assert.ok(counts[id] > counts[other] * 1.5, `${id} ${counts[id]} against ${other} ${counts[other]}`);
  assert.ok(counts.random / total < 0.1);
});

test('each new game (play again) draws the AIs afresh and the choice stays for the whole game', () => {
  const room = lobbyWithBots();
  g.start(room, 1, seeded(1));
  allBots(room, 'random');
  const chosen = room.seats.map((s) => s.ai);
  for (let guard = 0; guard < 5000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'handEnd') g.forceNextHand(room, seeded(guard));
    else g.runPending(room, seeded(guard + 1));
    assert.deepEqual(room.seats.map((s) => s.ai), chosen, 'unchanged during the game');
  }
  assert.equal(g.playAgain(room, 1).ok, true);
  room.seats[0] = { kind: 'human', id: 1, name: 'Ann' };
  assert.equal(g.start(room, 1, seeded(77)).ok, true);
  assert.ok(botSeats(room).every((i) => ids.includes(room.seats[i].ai)));
});

test('a bot that replaces a leaving human picks an AI at that moment', () => {
  const room = lobbyWithBots();
  g.addHuman(room, 2, 'Bea');
  g.removeBot(room, 1, 1);
  g.addHuman(room, 2, 'Bea');
  g.fillWithBots(room, 1);
  g.start(room, 1, seeded(4));
  assert.equal(room.seats[1].ai, undefined);
  const picked = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const r = lobbyWithBots();
    g.addHuman(r, 2, 'Bea');
    g.removeBot(r, 1, 1);
    g.addHuman(r, 2, 'Bea');
    g.fillWithBots(r, 1);
    g.start(r, 1, seeded(seed));
    const outcome = g.removeHuman(r, 2, seeded(seed + 500));
    assert.equal(outcome.replaced, true);
    assert.equal(g.isBot(r.seats[1]), true);
    assert.ok(ids.includes(r.seats[1].ai), 'the replacement has an AI');
    picked.add(r.seats[1].ai);
  }
  assert.ok(picked.size >= 4, `replacements pick from the range: ${[...picked]}`);
});

test('the view shows { id, name } for bots once the game is on, and nothing about an AI for humans or in the lobby', () => {
  const room = lobbyWithBots();
  g.addHuman(room, 2, 'Bea');
  assert.ok(g.viewFor(room, 1).seats.every((s) => !s || s.ai === undefined), 'nothing in the lobby');
  g.removeBot(room, 1, 1);
  g.addHuman(room, 2, 'Bea');
  g.fillWithBots(room, 1);
  g.start(room, 1, seeded(6));
  const view = g.viewFor(room, 1);
  const bobs = view.seats.filter((s) => s.bot);
  assert.equal(bobs.length, 2);
  for (const seat of bobs) {
    assert.deepEqual(Object.keys(seat.ai).sort(), ['id', 'name']);
    assert.equal(seat.ai.id, room.seats[seat.seat].ai);
    assert.equal(seat.ai.name, byId[seat.ai.id].name);
  }
  assert.ok(view.seats.filter((s) => !s.bot).every((s) => s.ai === undefined));
  const text = JSON.stringify(view);
  assert.ok(!text.includes('choosePlay') && !text.includes('weight') && !text.includes('description'));
  // Nobody else's cards or AI internals are exposed by the new fields.
  assert.deepEqual(g.viewFor(room, 2).seats.map((s) => s.cards), view.seats.map((s) => s.cards));
});

test('a room saved as JSON keeps its AIs and plays on identically; a room from before AIs existed falls back to standard', () => {
  const room = lobbyWithBots();
  g.start(room, 1, seeded(12));
  allBots(room);
  const rng = seeded(31);
  for (let i = 0; i < 25; i++) g.runPending(room, rng);
  const saved = JSON.parse(JSON.stringify(room));
  assert.deepEqual(saved.seats.map((s) => s.ai), room.seats.map((s) => s.ai));
  const continueFrom = (r) => {
    const play = seeded(99);
    for (let guard = 0; guard < 4000 && r.phase !== 'finished'; guard++) {
      if (r.phase === 'handEnd') g.forceNextHand(r, play);
      else if (!g.runPending(r, play)) break;
    }
    return { scores: r.scores, phase: r.phase };
  };
  const restored = continueFrom(saved);
  assert.deepEqual(restored, continueFrom(room), 'restored games play exactly as the original would have');
  assert.equal(restored.phase, 'finished');

  const legacy = JSON.parse(JSON.stringify(lobbyWithBots()));
  g.start(legacy, 1, seeded(12));
  allBots(legacy);
  for (const seat of legacy.seats) delete seat.ai;
  delete legacy.trickLog;
  assert.ok(legacy.seats.every((_, i) => g.aiOf(legacy, i) === AIS[0]));
  const saved2 = JSON.parse(JSON.stringify(legacy));
  assert.deepEqual(continueFrom(saved2).phase, 'finished', 'an old room without trickLog or AIs plays to the end');
  assert.ok(g.viewFor(legacy, 1).seats.filter((s) => s.bot).every((s) => s.ai.id === 'standard'));
});

test('an unknown saved AI id (one that was renamed or removed) plays as standard', () => {
  const room = lobbyWithBots();
  g.start(room, 1, seeded(2));
  allBots(room);
  room.seats[1].ai = 'gone-for-good';
  assert.equal(g.aiOf(room, 1).id, 'standard');
  const rng = seeded(5);
  for (let guard = 0; guard < 4000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'handEnd') g.forceNextHand(room, rng);
    else if (!g.runPending(room, rng)) break;
  }
  assert.equal(room.phase, 'finished');
});

