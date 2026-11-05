// The Achievements page: the global and per-game sections, levels and progress, and the layout on a desktop and a phone.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createWorld, root } from './helpers.js';

/**
 * The achievements a game defines.  They are read from the module rather than written down here because games gain
 * achievements: a number in this file is a number that goes stale the next time somebody adds one, silently, in a
 * suite that `npm test` does not run.
 *
 * @param {string} id  the module id
 * @returns {object[]} the game's own achievement definitions
 */
const ownOf = (id) => JSON.parse(fs.readFileSync(path.join(root, 'modules', id, 'module.json'), 'utf8')).achievements ?? [];

/**
 * How many achievement boxes a game's section should hold: the ones it defines, plus the Played and Won that every
 * game is given without asking - unless it defines a `played` or `won` of its own, which replaces them.
 *
 * @param {string} id  the module id
 * @returns {number} how many boxes to expect
 */
const boxesFor = (id) => ownOf(id).length + ['played', 'won'].filter((key) => !ownOf(id).some((a) => a.key === key)).length;

/**
 * The achievements of a game that have one level only, which are the ones the page keeps the name of back until they
 * are earned (`secret` in AchievementsView: a single level, not yet reached).  One with levels is named from the
 * start, because its progress bar would give it away anyway.
 *
 * @param {string} id  the module id
 * @returns {string[]} their full ids, as the page writes them in data-achievement
 */
const oneOffsOf = (id) => ownOf(id).filter((a) => a.levels === 'unlock' || (Array.isArray(a.levels) && a.levels.length === 1)).map((a) => `${id}.${a.key}`);

let world;
let user;
let me;
before(async () => {
  world = await createWorld({ suite: 'achievements', achievementPopups: true });
  user = await world.newUser('achiever');
  await user.signUp('achiever', { displayName: 'Ace Achiever' });
  me = (await user.api('GET', '/api/me')).user;
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const box = (id) => user.page.$eval(`[data-achievement="${id}"]`, (e) => ({ text: e.innerText.replace(/\s+/g, ' '), complete: e.classList.contains('complete'), bar: e.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? null }));
/** The pop-up on top, as its words read, or null when there is none. */
const popup = () => user.page.$eval('.notice.achievement', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => null);

/**
 * Closes the achievement pop-ups one at a time until none is left, and says what each of them read.
 *
 * They come in a queue rather than one at a time: a new account unlocks several at once (it is given everything in
 * the shop, which settles Customised and Fashionable, and being an account at all settles Welcome), and the point of
 * a pop-up is to name what was unlocked, so each gets its own.  Closing one brings the next up in the same place.
 *
 * @param {number} [limit]  how many to close before giving up, so a pop-up that will not close fails the test
 * @returns {Promise<string[]>} what each pop-up said, in the order they were shown
 */
async function closePopups(limit = 40) {
  const seen = [];
  for (let n = 0; n < limit; n++) {
    const text = await popup();
    if (text === null) return seen;
    seen.push(text);
    await user.page.click('.notice.achievement button');
    // The next one takes the same place, so wait for the words to change rather than for the box to go.
    await user.page.waitForFunction((was) => document.querySelector('.notice.achievement')?.innerText.replace(/\s+/g, ' ') !== was, { timeout: 5000 }, text);
  }
  assert.fail(`the achievement pop-ups did not run out after ${limit}`);
}

test('the page is in the menu and lists the global achievements, then each game with some', { timeout: 60000 }, guarded('list', async () => {
  await user.clickButton('Achievements', { scope: 'header nav', exact: true });
  await user.waitForText('Achievements for Ace Achiever');
  assert.equal(user.url.pathname, '/achievements');
  await user.waitForSelector('[data-section="hearts"]');
  const sections = await user.page.$$eval('[data-section] > header h2', (els) => els.map((e) => e.textContent.trim()));
  // The site's own achievements are headed with the site's name, not the word "global" (see sectionName).
  assert.ok(['Game Gang', 'Hearts', 'Nomination Whist', 'Wavelength', 'Cheat', 'Cribbage'].every((name) => sections.includes(name)));
  assert.equal(sections[0], 'Game Gang', "the site's own come first");
  assert.equal(await user.page.$$eval('[data-section="cheat"] h3', (els) => els.length), boxesFor('cheat'), 'Played and Won, then the ones Cheat defines');
  const wavelength = await user.page.$$eval('[data-section="wavelength"] [data-achievement]', (els) => els.map((e) => ({ id: e.getAttribute('data-achievement'), name: e.querySelector('h3').textContent.trim() })));
  assert.equal(wavelength.length, boxesFor('wavelength'), 'every Wavelength achievement has a box');
  // A one-off keeps its name back until it is earned; one with levels is named from the start, since its progress
  // bar would give it away in any case.
  assert.deepEqual(
    wavelength.filter((a) => a.name === '???').map((a) => a.id).sort(),
    oneOffsOf('wavelength').sort(),
    'the one-off achievements, and only those, are still a secret',
  );
  // One with levels, earned nothing of yet: named, with its goal shown and a progress bar sitting at nothing.
  const games = await box('global.games');
  assert.match(games.text, /Played games/);
  assert.match(games.text, /Locked/);
  assert.equal(games.bar, '0', 'a bar, with no progress along it');
  // A one-off, on the other hand, says nothing about itself at all.
  const [secretId] = oneOffsOf('wavelength');
  const hidden = await box(secretId);
  assert.match(hidden.text, /\?\?\?/);
  assert.match(hidden.text, /Locked/);
  assert.equal(hidden.bar, null, 'got or not, so never a progress bar');
}));

test('progress shows the level reached and how far it is towards the next', { timeout: 60000 }, guarded('progress', async () => {
  world.site.achievements.add('hearts', me.id, 'global.cards', 600);
  world.site.stats.record('hearts', { players: [{ userId: me.id, outcome: 'win', score: 0, extras: { moonsShot: 6, perfectGames: 1 } }] });
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('[data-achievement="global.cards"]');
  const cards = await box('global.cards');
  assert.match(cards.text, /Level 1/);
  // The box says what the number counts; the level reached is the badge and the one being worked towards is the count.
  assert.match(cards.text, /Cards played in every game/);
  assert.doesNotMatch(cards.text, /Level 2:/);
  assert.doesNotMatch(cards.text, /Play 1,000 cards/);
  assert.match(cards.text, /600 \/ 1,000/);
  assert.equal(cards.bar, '60');
  const moon = await box('hearts.moon');
  assert.match(moon.text, /Level 2/, '6 moons: levels at 1 and 3 reached, working to 10');
  assert.match(moon.text, /Times you shot the moon/, "a game's own stat labels the achievement that reads it");
  assert.match(moon.text, /6 \/ 10/);
  const perfect = await box('hearts.perfect');
  assert.equal(perfect.complete, true);
  assert.equal(perfect.bar, null, 'one level: got or not, so no progress bar');
  assert.match(perfect.text, /Unlocked/);
  assert.equal((await box('global.games')).bar, '10', 'one game of ten for the next level');
}));

test('what was unlocked is announced in a pop-up, and the coins are paid', { timeout: 60000 }, guarded('popup', async () => {
  await user.waitForSelector('.notice.achievement');
  const first = await popup();
  assert.match(first, /achievements? unlocked/i);
  assert.match(first, /\+[\d,]+ Gilders/, 'the pop-up says what it paid');
  const seen = await closePopups();
  assert.ok(seen.length >= 1, `${seen.length} unlocks were announced`);
  assert.ok(seen.every((text) => /\+[\d,]+ Gilders/.test(text)), 'every one of them paid');
  assert.equal(await popup(), null, 'and once they have all been seen, none is left');
}));

test("typing claim_steves_achievement() in the console unlocks Steve's Achievement, and the pop-up announces it", { timeout: 60000 }, guarded('steve', async () => {
  await closePopups(); // anything still queued would be in front of Steve's
  assert.equal(await user.page.evaluate(() => typeof window.claim_steves_achievement), 'function');
  assert.match(await user.page.evaluate(() => window.claim_steves_achievement()), /is yours/);
  await user.page.waitForFunction(() => [...document.querySelectorAll('.notice.achievement')].some((e) => e.innerText.includes("Steve's Achievement")), { timeout: 10000 });
  await user.page.click('.notice.achievement button');
  await user.page.goto(new URL('/achievements', user.url).href, { waitUntil: 'domcontentloaded' });
  await user.waitForSelector('[data-achievement="global.steve"]');
  const steve = await box('global.steve');
  assert.equal(steve.complete, true);
  assert.match(steve.text, /Steve's Achievement/);
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
