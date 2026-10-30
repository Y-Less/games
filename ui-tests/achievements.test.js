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
const box = (id) => user.page.$eval(`[data-achievement="${id}"]`, (e) => ({ text: e.innerText.replace(/\s+/g, ' '), complete: e.classList.contains('complete'), bar: e.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? null }));

test('the page is in the menu and lists the global achievements, then each game with some', { timeout: 60000 }, guarded('list', async () => {
  await user.clickButton('Achievements', { scope: 'header nav', exact: true });
  await user.waitForText('Achievements for Ace Achiever');
  assert.equal(user.url.pathname, '/achievements');
  await user.waitForSelector('[data-section="hearts"]');
  const sections = await user.page.$$eval('[data-section] > header h2', (els) => els.map((e) => e.textContent.trim()));
  assert.ok(['Global', 'Hearts', 'Nomination Whist', 'Wavelength', 'Cheat', 'Cribbage'].every((name) => sections.includes(name)));
  assert.equal(sections[0], 'Global', 'the global ones come first');
  assert.equal(await user.page.$$eval('[data-section="cheat"] h3', (els) => els.length), 2, 'a game with none of its own has played and won');
  const wavelength = await user.page.$$eval('[data-section="wavelength"] h3', (els) => els.map((e) => e.textContent.trim()));
  assert.equal(wavelength.length, 9, 'every Wavelength achievement has a box');
  assert.ok(wavelength.every((name) => name === '???'), "and none is named until it is earned");
  const first = await box('global.games');
  assert.match(first.text, /\?\?\?/);
  assert.match(first.text, /Locked/);
  assert.doesNotMatch(first.text, /Play a game/, 'the goal is a secret until it is reached');
  assert.equal(first.bar, null);
}));

test('progress shows the level reached and how far it is towards the next', { timeout: 60000 }, guarded('progress', async () => {
  world.site.achievements.add('hearts', me.id, 'global.cards', 600);
  world.site.stats.record('hearts', { players: [{ userId: me.id, outcome: 'win', score: 0, extras: { moonsShot: 6, perfectGames: 1 } }] });
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('[data-achievement="global.cards"]');
  const cards = await box('global.cards');
  assert.match(cards.text, /Level 1/);
  assert.match(cards.text, /Level 2: Play 1,000 cards/);
  assert.match(cards.text, /600 \/ 1,000/);
  assert.equal(cards.bar, '60');
  const moon = await box('hearts.moon');
  assert.match(moon.text, /Level 2/, '6 moons: levels at 1 and 3 reached, working to 10');
  assert.match(moon.text, /Level 3: Shoot the moon 10 times/);
  const perfect = await box('hearts.perfect');
  assert.equal(perfect.complete, true);
  assert.equal(perfect.bar, null, 'one level: got or not, so no progress bar');
  assert.match(perfect.text, /Unlocked/);
  assert.equal((await box('global.games')).bar, '10', 'one game of ten for the next level');
}));

test('what was unlocked is announced in a pop-up, and the coins are paid', { timeout: 60000 }, guarded('popup', async () => {
  await user.waitForSelector('.notice.achievement');
  const text = await user.page.$eval('.notice.achievement', (e) => e.innerText.replace(/\s+/g, ' '));
  assert.match(text, /achievements? unlocked/i);
  assert.match(text, /\+[\d,]+ coins/);
  await user.page.click('.notice.achievement button');
  await user.page.waitForFunction(() => !document.querySelector('.notice.achievement'), { timeout: 5000 });
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
