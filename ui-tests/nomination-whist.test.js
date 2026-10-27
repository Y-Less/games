// Nomination Whist: the shared seat lobby, then one whole round played by nominating and clicking cards.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
let user;
let code;
before(async () => {
  world = await createWorld({ suite: 'nomination-whist' });
  user = await world.newUser('human');
  await user.signUp('whist', { displayName: 'Whisty' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const seatKinds = () => user.page.$$eval('.seats .seat', (els) => els.map((e) => [...e.classList].find((c) => ['human', 'bot', 'empty'].includes(c))));

test('the seat lobby: Start stays disabled until every seat is filled', { timeout: 60000 }, guarded('lobby', async () => {
  await user.goto('/play/nomination-whist');
  await user.clickButton('Start a new game');
  await user.waitForText('Waiting for players');
  code = await user.inviteCode();
  await user.waitForCodeInUrl(code);
  assert.equal(await user.copyInvite(), `${world.base}/play/nomination-whist?${code}`);

  assert.deepEqual(await seatKinds(), ['human', 'empty', 'empty', 'empty']);
  assert.equal((await user.buttonState('Leave game', { scope: '.field' })).present, false, 'the lobby has no Leave button of its own');
  assert.equal((await user.buttonState('Leave game', { scope: 'header.bar' })).present, true, 'the header offers it');
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.clickButton('Add a computer player');
  await user.waitForText('2 more seats to fill.');
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.clickButton('Fill the empty seats with computer players');
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot', 'bot', 'bot']);
  assert.equal((await user.buttonState('Start the game')).disabled, false);
}));

test('starting the game deals round 1, and a reload resumes the same room', { timeout: 60000 }, guarded('start and reload', async () => {
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  await user.waitForText('Round 1 of 14');
  await user.waitForCodeInUrl(code);

  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('.score-bar');
  await user.waitForText('Round 1 of 14');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$('.entry'), null, 'not back at the start screen');
}));

test('a whole round, nominating then playing seven tricks, ends with the scores pop-up and its All rounds table', { timeout: 120000 }, guarded('play a round', async () => {
  const finder = () =>
    document.querySelector('.nominate .numbers button.number:not([disabled])') ?? document.querySelector('.hand button.playing-card:not(.dimmed):not([disabled])');
  const act = () => user.clickFound(finder);
  await drive({ act, finished: async () => /^Scores after/.test(await user.modalTitle()), what: 'a round of Nomination Whist', timeout: 100000 });

  assert.match(await user.modalTitle(), /^Scores after Round 1/);
  const modal = await user.page.$eval('.modal', (el) => ({
    rows: [...el.querySelectorAll('.score-table tbody th')].map((t) => t.textContent.trim()),
    heads: [...el.querySelectorAll('.score-table thead th')].map((t) => t.textContent.trim()),
    result: el.querySelector('.result')?.innerText ?? '',
  }));
  assert.equal(modal.rows.length, 1);
  assert.match(modal.rows[0], /Round 1/);
  assert.equal(modal.heads.length, 5, 'Round plus four players');
  assert.match(modal.result, /Nominated/);

  // Closing the pop-up is how a person says they are ready: with only computer players left to wait for, round 2 is dealt.
  await user.closeModalWithEsc();
  await user.waitForText('Round 2 of 14');
  await user.clickButton('All rounds', { exact: true });
  await user.waitForSelector('.modal');
  assert.equal(await user.modalTitle(), 'Scores so far');
  await user.closeModalWithEsc();
}));

const rect = (selector) =>
  user.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }, selector);
const rects = (selector) =>
  user.page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => {
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }), selector);

test('the site header shows the title, Rules and Leave game, and neither the play area nor the lobby has a Leave button', { timeout: 60000 }, guarded('header', async () => {
  assert.equal(await user.page.$eval('header.bar h1', (e) => e.textContent.trim()), 'Nomination Whist');
  const names = await user.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()));
  assert.ok(names.includes('Rules') && names.includes('Leave game'), `header buttons: ${names}`);
  const inPlay = await user.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Leave/.test(t)));
  assert.deepEqual(inPlay, [], 'no Leave button in the play area');
}));

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`at ${viewport.width}x${viewport.height} the table fits the window and every row shares the same outer edges and gutters`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await user.page.setViewport(viewport);
    await user.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, 'no sideways scroll');
    const bar = await rect('.score-bar');
    const frame = await rect('.game-frame');
    assert.ok(frame.bottom <= viewport.height, `the frame ends inside the window: ${frame.bottom}`);
    const log = await rect('.box.log');
    const status = await rect('.box.status');
    const nominate = await rect('.nominate');
    const mine = await rect('.mine');
    const main = await rect('.game-frame .main');
    const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} vs ${b}`);
    // Left edges: your hand row and Recent moves with the score bar; right edges: the nomination zone, Status.
    assert.equal(await user.page.$('.seats'), null, 'no row of duplicate player seats');
    near(mine.left, bar.left, 'your row left');
    near(log.left, bar.left, 'Recent moves left');
    near(nominate.right, bar.right, 'nomination zone right');
    near(mine.right, bar.right, 'your row right');
    near(status.right, bar.right, 'Status right');
    // The gutters: the same between seats and between the two bottom boxes.
    const gutter = status.left - log.right;
    assert.ok(gutter >= 10 && gutter <= 14, `gutter between the bottom boxes: ${gutter}`);
    assert.ok(log.top - main.bottom >= 4 && log.top - main.bottom <= 12, `gap between the table and the boxes: ${log.top - main.bottom}`);
    near(log.bottom, status.bottom, 'the bottom boxes end on one line');
    assert.ok(mine.bottom <= main.bottom + 1, 'your hand is inside the main area');
    // Status holds the words; the play area holds none of them.
    const inPlay = await user.page.$eval('.game-frame .main', (el) => el.innerText);
    for (const text of ['Round 2 of 14', 'Your turn', 'Dealer:', 'Waiting for']) assert.ok(!inPlay.includes(text), `"${text}" should be in Status, not in the play area`);
    assert.match(await user.page.$eval('.box.status', (el) => el.innerText), /Round \d+ of 14[\s\S]*Dealer:[\s\S]*Trumps:/);
  }));
}

test('the next round was dealt without a separate button', { timeout: 60000 }, guarded('next round', async () => {
  await user.waitForText('Round 2 of 14');
  assert.equal((await user.buttonState('Deal round 2')).present, false);
}));

test('clicking a player chip toggles a popup with their cards and nomination, and moves nothing', { timeout: 60000 }, guarded('popup', async () => {
  const areas = ['.score-bar', '.centre', '.nominate', '.mine', '.hand', '.box.log', '.box.status'];
  const boxes = () => Promise.all(areas.map(rect));
  const was = await boxes();
  await user.page.click('.score-bar .chip:not(.me) button.chip-button');
  await user.waitForSelector('.main .popup');
  assert.match(await user.page.$eval('.popup', (e) => e.innerText), /Cards in hand\s*\d+[\s\S]*Score/);
  assert.deepEqual(await boxes(), was, 'opening the popup moved something');
  await user.page.click('.score-bar .chip:not(.me) button.chip-button');
  await user.waitForSelector('.main .popup', { hidden: true });
  await user.page.click('.score-bar .chip:not(.me) button.chip-button');
  await user.page.keyboard.press('Escape');
  await user.waitForSelector('.main .popup', { hidden: true });
  assert.deepEqual(await boxes(), was, 'closing the popup moved something');
}));

test('Leave game in the header asks first, then leaves the room', { timeout: 60000 }, guarded('leave', async () => {
  await user.clickButton('Leave game', { exact: true, scope: 'header.bar' });
  await user.waitForText('A computer player takes your seat if you leave.');
  await user.clickButton('Stay', { exact: true });
  await user.waitForNoText('A computer player takes your seat');
  await user.clickButton('Leave game', { exact: true, scope: 'header.bar' });
  await user.clickButton('Yes, leave', { exact: true });
  await user.waitForText('Start a new game');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
