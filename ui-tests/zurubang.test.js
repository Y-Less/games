// Zurubang in two real browsers.  What is checked here and nowhere else is the one thing the game is about on a
// screen: a hand you can see the faces of, a hand opposite that is five backs and nothing more, and ten places on the
// battlefield that fill up as the two of you put cards down.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
let host;
let guest;
let code;
before(async () => {
  world = await createWorld({ suite: 'zurubang', env: { ZURUBANG_BOT_DELAY: '10-30', ZURUBANG_REVEAL_WAIT: '150', ZURUBANG_NEXT_WAIT: '4000' } });
  host = await world.newUser('host');
  guest = await world.newUser('guest');
  await host.signUp('zurubang', { displayName: 'Zuri' });
  await guest.signUp('zurubang', { displayName: 'Bangor' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);

/** How many cards are drawn in a part of the table, and how many of them are showing a face. */
const cardsIn = (user, selector) =>
  user.page.$$eval(`${selector} .zb-card`, (els) =>
    els.map((el) => ({
      face: Boolean(el.querySelector('img')?.src.includes('/faces/')),
      back: Boolean(el.querySelector('img')?.src.includes('/backs/')),
    })),
  );

/** Clicks the nth card of a row, which is how everything in this game is done. */
const clickCard = (user, selector, n) =>
  user.clickFoundOnTop(
    (sel, index) => document.querySelectorAll(`${sel} .zb-card`)[index] ?? null,
    selector,
    n,
  );

test('two people sit down, and the table shows your five faces against their five backs', { timeout: 120000 }, guarded('lobby and table', async () => {
  await host.goto('/play/zurubang');
  await host.clickButton('Start a new game');
  await host.waitForText('Waiting for players');
  code = await host.inviteCode();

  await guest.goto(`/play/zurubang?${code}`);
  await guest.waitForText('Bangor');
  await host.waitForText('Bangor');
  assert.equal((await host.buttonState('Start the game')).disabled, false);
  await host.clickButton('Start the game', { exact: true });

  for (const user of [host, guest]) await user.waitForSelector('.hand .zb-card');
  const mine = await cardsIn(host, '.hand');
  assert.equal(mine.length, 5, 'five cards in hand');
  assert.equal(mine.every((card) => card.face), true, 'and you can see every one of their faces');

  const theirs = await cardsIn(host, '.their-hand');
  assert.equal(theirs.length, 5, 'five cards opposite');
  assert.equal(theirs.every((card) => card.back && !card.face), true, 'and nothing of them but their backs');

  const battlefield = await cardsIn(host, '.battlefield');
  assert.equal(battlefield.length, 10, 'ten empty places, five a side, so nothing moves when they fill');
  assert.equal(battlefield.some((card) => card.face || card.back), false, 'and nothing standing on any of them yet');
}));

test('a duel: the challenge, the ten cards going down, and the result', { timeout: 180000 }, guarded('a duel', async () => {
  // Whoever has the turn challenges; the other accepts and says who places first.
  const [challenger, challenged] = (await host.text()).includes('Your turn.') ? [host, guest] : [guest, host];
  await challenger.waitForText('Your turn.');
  await challenger.clickButton('Challenge to a duel');

  await challenged.waitForText('You have been challenged to a duel.');
  await challenged.clickButton('Accept the duel');
  await challenged.waitForText('you say who places first');
  await challenged.clickButton('I place first');

  // Ten cards go down, a card at a time, by whoever is owed one.  The battlefield filling up is what says it worked,
  // rather than a count of clicks: a click that lands while the hand is being redrawn is a click that did nothing.
  const down = (user) => user.page.$$eval('.battlefield .zb-card img', (els) => els.length);
  const deadline = Date.now() + 60000;
  while ((await down(host)) < 10) {
    let done = false;
    for (const user of [host, guest]) {
      if (!(await user.text()).includes('Place a card on position')) continue;
      done = await clickCard(user, '.hand', 0);
      if (done) break;
    }
    if (!done) await new Promise((resolve) => setTimeout(resolve, 100));
    if (Date.now() > deadline) {
      const boxes = async (user) =>
        JSON.stringify(
          await user.page.$$eval('.hand .zb-card', (els) =>
            els.map((el) => {
              const b = el.getBoundingClientRect();
              return { tag: el.tagName, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), on: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.tagName ?? null };
            }),
          ),
        );
      assert.fail(`only ${await down(host)} of the ten cards went down.\nhost: ${(await host.text()).slice(500, 900)} ${await boxes(host)}\nguest: ${(await guest.text()).slice(500, 900)} ${await boxes(guest)}`);
    }
  }

  // Every place on the battlefield is full, and the pairs then turn over by themselves.
  for (const user of [host, guest]) {
    await user.page.waitForFunction(() => document.querySelectorAll('.battlefield .zb-card img').length === 10, { timeout: 20000, polling: 50 });
    const battlefield = await cardsIn(user, '.battlefield');
    assert.equal(battlefield.filter((card) => card.face || card.back).length, 10, 'ten cards down');
    assert.ok(battlefield.filter((card) => card.face).length >= 5, 'and at least your own five of them face up to you');
  }

  // The duel ends: somebody takes it, or it goes to a sudden death, and either way the table says so.
  await host.waitForText(/wins the duel|You win the duel|sudden death|settles nothing/, { timeout: 60000 });
}));
