// The Wavelength computer players: the registry, what each one decides, and the traits that tell them apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AIS } from './ai/index.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { SPECTRA } from './spectra.js';
import { seeded } from '../../shared/testkit.js';

const byId = (id) => AIS.find((ai) => ai.id === id);
const sample = (fn, n = 400) => Array.from({ length: n }, (_, i) => fn(seeded(i + 1), i));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('the registry has the standard player first (the fallback), then the others, all with what a game needs', () => {
  assert.deepEqual(AIS.map((ai) => ai.id), ['standard', 'wobbly', 'random']);
  for (const ai of AIS) {
    assert.equal(typeof ai.clue, 'function', ai.id);
    assert.equal(typeof ai.guess, 'function', ai.id);
    assert.ok(ai.name && ai.description, ai.id);
    assert.deepEqual(Object.keys(describeAI(ai)).sort(), ['description', 'id', 'name'], 'a view never shows the functions');
  }
  assert.equal(aiById(AIS, 'no-such-ai').id, 'standard', 'an unknown AI falls back to the first');
  assert.ok(byId('standard').weight > byId('random').weight, 'the strong ones are the common ones');
  const picks = assignAIs(AIS, ['bot:1', 'bot:2', 'bot:3'], seeded(4));
  assert.deepEqual(Object.keys(picks), ['bot:1', 'bot:2', 'bot:3']);
  assert.ok(Object.values(picks).every((id) => byId(id)));
  const counts = { standard: 0, wobbly: 0, random: 0 };
  for (const r of sample((rng) => pickAI(AIS, rng).id, 3000)) counts[r]++;
  assert.ok(counts.standard > counts.wobbly && counts.wobbly > counts.random && counts.random > 0, JSON.stringify(counts));
});

test('as the psychic, the standard players say the example clue nearest the target, for every spectrum', () => {
  for (const spectrum of SPECTRA) {
    for (let target = 13; target <= 87; target += 3) {
      const clue = byId('standard').clue({ target, anchors: spectrum.anchors }, seeded(1));
      const chosen = spectrum.anchors.find((a) => a.text === clue);
      assert.ok(chosen, `${spectrum.id}: the clue is one of the examples`);
      const best = Math.min(...spectrum.anchors.map((a) => Math.abs(a.position - target)));
      assert.equal(Math.abs(chosen.position - target), best, `${spectrum.id} at ${target}`);
    }
  }
  const clues = new Set(sample((rng) => byId('random').clue({ anchors: SPECTRA[0].anchors }, rng)));
  assert.ok(clues.size > 2, 'the random one says different things');
});

test('as a guesser, the standard players turn the dial to near the example the clue names', () => {
  for (const spectrum of SPECTRA) {
    for (const anchor of spectrum.anchors) {
      for (const [id, wobble] of [['standard', 12], ['wobbly', 30]]) {
        for (const position of sample((rng) => byId(id).guess({ clue: anchor.text, anchors: spectrum.anchors }, rng), 30)) {
          assert.ok(Math.abs(position - anchor.position) <= wobble + 1e-9, `${id} ${spectrum.id} "${anchor.text}": ${position}`);
        }
      }
    }
  }
  // The words do not need the same case or spacing.
  const anchors = SPECTRA[0].anchors;
  const loud = byId('standard').guess({ clue: `  ${anchors[1].text.toUpperCase()}  `, anchors }, seeded(2));
  assert.ok(Math.abs(loud - anchors[1].position) <= 12);
});

test('a clue they do not know sends the standard players to the middle, the random one anywhere in the middle part', () => {
  const anchors = SPECTRA[3].anchors;
  for (const clue of ['something nobody wrote', '', null, undefined, 42]) {
    const spots = sample((rng) => byId('standard').guess({ clue, anchors }, rng), 100);
    assert.ok(spots.every((p) => p >= 26 && p <= 74), `an unknown clue ${clue}`);
  }
  const random = sample((rng) => byId('random').guess({ clue: anchors[0].text, anchors }, rng));
  assert.ok(random.every((p) => p >= 15 && p <= 85));
  assert.ok(Math.max(...random) - Math.min(...random) > 50, 'it uses much of the dial');
});

test('the standard players are steadier than the wobbly ones, who are steadier than guessing', () => {
  const error = (id) => mean(sample((rng, i) => {
    const spectrum = SPECTRA[i % SPECTRA.length];
    const anchor = spectrum.anchors[i % spectrum.anchors.length];
    return Math.abs(byId(id).guess({ clue: anchor.text, anchors: spectrum.anchors }, rng) - anchor.position);
  }, 1000));
  const [standard, wobbly] = [error('standard'), error('wobbly')];
  const randomError = mean(sample((rng, i) => {
    const spectrum = SPECTRA[i % SPECTRA.length];
    const anchor = spectrum.anchors[i % spectrum.anchors.length];
    return Math.abs(byId('random').guess({ clue: anchor.text, anchors: spectrum.anchors }, rng) - anchor.position);
  }, 1000));
  assert.ok(standard < wobbly && wobbly < randomError, `${standard.toFixed(1)} < ${wobbly.toFixed(1)} < ${randomError.toFixed(1)}`);
});

test('the same seed makes the same decisions, so a seeded game is repeatable', () => {
  for (const ai of AIS) {
    const decide = (seed) => [ai.clue({ target: 41, anchors: SPECTRA[5].anchors }, seeded(seed)), ai.guess({ clue: SPECTRA[5].anchors[2].text, anchors: SPECTRA[5].anchors }, seeded(seed))];
    assert.deepEqual(decide(7), decide(7), ai.id);
  }
});
