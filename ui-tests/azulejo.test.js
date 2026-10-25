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
  if (!document.querySelector('.status.mine')) return null;
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
