// Cribbage: the shared seat lobby, then one whole hand (discard, pegging, the show) played by clicking cards.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive } from './helpers.js';

let world;
let user;
let code;
before(async () => {
  world = await createWorld({ suite: 'cribbage' });
  user = await world.newUser('human');
  await user.signUp('crib', { displayName: 'Cribby' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const playAreaLeaveButtons = () => user.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Leave/.test(t)));
const headerButtons = () => user.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()));
const seatKinds = () => user.page.$$eval('.seats .seat', (els) => els.map((e) => [...e.classList].find((c) => ['human', 'bot', 'empty'].includes(c))));

test('the seat lobby: Start stays disabled until every seat is filled', { timeout: 60000 }, guarded('lobby', async () => {
  await user.goto('/play/cribbage');
  await user.clickButton('Start a new game');
  await user.waitForText('Waiting for players');
  code = await user.inviteCode();
  await user.waitForCodeInUrl(code);
  assert.equal(await user.copyInvite(), `${world.base}/play/cribbage?${code}`);

  await user.clickButton('3', { exact: true }); // three seats
  await user.waitForText('2 more seats to fill.');
  assert.deepEqual(await seatKinds(), ['human', 'empty', 'empty']);
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.clickButton('Add a computer player');
  await user.waitForText('1 more seat to fill.');
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.clickButton('2', { exact: true }); // back to two seats: the one computer player fills it
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot']);
  assert.equal((await user.buttonState('Start the game')).disabled, false);
  // Four seats again, and "fill" tops up the empty ones.
  await user.clickButton('4', { exact: true });
  await user.waitForText('2 more seats to fill.');
  await user.clickButton('Fill the empty seats with computer players');
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot', 'bot', 'bot']);
  // Take two computer players away again (a seat count cannot drop below the people seated), for a quicker two-player game.
  await user.clickButton('Remove', { scope: '.seat.bot' });
  await user.waitForText('1 more seat to fill.');
  await user.clickButton('Remove', { scope: '.seat.bot' });
  await user.waitForText('2 more seats to fill.');
  await user.clickButton('2', { exact: true });
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot']);
  // Leave game is in the site's header, not in the lobby.
  assert.deepEqual(await playAreaLeaveButtons(), [], 'no Leave button in the lobby');
  assert.ok((await headerButtons()).includes('Leave game'), 'the header offers Leave game in the lobby');
}));

test('starting the game deals the discard phase, and a reload resumes the same room', { timeout: 60000 }, guarded('start and reload', async () => {
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  await user.waitForText('Send to the crib');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$$eval('.hand button.playing-card', (c) => c.length), 6, 'two players are dealt six cards each');

  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('.score-bar');
  await user.waitForText('Send to the crib');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$('.entry'), null, 'not back at the start screen');
}));

test('playing a hand (crib, pegging, the show) ends with the scores pop-up and its All rounds table', { timeout: 120000 }, guarded('play a hand', async () => {
  const finder = () => {
    const send = document.querySelector('.zone button.primary');
    if (send && /Send to the crib/.test(send.innerText)) return send.disabled ? document.querySelector('.hand button.playing-card:not(.selected):not([disabled])') : send;
    return document.querySelector('.hand button.playing-card:not([disabled])');
  };
  const act = () => user.clickFound(finder);
  await drive({ act, finished: async () => /^Scores after/.test(await user.modalTitle()), what: 'a hand of Cribbage', timeout: 100000 });

  assert.equal(await user.modalTitle(), 'Scores after Hand 1');
  const modal = await user.page.$eval('.modal', (el) => ({
    rows: [...el.querySelectorAll('.score-table tbody th')].map((t) => t.textContent.trim()),
    heads: [...el.querySelectorAll('.score-table thead th')].map((t) => t.textContent.trim()),
    show: el.querySelector('.show')?.innerText ?? '',
  }));
  assert.deepEqual(modal.rows, ['Hand 1']);
  assert.equal(modal.heads.length, 3, 'Round plus two players');
  assert.match(modal.show, /hand/i, 'the pop-up shows the counted hands');

  // Closing the pop-up is how a person says they are ready: with only a computer player left to wait for, hand 2 is dealt.
  await user.closeModalWithEsc();
  await user.waitForText('Hand 2');
  await user.clickButton('All rounds', { exact: true });
  await user.waitForSelector('.modal');
  assert.equal(await user.modalTitle(), 'Scores so far');
  await user.closeModalWithEsc();
}));

test('the site header shows the title, Rules and Leave game, and the play area has none of them', { timeout: 60000 }, guarded('header', async () => {
  assert.equal(await user.page.$eval('header.bar h1', (e) => e.textContent.trim()), 'Cribbage');
  assert.equal(await user.page.$('.play h1'), null);
  const names = await headerButtons();
  assert.ok(names.includes('Rules') && names.includes('Leave game'), `header buttons: ${names}`);
  assert.deepEqual(await playAreaLeaveButtons(), [], 'no Leave button in the play area');
}));

const rect = (selector) =>
  user.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }, selector);

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`at ${viewport.width}x${viewport.height} the table fits the window, its rows share the same outer edges and gutters, and the pieces stay in their areas`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await user.page.setViewport(viewport);
    await user.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((r) => setTimeout(r, 400));
    await user.waitForSelector('.arena');
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    assert.ok(['', '1'].includes(await user.page.evaluate(() => document.querySelector('.field-frame').style.zoom)), 'the game is not scaled down');
    const frame = await rect('.game-frame');
    assert.ok(frame.bottom <= viewport.height && frame.bottom >= viewport.height - 20, `the frame fills the window: bottom ${frame.bottom} of ${viewport.height}`);
    // Outer edges: score bar, your side, the board side and both bottom boxes.
    const bar = await rect('.score-bar');
    const mine = await rect('.mine-col');
    const right = await rect('.right-col');
    const log = await rect('.box.log');
    const status = await rect('.box.status');
    for (const [name, r] of Object.entries({ mine, log })) assert.ok(Math.abs(r.left - bar.left) <= 1, `${name} left edge ${r.left} vs score bar ${bar.left}`);
    for (const [name, r] of Object.entries({ right, status })) assert.ok(Math.abs(r.right - bar.right) <= 1, `${name} right edge ${r.right} vs score bar ${bar.right}`);
    // Gutters: 12px between the two halves of the table and of the bottom row, the same row gap everywhere.
    assert.ok(Math.abs(right.left - mine.right - 12) <= 1, `the gutter between the table's halves is 12px (got ${right.left - mine.right})`);
    assert.ok(Math.abs(status.left - log.right - 12) <= 1, `the gutter between the boxes is 12px (got ${status.left - log.right})`);
    const gapBelowMain = log.top - mine.bottom;
    const gapBelowBars = log.top - mine.bottom;
    const gapBelowScores = mine.top - bar.bottom;
    assert.ok(Math.abs(gapBelowMain - gapBelowBars) <= 1 && Math.abs(gapBelowScores - gapBelowBars) <= 1, `row gaps ${gapBelowScores}, ${gapBelowMain} and ${gapBelowBars}`);
    assert.ok(Math.abs(right.bottom - mine.bottom) <= 1, 'both halves of the table end on the same line');
    assert.ok(Math.abs(log.top - status.top) <= 1 && Math.abs(log.bottom - status.bottom) <= 1, 'the two boxes are the same height');
    // The pieces: your hand ends the left half, the piles end the right half, and the board stays inside its box.
    const hand = await rect('.hand-area');
    const piles = await rect('.piles');
    const boardBox = await rect('.board-box');
    const board = await rect('.board-box svg.board');
    assert.ok(Math.abs(hand.bottom - mine.bottom) <= 1, 'your hand is on the bottom edge of its half');
    assert.ok(Math.abs(piles.bottom - right.bottom) <= 1, 'the piles are on the bottom edge of their half');
    assert.ok(Math.abs(boardBox.top - right.top) <= 1, 'the board box is on the top edge of its half');
    assert.ok(board.left >= boardBox.left - 1 && board.right <= boardBox.right + 1 && board.top >= boardBox.top - 1 && board.bottom <= boardBox.bottom + 1, 'the board is inside its box');
    assert.ok(hand.right <= mine.right + 1 && hand.left >= mine.left - 1, 'your hand is inside its half');
    // The opponent's face-down hand and name are shown over the play zone, above your hand and clear of the board side.
    const opp = await user.page.$eval('.opponent-hands .opp', (e) => ({ name: e.querySelector('.who').textContent.trim(), cards: e.querySelectorAll('.playing-card').length, ...(({ left, right, top, bottom }) => ({ left, right, top, bottom }))(e.getBoundingClientRect()) }));
    assert.ok(opp.name.length > 0 && opp.cards > 0, `an opponent's hand is shown: ${JSON.stringify(opp)}`);
    assert.ok(opp.left >= mine.left - 1 && opp.right <= mine.right + 1 && opp.top >= mine.top - 1 && opp.bottom <= hand.top + 1, `the opponent is inside the play zone: ${JSON.stringify(opp)} vs ${JSON.stringify(mine)}`);
    // An opponent's chip opens their details over the top of the table without moving anything; Esc and a second click close it.
    const areas = ['.score-bar', '.mine-col', '.right-col', '.box.log', '.box.status', '.board-box'];
    const before = await Promise.all(areas.map(rect));
    await user.clickButton("Show", { scope: '.score-bar' });
    await user.waitForSelector('.arena .popup');
    assert.match(await user.page.$eval('.arena .popup', (e) => e.innerText), /cards in hand/);
    assert.deepEqual(await Promise.all(areas.map(rect)), before, 'opening the details moved something');
    await user.page.keyboard.press('Escape');
    await user.waitForSelector('.arena .popup', { hidden: true });
  }));
}

test('the next hand was dealt without a separate button', { timeout: 60000 }, guarded('next hand', async () => {
  await user.waitForText('Hand 2');
  assert.equal((await user.buttonState('Next hand', { scope: 'body' })).present, false);
  await user.waitForSelector('.hand button.playing-card');
}));

test('Leave game in the header asks first, then leaves the room', { timeout: 60000 }, guarded('leave', async () => {
  await user.page.setViewport({ width: 1366, height: 768 });
  await user.waitForText('Hand 2');
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
