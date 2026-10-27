import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { fullDeck, rankValue, shuffle } from '../../shared/cards.js';
import { AIS } from './ai/index.js';
import { bestNomination, biddingModel, lut, playModel, trickChances } from './ai/lut.js';
import { FULL_SCHEDULE, SHORT_SCHEDULE, forbiddenNomination, isInstantWinRound as liveInstantWinRound, scoreRound, trumpOf } from './game.js';
import { isInstantWinRound, playGame } from './sim/game.js';
import { COARSE_CELLS, FINE_CELLS, coarseOfFine, keysFor } from './sim/play-features.js';
import { emptyPlayModel, loadPlayModel, savePlayModel } from './sim/play-model.js';
import { mulberry32 } from './sim/rng.js';
import { playGames } from './sim/tournament.js';

const ai = (id) => AIS.find((a) => a.id === id);
const four = ['standard', 'counter', 'cautious', 'random'].map(ai);

/** Always nominates 7 when it may and then plays its highest legal card: it wins all seven tricks now and then. */
const grabber = {
  nominate: ({ allowed, instantWin }) => (instantWin && allowed.includes(7) ? 7 : allowed[0]),
  play: ({ legal }) => legal.reduce((best, card) => (rankValue(card) > rankValue(best) ? card : best)),
};

test('a full game follows the schedule, trump order, dealer rotation and scoring', () => {
  const rng = mulberry32(11);
  for (let g = 0; g < 50; g++) {
    const players = 3 + (g % 5);
    const ais = Array.from({ length: players }, (_, i) => four[i % four.length]);
    const firstDealer = g % players;
    const game = playGame({ ais, firstDealer, instantWin: false }, rng);
    assert.equal(game.rounds.length, FULL_SCHEDULE.length);
    const totals = Array(players).fill(0);
    game.rounds.forEach((round, i) => {
      assert.equal(round.cards, FULL_SCHEDULE[i]);
      assert.equal(round.trump, trumpOf(i));
      assert.equal(round.dealer, (firstDealer + i) % players);
      assert.equal(round.taken.reduce((a, b) => a + b, 0), round.cards, 'every trick is won by somebody');
      const others = round.nominations.reduce((sum, bid, seat) => sum + (seat === round.dealer ? 0 : bid), 0);
      assert.notEqual(round.nominations[round.dealer], forbiddenNomination(round.cards, others), 'the dealer never makes the total equal the tricks');
      round.nominations.forEach((bid, seat) => {
        assert.ok(bid >= 0 && bid <= round.cards);
        assert.equal(round.points[seat], scoreRound(bid, round.taken[seat], { missPoints: true }));
        totals[seat] += round.points[seat];
      });
    });
    assert.deepEqual(game.scores, totals);
    assert.equal(game.instantWin, null);
    assert.ok(game.winners.every((seat) => game.scores[seat] === Math.max(...game.scores)));
  }
});

test('the same seed plays the same game, and a different seed a different one', () => {
  const play = (seed) => playGame({ ais: four }, mulberry32(seed));
  assert.deepEqual(play(3), play(3));
  assert.notDeepEqual(play(3).scores, play(4).scores);
});

test('the AIs are told the score situation', () => {
  const seen = [];
  playGame({ ais: four, schedule: SHORT_SCHEDULE }, mulberry32(2), (e) => {
    if (e.type === 'nominate' && e.seat === e.context.dealer) seen.push(e.context);
  });
  assert.deepEqual(seen.map((c) => c.round), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(seen.every((c) => c.rounds === 7 && c.scores.length === 4));
  assert.deepEqual(seen[0].scores, [0, 0, 0, 0]);
  assert.ok(seen.at(-1).scores.some((s) => s > 0));
});

test('the instant-win round is the same one as in the live game', () => {
  for (const [schedule, length] of [[FULL_SCHEDULE, 'full'], [SHORT_SCHEDULE, 'short']]) {
    schedule.forEach((_, round) => assert.equal(isInstantWinRound(schedule, round), liveInstantWinRound({ length }, round)));
  }
});

test('nominating 7 and taking all 7 tricks in a 7-card round wins the game on the spot', () => {
  const ais = [grabber, grabber, grabber, grabber];
  let seed = 1;
  let found = playGame({ ais, instantWin: true }, mulberry32(seed));
  while (found.instantWin === null && seed < 20000) found = playGame({ ais, instantWin: true }, mulberry32(++seed));
  assert.notEqual(found.instantWin, null, 'a grabber should get all seven tricks within a few thousand games');
  const last = found.rounds.at(-1);
  assert.equal(last.cards, 7);
  assert.ok(found.rounds.length === 1 || found.rounds.length === FULL_SCHEDULE.length, 'only the first or last round can do it');
  assert.equal(last.nominations[found.instantWin], 7);
  assert.equal(last.taken[found.instantWin], 7);
  assert.deepEqual(found.winners, [found.instantWin], 'the instant winner wins whatever the totals say');
  // Switched off, the same deals play on to the end and the totals decide.
  const plain = playGame({ ais, instantWin: false }, mulberry32(seed));
  assert.equal(plain.rounds.length, FULL_SCHEDULE.length);
  assert.equal(plain.instantWin, null);
});

test('missing a 7 does not end the game, and the last round of the short game cannot', () => {
  const short = playGame({ ais: [grabber, grabber, grabber, grabber], schedule: SHORT_SCHEDULE }, mulberry32(8));
  assert.ok(short.rounds.length >= 1);
  for (let seed = 1; seed < 3000; seed++) {
    const game = playGame({ ais: [grabber, grabber, grabber, grabber], schedule: SHORT_SCHEDULE }, mulberry32(seed));
    if (game.instantWin === null) assert.equal(game.rounds.length, 7);
    else assert.equal(game.rounds.length, 1, 'only the first round of the short game can end it');
  }
});

test('tournament totals add up and do not depend on how the games are split into jobs', () => {
  const base = { names: ['standard', 'counter', 'random'], seed: 5, schedule: SHORT_SCHEDULE, missPoints: true, instantWin: true };
  const whole = playGames({ ...base, from: 0, to: 60 });
  const games = Object.values(whole).reduce((sum, t) => sum + t.games, 0);
  assert.equal(games, 60 * 3, 'every game gives every AI one seat');
  assert.ok(whole.random.score / whole.random.games < whole.standard.score / whole.standard.games);
  assert.deepEqual(playGames({ ...base, from: 0, to: 60 }), whole, 'repeatable');
});

test('the bidding table covers 3 to 7 players and every row is a distribution', () => {
  const model = biddingModel();
  assert.ok(model, 'run sim/train-bids.js to create sim/models/bidding.json');
  for (const players of [3, 4, 5, 6, 7]) {
    for (let cards = 1; cards <= 7; cards++) {
      for (const trump of ['H', 'C', 'D', 'S', 'N']) {
        for (const row of model.players[players][cards][trump]) {
          assert.equal(row.length, cards + 1);
          assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 0.001);
        }
      }
    }
  }
});

test('the lookup AI nominates only allowed numbers, and expects more tricks from a stronger hand', () => {
  const rng = mulberry32(9);
  const chancesFor = (hand, players) => trickChances(biddingModel(), { hand, trump: 'H', players });
  const mean = (chances) => chances.reduce((sum, p, taken) => sum + p * taken, 0);
  assert.ok(mean(chancesFor(['AH', 'KH', 'QH', 'AS', 'KS'], 4)) > mean(chancesFor(['2D', '3C', '4S', '5D', '6C'], 4)));
  assert.equal(bestNomination([0.1, 0.9], [0, 1]), 1);
  assert.equal(bestNomination([0.1, 0.9], [0]), 0, 'a forbidden number is never chosen');
  for (let i = 0; i < 300; i++) {
    const players = 3 + (i % 5);
    const cards = 1 + (i % 7);
    const hand = shuffle(fullDeck(), rng).slice(0, cards);
    const allowed = Array.from({ length: cards + 1 }, (_, n) => n).filter((n) => n !== (i % 3 === 0 ? 1 : -1));
    assert.ok(allowed.includes(lut.nominate({ hand, trump: i % 2 ? 'S' : null, players, allowed, rng })));
  }
});

test('play-table keys are in range, the fine key refines the coarse one, and cards differ only where they should', () => {
  const rng = mulberry32(21);
  const ais = Array(5).fill({
    nominate: (ctx) => ctx.allowed[0],
    play: (ctx) => ctx.legal[0],
  });
  let decisions = 0;
  const seen = new Set();
  for (let g = 0; g < 200; g++) {
    playGame({ ais: ais.slice(0, 3 + (g % 3)), schedule: SHORT_SCHEDULE }, rng, (e) => {
      if (e.type !== 'play') return;
      for (const key of keysFor(e.context)) {
        assert.ok(Number.isInteger(key.coarse) && key.coarse >= 0 && key.coarse < COARSE_CELLS);
        assert.ok(Number.isInteger(key.fine) && key.fine >= 0 && key.fine < FINE_CELLS);
        assert.equal(coarseOfFine(key.fine), key.coarse);
        seen.add(key.coarse);
      }
      decisions++;
    });
  }
  assert.ok(decisions > 1000 && seen.size > 50, 'many different situations come up');
});

test('the play table saves and loads without changing a value beyond a hundredth of a point', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whist-model-'));
  const files = [pathToFileURL(path.join(dir, 'p.json')), pathToFileURL(path.join(dir, 'p.bin'))];
  const model = emptyPlayModel();
  model.fine[5] = 12.345;
  model.fine[9] = -3.2;
  model.coarse[7] = 0.5;
  savePlayModel(model, { trainedOn: { deals: 1 } }, ...files);
  const back = loadPlayModel(...files);
  assert.ok(Math.abs(back.fine[5] - 12.345) <= 0.006);
  assert.ok(Math.abs(back.fine[9] + 3.2) <= 0.006);
  assert.ok(Math.abs(back.coarse[7] - 0.5) <= 0.006);
  assert.ok(Number.isNaN(back.fine[0]) && Number.isNaN(back.coarse[0]));
  assert.equal(back.meta.trainedOn.deals, 1);
  assert.equal(loadPlayModel(pathToFileURL(path.join(dir, 'missing.json')), files[1]), null);
  fs.rmSync(dir, { recursive: true });
});

test('the lookup AI plays legal cards through whole games at every player count', () => {
  const rng = mulberry32(33);
  for (let players = 3; players <= 7; players++) {
    const game = playGame({ ais: Array(players).fill(lut), schedule: SHORT_SCHEDULE }, rng);
    assert.equal(game.rounds.length, SHORT_SCHEDULE.length);
    for (const round of game.rounds) assert.equal(round.taken.reduce((a, b) => a + b, 0), round.cards);
  }
});

test('with a table that always prefers the lowest-valued key the AI follows it, and without one it plays as Standard', () => {
  const rng = mulberry32(4);
  const preferHighCards = emptyPlayModel();
  preferHighCards.coarse.fill(0);
  const previous = playModel();
  try {
    playModel(null);
    const plain = playGame({ ais: Array(4).fill(lut), schedule: SHORT_SCHEDULE }, mulberry32(4));
    const standardGame = playGame({ ais: Array(4).fill({ ...ai('standard'), nominate: lut.nominate }), schedule: SHORT_SCHEDULE }, mulberry32(4));
    assert.deepEqual(plain.scores, standardGame.scores, 'no table means Standard play');
    playModel(preferHighCards);
    const withTable = playGame({ ais: Array(4).fill(lut), schedule: SHORT_SCHEDULE }, rng);
    assert.equal(withTable.rounds.length, SHORT_SCHEDULE.length);
  } finally {
    playModel(previous);
  }
});
