// Hearts: the shared seat lobby, then one whole hand played by clicking cards, then the score pop-up.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
let user;
let code;
before(async () => {
  world = await createWorld({ suite: 'hearts' });
  user = await world.newUser('human');
  await user.signUp('hearts', { displayName: 'Hearty' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const playAreaLeaveButtons = () => user.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Leave/.test(t)));
const headerButtons = () => user.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()));
const seatTags = () => user.page.$$eval('.seats .seat', (els) => els.map((e) => ({ kind: [...e.classList].find((c) => ['human', 'bot', 'empty'].includes(c)), text: e.innerText.replace(/\s+/g, ' ').trim() })));

test('the seat lobby: Start stays disabled until every seat is filled with a person or a computer player', { timeout: 60000 }, guarded('lobby', async () => {
  await user.goto('/play/hearts');
  await user.clickButton('Start a new game of Hearts');
  await user.waitForText('Waiting for players');
  code = await user.inviteCode();
  assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
  await user.waitForCodeInUrl(code);
  assert.equal(await user.copyInvite(), `${world.base}/play/hearts?${code}`, 'the invite pill copies the invite link');

  let seats = await seatTags();
  assert.equal(seats.length, 4);
  assert.deepEqual(seats.map((s) => s.kind), ['human', 'empty', 'empty', 'empty']);
  assert.match(seats[0].text, /Hearty.*you.*host/i);
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.waitForText('3 more seats to fill.');

  // Add one computer player, then take it away again, then fill the rest.
  await user.clickButton('Add a computer player');
  await user.waitForText('2 more seats to fill.');
  assert.equal((await seatTags()).filter((s) => s.kind === 'bot').length, 1);
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.clickButton('Remove', { scope: '.seat.bot' });
  await user.waitForText('3 more seats to fill.');
  await user.clickButton('Add a computer player');
  await user.clickButton('Fill the empty seats with computer players');
  await user.waitForNoText('more seat');
  seats = await seatTags();
  assert.deepEqual(seats.map((s) => s.kind), ['human', 'bot', 'bot', 'bot']);
  assert.equal((await user.buttonState('Start the game')).disabled, false);
  // The game's own options are on the lobby page too.
  await user.waitForText('Rules for this game');
  // Leave game is in the site's header, not in the lobby.
  assert.deepEqual(await playAreaLeaveButtons(), [], 'no Leave button in the lobby');
  assert.ok((await headerButtons()).includes('Leave game'), 'the header offers Leave game in the lobby');
}));

test('a reload mid-game puts you back in the same room', { timeout: 60000 }, guarded('reload', async () => {
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  await user.waitForText('Hand 1');
  await user.waitForCodeInUrl(code);

  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('.score-bar');
  await user.waitForText('Hand 1');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$('.entry'), null, 'not back at the start screen');
}));

test('playing a whole hand by clicking cards ends with the scores pop-up and its All rounds table', { timeout: 120000 }, guarded('play a hand', async () => {
  // Pick three cards to pass when asked, confirm, then play the first card that is legal whenever it is our turn.
  const finder = () => {
    const pass = document.querySelector('.confirm:not(.hidden) button.primary');
    // The hand is a fan, so take the right-most wanted card: it is the one with nothing on top of it.
    const last = (selector) => [...document.querySelectorAll(selector)].at(-1) ?? null;
    if (pass) return pass.disabled ? last('.hand button.playing-card:not(.selected)') : pass;
    return last('.hand button.playing-card:not(.dimmed):not([disabled])');
  };
  const signature = () => user.page.evaluate(() => `${document.querySelectorAll('.hand button.playing-card').length}:${document.querySelector('.status')?.innerText ?? ''}`);
  const act = async () => {
    const before = await signature();
    if (!(await user.clickFoundOnTop(finder))) return false; // the hand is a fan of overlapping cards
    // Wait for the table to answer (the card leaves the hand, or the pass is made) before clicking again: a second click
    // on a card the server has already taken would only be refused. If the server refuses anyway (an error toast, and
    // no change), give up waiting after a moment and look at the table afresh instead of clicking on in a loop.
    await user.page.waitForFunction((was) => `${document.querySelectorAll('.hand button.playing-card').length}:${document.querySelector('.status')?.innerText ?? ''}` !== was, { timeout: 3000, polling: 20 }, before).catch(() => {});
    return true;
  };
  await drive({ act, finished: async () => /^Scores after/.test(await user.modalTitle()), what: 'a hand of Hearts', timeout: 100000 });

  assert.equal(await user.modalTitle(), 'Scores after Hand 1');
  const modal = await user.page.$eval('.modal', (el) => ({
    rows: [...el.querySelectorAll('.score-table tbody th')].map((t) => t.textContent.trim()),
    heads: [...el.querySelectorAll('.score-table thead th')].map((t) => t.textContent.trim()),
    totals: [...el.querySelectorAll('.score-table tfoot td strong')].map((t) => Number(t.textContent)),
    summary: el.querySelector('.summary')?.innerText ?? '',
  }));
  assert.deepEqual(modal.rows, ['Hand 1']);
  assert.equal(modal.heads.length, 5, 'Round plus four players');
  assert.ok(modal.heads.some((h) => h.includes('Hearty (you)')));
  assert.equal(modal.totals.length, 4);
  // 26 points in a hand, or 78 if someone shoots the moon (everyone else scores 26).
  const sum = modal.totals.reduce((a, b) => a + b, 0);
  assert.ok(sum === 26 || sum === 78, `the hand's points add up (got ${sum})`);
  assert.match(modal.summary, /hearts?/);

  // Closing the pop-up is how a person says they are ready: with only computer players left to wait for, hand 2 is dealt.
  await user.closeModalWithEsc();
  await user.waitForText('Hand 2');
  await user.clickButton('All rounds', { exact: true });
  await user.waitForSelector('.modal');
  assert.equal(await user.modalTitle(), 'Scores so far');
  await user.closeModalWithEsc();
}));

test('the site header shows the title, Rules and Leave game, and the play area has none of them', { timeout: 60000 }, guarded('header', async () => {
  assert.equal(await user.page.$eval('header.bar h1', (e) => e.textContent.trim()), 'Hearts');
  assert.equal(await user.page.$('.play h1'), null);
  const names = await headerButtons();
  assert.ok(names.includes('Rules') && names.includes('Leave game'), `header buttons: ${names}`);
  assert.deepEqual(await playAreaLeaveButtons(), [], 'no Leave button in the play area');
}));

test('every player has a popup with the facts and, for the host, Remove computer player (refused inline once the game is on)', { timeout: 60000 }, guarded('player popup', async () => {
  await user.page.setViewport({ width: 1366, height: 768 });
  await user.waitForSelector('.score-bar .chip:not(.me) button.chip-button');
  assert.equal((await user.page.$$('.score-bar .chip:not(.me) button.chip-button')).length, 3, 'a button for every other player');
  assert.equal(await user.page.$eval('.score-bar .chip:not(.me) button.chip-button', (e) => e.title), 'Show details');
  await user.page.click('.score-bar .chip:not(.me) button.chip-button');
  await user.waitForSelector('.main .player-popup');
  assert.match(await user.page.$eval('.player-popup', (e) => e.innerText), /computer[\s\S]*Cards in hand[\s\S]*Remove computer player/);
  await user.clickButton('Remove computer player', { scope: '.player-popup' });
  await user.clickButton('Yes, remove', { scope: '.player-popup' });
  await user.waitForText('only change that before the game starts');
  assert.equal((await user.page.$$('.score-bar .chip:not(.me) button.chip-button')).length, 3, 'the computer player is still seated');
  await user.page.keyboard.press('Escape');
  await user.waitForSelector('.player-popup', { hidden: true });
}));

const rect = (selector) =>
  user.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }, selector);

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`at ${viewport.width}x${viewport.height} the table fits the window, its rows share the same outer edges and gutters, and the cards stay inside it`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await user.page.setViewport(viewport);
    await user.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((r) => setTimeout(r, 400));
    await user.waitForSelector('.felt');
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    assert.ok(['', '1'].includes(await user.page.evaluate(() => document.querySelector('.field-frame').style.zoom)), 'the game is not scaled down');
    const frame = await rect('.game-frame');
    assert.ok(frame.bottom <= viewport.height && frame.bottom >= viewport.height - 20, `the frame fills the window: bottom ${frame.bottom} of ${viewport.height}`);
    const bar = await rect('.score-bar');
    const felt = await rect('.felt');
    const log = await rect('.box.log');
    const status = await rect('.box.status');
    for (const [name, r] of Object.entries({ felt, log })) assert.ok(Math.abs(r.left - bar.left) <= 1, `${name} left edge ${r.left} vs score bar ${bar.left}`);
    for (const [name, r] of Object.entries({ felt, status })) assert.ok(Math.abs(r.right - bar.right) <= 1, `${name} right edge ${r.right} vs score bar ${bar.right}`);
    assert.ok(Math.abs(log.top - status.top) <= 1 && Math.abs(log.bottom - status.bottom) <= 1, 'the two boxes are the same height');
    assert.ok(Math.abs(status.left - log.right - 12) <= 1, `the gutter between the boxes is 12px (got ${status.left - log.right})`);
    assert.ok(Math.abs(felt.top - bar.bottom - (log.top - felt.bottom)) <= 1, 'the same gap above and below the table');
    // The opponents sit on the table's edges, and nothing drawn on the table leaves it.
    const parts = { top: await rect('.felt .opp.top'), left: await rect('.felt .opp.left'), right: await rect('.felt .opp.right'), trick: await rect('.felt .trick'), hand: await rect('.felt .my-fan') };
    assert.ok(Math.abs(parts.left.left - felt.left) <= 2, `the left opponent is on the left edge (${parts.left.left} vs ${felt.left})`);
    assert.ok(Math.abs(parts.right.right - felt.right) <= 2, `the right opponent is on the right edge (${parts.right.right} vs ${felt.right})`);
    assert.ok(Math.abs(parts.top.top - felt.top) <= 2, 'the top opponent is on the top edge');
    assert.ok(Math.abs(parts.hand.bottom - felt.bottom) <= 2, 'your hand is on the bottom edge');
    for (const [name, r] of Object.entries(parts)) assert.ok(r.left >= felt.left - 2 && r.right <= felt.right + 2 && r.top >= felt.top - 2 && r.bottom <= felt.bottom + 2, `${name} stays inside the table: ${JSON.stringify(r)} in ${JSON.stringify(felt)}`);
    assert.ok(Math.abs((parts.trick.left + parts.trick.right) / 2 - (felt.left + felt.right) / 2) <= 2, 'the trick is in the middle');
  }));
}

test('Leave game in the header asks first, then leaves the room', { timeout: 60000 }, guarded('leave', async () => {
  await user.page.setViewport({ width: 1366, height: 768 });
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
