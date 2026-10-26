// Cribbage: the shared seat lobby, then one whole hand (discard, pegging, the show) played by clicking cards.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { checkScoreBarSticks, createWorld, drive } from './helpers.js';

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
    const send = document.querySelector('.panel button.primary');
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

test('the score bar stays visible while the page scrolls', { timeout: 60000 }, guarded('sticky bar', async () => {
  const result = await checkScoreBarSticks(user);
  assert.ok(result.found);
  assert.ok(result.top >= result.headerBottom - 2 && result.top < result.headerBottom + 40, `bar sits under the header: ${JSON.stringify(result)}`);
  assert.ok(result.height > 20 && result.bottom < result.viewport);
}));

test('the next hand was dealt without a separate button', { timeout: 60000 }, guarded('next hand', async () => {
  await user.waitForText('Hand 2');
  assert.equal((await user.buttonState('Next hand', { scope: 'body' })).present, false);
  await user.waitForSelector('.hand button.playing-card');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
