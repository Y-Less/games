// Nomination Whist: the shared seat lobby, then one whole round played by nominating and clicking cards.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { checkScoreBarSticks, createWorld, drive } from './helpers.js';

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

  await user.closeModalWithEsc();
  await user.waitForText('The round is over.');
  await user.clickButton('All rounds', { exact: true });
  await user.waitForSelector('.modal');
  assert.equal(await user.modalTitle(), 'Scores so far');
  await user.closeModalWithEsc();
}));

test('the score bar stays visible while the page scrolls', { timeout: 60000 }, guarded('sticky bar', async () => {
  const result = await checkScoreBarSticks(user);
  assert.ok(result.found);
  assert.ok(result.top >= result.headerBottom - 2 && result.top < result.headerBottom + 40, `bar sits under the header: ${JSON.stringify(result)}`);
  assert.ok(result.height > 20 && result.bottom < result.viewport);
}));

test('the next round can be dealt', { timeout: 60000 }, guarded('next round', async () => {
  await user.clickButton('Deal round 2');
  await user.waitForText('Round 2 of 14');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
