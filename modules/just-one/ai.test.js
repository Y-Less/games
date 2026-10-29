// The Just One computer players: the registry, what each one decides, and the traits that tell them apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AIS } from './ai/index.js';
import { link } from './ai/standard.js';
import { clueProblem } from './game.js';
import { WORDS, relatedTo } from './words.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { seeded } from '../../shared/testkit.js';

const byId = (id) => AIS.find((ai) => ai.id === id);
const wordsOf = WORDS.map((w) => w.word);

test('the registry has the standard player first (the fallback), then the others, all with what a game needs', () => {
  assert.deepEqual(AIS.map((ai) => ai.id), ['standard', 'adventurous', 'random']);
  for (const ai of AIS) {
    for (const decide of ['clue', 'guess', 'best']) assert.equal(typeof ai[decide], 'function', `${ai.id}.${decide}`);
    assert.ok(ai.name && ai.description, ai.id);
    assert.deepEqual(Object.keys(describeAI(ai)).sort(), ['description', 'id', 'name'], 'a view never shows the functions');
  }
  assert.equal(aiById(AIS, 'no-such-ai').id, 'standard');
  assert.ok(Object.values(assignAIs(AIS, ['bot:1', 'bot:2'], seeded(3))).every((id) => byId(id)));
  const counts = { standard: 0, adventurous: 0, random: 0 };
  for (let i = 1; i <= 3000; i++) counts[pickAI(AIS, seeded(i)).id]++;
  assert.ok(counts.standard > counts.adventurous && counts.adventurous > counts.random && counts.random > 0, JSON.stringify(counts));
});

test('how strongly a clue points to a word: the first usual clue most, later ones less, unknown ones not at all', () => {
  const related = relatedTo('apple');
  assert.ok(link('apple', related[0]) > link('apple', related[1]));
  assert.ok(link('apple', related[1]) > link('apple', related[5]));
  assert.ok(link('apple', related[5]) > 0);
  assert.equal(link('apple', 'zzzz'), 0);
  assert.equal(link('apple', related[0].toUpperCase()), link('apple', related[0]), 'case does not matter');
  assert.equal(link('nonsense', 'fruit'), 0);
});

test('every AI always writes a clue the rules allow, for every word', () => {
  for (const ai of AIS) {
    for (const { word, related } of WORDS) {
      for (let seed = 1; seed <= 6; seed++) {
        const clue = ai.clue({ word, related }, seeded(seed));
        assert.equal(typeof clue, 'string', `${ai.id} ${word}`);
        assert.equal(clueProblem(clue, word), null, `${ai.id} ${word}: ${clue}`);
        assert.ok(related.includes(clue), `${ai.id} ${word}: ${clue} is one of the usual clues`);
      }
    }
  }
});

test('the standard player gives one of the first usual clues, and the adventurous one reaches for later ones', () => {
  const where = (id) => {
    const positions = [];
    for (const { word, related } of WORDS) for (let seed = 1; seed <= 8; seed++) positions.push(related.indexOf(byId(id).clue({ word, related }, seeded(seed))));
    return positions;
  };
  const standard = where('standard');
  const adventurous = where('adventurous');
  assert.ok(standard.every((i) => i >= 0 && i < 4), 'the first four');
  assert.ok(adventurous.every((i) => i >= 3 && i < 8));
  assert.ok(standard.reduce((a, b) => a + b) / standard.length < adventurous.reduce((a, b) => a + b) / adventurous.length);
});

test('as the guesser, the standard player finds the word from two of its usual clues, nearly always', () => {
  let right = 0;
  let total = 0;
  for (const { word, related } of WORDS) {
    total++;
    if (byId('standard').guess({ clues: [related[0], related[1]], words: wordsOf }, seeded(total)) === word) right++;
  }
  assert.ok(right / total > 0.9, `${right} of ${total}`);
  // Three clues are better than one.
  let one = 0;
  for (const { word, related } of WORDS) if (byId('standard').guess({ clues: [related[0]], words: wordsOf }, seeded(7)) === word) one++;
  assert.ok(right >= one, `${right} with two clues, ${one} with one`);
});

test('as the guesser, clues it does not know make the standard player pass, and the random one guess anything or pass', () => {
  for (const clues of [[], ['zzzz'], ['qqqq', 'xxxx']]) assert.equal(byId('standard').guess({ clues, words: wordsOf }, seeded(1)), '', JSON.stringify(clues));
  const guesses = new Set();
  let passes = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const g = byId('random').guess({ clues: ['x'], words: wordsOf }, seeded(seed));
    if (g === '') passes++;
    else assert.ok(wordsOf.includes(g));
    guesses.add(g);
  }
  assert.ok(passes > 20 && passes < 120, `about a fifth pass (${passes})`);
  assert.ok(guesses.size > 40, 'and the rest are all over the list');
});

test('having guessed right, the standard player picks the clue most tied to the word', () => {
  const related = relatedTo('castle');
  const pick = (clues) => byId('standard').best({ word: 'castle', clues }, seeded(1));
  assert.equal(pick(['zzzz', related[3], related[0], related[5]]), 2);
  assert.equal(pick([related[4], related[2]]), 1);
  assert.equal(pick(['zzzz']), 0, 'with nothing it knows it still names a legal one');
  for (const ai of AIS) {
    const n = ai.best({ word: 'castle', clues: ['a', 'b', 'c'] }, seeded(5));
    assert.ok(Number.isInteger(n) && n >= 0 && n < 3, `${ai.id}: ${n}`);
  }
});

test('the same seed makes the same decisions, so a seeded game is repeatable', () => {
  for (const ai of AIS) {
    const decide = (seed) => [
      ai.clue({ word: 'owl', related: relatedTo('owl') }, seeded(seed)),
      ai.guess({ clues: ['night', 'hoot'], words: wordsOf }, seeded(seed)),
      ai.best({ word: 'owl', clues: ['night', 'hoot', 'zzz'] }, seeded(seed)),
    ];
    assert.deepEqual(decide(9), decide(9), ai.id);
  }
});
