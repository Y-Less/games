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
  if (!document.querySelector('.status.mine')) return null;
  const mem = (window.__gaudi ??= { key: '', tried: [] });
  const key = `${document.querySelector('.status').innerText}|${document.querySelectorAll('.mine .space.filled').length}|${document.querySelectorAll('.pool-die').length}`;
  if (mem.key !== key) Object.assign(mem, { key, tried: [] });
  const endTurn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'End turn' && !b.disabled);
  if (!document.querySelector('.status').innerText.includes('place a die;')) return endTurn;
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

test('playing the whole game by clicking dice and spaces: a pop-up after every round, then the final result', { timeout: 280000 }, guarded('play a game', async () => {
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

  assert.ok([...titles].includes('Scores after Round 1'), `the round pop-up appeared: ${[...titles]}`);
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
  assert.ok(result.top >= result.headerBottom - 2 && result.top < result.headerBottom + 40, `bar sits under the header: ${JSON.stringify(result)}`);
  assert.ok(result.height > 20 && result.bottom < result.viewport);
  await user.clickButton('Leave game', { exact: true });
  await user.waitForText('Start a new game');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
