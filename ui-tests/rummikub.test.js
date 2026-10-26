// Rummikub: the shared seat lobby filled with computer players, the standard frame (fits the window, rows share their
// outer edges), drawing a tile, and Leave game from the site header.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, sleep } from './helpers.js';

let world;
let user;
let code;
before(async () => {
  world = await createWorld({ suite: 'rummikub' });
  user = await world.newUser('human');
  await user.signUp('rummi', { displayName: 'Rummy' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const rackCount = () => user.page.$$eval('[data-rack] .tile', (els) => els.length);
const rect = (selector) =>
  user.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }, selector);

test('the lobby fills with computer players, has no Leave button of its own, and the game starts', { timeout: 60000 }, guarded('lobby', async () => {
  await user.goto('/play/rummikub');
  await user.clickButton('Start a new game');
  await user.waitForText('Waiting for players');
  code = await user.inviteCode();
  await user.waitForCodeInUrl(code);
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  assert.equal((await user.buttonState('Leave game', { scope: '.field' })).present, false, 'the lobby has no Leave button of its own');
  assert.equal((await user.buttonState('Leave game', { scope: 'header.bar' })).present, true, 'the header offers it');
  const bulk = await user.buttonState('Fill the empty seats with computer players');
  await user.clickButton(bulk.present ? 'Fill the empty seats with computer players' : 'Add a computer player');
  await user.waitForNoText('more seat');
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  await user.waitForText('Round 1');
  await user.waitForSelector('[data-rack] .tile');
}));

test('the site header shows the title, Rules and Leave game, and the play area has no Leave button', { timeout: 60000 }, guarded('header', async () => {
  assert.equal(await user.page.$eval('header.bar h1', (e) => e.textContent.trim()), 'Rummikub');
  const names = await user.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()));
  assert.ok(names.includes('Rules') && names.includes('Leave game'), `header buttons: ${names}`);
  const inPlay = await user.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Leave/.test(t)));
  assert.deepEqual(inPlay, [], 'no Leave button in the play area');
}));

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`at ${viewport.width}x${viewport.height} the table fits the window and every row shares the same outer edges and gutters`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await user.page.setViewport(viewport);
    await user.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await sleep(400);
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, 'no sideways scroll');
    const bar = await rect('.score-bar');
    const felt = await rect('.felt');
    const rack = await rect('.rack-panel');
    const actions = await rect('.actions');
    const log = await rect('.box.log');
    const status = await rect('.box.status');
    const frame = await rect('.game-frame');
    const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} vs ${b}`);
    assert.ok(frame.bottom <= viewport.height, `the frame ends inside the window: ${frame.bottom}`);
    near(felt.left, bar.left, 'table left');
    near(felt.right, bar.right, 'table right');
    near(rack.left, bar.left, 'rack left');
    near(actions.right, bar.right, 'buttons right');
    assert.equal(await user.page.$('.others'), null, 'no row of duplicate player bars');
    near(log.left, bar.left, 'Recent moves left');
    near(status.right, bar.right, 'Status right');
    const gutter = status.left - log.right;
    assert.ok(gutter >= 10 && gutter <= 14, `gutter between the bottom boxes: ${gutter}`);
    near(actions.left - rack.right, gutter, 'gutter between the rack and the buttons');
    assert.ok(rack.top >= felt.bottom && rack.top - felt.bottom <= 12, 'your rack sits directly under the table');
    near(log.bottom, status.bottom, 'the bottom boxes end on one line');
    // The words are in Status, not in the play area.
    const inPlay = await user.page.$eval('.game-frame .main', (el) => el.innerText);
    for (const text of ['in the pool', 'Your turn', 'First meld', 'Waiting for']) assert.ok(!inPlay.includes(text), `"${text}" should be in Status, not in the play area`);
    assert.match(await user.page.$eval('.box.status', (el) => el.innerText), /Round 1[\s\S]*in the pool[\s\S]*First meld/);
  }));
}

test('clicking a player chip toggles a popup with their tile count, and moves nothing', { timeout: 60000 }, guarded('popup', async () => {
  const areas = ['.score-bar', '.felt', '.rack-panel', '.actions', '.box.log', '.box.status'];
  const boxes = () => Promise.all(areas.map(rect));
  const was = await boxes();
  assert.equal(await user.page.$eval('.score-bar .chip.me', (e) => Boolean(e.querySelector('button.chip-button'))), false, 'your own chip opens nothing');
  await user.page.click('.score-bar button.chip-button');
  await user.waitForSelector('.main .popup');
  assert.match(await user.page.$eval('.popup', (e) => e.innerText), /Tiles in rack\s*\d+/);
  assert.deepEqual(await boxes(), was, 'opening the popup moved something');
  await user.page.click('.score-bar button.chip-button');
  await user.waitForSelector('.main .popup', { hidden: true });
  await user.page.click('.score-bar button.chip-button');
  await user.page.keyboard.press('Escape');
  await user.waitForSelector('.main .popup', { hidden: true });
  await user.page.click('.score-bar button.chip-button');
  await user.page.mouse.click(5, 400);
  await user.waitForSelector('.main .popup', { hidden: true });
  assert.deepEqual(await boxes(), was, 'closing the popup moved something');
}));

test('drawing a tile adds one to the rack and passes the turn on without moving anything', { timeout: 60000 }, guarded('draw', async () => {
  const before = await rackCount();
  const areas = ['.score-bar', '.felt', '.rack-panel', '.actions', '.box.log', '.box.status'];
  const boxes = () => Promise.all(areas.map(rect));
  const was = await boxes();
  await user.clickButton('Draw a tile', { exact: true });
  await user.page.waitForFunction((n) => document.querySelectorAll('[data-rack] .tile').length === n, { timeout: 10000 }, before + 1);
  await user.waitForText('Rummy drew a tile');
  assert.deepEqual(await boxes(), was, 'drawing moved something');
}));

test('Leave game in the header leaves the room', { timeout: 60000 }, guarded('leave', async () => {
  await user.clickButton('Leave game', { exact: true, scope: 'header.bar' });
  await user.waitForText('Start a new game');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
