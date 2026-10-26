// Bots tell the server which AI they play with: the choice is validated, shown on bot seats only, and survives a restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function makeFakeCards(dataDir) {
  const cardsDir = path.join(dataDir, 'cards');
  fs.mkdirSync(path.join(cardsDir, 'medium'), { recursive: true });
  const ids = Array.from({ length: 150 }, (_, i) => 10001 + i);
  for (const id of ids) fs.writeFileSync(path.join(cardsDir, 'medium', `card_${id}.jpg`), '');
  fs.writeFileSync(path.join(cardsDir, 'categories.json'), JSON.stringify({ categories: [{ key: 'all', label: 'All', description: '', ids }] }));
  process.env.DIXNT_CARDS_DIR = cardsDir;
}

test('declareAI is validated, shown for bot seats only, and kept across a restart', async (t) => {
  const site = await launchModule(t, { id: 'dixnt', moduleDir: here, setup: makeFakeCards, keep: true });
  const [ann, bot, cat] = await Promise.all(['ann', 'robin', 'cat'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create');
  for (const p of [bot, cat]) assert.equal((await p.call('join', { code })).ok, true);

  assert.equal((await bot.call('declareAI', { id: 'no-such-ai' })).ok, false, 'unknown AIs are refused');
  assert.equal((await bot.call('declareAI', {})).ok, false);
  assert.equal((await bot.call('declareAI', { id: 'sharp' })).ok, true);
  await until(() => ann.state?.players.some((p) => p.ai), 'the AI to appear in everyone\'s view');
  const seats = Object.fromEntries(ann.state.players.map((p) => [p.name, p.ai]));
  assert.deepEqual(seats, { ann: null, robin: { id: 'sharp', name: 'Sharp' }, cat: null });

  // A new game: the bot says again, and the new AI replaces the old one.
  assert.equal((await ann.call('start')).ok, true);
  assert.equal((await bot.call('declareAI', { id: 'literal' })).ok, true);
  await until(() => ann.state.players.find((p) => p.name === 'robin').ai?.id === 'literal', 'the new AI');

  // A restart keeps the seat's AI.
  await site.stop();
  const again = await launchModule(t, { id: 'dixnt', moduleDir: here, setup: makeFakeCards, dataDir: site.dataDir });
  const back = again.person('ann');
  Object.assign(back, { cookie: ann.cookie, id: ann.id });
  await back.connect();
  assert.equal((await back.call('resume', { code })).ok, true);
  await until(() => back.state?.players.length === 3, 'the saved game');
  assert.deepEqual(back.state.players.find((p) => p.name === 'robin').ai, { id: 'literal', name: 'Literal' });
  assert.equal(back.state.players.find((p) => p.name === 'cat').ai, null);
});
