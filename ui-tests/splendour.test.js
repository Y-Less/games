// Splendour: the shared seat lobby, a reload mid-game, then a whole game against a computer player played by clicking
// gems and cards, with the score pop-up after every round and the final result.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { checkScoreBarSticks, createWorld, drive } from './helpers.js';

let world;
let user;
let code;
before(async () => {
  world = await createWorld({ suite: 'splendour' });
  user = await world.newUser('human');
  await user.signUp('splendid', { displayName: 'Splendid' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const seatKinds = () => user.page.$$eval('.seats .seat', (els) => els.map((e) => [...e.classList].find((c) => ['human', 'bot', 'empty'].includes(c))));

test('the seat lobby: seat count, play-to target and computer players; Start needs every seat filled', { timeout: 60000 }, guarded('lobby', async () => {
  await user.goto('/play/splendour');
  await user.clickButton('Start a new game');
  await user.waitForText('Waiting for players');
  code = await user.inviteCode();
  assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
  await user.waitForCodeInUrl(code);
  assert.equal(await user.copyInvite(), `${world.base}/play/splendour?${code}`);

  assert.deepEqual(await seatKinds(), ['human', 'empty', 'empty', 'empty']);
  assert.equal((await user.buttonState('Start the game')).disabled, true);
  await user.clickButton('Fill the empty seats with computer players');
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot', 'bot', 'bot']);
  assert.equal((await user.buttonState('Start the game')).disabled, false);

  // Two bots go again, then two seats and a low target keep the game short (one bot is left to fill the second seat).
  await user.clickButton('Remove', { scope: '.seat.bot' });
  await user.waitForText('1 more seat to fill.');
  await user.clickButton('Remove', { scope: '.seat.bot' });
  await user.waitForText('2 more seats to fill.');
  await user.clickButton('2 players', { exact: true });
  await user.waitForNoText('more seat');
  await user.clickButton('10', { exact: true });
  await user.page.waitForFunction(() => [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.innerText.trim() === '10'));
  await user.waitForNoText('more seat');
  assert.deepEqual(await seatKinds(), ['human', 'bot']);
  assert.equal((await user.buttonState('Start the game')).disabled, false);
}));

test('starting deals the table, and a reload resumes the same room', { timeout: 60000 }, guarded('start and reload', async () => {
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  await user.waitForText('first to 10 prestige');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$$eval('.level-row button.dev-card:not(.pile-button)', (c) => c.length), 12, 'twelve cards on the table');
  assert.equal(await user.page.$$eval('.noble-row > *', (c) => c.length), 3, 'three nobles for two players');

  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('.score-bar');
  await user.waitForText('first to 10 prestige');
  await user.waitForCodeInUrl(code);
  assert.equal(await user.page.$('.entry'), null, 'not back at the start screen');
}));

test('playing a whole game by clicking gems and cards: a pop-up after every round, then the final result', { timeout: 240000 }, guarded('play a game', async () => {
  const titles = new Set();
  const finder = () => {
    const action = document.querySelector('.action');
    const mine = document.querySelector('.status.mine');
    if (!action || !mine) return null;
    const enabled = (el) => el && !el.disabled;
    const byText = (re) => [...action.querySelectorAll('button')].find((b) => re.test(b.innerText.trim()) && !b.disabled);
    // Over ten tokens: give some back, then confirm.
    if (action.querySelector('.give-row')) return byText(/^Return \d+ of/) ?? action.querySelector('.give-row button:not(:disabled)');
    // Several nobles: pick one.
    const noble = action.querySelector('.noble-row button');
    if (noble) return noble;
    // A card is selected: buy it if we can, otherwise let it go.
    const buy = [...action.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Buy this card');
    if (buy) return enabled(buy) ? buy : byText(/^Cancel$/);
    const take = byText(/^Take \d/);
    if (take) return take;
    const pass = byText(/^Pass/);
    if (pass) return pass;
    const card = document.querySelector('.market button.dev-card.affordable');
    const picked = action.querySelectorAll('.picks svg').length;
    if (card && !picked) return card;
    return [...document.querySelectorAll('.supply button.stack-btn')].find((b) => b.getAttribute('aria-pressed') === 'false' && !/: 0 left/.test(b.getAttribute('aria-label')));
  };
  const act = async () => {
    const title = await user.modalTitle();
    if (title) {
      titles.add(title);
if (title === 'Final scores') return false; // the game is over: leave this pop-up for the checks below
      await user.page.keyboard.press('Escape');
      return true;
    }
    return user.clickFound(finder);
  };
  const done = () => user.page.$('section.end').then(Boolean);
  await drive({ act, finished: done, what: 'a game of Splendour', timeout: 220000 });

  assert.ok([...titles].some((t) => /^Scores after Round 1$/.test(t)), `the round pop-up appeared: ${[...titles]}`);
  assert.match(await user.page.$eval('section.end h2', (el) => el.innerText), /wins with|shared win/);
  assert.ok((await user.page.$$eval('section.end .standings li', (els) => els.length)) === 2);
  // The final pop-up arrives by itself, with every round in its table.
  await user.waitForSelector('.modal');
  assert.equal(await user.modalTitle(), 'Final scores');
  const rounds = await user.page.$$eval('.modal .score-table tbody th', (els) => els.length);
  assert.ok(rounds >= 3, `the All rounds table has the rounds played (${rounds})`);
  assert.match(await user.page.$eval('.modal', (e) => e.innerText), /wins!/);
  await user.closeModalWithEsc();
}));

test('after the game ends, a reload still shows the result and Play again starts a new lobby', { timeout: 60000 }, guarded('again', async () => {
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('section.end');
  await user.waitForCodeInUrl(code);
  await user.clickButton('Play again', { exact: true });
  await user.waitForText('Waiting for players');
  assert.deepEqual((await seatKinds()).sort(), ['bot', 'human'], 'the same two players are back in the lobby (the seating may be shuffled)');
  await user.clickButton('Start the game', { exact: true });
  await user.waitForText('Round 1');
  await user.waitForSelector('.market');
  await user.clickButton('Leave game', { exact: true });
  await user.waitForText('Start a new game');
  assert.equal(await user.page.$('.table-view'), null);
}));

test('the score bar stays visible while the page scrolls', { timeout: 60000 }, guarded('sticky bar', async () => {
  await user.goto('/play/splendour');
  await user.clickButton('Start a new game');
  await user.clickButton('2 players', { exact: true });
  await user.clickButton('Add a computer player');
  await user.waitForNoText('more seat');
  await user.clickButton('Start the game', { exact: true });
  await user.waitForSelector('.score-bar');
  const result = await checkScoreBarSticks(user);
  assert.ok(result.found);
  assert.ok(result.top >= result.headerBottom - 2 && result.top < result.headerBottom + 40, `bar sits under the header: ${JSON.stringify(result)}`);
  assert.ok(result.height > 20 && result.bottom < result.viewport);
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
