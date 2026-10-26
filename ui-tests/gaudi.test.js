// Gaudi: the shared seat lobby, choosing a window, a reload mid-game, then a whole ten-round game against a computer
// player played by clicking dice and legal spaces, with the provisional score pop-up after every round.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { checkScoreBarSticks, createWorld, drive } from './helpers.js';

let world;
let user;
let code;
before(async () => {
  world = await createWorld({ suite: 'gaudi' });
  user = await world.newUser('human');
  await user.signUp('gaudi', { displayName: 'Antoni' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const seatKinds = () => user.page.$$eval('.seats .seat', (els) => els.map((e) => [...e.classList].find((c) => ['human', 'bot', 'empty'].includes(c))));

/** One click of a human playing Gaudi, decided inside the page: returns the element to click, or null. */
const finder = () => {
  // Choosing a window: pick the first one, then confirm.
  const confirm = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Choose this window');
  if (confirm) return confirm.disabled ? document.querySelector('.option:not(.locked)') : confirm;
  if (!document.querySelector('.game-status .headline.mine')) return null;
  const mem = (window.__gaudi ??= { key: '', tried: [] });
  const key = `${document.querySelector('.game-status .headline').innerText}|${document.querySelectorAll('.mine .space.filled').length}|${document.querySelectorAll('.pool-die').length}`;
  if (mem.key !== key) Object.assign(mem, { key, tried: [] });
  const endTurn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'End turn' && !b.disabled);
  if (!document.querySelector('.game-status .headline').innerText.includes('place a die;')) return endTurn;
  const chosen = document.querySelector('.pool-die.chosen');
  if (chosen) {
    const legal = document.querySelector('.mine .space.legal');
    if (legal) return legal;
    mem.tried.push(chosen.getAttribute('aria-label'));
  }
  const next = [...document.querySelectorAll('.pool-die')].find((d) => !mem.tried.includes(d.getAttribute('aria-label')) && !d.classList.contains('chosen'));
  return next ?? endTurn; // nothing fits anywhere: just end the turn
};

test('the seat lobby: players, the private-scoring option and computer players; Start needs every seat filled', { timeout: 60000 }, guarded('lobby', async () => {
  await user.goto('/play/gaudi');
  await user.clickButton('Start a new game');
  await user.waitForText('Waiting for players');
  code = await user.inviteCode();
  assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
  await user.waitForCodeInUrl(code);
  assert.equal(await user.copyInvite(), `${world.base}/play/gaudi?${code}`);

  assert.equal((await seatKinds()).length, 4, 'four seats to begin with');
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
  await user.waitForText('The weaker rule applies');
  await user.page.click('input[type="checkbox"]');
  await user.waitForText('The normal rule applies');
}));

test('starting offers windows to choose from; a reload resumes the same room', { timeout: 60000 }, guarded('start and reload', async () => {
  await user.clickButton('Start the game', { exact: true });
  await user.waitForText('Choose your window');
  await user.waitForCodeInUrl(code);
  assert.ok((await user.page.$$('.option')).length >= 2, 'several windows to choose from');
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await user.page.setViewport(viewport);
    await new Promise((r) => setTimeout(r, 300));
    const fit = await user.page.evaluate(() => {
      const phase = document.querySelector('.windows-phase');
      return { overflow: document.documentElement.scrollHeight - innerHeight, right: Math.max(...[...document.querySelectorAll('.option')].map((o) => o.getBoundingClientRect().right)), width: innerWidth, clipped: phase.scrollHeight - phase.clientHeight };
    });
    assert.ok(fit.overflow <= 0 && fit.right <= fit.width && fit.clipped <= 0, `the windows to choose from fit ${viewport.width}x${viewport.height}: ${JSON.stringify(fit)}`);
  }
  assert.equal((await user.buttonState('Choose this window')).disabled, true, 'nothing chosen yet');

  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForText('Choose your window');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$('.entry'), null, 'not back at the start screen');
  await user.page.click('.option');
  await user.clickButton('Choose this window', { exact: true });
  await user.waitForText('Round 1 of 10');
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForText('Round 1 of 10');
  await user.waitForSelector('.mine .space');
}));

const rect = (selector) =>
  user.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) };
  }, selector);

test('the site header shows the title, Rules and Leave game, and the play area has none of them', { timeout: 60000 }, guarded('header', async () => {
  assert.equal(await user.page.$eval('header.bar h1', (e) => e.textContent.trim()), 'Gaudi');
  assert.equal(await user.page.$('.play h1'), null);
  const names = await user.page.$$eval('header.bar button', (bs) => bs.map((b) => b.innerText.trim()));
  assert.ok(names.includes('Rules') && names.includes('Leave game'), `header buttons: ${names}`);
  const inPlay = await user.page.$$eval('.field button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Leave/.test(t)));
  assert.deepEqual(inPlay, [], 'no Leave button in the play area');
}));

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`at ${viewport.width}x${viewport.height} the table fits the window without scaling, its rows share the same outer edges and gutters, and a click on a name in the score bar toggles that window without moving anything`, { timeout: 60000 }, guarded(`layout ${viewport.width}`, async () => {
    await user.page.setViewport(viewport);
    await user.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await user.page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), 0, 'the page does not scroll');
    assert.equal(await user.page.evaluate(() => Number.parseFloat(document.querySelector('.field-frame')?.style.zoom) || 1), 1, 'the shell does not scale the game down');
    const bar = await rect('.score-bar');
    const mine = await rect('.mine-col');
    const right = await rect('.right-col');
    const log = await rect('.box.log');
    const status = await rect('.box.status');
    for (const [name, r] of Object.entries({ mine, log })) assert.ok(Math.abs(r.left - bar.left) <= 1, `${name} left edge ${r.left} vs score bar ${bar.left}`);
    for (const [name, r] of Object.entries({ right, status })) assert.ok(Math.abs(r.right - bar.right) <= 1, `${name} right edge ${r.right} vs score bar ${bar.right}`);
    assert.ok(mine.right < right.left && right.left - mine.right <= 24, `the gutter between your window and the cards: ${right.left - mine.right}`);
    assert.equal(await user.page.$('.others'), null, 'no row of duplicate player bars');
    assert.ok(log.top - mine.bottom >= 4 && log.top - mine.bottom <= 12, `the gap between the main row and the boxes: ${log.top - mine.bottom}`);
    assert.ok(Math.abs(right.bottom - mine.bottom) <= 1, 'your window and the cards end on the same line');
    assert.ok(Math.abs(log.bottom - status.bottom) <= 1);
    const clipped = await user.page.evaluate(() => ['.mine', '.right-col'].map((s) => { const e = document.querySelector(s); return [s, e.scrollHeight - e.clientHeight, e.scrollWidth - e.clientWidth]; }).filter(([, h, w]) => h > 1 || w > 1));
    assert.deepEqual(clipped, [], 'nothing in the main area is cut off');

    // Toggling another player's window moves nothing else.
    const areas = ['.score-bar', '.mine-col', '.mine .pool-col', '.mine [aria-label="Your window"]', '.right-col', '.box.log', '.box.status'];
    const before = await Promise.all(areas.map(rect));
    await user.page.click('.score-bar button.chip-button');
    await user.waitForSelector('.main .popup .window');
    assert.deepEqual(await Promise.all(areas.map(rect)), before, 'opening a window moved something');
    assert.equal((await user.page.$$('.main .popup')).length, 1);
    assert.equal(await user.page.$eval('.score-bar button.chip-button', (e) => e.getAttribute('aria-pressed')), 'true');
    const popup = await rect('.main .popup');
    const main = await rect('.arena');
    assert.ok(popup.top >= main.top - 1 && popup.bottom <= main.bottom + 1 && popup.left >= main.left && popup.right <= main.right, 'the pop-up sits inside the main area');
    await user.page.keyboard.press('Escape');
    await user.waitForSelector('.main .popup', { hidden: true });
    assert.deepEqual(await Promise.all(areas.map(rect)), before, 'closing a window moved something');
  }));
}

test('playing the whole game by clicking dice and spaces: no pop-up between rounds, then the final result', { timeout: 280000 }, guarded('play a game', async () => {
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
  await drive({ act, finished: () => user.page.$('section.final').then(Boolean), what: 'a game of Gaudi', timeout: 260000 });

  assert.deepEqual([...titles].filter((t) => t !== 'Final scores'), [], 'no score pop-up between rounds');
  const placed = await user.page.$$eval('.mine .space.filled', (els) => els.length);
  assert.ok(placed > 0, 'the human placed some dice');
  await user.waitForSelector('.modal');
  assert.equal(await user.modalTitle(), 'Final scores');
  const rounds = await user.page.$$eval('.modal .score-table tbody th', (els) => els.length);
  assert.ok(rounds >= 10, `the All rounds table has every round (${rounds})`);
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
  await user.waitForText('Choose your window');
}));

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
