// The Achievements page: the global and per-game sections, levels and progress, and the layout on a desktop and a phone.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
let user;
let me;
before(async () => {
  world = await createWorld({ suite: 'achievements' });
  user = await world.newUser('achiever');
  await user.signUp('achiever', { displayName: 'Ace Achiever' });
  me = (await user.api('GET', '/api/me')).user;
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const box = (id) => user.page.$eval(`[data-achievement="${id}"]`, (e) => ({ text: e.innerText.replace(/\s+/g, ' '), complete: e.classList.contains('complete'), bar: e.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') }));

test('the page is in the menu and lists the global achievements, then each game with some', { timeout: 60000 }, guarded('list', async () => {
  await user.clickButton('Achievements', { scope: 'header nav', exact: true });
  await user.waitForText('Achievements for Ace Achiever');
  assert.equal(user.url.pathname, '/achievements');
  await user.waitForSelector('[data-section="hearts"]');
  const sections = await user.page.$$eval('[data-section] > header h2', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(sections, ['Global', 'Hearts', 'Nomination Whist', 'Wavelength']);
  const wavelength = await user.page.$$eval('[data-section="wavelength"] h3', (els) => els.map((e) => e.textContent.trim()));
  assert.ok(wavelength.includes('Guess exactly'));
  const first = await box('global.games');
  assert.match(first.text, /Not started/);
  assert.match(first.text, /Level 1: Play 10 games/);
  assert.equal(first.bar, '0');
}));

test('progress shows the level reached and how far it is towards the next', { timeout: 60000 }, guarded('progress', async () => {
  world.site.achievements.add('hearts', me.id, 'global.cards', 600);
  world.site.stats.record('hearts', { players: [{ userId: me.id, outcome: 'win', score: 0, extras: { moonsShot: 6, perfectGames: 1 } }] });
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('[data-achievement="global.cards"]');
  const cards = await box('global.cards');
  assert.match(cards.text, /Level 2/);
  assert.match(cards.text, /Level 3: Play 1,000 cards/);
  assert.match(cards.text, /600 \/ 1,000/);
  assert.equal(cards.bar, '60');
  const moon = await box('hearts.moon');
  assert.match(moon.text, /Level 3/, '6 moons: levels 1 and 5 reached, working to 10');
  assert.match(moon.text, /Level 3: Shoot the moon 10 times/);
  const perfect = await box('hearts.perfect');
  assert.equal(perfect.complete, true);
  assert.equal((await box('global.games')).bar, '10', 'one game of ten');
}));

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`at ${viewport.width}x${viewport.height} the boxes stay on the page without sideways scrolling`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await user.page.setViewport(viewport);
    await new Promise((r) => setTimeout(r, 300));
    const overflow = await user.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `the page is ${overflow}px too wide`);
    const outside = await user.page.$$eval('.box', (els) => els.filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
    assert.equal(outside, 0, 'every box fits the width');
  }));
}
