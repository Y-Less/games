// The Dixnt AIs: the registry, how each one decides (as plain data in, plain answer out), complete games played by
// every AI in every judging style, a seeded tournament, and how an AI is recorded on a computer player.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { seeded } from '../../shared/testkit.js';
import { createRules, JUDGING_MODES } from './game.js';
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

/** Plays a whole game, every place driven by the AI named in `lineup` (an AI id per place); returns the finished room. */
function playGame(lineup, { judging = 'everyone', seed = 1, roundsEach = 2, handSize = 6 } = {}) {
  const rng = seeded(seed);
  const game = createRules({ getCategories: () => categories, hints });
  const room = game.createRoom({ code: 'ai-test-game-here', hostId: 1, hostName: 'P0', now: 0 });
  for (let i = 1; i < lineup.length; i++) assert.equal(game.addHuman(room, i + 1, `P${i}`).ok, true);
  const aiOf = Object.fromEntries(room.players.map((p, i) => [p.id, byId[lineup[i]]]));
  assert.equal(game.setSettings(room, 1, { handSize, roundsEach, judging }).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  const imposters = new Set();
  let guard = 0;
  while (room.phase !== 'finished') {
    assert.ok(++guard < 500, 'the game terminates');
    if (room.phase === 'word') {
      const view = game.viewFor(room, room.chooserId);
      const offered = game.nextHints(room, 3, rng);
      const word = aiOf[room.chooserId].chooseWord({ hints: offered, hand: view.me.hand, cards, round: room.round, judging }, rng);
      assert.ok(offered.includes(word), 'a chosen word is one of the hints');
      assert.equal(game.submitWord(room, room.chooserId, word, rng).ok, true);
    } else if (room.phase === 'picking') {
      for (const p of game.cardPlayers(room)) {
        const view = game.viewFor(room, p.id);
        if (view.wordHidden) imposters.add(`${room.round}:${p.id}`);
        const cardId = aiOf[p.id].playCard({ word: view.word, hand: view.me.hand, cards, round: room.round, judging }, rng);
        assert.ok(view.me.hand.includes(cardId), 'the card is from the hand');
        assert.equal(game.playCard(room, p.id, cardId, rng).ok, true);
      }
    } else if (room.phase === 'voting') {
      for (const p of game.voters(room)) {
        if (room.phase !== 'voting') break;
        const view = game.viewFor(room, p.id);
        const targetId = aiOf[p.id].vote({ word: view.word, table: view.table, targets: view.voteTargets, me: p.id, imposter: imposters.has(`${room.round}:${p.id}`), chooser: view.me.isChooser, judging, cards, scores: {} }, rng);
        assert.ok(view.voteTargets.includes(targetId), 'the vote is for a legal target');
        assert.equal(game.vote(room, p.id, targetId).ok, true);
      }
    } else if (room.phase === 'results') {
      assert.equal(game.nextRound(room, room.hostId, rng).ok, true);
    }
  }
  return room;
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
        const room = playGame([ai.id, ai.id, ai.id, ai.id], { judging, seed });
        assert.equal(room.phase, 'finished', `${ai.id} ${judging}`);
        assert.equal(room.completed, 8, 'each of four players chose twice');
      }
    }
    assert.equal(playGame(AIS.map((a) => a.id), { judging, seed: 9 }).phase, 'finished', 'all five mixed');
    assert.equal(playGame(['sharp', 'random', 'literal'], { judging, seed: 4, handSize: 3 }).phase, 'finished', 'the minimum of three players');
  }
});

test('every AI is deterministic for a given seed', () => {
  for (const ai of AIS) {
    const a = playGame([ai.id, 'random', 'sharp', ai.id], { seed: 21 });
    const b = playGame([ai.id, 'random', 'sharp', ai.id], { seed: 21 });
    assert.deepEqual(a.players.map((p) => p.score), b.players.map((p) => p.score), ai.id);
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
      const room = playGame(Array(players).fill(ai), { seed, judging: 'everyone', roundsEach: 3 });
      for (const round of room.history) {
        // The notes a view carries are messages: `{ key: 'notes.imposterCaught' }` and friends.
        for (const note of Object.values(round.notes)) {
          if (note.key.startsWith('notes.imposter')) rounds++;
          if (note.key === 'notes.imposterCaught') caught++;
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

test('an AI is dealt to a computer player, shown as { id, name } for them only, saved and restored', () => {
  const game = createRules({ getCategories: () => categories, hints });
  const rng = seeded(4);
  const room = game.createRoom({ code: 'ai-dealt-here', hostId: 1, hostName: 'Host', now: 0 });
  assert.equal(game.addHuman(room, 2, 'Human').ok, true);
  assert.equal(game.addBot(room, 1).id, 'bot:1');
  const seat = (r, id) => game.viewFor(r, 1).players.find((p) => p.id === id);
  assert.equal(seat(room, 'bot:1').ai, null, 'a computer player has none until the game starts');

  assert.equal(game.start(room, 1, rng).ok, true);
  const dealt = seat(room, 'bot:1').ai;
  assert.deepEqual(Object.keys(dealt).sort(), ['id', 'name'], 'only the public part is shown');
  assert.ok(AIS.some((ai) => ai.id === dealt.id), `${dealt.id} is one of the AIs`);
  assert.equal(seat(room, 1).ai, null, 'and a person has none');
  assert.equal(seat(room, 2).ai, null);

  // A save and restore keeps it.
  const restored = game.migrate(JSON.parse(JSON.stringify(room)));
  assert.deepEqual(seat(restored, 'bot:1').ai, dealt);

  // A room saved with an AI that no longer exists falls back to the first AI; one saved before this feature has none.
  const saved = JSON.parse(JSON.stringify(room));
  saved.players.find((p) => p.id === 'bot:1').ai = 'retired';
  delete saved.players.find((p) => p.id === 2).ai;
  const old = game.migrate(saved);
  assert.deepEqual(seat(old, 'bot:1').ai, { id: 'standard', name: 'Standard' });
  assert.equal(seat(old, 2).ai, null);
});
