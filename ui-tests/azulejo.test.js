// Azulejo: the shared seat lobby, a reload mid-game, then a whole game against a computer player played by taking tiles
// from the plates and placing them on pattern lines (or the floor), with the score pop-up after every round.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { checkScoreBarSticks, createWorld, drive } from './helpers.js';

let world;
let user;
let code;
before(async () => {
  world = await createWorld({ suite: 'azulejo' });
  user = await world.newUser('human');
  await user.signUp('azulejo', { displayName: 'Maria' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const seatKinds = () => user.page.$$eval('.seats .seat', (els) => els.map((e) => [...e.classList].find((c) => ['human', 'bot', 'empty'].includes(c))));

/** One click of a human playing Azulejo, decided inside the page: returns the element to click, or null. */
const finder = () => {
  if (!document.querySelector('.game-status .headline.mine')) return null;
  const column = document.querySelector('.spot.choice'); // free wall only
  if (column) return column;
  if (document.querySelector('.workshop button.pick[aria-pressed="true"]')) {
    return document.querySelector('.mine .line.ok') ?? document.querySelector('.mine .floor.open');
  }
  return document.querySelector('.workshop button.pick:not(:disabled)');
};

test('the seat lobby: players, the free-wall option and computer players; Start needs every seat filled', { timeout: 60000 }, guarded('lobby', async () => {
  await user.goto('/play/azulejo');
  await user.clickButton('Start a new game');
  await user.waitForText('Waiting for players');
  code = await user.inviteCode();
  assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
  await user.waitForCodeInUrl(code);
  assert.equal(await user.copyInvite(), `${world.base}/play/azulejo?${code}`);

  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.waitForText('3 more seats to fill.');
  await user.clickButton('Fill the empty seats with computer players');
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot', 'bot', 'bot']);
  await user.clickButton('Remove', { scope: '.seat.bot' });
  await user.waitForText('1 more seat to fill.');
  await user.clickButton('Remove', { scope: '.seat.bot' });
  await user.waitForText('2 more seats to fill.');
  await user.clickButton('2 players', { exact: true });
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot']);
  assert.equal((await user.buttonState('Start the game')).disabled, false);

  await user.page.click('input[type="checkbox"]');
  await user.waitForText('The wall starts blank');
  await user.page.click('input[type="checkbox"]');
  await user.waitForText('The standard wall');
}));

test('starting deals the plates, and a reload resumes the same room', { timeout: 60000 }, guarded('start and reload', async () => {
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  await user.waitForText('Round 1');
  await user.waitForCodeInUrl(code);
  assert.equal((await user.page.$$('.plates .plate')).length, 5, 'five plates for two players');

  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('.score-bar');
  await user.waitForText('Round 1');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$('.entry'), null, 'not back at the start screen');
}));

test('playing the whole game by clicking tiles and lines: a pop-up after every round, then the final result', { timeout: 280000 }, guarded('play a game', async () => {
  const titles = new Set();
  const act = async () => {
    const title = await user.modalTitle();
    if (title) {
      titles.add(title);
      if (title === 'Final scores') return false;
      await user.page.keyboard.press('Escape');
      return true;
    }
    return user.clickFound(finder);
  };
  await drive({ act, finished: () => user.page.$('section.final').then(Boolean), what: 'a game of Azulejo', timeout: 260000 });

  assert.ok([...titles].includes('Scores after Round 1'), `the round pop-up appeared: ${[...titles]}`);
  await user.waitForSelector('.modal');
  assert.equal(await user.modalTitle(), 'Final scores');
  const rounds = await user.page.$$eval('.modal .score-table tbody th', (els) => els.length);
  assert.ok(rounds >= 4, `the All rounds table has the rounds played (${rounds})`);
  assert.match(await user.page.$eval('.modal', (e) => e.innerText), /wins!|win\./);
  await user.closeModalWithEsc();
  assert.equal(await user.page.$$eval('table.breakdown tbody tr', (r) => r.length), 2, 'the breakdown has a row per player');
}));

test('after the game ends, a reload still shows the result, and Play again returns to the lobby', { timeout: 60000 }, guarded('again', async () => {
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('section.final');
  await user.waitForCodeInUrl(code);
  await user.clickButton('Play again', { exact: true });
  await user.waitForText('Waiting for players');
  assert.deepEqual((await seatKinds()).sort(), ['bot', 'human']);
  await user.clickButton('Start the game', { exact: true });
  await user.waitForText('Round 1');
}));

const rect = (selector) =>
  user.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }, selector);

test('the site header shows the title, Rules and Leave game, and the play area has none of them', { timeout: 60000 }, guarded('header', async () => {
  assert.equal(await user.page.$eval('header.bar h1', (e) => e.textContent.trim()), 'Azulejo');
  assert.equal(await user.page.$('.play h1'), null);
  const names = await user.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()));
  assert.ok(names.includes('Rules') && names.includes('Leave game'), `header buttons: ${names}`);
  const inPlay = await user.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Leave/.test(t)));
  assert.deepEqual(inPlay, [], 'no Leave button in the play area');
  await user.clickButton('Rules', { exact: true, scope: 'header.bar' });
  await user.waitForSelector('[role="dialog"][aria-label="Rules"]');
  await user.page.keyboard.press('Escape');
}));

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`at ${viewport.width}x${viewport.height} the table fits the window, its rows share the same outer edges and gutters, and a click on a name in the score bar toggles that board without moving anything`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await user.page.setViewport(viewport);
    await user.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    // Outer edges: score bar, own board, plates panel and both bottom boxes.
    const bar = await rect('.score-bar');
    const mine = await rect('.mine-col');
    const right = await rect('.right-col');
    const log = await rect('.box.log');
    const status = await rect('.box.status');
    for (const [name, r] of Object.entries({ mine, log })) assert.ok(Math.abs(r.left - bar.left) <= 1, `${name} left edge ${r.left} vs score bar ${bar.left}`);
    for (const [name, r] of Object.entries({ right, status })) assert.ok(Math.abs(r.right - bar.right) <= 1, `${name} right edge ${r.right} vs score bar ${bar.right}`);
    assert.equal(await user.page.$('.others'), null, 'no row of duplicate player bars');
    assert.ok(log.top - mine.bottom >= 4 && log.top - mine.bottom <= 12, `the gap between the main row and the boxes: ${log.top - mine.bottom}`);
    assert.ok(Math.abs(right.bottom - mine.bottom) <= 1, 'the board and the plates panel end on the same line');
    assert.ok(Math.abs(log.bottom - status.bottom) <= 1);

    // Toggling another player's board moves nothing else.
    const areas = ['.score-bar', '.mine-col', '.right-col', '.box.log', '.box.status', '.workshop-panel'];
    const before = await Promise.all(areas.map(rect));
    await user.page.click('.score-bar .chip:not(.me) button.chip-button');
    await user.waitForSelector('.arena .popup section.board');
    assert.deepEqual(await Promise.all(areas.map(rect)), before, 'opening a board moved something');
    assert.equal((await user.page.$$('.arena .popup')).length, 1);
    assert.equal(await user.page.$eval('.score-bar .chip:not(.me) button.chip-button', (e) => e.getAttribute('aria-pressed')), 'true');
    await user.page.click('.score-bar .chip:not(.me) button.chip-button');
    await user.waitForSelector('.arena .popup', { hidden: true });
    assert.deepEqual(await Promise.all(areas.map(rect)), before, 'closing a board moved something');
  }));
}

test('the score bar stays visible while the page scrolls', { timeout: 60000 }, guarded('sticky bar', async () => {
  const result = await checkScoreBarSticks(user);
  assert.ok(result.found);
  assert.ok(result.height > 20 && result.bottom < result.viewport);
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
