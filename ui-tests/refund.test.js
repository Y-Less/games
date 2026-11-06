// Asking for a refund, from the shop to the row in the database: the Gilder count becomes the way in, the page will not
// send anything short of a thousand words, and what is sent is kept.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';
import { REFUND_MINIMUM_WORDS } from '../shared/refunds.js';

let world;
let user;
before(async () => {
  world = await createWorld({ suite: 'refund' }); // every account here owns everything on sale, Refunds among it
  user = await world.newUser('customer');
  await user.signUp('refund');
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
/** A piece of writing of exactly `n` words. */
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
/** Puts writing into the textarea the way a person would, without typing a thousand words one key at a time. */
const write = (text) =>
  user.page.$eval(
    'textarea',
    (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    text,
  );
const sendState = () => user.buttonState('Submit for review');

test('the shop\'s Gilder count is the way to the refund page', { timeout: 60000 }, guarded('the way in', async () => {
  await user.goto('/shop/unlocks');
  await user.waitForSelector('.coins.refund');
  assert.equal(await user.page.$eval('.coins.refund', (el) => el.textContent.trim()), 'Refund');
  await user.page.click('.coins.refund');
  await user.waitForText(`In no fewer than ${REFUND_MINIMUM_WORDS} words`);
  assert.equal(user.url.pathname, '/refund');
}));

test('the page says what customer support wants, and counts the words written so far', { timeout: 60000 }, guarded('the asking', async () => {
  await user.goto('/refund');
  await user.waitForSelector('textarea');
  const intro = await user.page.$eval('.intro', (el) => el.textContent.trim());
  assert.equal(
    intro,
    `In no fewer than ${REFUND_MINIMUM_WORDS} words please describe which item you wish to refund and why.  This will be submitted to our customer support agents for review.  We will endeavour to get back to you within 20 working months with a decision.`,
  );
  assert.deepEqual(await sendState(), { present: true, disabled: true }, 'nothing written yet');

  await write(words(REFUND_MINIMUM_WORDS - 1));
  await user.waitForText(`${REFUND_MINIMUM_WORDS - 1} of ${REFUND_MINIMUM_WORDS} words`);
  assert.equal((await sendState()).disabled, true, 'a word short');
}));

test('a long enough request is sent, kept, and answered with the promise of 20 working months', { timeout: 60000 }, guarded('sending', async () => {
  await user.goto('/refund');
  await user.waitForSelector('textarea');
  const essay = `Please refund my Moving gradient. ${words(REFUND_MINIMUM_WORDS - 5)}`;
  await write(essay);
  await user.waitForText(`${REFUND_MINIMUM_WORDS} words: long enough.`);
  await user.clickButton('Submit for review');
  await user.waitForText('within 20 working months');

  const row = world.site.db.prepare('SELECT * FROM refund_requests ORDER BY id DESC').get();
  assert.equal(row.text, essay);
  assert.equal(row.words, REFUND_MINIMUM_WORDS);
  assert.equal(row.user_id, world.site.db.prepare('SELECT id FROM users WHERE username = ?').get(user.username).id);
}));
