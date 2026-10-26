// The Dixnt AIs: the registry, how each one decides (as plain data in, plain answer out), complete games played by
// every AI in every judging style, a seeded tournament, and how an AI is recorded on a seat.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { seeded } from '../../shared/testkit.js';
import { Game, GameError, JUDGING_MODES } from './game.js';
import { AIS, buildCardInfo } from './ai/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const hints = fs.readFileSync(path.join(here, 'hints.txt'), 'utf8').split(/\r?\n/).map((h) => h.trim()).filter(Boolean);
const byId = Object.fromEntries(AIS.map((ai) => [ai.id, ai]));

// Eight categories with the real labels and descriptions, 40 fake cards each (ids 1001.., 2001.., ...).
const realCategories = JSON.parse(fs.readFileSync(path.join(here, 'cards', 'categories.json'), 'utf8')).categories;
const categories = realCategories.map((c, i) => ({ key: c.key, label: c.label, description: c.description, ids: Array.from({ length: 40 }, (_, n) => (i + 1) * 1000 + n + 1) }));
const cards = buildCardInfo({ categories });
const idsOf = (key) => categories.find((c) => c.key === key).ids;
const firstOf = (key) => idsOf(key)[0];

/** Plays a whole game, every seat driven by the AI named in `lineup` (an AI id per seat); returns the finished game. */
function playGame(lineup, { judging = 'everyone', seed = 1, roundsEach = 2, handSize = 6 } = {}) {
  const rng = seeded(seed);
  const game = new Game({ getCategories: () => categories, hints, rng });
  const players = lineup.map((_, i) => game.addPlayer(`P${i}`, `t${i}`));
  players.forEach((p, i) => (p.id = `p${i}`)); // the game's own ids are random; fixed ones keep the run repeatable
  game.s.hostId = players[0].id;
  const aiOf = Object.fromEntries(players.map((p, i) => [p.id, byId[lineup[i]]]));
  game.setHandSize(players[0].id, handSize);
  game.setRounds(players[0].id, roundsEach);
  game.setJudging(players[0].id, judging);
  game.start(players[0].id);
  const imposters = new Set();
  let guard = 0;
  while (game.s.phase !== 'finished') {
    assert.ok(++guard < 500, 'the game terminates');
    const s = game.s;
    if (s.phase === 'word') {
      const view = game.viewFor(s.chooserId);
      const offered = game.nextHints(3);
      const word = aiOf[s.chooserId].chooseWord({ hints: offered, hand: view.me.hand, cards, round: s.round, judging }, rng);
      assert.ok(offered.includes(word), 'a chosen word is one of the hints');
      game.submitWord(s.chooserId, word);
    } else if (s.phase === 'picking') {
      for (const p of game.cardPlayers()) {
        const view = game.viewFor(p.id);
        if (view.wordHidden) imposters.add(`${s.round}:${p.id}`);
        const cardId = aiOf[p.id].playCard({ word: view.word, hand: view.me.hand, cards, round: s.round, judging }, rng);
        assert.ok(view.me.hand.includes(cardId), 'the card is from the hand');
        game.playCard(p.id, cardId);
      }
    } else if (s.phase === 'voting') {
      for (const p of game.voters()) {
        if (s.phase !== 'voting') break;
        const view = game.viewFor(p.id);
        const targetId = aiOf[p.id].vote({ word: view.word, table: view.table, targets: view.voteTargets, me: p.id, imposter: imposters.has(`${s.round}:${p.id}`), chooser: view.me.isChooser, judging, cards, scores: {} }, rng);
        assert.ok(view.voteTargets.includes(targetId), 'the vote is for a legal target');
        game.vote(p.id, targetId);
      }
    } else if (s.phase === 'results') {
      game.nextRound(s.hostId);
    }
  }
  return game;
}

test('the registry is valid, has the required AIs and falls back safely', () => {
  assert.deepEqual(AIS.map((ai) => ai.id), ['standard', 'random', 'literal', 'contrarian', 'sharp']);
  for (const ai of AIS) {
    assert.ok(ai.name && ai.description && ai.weight > 0, ai.id);
    for (const fn of ['chooseWord', 'playCard', 'vote']) assert.equal(typeof ai[fn], 'function', `${ai.id}.${fn}`);
  }
  assert.ok(byId.random.weight < byId.standard.weight, 'random is rarer than the standard bot');
  assert.equal(aiById(AIS, 'gone').id, 'standard', 'an unknown saved id falls back to the first AI');
  const picks = new Set(Array.from({ length: 400 }, (_, i) => pickAI(AIS, seeded(i + 1)).id));
  assert.deepEqual([...picks].sort(), AIS.map((a) => a.id).sort(), 'every AI can be picked');
  const assigned = assignAIs(AIS, ['a', 'b', 'c'], seeded(3));
  assert.deepEqual(Object.keys(assigned), ['a', 'b', 'c']);
  for (const id of Object.values(assigned)) assert.ok(byId[id]);
});

test('every AI plays complete, legal games in every judging style', () => {
  for (const judging of JUDGING_MODES) {
    for (const ai of AIS) {
      for (const seed of [1, 2, 3]) {
        const game = playGame([ai.id, ai.id, ai.id, ai.id], { judging, seed });
        assert.equal(game.s.phase, 'finished', `${ai.id} ${judging}`);
        assert.equal(game.s.completed, 8, 'each of four players chose twice');
      }
    }
    assert.equal(playGame(AIS.map((a) => a.id), { judging, seed: 9 }).s.phase, 'finished', 'all five mixed');
    assert.equal(playGame(['sharp', 'random', 'literal'], { judging, seed: 4, handSize: 3 }).s.phase, 'finished', 'the minimum of three players');
  }
});

test('every AI is deterministic for a given seed', () => {
  for (const ai of AIS) {
    const a = playGame([ai.id, 'random', 'sharp', ai.id], { seed: 21 });
    const b = playGame([ai.id, 'random', 'sharp', ai.id], { seed: 21 });
    assert.deepEqual(a.s.players.map((p) => p.score), b.s.players.map((p) => p.score), ai.id);
  }
});

test('standard and random choose among the legal options', () => {
  const rng = seeded(5);
  for (const id of ['standard', 'random']) {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(byId[id].playCard({ word: 'x', hand: [1, 2, 3, 4], cards }, rng));
    assert.deepEqual([...seen].sort(), [1, 2, 3, 4], `${id} reaches every card`);
    assert.equal(byId[id].vote({ targets: ['only'], table: [], cards }, rng), 'only');
    assert.equal(byId[id].chooseWord({ hints: ['one'], hand: [], cards }, rng), 'one');
  }
});

test('with no card information the smart AIs still answer legally', () => {
  const none = buildCardInfo(null);
  const rng = seeded(1);
  for (const id of ['literal', 'contrarian', 'sharp']) {
    const ai = byId[id];
    assert.ok([1, 2, 3].includes(ai.playCard({ word: 'dragon', hand: [1, 2, 3], cards: none }, rng)));
    assert.ok([1, 2, 3].includes(ai.playCard({ word: null, hand: [1, 2, 3], cards: none }, rng)));
    assert.ok(['a', 'b'].includes(ai.vote({ word: 'dragon', table: [{ playerId: 'a', cardId: 1 }, { playerId: 'b', cardId: 2 }], targets: ['a', 'b'], judging: 'everyone', cards: none }, rng)));
    assert.ok(['x', 'y'].includes(ai.chooseWord({ hints: ['x', 'y'], hand: [], cards: none }, rng)));
  }
});

test('literal plays the card that suits the word, and distrusts the one that does not', () => {
  const rng = seeded(2);
  const hand = [firstOf('food'), firstOf('fantasy'), firstOf('sci_fi'), firstOf('medieval')];
  assert.equal(byId.literal.playCard({ word: 'dragon', hand, cards }, rng), firstOf('fantasy'));
  assert.equal(byId.literal.playCard({ word: 'robot', hand, cards }, rng), firstOf('sci_fi'));
  assert.equal(byId.literal.playCard({ word: 'bakery feast', hand, cards }, rng), firstOf('food'));
  const table = [{ playerId: 'a', cardId: idsOf('fantasy')[1] }, { playerId: 'b', cardId: idsOf('food')[1] }, { playerId: 'c', cardId: idsOf('fantasy')[2] }];
  assert.equal(byId.literal.vote({ word: 'dragon', table, targets: ['a', 'b', 'c'], judging: 'everyone', cards }, rng), 'b', 'the card that does not fit is the bluff');
  assert.notEqual(byId.literal.vote({ word: 'dragon', table, targets: ['a', 'b', 'c'], judging: 'favourite', cards }, rng), 'b', 'a favourite is a card that fits');
  assert.equal(byId.literal.chooseWord({ hints: ['respite', 'dragon', 'hush'], hand: [], cards }, rng), 'dragon', 'prefers a clue it can match');
});

test('contrarian gives vague clues, plays half-fitting cards and suspects the neat fit', () => {
  const rng = seeded(3);
  assert.equal(byId.contrarian.chooseWord({ hints: ['dragon', 'respite', 'robot'], hand: [], cards }, rng), 'respite');
  // "castle feast" suits medieval fully, food partly and sci-fi not at all: the ambiguous card is the middle one.
  const hand = [firstOf('medieval'), firstOf('food'), firstOf('sci_fi')];
  assert.equal(byId.contrarian.playCard({ word: 'castle feast', hand, cards }, rng), firstOf('food'), 'avoids both the obvious and the absurd');
  const table = [{ playerId: 'a', cardId: firstOf('medieval') }, { playerId: 'b', cardId: firstOf('sci_fi') }];
  assert.equal(byId.contrarian.vote({ word: 'castle', table, targets: ['a', 'b'], judging: 'everyone', cards }, rng), 'a', 'suspects the too-neat card');
});

test('sharp finds the odd one out, agrees with other sharp bots and bluffs sensibly when it cannot see the word', () => {
  const fantasy = idsOf('fantasy');
  const table = [
    { playerId: 'p3', cardId: fantasy[1] },
    { playerId: 'p1', cardId: fantasy[2] },
    { playerId: 'p2', cardId: firstOf('food') },
    { playerId: 'p4', cardId: fantasy[3] },
  ];
  const input = { word: 'dragon', table, targets: ['p1', 'p2', 'p3', 'p4'], judging: 'everyone', cards };
  assert.equal(byId.sharp.vote(input, seeded(1)), 'p2');
  assert.equal(byId.sharp.vote({ ...input, word: 'respite' }, seeded(1)), 'p2', 'the odd card stands out even for a clue the word list does not know');
  // With nothing to go on, every sharp bot accuses the same player, whatever the random numbers are.
  const flat = { ...input, word: 'respite', table: table.map((r, i) => ({ ...r, cardId: fantasy[i] })) };
  assert.equal(new Set([1, 2, 3, 4, 5].map((seed) => byId.sharp.vote(flat, seeded(seed)))).size, 1);
  // Bluffing blind: the category the hand holds most of.
  const hand = [firstOf('food'), idsOf('sci_fi')[0], idsOf('sci_fi')[1], idsOf('sci_fi')[2]];
  assert.ok(idsOf('sci_fi').includes(byId.sharp.playCard({ word: null, hand, cards }, seeded(1))));
  // A favourite is simply the best fit.
  assert.equal(byId.sharp.vote({ ...input, judging: 'favourite', targets: ['p1', 'p2'] }, seeded(1)), 'p1');
});

test('seeded tournament: how often a table of each AI catches the imposter (everyone votes)', () => {
  const caughtRate = (ai, players) => {
    let caught = 0;
    let rounds = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const game = playGame(Array(players).fill(ai), { seed, judging: 'everyone', roundsEach: 3 });
      for (const round of game.s.history) {
        for (const note of Object.values(round.notes)) {
          if (note.startsWith('imposter')) rounds++;
          if (note === 'imposter, caught') caught++;
        }
      }
    }
    return caught / rounds;
  };
  const rate = Object.fromEntries(['random', 'literal', 'sharp'].map((ai) => [ai, [caughtRate(ai, 4), caughtRate(ai, 6)]]));
  console.log('dixnt tournament (share of imposters caught, 4 and 6 players, 150 seeded games each):', JSON.stringify(rate));
  for (const size of [0, 1]) {
    assert.ok(rate.literal[size] > rate.random[size] + 0.08, 'literal beats random');
    assert.ok(rate.sharp[size] > rate.literal[size] + 0.05, 'sharp beats literal');
  }
});

test('an AI is recorded on a bot seat, shown as { id, name } for bots only, saved and restored', () => {
  const game = new Game({ getCategories: () => categories, hints });
  const [host, bot, human] = ['Host', 'Bot', 'Human'].map((n) => game.addPlayer(n, `t-${n}`));
  assert.throws(() => game.setAI(bot.id, 'wizardry'), GameError, 'unknown AIs are refused');
  assert.throws(() => game.setAI('nobody', 'sharp'), GameError, 'the seat must exist');
  game.setAI(bot.id, 'sharp');
  const seat = (g, id) => g.viewFor(host.id).players.find((p) => p.id === id);
  assert.deepEqual(seat(game, bot.id).ai, { id: 'sharp', name: 'Sharp' });
  assert.equal(seat(game, host.id).ai, null);
  assert.equal(seat(game, human.id).ai, null);
  // A re-declaration replaces it, and a save/restore round trip keeps it.
  game.setAI(bot.id, 'literal');
  const restored = new Game({ getCategories: () => categories, hints, saved: JSON.parse(JSON.stringify(game.toJSON())) });
  assert.deepEqual(seat(restored, bot.id).ai, { id: 'literal', name: 'Literal' });
  // A room saved with an AI that no longer exists falls back to the first AI; a seat saved before this feature has none.
  const saved = JSON.parse(JSON.stringify(game.toJSON()));
  saved.players.find((p) => p.id === bot.id).ai = 'retired';
  delete saved.players.find((p) => p.id === human.id).ai;
  const old = new Game({ getCategories: () => categories, hints, saved });
  assert.deepEqual(seat(old, bot.id).ai, { id: 'standard', name: 'Standard' });
  assert.equal(seat(old, human.id).ai, null);
});
