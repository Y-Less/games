// The computer-player AIs: the registry, that every AI plays legal and finished games, the habit that gives each one its
// character, a seeded tournament, and how the choice of AI is made, stored and shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as game from './game.js';
import * as bot from './bot.js';
import { AIS } from './ai/index.js';
import { aiById } from '../../shared/ai.js';
import { CARDS, CARD_BY_ID, GOLD } from './cards.js';
import { botsOnly, checkInvariants, started } from './kit.js';
import { playWith, summary, tournament } from './ai-kit.js';
import { launchModule, seeded, sleep, until } from '../../shared/testkit.js';
import { fast, step } from './playkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const IDS = AIS.map((ai) => ai.id);
const sum = (list) => list.reduce((a, b) => a + b, 0);

// ---- the registry ----

test('the registry has the standard player first, then a range of AIs from sharp to random', () => {
  assert.equal(AIS[0].id, 'standard', 'the fallback for old rooms must be the original player');
  for (const id of ['standard', 'random', 'sharp', 'noble-hunter', 'engine-builder', 'rusher', 'blocker']) assert.ok(IDS.includes(id), id);
  for (const ai of AIS) {
    assert.ok(ai.name && ai.description, `${ai.id} has a name and a description`);
    for (const fn of ['chooseMove', 'chooseReturn', 'chooseNoble']) assert.equal(typeof ai[fn], 'function', `${ai.id}.${fn}`);
  }
  assert.ok(AIS.find((a) => a.id === 'random').weight < AIS.find((a) => a.id === 'standard').weight, 'random is rarer');
  assert.equal(aiById(AIS, 'no-such-ai').id, 'standard');
});

// ---- legality ----

/** Plays one random legal action (a return or a noble choice included) for whoever is to act. */
function randomStep(room, rng) {
  const seat = room.pending?.seat ?? room.turn;
  if (room.pending?.type === 'return') {
    const give = [0, 0, 0, 0, 0, 0];
    const have = [...room.players[seat].tokens];
    for (let k = 0; k < room.pending.count; k++) {
      const options = have.flatMap((n, c) => (n > 0 ? [c] : []));
      const c = options[Math.floor(rng() * options.length)];
      have[c]--;
      give[c]++;
    }
    return game.returnTokens(room, seat, give);
  }
  if (room.pending?.type === 'noble') return game.chooseNoble(room, seat, room.pending.options[Math.floor(rng() * room.pending.options.length)]);
  const moves = game.legalMoves(room, seat);
  return moves.length ? game.applyMove(room, seat, moves[Math.floor(rng() * moves.length)]) : game.passTurn(room, seat);
}

for (const ai of AIS) {
  test(`${ai.id}: every decision is legal over hundreds of random positions`, () => {
    const rng = seeded(31);
    let checked = 0;
    for (let g = 0; g < 40; g++) {
      const room = botsOnly(2 + (g % 3), rng, { target: [10, 15, 20][g % 3] });
      room.ais = Object.fromEntries(room.seats.map((s) => [s.id, ai.id]));
      const stop = 3 + Math.floor(rng() * 80);
      for (let i = 0; i < stop && room.phase === 'playing'; i++) {
        assert.equal(randomStep(room, rng).ok, true);
        if (room.phase !== 'playing' || room.pending) continue;
        const clone = structuredClone(room);
        const seat = clone.turn;
        const move = bot.chooseMove(clone, seat, rng);
        const given = ai.chooseMove(bot.situation(clone, seat, { moves: game.legalMoves(clone, seat) }), rng);
        assert.ok(game.legalMoves(clone, seat).some((m) => JSON.stringify(m) === JSON.stringify(given)) || (given.type === 'pass' && !game.legalMoves(clone, seat).length), `${ai.id} proposed an illegal move ${JSON.stringify(given)}`);
        assert.equal(game.applyMove(clone, seat, move).ok, true);
        if (clone.pending?.type === 'return') {
          const s = bot.situation(clone, seat, { returnCount: clone.pending.count });
          const give = ai.chooseReturn(s, rng);
          assert.equal(sum(give), clone.pending.count, `${ai.id} returns the right number`);
          assert.equal(game.returnTokens(clone, seat, give).ok, true, `${ai.id} returns tokens it has`);
        }
        if (clone.pending?.type === 'noble') {
          const id = ai.chooseNoble(bot.situation(clone, seat, { options: clone.pending.options }), rng);
          assert.ok(clone.pending.options.includes(id), `${ai.id} picks one of the nobles on offer`);
        }
        checked++;
      }
    }
    assert.ok(checked > 300, `checked ${checked}`);
  });
}

test('the AIs never read the draw piles (the same table gives the same decision whatever the order of the piles)', () => {
  for (const ai of AIS) {
    const rng = seeded(77);
    for (let g = 0; g < 6; g++) {
      const room = botsOnly(3, rng);
      room.ais = Object.fromEntries(room.seats.map((s) => [s.id, ai.id]));
      for (let i = 0; i < 40 && room.phase === 'playing'; i++) {
        if (!room.pending) {
          const a = structuredClone(room);
          const b = structuredClone(room);
          for (const l of [1, 2, 3]) b.decks[l].reverse();
          assert.deepEqual(bot.chooseMove(a, a.turn, seeded(i)), bot.chooseMove(b, b.turn, seeded(i)), `${ai.id}: same public position, same move`);
        }
        assert.equal(randomStep(room, rng).ok, true);
      }
    }
  }
});

test('the AIs do not see opponents\' face-down reserved cards', () => {
  const room = botsOnly(2, () => 0.5);
  const hidden = room.decks[3].pop();
  room.players[1].reserved.push({ card: hidden, blind: true });
  const s = bot.situation(room, 0);
  assert.equal(s.players[1].reservedCount, 1);
  assert.deepEqual(s.players[1].reserved, []);
  assert.ok(!JSON.stringify(s).includes(hidden));
  assert.deepEqual(bot.situation(room, 1).players[1].reserved, [hidden], 'but the holder knows its own');
});

// ---- whole games ----

for (const ai of AIS) {
  test(`${ai.id}: complete games at 2, 3 and 4 players are legal and finish (against itself and a mixed table)`, () => {
    const rng = seeded(500 + IDS.indexOf(ai.id));
    const lineups = [
      [ai.id, ai.id],
      [ai.id, ai.id, ai.id],
      [ai.id, ai.id, ai.id, ai.id],
      [ai.id, 'random'],
      [ai.id, 'standard', 'random'],
      ['sharp', ai.id, 'blocker', 'rusher'],
    ];
    for (const [n, ids] of lineups.entries()) {
      const target = [10, 15, 20][n % 3];
      const room = playWith(ids, rng, { target, check: true });
      assert.equal(room.phase, 'finished', ids.join());
      assert.ok(room.winners.length >= 1);
      assert.ok(['target', 'stalled', 'limit'].includes(room.endReason));
      checkInvariants(room, `${ids} end`);
    }
  });
}

test('a game cannot be started for one player (so there is no one-player game to play)', () => {
  assert.equal(game.normaliseSettings({ seats: 1 }).ok, false);
});

// ---- the character of each AI ----

const find = (predicate) => CARDS.filter(predicate);
const room2 = () => {
  const room = botsOnly(2, () => 0.5);
  room.turn = 0;
  room.supply = [4, 4, 4, 4, 4, 5];
  for (const l of [1, 2, 3]) room.board[l] = [null, null, null, null];
  room.nobles = [];
  return room;
};
const place = (room, ...ids) => ids.forEach((id) => (room.board[CARD_BY_ID[id].level][room.board[CARD_BY_ID[id].level].indexOf(null)] = id));
const withAI = (room, id) => {
  room.ais = Object.fromEntries(room.seats.map((s) => [s.id, id]));
  return room;
};
const picks = (room, id, tries = 12) => {
  withAI(room, id);
  return Array.from({ length: tries }, (_, i) => bot.chooseMove(structuredClone(room), 0, seeded(i + 1)));
};

test('random: a uniformly random legal move (every legal move turns up, none is favoured)', () => {
  const room = started(2, () => 0.5);
  room.seats[0] = { kind: 'bot', id: 'bot:0', name: 'Zed' };
  room.ais = { 'bot:0': 'random' };
  const moves = game.legalMoves(room, 0);
  const rng = seeded(9);
  const draws = moves.length * 200;
  const tally = new Map(moves.map((m) => [JSON.stringify(m), 0]));
  for (let i = 0; i < draws; i++) {
    const key = JSON.stringify(bot.chooseMove(room, 0, rng));
    tally.set(key, tally.get(key) + 1);
  }
  const expected = draws / moves.length;
  for (const [key, n] of tally) assert.ok(n > expected * 0.5 && n < expected * 1.6, `${key} was chosen ${n} times (expected about ${expected})`);
});

test('noble-hunter: buys the card whose colour a noble needs rather than an equally cheap one of another colour', () => {
  const [wanted, other] = (() => {
    const wanted = find((c) => c.level === 1 && c.points === 0 && c.bonus === 0)[0];
    return [wanted, find((c) => c.level === 1 && c.points === 0 && c.bonus === 4 && sum(c.cost) === sum(wanted.cost))[0]];
  })();
  const room = room2();
  room.nobles = ['n1']; // needs four Diamond and four Sapphire cards
  room.players[0].bought = [...find((c) => c.bonus === 0 && c.level === 1 && c.id !== wanted.id).slice(0, 3).map((c) => c.id), ...find((c) => c.bonus === 1 && c.level === 1).slice(0, 3).map((c) => c.id)];
  room.players[0].tokens = [5, 5, 5, 5, 5, 0];
  place(room, wanted.id, other.id);
  for (const move of picks(room, 'noble-hunter')) assert.deepEqual(move, { type: 'buy', card: wanted.id });
});

test('engine-builder: buys cheap cards early, then big point cards once the engine is running', () => {
  const big = find((c) => c.level === 2 && c.points === 2 && sum(c.cost) === 5)[0];
  const cheap = find((c) => c.level === 1 && c.points === 0 && sum(c.cost) === 3)[0];
  const early = room2();
  early.players[0].tokens = [5, 5, 5, 5, 5, 0];
  place(early, big.id, cheap.id);
  for (const move of picks(early, 'engine-builder')) assert.deepEqual(move, { type: 'buy', card: cheap.id });
  const late = room2();
  late.players[0].bought = find((c) => c.level === 1 && c.points === 0 && c.id !== cheap.id).slice(0, 9).map((c) => c.id);
  late.players[0].tokens = [5, 5, 5, 5, 5, 0];
  place(late, big.id, cheap.id);
  for (const move of picks(late, 'engine-builder')) assert.deepEqual(move, { type: 'buy', card: big.id });
});

test('rusher: buys the card with the most points it can afford rather than a plain one', () => {
  const plain = find((c) => c.level === 1 && c.points === 0)[0];
  const one = find((c) => c.level === 1 && c.points === 1)[0];
  const two = find((c) => c.level === 2 && c.points === 2 && sum(c.cost) <= 6)[0];
  const room = room2();
  room.players[0].tokens = [6, 6, 6, 6, 6, 0];
  place(room, plain.id, one.id, two.id);
  for (const move of picks(room, 'rusher')) assert.deepEqual(move, { type: 'buy', card: two.id });
});

/** A table where seat 1 can buy exactly one big card and seat 0 can buy nothing: who reserves that card? */
function threatTable() {
  const prize = find((c) => c.level === 3 && c.points === 3)[0];
  const room = room2();
  place(room, prize.id, ...find((c) => c.level === 1 && sum(c.cost) >= 6).slice(0, 1).map((c) => c.id));
  room.players[1].tokens = [...prize.cost, 0];
  room.players[0].tokens = [1, 0, 0, 0, 0, 0];
  return { room, prize };
}

for (const id of ['rusher', 'blocker', 'sharp']) {
  test(`${id}: reserves the big card an opponent is about to buy`, () => {
    const { room, prize } = threatTable();
    const moves = picks(room, id, 6);
    for (const move of moves) assert.deepEqual(move, { type: 'reserve', card: prize.id }, `${id} chose ${JSON.stringify(move)}`);
  });
}

test('sharp: takes the win when it can buy its way past the target', () => {
  const prize = find((c) => c.level === 3 && c.points === 3)[0];
  const room = room2();
  room.nobles = [];
  room.players[0].nobles = ['n1', 'n2', 'n3', 'n4'];
  room.players[0].bought = [find((c) => c.points === 1 && c.level === 1)[0].id];
  room.players[0].tokens = [...prize.cost, 0].map((n) => n + 1);
  place(room, prize.id);
  for (const move of picks(room, 'sharp', 4)) assert.deepEqual(move, { type: 'buy', card: prize.id });
});

test('sharp: does not trigger the end of the game when the opponent would then win it', () => {
  const [x] = find((c) => c.level === 3 && c.points === 3);
  const [y] = find((c) => c.level === 3 && c.points === 4);
  const room = room2();
  room.nobles = [];
  room.players[0].nobles = ['n1', 'n2', 'n3', 'n4']; // 12 points: buying a three-point card would end the game on 15
  room.players[1].nobles = ['n5', 'n6', 'n7', 'n8']; // 12 points: the four-point card would take it to 16
  room.players[0].tokens = [...x.cost, 0];
  room.players[1].tokens = [...y.cost, 0];
  place(room, x.id, y.id);
  for (const move of picks(room, 'sharp', 4)) assert.notDeepEqual(move, { type: 'buy', card: x.id }, 'buying would lose the game');
});

test('sharp: gives back the right tokens (never its Gold, and what it will spend stays)', () => {
  const card = find((c) => c.level === 2 && c.points === 3)[0]; // six of one colour
  const room = room2();
  place(room, card.id);
  const colour = card.cost.findIndex((n) => n > 0);
  const other = [0, 1, 2, 3, 4].filter((c) => c !== colour);
  room.players[0].tokens = [0, 0, 0, 0, 0, 1];
  room.players[0].tokens[colour] = 4;
  room.players[0].tokens[other[0]] = 3;
  room.players[0].tokens[other[1]] = 3; // thirteen? no: 4 + 3 + 3 + 1 = 11
  room.pending = { type: 'return', seat: 0, count: 1 };
  withAI(room, 'sharp');
  const give = bot.chooseReturn(room, 0, seeded(1));
  assert.equal(sum(give), 1);
  assert.equal(give[GOLD], 0, 'Gold is kept');
  assert.equal(give[colour], 0, 'the colour the card needs is kept');
});

test('sharp: never gives back Gold while it holds anything else', () => {
  const rng = seeded(4);
  for (let g = 0; g < 30; g++) {
    const room = botsOnly(3, rng);
    room.ais = Object.fromEntries(room.seats.map((s) => [s.id, 'sharp']));
    for (let i = 0; i < 60 && room.phase === 'playing'; i++) {
      if (room.pending?.type === 'return') {
        const seat = room.pending.seat;
        const give = bot.chooseReturn(room, seat, rng);
        const kept = room.players[seat].tokens.map((n, c) => n - give[c]);
        if (give[GOLD] > 0) assert.equal(sum(kept.slice(0, 5)), 0, 'gold only goes when nothing else is left');
      }
      assert.equal(randomStep(room, rng).ok, true);
    }
  }
});

// ---- the tournament ----

test('a seeded tournament: sharp beats standard, which beats random', { timeout: 300000 }, () => {
  const three = tournament(['sharp', 'standard', 'random'], 150, 20240601);
  console.log(`3 players, 150 games, win rate: ${summary(three)}`);
  assert.ok(three.sharp.rate > three.standard.rate, 'sharp > standard');
  assert.ok(three.standard.rate > three.random.rate, 'standard > random');
  const duel = tournament(['sharp', 'standard'], 150, 77);
  console.log(`2 players sharp v standard, 150 games: ${summary(duel)}`);
  assert.ok(duel.sharp.rate > 0.6, `sharp wins most duels with standard (${summary(duel)})`);
  const low = tournament(['standard', 'random'], 100, 78);
  console.log(`2 players standard v random, 100 games: ${summary(low)}`);
  assert.ok(low.standard.rate > 0.8);
});

test('every AI beats random head to head', { timeout: 300000 }, () => {
  const rows = [];
  for (const id of IDS.filter((x) => x !== 'random')) {
    const result = tournament([id, 'random'], 60, 1000 + IDS.indexOf(id));
    rows.push(`${id} ${(result[id].rate * 100).toFixed(0)}%`);
    assert.ok(result[id].rate > 0.7, `${id} should beat random: ${summary(result)}`);
  }
  console.log(`vs random, 2 players, 60 games: ${rows.join(', ')}`);
});

// ---- choosing, storing and showing an AI ----

const lobby = (seats = 4) => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats } });
  game.fillWithBots(room, 1);
  return room;
};

test('starting a game gives every bot (and only the bots) an AI, chosen with the game\'s rng', () => {
  const room = lobby();
  assert.equal(game.start(room, 1, seeded(3)).ok, true);
  const botIds = room.seats.filter(game.isBot).map((s) => s.id);
  assert.equal(botIds.length, 3);
  assert.deepEqual(Object.keys(room.ais).sort(), [...botIds].sort());
  for (const id of Object.values(room.ais)) assert.ok(IDS.includes(id));
  // The same seed gives the same AIs.
  const again = lobby();
  game.start(again, 1, seeded(3));
  assert.deepEqual(again.ais, room.ais);
  // The deal does not depend on the AIs, so existing seeded expectations hold.
  assert.deepEqual(again.board, room.board);
});

test('over many games every AI gets picked, the random AI least often, and a person never gets one', () => {
  const counts = Object.fromEntries(IDS.map((id) => [id, 0]));
  const rng = seeded(8);
  for (let g = 0; g < 600; g++) {
    const room = lobby();
    game.start(room, 1, rng);
    for (const id of Object.values(room.ais)) counts[id]++;
    assert.equal(Object.keys(room.ais).length, 3);
  }
  for (const id of IDS) assert.ok(counts[id] > 0, `${id} is picked sometimes`);
  assert.ok(counts.random < counts.standard && counts.random < counts.sharp, JSON.stringify(counts));
});

test('the view names each bot\'s AI (id and name only) and nobody else\'s', () => {
  const room = lobby(3);
  assert.ok(game.viewFor(room, 1).seats.every((s) => !s || !('ai' in s)), 'nothing in the lobby');
  game.start(room, 1, seeded(5));
  const view = game.viewFor(room, 1);
  view.seats.forEach((seat, i) => {
    if (!room.seats[i].kind || room.seats[i].kind === 'human') return assert.equal('ai' in seat, false, 'a person has no AI');
    const ai = aiById(AIS, room.ais[room.seats[i].id]);
    assert.deepEqual(seat.ai, { id: ai.id, name: ai.name });
  });
  assert.ok(!JSON.stringify(view).includes('chooseMove'));
});

test('the AIs survive being saved and loaded, and the loaded room plays the same moves', () => {
  const room = lobby(3);
  game.start(room, 1, seeded(6));
  const human = game.seatOf(room, 1);
  const rng = seeded(2);
  for (let i = 0; i < 20 && room.phase === 'playing'; i++) {
    const seat = room.pending?.seat ?? room.turn;
    if (seat === human) randomStep(room, rng);
    else bot.runPending(room, rng);
  }
  const loaded = JSON.parse(JSON.stringify(room));
  assert.deepEqual(loaded.ais, room.ais);
  for (let i = 0; i < 30 && room.phase === 'playing'; i++) {
    const seat = room.pending?.seat ?? room.turn;
    if (seat === human) {
      assert.equal(randomStep(room, seeded(i)).ok, true);
      assert.equal(randomStep(loaded, seeded(i)).ok, true);
    } else {
      bot.runPending(room, seeded(i));
      bot.runPending(loaded, seeded(i));
    }
    assert.deepEqual(loaded, room, `step ${i}`);
  }
});

test('a person who leaves mid-game is replaced by a bot that picks an AI then; in the lobby nothing is picked', () => {
  const room = lobby(3);
  room.seats[room.seats.findIndex(game.isBot)] = null;
  game.addHuman(room, 2, 'bob');
  room.seats[room.seats.findIndex(game.isBot)] = null;
  game.addHuman(room, 3, 'cat');
  assert.equal(game.removeHuman(room, 3).ok, true);
  assert.deepEqual(room.ais, {}, 'lobby: nothing recorded');
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(1));
  const before = Object.keys(room.ais).length;
  const seat = game.seatOf(room, 2);
  assert.equal(game.removeHuman(room, 2, () => 0.999).ok, true);
  assert.equal(game.isBot(room.seats[seat]), true);
  assert.equal(Object.keys(room.ais).length, before + 1);
  assert.equal(room.ais[room.seats[seat].id], 'random', 'chosen with the given rng (the last, lightest AI for a roll near 1)');
  assert.ok(game.viewFor(room, 1).seats[seat].ai.id);
});

test('rooms saved before this feature (no ais) fall back to the standard AI everywhere', () => {
  const room = lobby(3);
  game.start(room, 1, seeded(7));
  const old = JSON.parse(JSON.stringify(room));
  delete old.ais;
  assert.equal(bot.aiOf(old, old.seats.findIndex(game.isBot)).id, 'standard');
  const view = game.viewFor(old, 1);
  for (const seat of view.seats.filter((s) => s.bot)) assert.deepEqual(seat.ai, { id: 'standard', name: 'Standard' });
  // And an unknown id (an AI that was later renamed) falls back too.
  const odd = JSON.parse(JSON.stringify(room));
  for (const key of Object.keys(odd.ais)) odd.ais[key] = 'gone';
  assert.equal(bot.aiOf(odd, odd.seats.findIndex(game.isBot)).id, 'standard');
  // Neither stops the bots playing the game out.
  for (const r of [old, odd]) {
    const human = game.seatOf(r, 1);
    let steps = 0;
    const rng = seeded(4);
    while (r.phase === 'playing' && steps++ < 3000) {
      const seat = r.pending?.seat ?? r.turn;
      if (seat === human) randomStep(r, rng);
      else bot.runPending(r, rng);
    }
    assert.equal(r.phase, 'finished');
  }
});

test('play again clears the AIs and the next game picks afresh', () => {
  const room = lobby(2);
  game.start(room, 1, seeded(1));
  const bots = room.seats.filter(game.isBot).map((s) => s.id);
  assert.equal(bots.length, 1);
  room.phase = 'finished';
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.deepEqual(room.ais, {});
  game.start(room, 1, seeded(2));
  assert.deepEqual(Object.keys(room.ais), room.seats.filter(game.isBot).map((s) => s.id));
});

test('over the real site: bots keep their AI through a restart, and a replacement bot gets one', async (t) => {
  fast('5-10');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splendour-ai-'));
  const first = await launchModule(t, { id: 'splendour', moduleDir: here, dataDir, keep: true });
  const ann = await first.person('ann').open();
  const bob = await first.person('bob').open();
  await ann.call('create', { target: 15, seats: 4 });
  assert.equal((await bob.call('join', { code: ann.state.code })).ok, true);
  await until(() => ann.state?.seats.filter(Boolean).length === 2, 'bob joins');
  await ann.call('fillBots');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.phase === 'playing', 'the game starts');
  const aisOf = (state) => Object.fromEntries(state.seats.map((s, i) => [s.name, s.ai?.id]));
  const before = aisOf(ann.state);
  const botSeats = ann.state.seats.filter((s) => s.bot);
  assert.equal(botSeats.length, 2);
  for (const seat of botSeats) assert.ok(IDS.includes(seat.ai.id) && seat.ai.name, 'a bot shows its AI');
  assert.ok(ann.state.seats.filter((s) => !s.bot).every((s) => !('ai' in s)), 'people show none');
  // Bob leaves: a bot takes his seat with an AI of its own.
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => ann.state.seats.filter((s) => s.bot).length === 3, 'a replacement bot');
  const replacement = ann.state.seats.find((s) => s.bot && !(s.name in before));
  assert.ok(replacement && IDS.includes(replacement.ai.id), 'the replacement has an AI');
  const mid = aisOf(ann.state);
  const code = ann.state.code;
  const cookie = ann.cookie;
  for (let i = 0; i < 6; i++) {
    await step(ann);
    await sleep(25);
  }
  await first.stop();

  const second = await launchModule(t, { id: 'splendour', moduleDir: here, dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  assert.equal((await again.call('resume')).ok, true);
  await until(() => again.state?.phase === 'playing' || again.state?.phase === 'finished', 'the saved game');
  assert.equal(again.state.code, code);
  assert.deepEqual(aisOf(again.state), mid, 'every bot has the same AI after the restart');
});
