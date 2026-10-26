// Hearts: the shared seat lobby, then one whole hand played by clicking cards, then the score pop-up.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { checkScoreBarSticks, createWorld, drive } from './helpers.js';

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
  const act = () => user.clickFoundOnTop(finder); // the hand is a fan of overlapping cards
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

test('the score bar stays visible while the page scrolls', { timeout: 60000 }, guarded('sticky bar', async () => {
  const result = await checkScoreBarSticks(user);
  assert.ok(result.found);
  assert.ok(result.top >= result.headerBottom - 2 && result.top < result.headerBottom + 40, `bar sits under the header: ${JSON.stringify(result)}`);
  assert.ok(result.height > 20 && result.bottom < result.viewport);
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
