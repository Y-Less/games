// The AI a computer player plays with, over the real site: dealt at the start, shown on its seat only, and surviving a
// restart.
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

test('a computer player is dealt an AI at the start, shown to everybody, and kept across a restart', async (t) => {
  const site = await launchModule(t, { id: 'dixnt', moduleDir: here, setup: makeFakeCards, keep: true });
  const [ann, cat] = await Promise.all(['ann', 'cat'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create');
  assert.equal((await cat.call('join', { code })).ok, true);
  assert.equal((await ann.call('addBot', {})).ok, true);
  await until(() => ann.state?.players.length === 3, 'a table of three');
  assert.equal(ann.state.players.find((p) => p.bot).ai, null, 'a computer player has no AI until the game starts');

  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.players.some((p) => p.ai), 'the AI to appear in everyone’s view');
  const dealt = ann.state.players.find((p) => p.bot).ai;
  assert.deepEqual(Object.keys(dealt).sort(), ['id', 'name']);
  for (const player of ann.state.players) assert.equal(Boolean(player.ai), player.bot, `${player.name}: an AI iff a computer player`);
  await until(() => cat.state?.players.find((p) => p.bot)?.ai?.id === dealt.id, 'and in everybody else’s');

  // A restart keeps the seat's AI.
  await site.stop();
  const again = await launchModule(t, { id: 'dixnt', moduleDir: here, setup: makeFakeCards, dataDir: site.dataDir });
  const back = again.person('ann');
  Object.assign(back, { cookie: ann.cookie, id: ann.id });
  await back.connect();
  assert.equal((await back.call('resume', { code })).ok, true);
  await until(() => back.state?.players.length === 3, 'the saved game');
  assert.deepEqual(back.state.players.find((p) => p.bot).ai, dealt);
  assert.equal(back.state.players.find((p) => p.name === 'cat').ai, null);
});
