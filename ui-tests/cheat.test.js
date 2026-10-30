// Cheat: the seat lobby, a whole game played by clicking (against two computer players), and the layout on a desktop and a phone.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
let user;
before(async () => {
  world = await createWorld({ suite: 'cheat', env: { CHEAT_BOT_DELAY: '0-5' } });
  user = await world.newUser('human');
  await user.signUp('cheat', { displayName: 'Chancer' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const seatKinds = () => user.page.$$eval('.seats .seat', (els) => els.map((e) => [...e.classList].find((c) => ['human', 'bot', 'empty'].includes(c))));
const rect = (selector) =>
  user.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }, selector);

test('the lobby: three to seven players, the deal described, and Start waits for every seat', { timeout: 60000 }, guarded('lobby', async () => {
  await user.goto('/play/cheat');
  await user.clickButton('Start a new game of Cheat');
  await user.waitForText('Waiting for players');
  await user.waitForText('4 players: one pack, 13 cards each.');
  for (const [n, line] of [[6, '6 players: two packs, 17 cards each (and 2 players get one more).'], [3, '3 players: one pack, 17 cards each (and 1 players get one more).']]) {
    await user.clickButton(String(n), { exact: true, scope: 'fieldset' });
    await user.waitForText(line);
    assert.equal((await seatKinds()).length, n);
  }
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.clickButton('Fill the empty seats with computer players');
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot', 'bot']);
  assert.equal((await user.buttonState('Start the game')).disabled, false);
}));

test('the table at the start: your hand, the rank to claim and the status, with no your-turn popup', { timeout: 60000 }, guarded('start', async () => {
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.felt');
  assert.ok((await user.page.$$('.hand .playing-card')).length >= 17);
  assert.match(await user.page.$eval('.claim b', (e) => e.textContent.trim()), /^(?:[2-9]|10|[JQKA])$/, 'a rank to claim (the computer players may already have played)');
  assert.equal(await user.page.$('.your-turn'), null, 'no popup in a card game');
}));

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`at ${viewport.width}x${viewport.height} the page does not scroll and the hand, pile and buttons stay inside the table`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await user.page.setViewport(viewport);
    await user.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    const felt = await rect('.felt');
    for (const part of ['.hand', '.middle', '.actions']) {
      const r = await rect(part);
      assert.ok(r.left >= felt.left - 2 && r.right <= felt.right + 2 && r.top >= felt.top - 2 && r.bottom <= felt.bottom + 2, `${part} stays inside the table: ${JSON.stringify(r)} in ${JSON.stringify(felt)}`);
    }
  }));
}

test('a whole game is played by clicking cards, ending with a winner', { timeout: 180000 }, guarded('play', async () => {
  await user.page.setViewport({ width: 1280, height: 900 });
  const finder = () => {
    const available = (text) => [...document.querySelectorAll('.actions button')].find((b) => !b.classList.contains('hidden') && !b.disabled && b.textContent.trim().startsWith(text));
    const believe = available('I believe');
    if (believe) return believe;
    const play = available('Play');
    if (play) return play;
    if (document.querySelector('.actions button.primary')) return document.querySelector('.hand button.playing-card:not(.selected)');
    return null;
  };
  const signature = () => user.page.evaluate(() => `${document.querySelectorAll('.hand .playing-card').length}:${document.querySelector('.status')?.innerText ?? ''}:${document.querySelector('.pile .size')?.textContent ?? ''}`);
  const act = async () => {
    const before = await signature();
    if (!(await user.clickFoundOnTop(finder))) return false;
    await user.page.waitForFunction((was) => `${document.querySelectorAll('.hand .playing-card').length}:${document.querySelector('.status')?.innerText ?? ''}:${document.querySelector('.pile .size')?.textContent ?? ''}` !== was, { timeout: 3000, polling: 20 }, before).catch(() => {});
    return true;
  };
  await drive({ act, finished: async () => /wins/.test(await user.page.evaluate(() => document.querySelector('.status')?.innerText ?? '')) && (await user.page.$('.status button')) !== null, what: 'a game of Cheat', timeout: 170000 });
  assert.match(await user.page.evaluate(() => document.querySelector('.status').innerText), /Play again/);
  assert.ok((await user.page.$$('.log li, .box.log li')).length > 3, 'Recent moves recorded the game');
}));
