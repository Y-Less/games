import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, fullId, GLOBAL, sectionOf } from './achievementRegistry.js';

const GAMES = [
  { id: 'hearts', name: 'Hearts', achievements: [{ key: 'moon', name: 'Shot the moon' }] },
  { id: 'plain', name: 'Plain', achievements: [] },
];

test('ids: a bare key belongs to the game, a global one keeps its prefix, and the section is the first part', () => {
  assert.equal(fullId('hearts', 'moon'), 'hearts.moon');
  assert.equal(fullId('hearts', 'global.cards'), 'global.cards');
  assert.equal(sectionOf('hearts.moon'), 'hearts');
  assert.equal(sectionOf('global.cards'), GLOBAL);
});

test('sections are the global ones first, then each game that has any achievements', () => {
  const { sections } = createRegistry(() => GAMES);
  assert.deepEqual(sections().map((s) => s.id), ['global', 'hearts']);
});

test('find answers with the section and definition, or null for anything unknown', () => {
  const { find } = createRegistry(() => GAMES);
  assert.equal(find('hearts.moon').section.name, 'Hearts');
  assert.equal(find('hearts.moon').definition.name, 'Shot the moon');
  assert.equal(find('global.cards').section.id, 'global');
  assert.equal(find('hearts.nope'), null);
  assert.equal(find('plain.played'), null, 'a game with none of its own has no section here');
  assert.equal(find('nothing'), null);
});
