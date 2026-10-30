import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDefinition, describe, GAME_ACHIEVEMENTS, GLOBAL_ACHIEVEMENTS, levelInfo, levelReward, levelText, TIERS } from './achievements.js';

const cards = { key: 'cards', name: 'Played cards', text: 'Play {n} cards', one: 'Play a card', levels: [500, 1000, 5000] };

test('levels unlock at their numbers and progress is the fraction of the next one', () => {
  assert.deepEqual(levelInfo([500, 1000], 0), { level: 0, next: 500, progress: 0 });
  assert.deepEqual(levelInfo([500, 1000], 499), { level: 0, next: 500, progress: 499 / 500 });
  assert.deepEqual(levelInfo([500, 1000], 500), { level: 1, next: 1000, progress: 0.5 });
  const level2 = levelInfo([100, 500, 1000], 600);
  assert.deepEqual([level2.level, level2.next, level2.progress], [2, 1000, 0.6], '600 played: level 2, 60% of the way to level 3');
  assert.deepEqual(levelInfo([1], 3), { level: 1, next: null, progress: 1 }, 'a one-level achievement is done');
  assert.deepEqual(levelInfo([10, 20], 99), { level: 2, next: null, progress: 1 });
});

test('level text fills in the number, with thousands separators, and uses the singular form for 1', () => {
  assert.equal(levelText(cards, 1000), 'Play 1,000 cards');
  assert.equal(levelText({ ...cards, levels: [1] }, 1), 'Play a card');
  assert.equal(levelText({ text: 'Play {n} cards', levels: [1] }, 1), 'Play 1 cards', 'without a singular form the template is used');
});

test('describe gives what the page draws', () => {
  const d = describe(cards, 'global.cards', 600);
  assert.equal(d.level, 1);
  assert.deepEqual(d.current, { n: 500, text: 'Play 500 cards' });
  assert.deepEqual(d.next, { n: 1000, text: 'Play 1,000 cards' });
  assert.equal(d.progress, 0.6);
  assert.deepEqual(d.levels.map((l) => l.done), [true, false, false]);
  assert.equal(describe(cards, 'x', 0).current, null);
  assert.equal(describe(cards, 'x', 9999).next, null);
});

test('definitions from a module.json are checked', () => {
  assert.ok(cleanDefinition({ key: 'moon', name: 'Moon', text: 'Shoot {n}', levels: [1, 5], stat: 'moonsShot' }));
  const bads = [null, {}, { key: 'a b', name: 'x', text: 'y', levels: [1] }, { key: 'a', name: 'x', text: 'y', levels: [] }, { key: 'a', name: 'x', text: 'y', levels: [5, 5] }, { key: 'a', name: 'x', text: 'y', levels: [0, 1] }, { key: 'a', name: 'x', text: 'y', levels: [3, 2] }, { key: 'a', name: '', text: 'y', levels: [1] }];
  for (const bad of bads) assert.equal(cleanDefinition(bad), null, JSON.stringify(bad));
});

test('the global achievements are the ones asked for', () => {
  assert.deepEqual(GLOBAL_ACHIEVEMENTS.find((a) => a.key === 'games').levels, TIERS.medium);
  assert.deepEqual(GLOBAL_ACHIEVEMENTS.find((a) => a.key === 'cards').levels, TIERS.veryEasy, 'played cards is something everyone does many times a game');
});

test('there are five tiers, medium and up start at 1, and a definition may name one', () => {
  assert.deepEqual(Object.keys(TIERS), ['veryEasy', 'easy', 'medium', 'hard', 'veryHard']);
  assert.deepEqual(TIERS.veryEasy, [100, 500, 2000, 5000, 15000]);
  assert.deepEqual(TIERS.easy, [10, 100, 500, 1000, 1500]);
  assert.deepEqual(TIERS.medium, [1, 10, 50, 100, 500]);
  assert.deepEqual(TIERS.hard, [1, 5, 10, 50, 100]);
  assert.deepEqual(TIERS.veryHard, [1, 3, 5, 10, 20]);
  for (const [name, levels] of Object.entries(TIERS)) {
    assert.equal(levels.length, 5, name);
    if (['medium', 'hard', 'veryHard'].includes(name)) assert.equal(levels[0], 1, `${name}: the first time always counts`);
  }
  assert.deepEqual(cleanDefinition({ key: 'a', name: 'A', text: 'Do {n}', levels: 'hard' }).levels, TIERS.hard);
  assert.equal(cleanDefinition({ key: 'a', name: 'A', text: 'Do {n}', levels: 'impossible' }), null);
  const clean = cleanDefinition({ key: 'a', name: 'A', text: 'Do {n}', levels: 'easy' });
  clean.levels.push(1);
  assert.equal(TIERS.easy.length, 5, 'a definition has its own copy');
});

test('a level pays 200 times its number, and an achievement with one level pays 500', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((level) => levelReward(level, 5)), [200, 400, 600, 800, 1000]);
  assert.equal(levelReward(1, 1), 500);
  assert.equal(levelReward(1, 2), 200);
});

test('every game has a medium played and a hard won achievement', () => {
  const [played, won] = GAME_ACHIEVEMENTS;
  assert.deepEqual([played.key, played.levels, played.stat], ['played', TIERS.medium, 'played']);
  assert.deepEqual([won.key, won.levels, won.stat], ['won', TIERS.hard, 'wins']);
  assert.deepEqual(GLOBAL_ACHIEVEMENTS.find((a) => a.key === 'wins').levels, TIERS.hard);
});
