// A finished trick stays on the table for a moment so that everybody can see who took it.  Every other suite sets that
// pause to nothing, so this one is the only place it is real: it is long enough here to watch, and the tests prove that
// whoever won the trick does not have to sit through it.  Clicking a card leads the next trick at once, and the one
// that was on the table goes with it.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, drive, sleep } from './helpers.js';

const PAUSE = 4000; // how long a finished trick stays up here; a real game uses 1500
const SEATS = 4;

let world;
before(async () => {
  world = await createWorld({ suite: 'trick-pause', env: { HEARTS_TRICK_PAUSE: String(PAUSE), NOMINATION_WHIST_TRICK_PAUSE: String(PAUSE) } });
});
after(async () => {
  await world?.close();
});

/** The cards showing on the table, by their spoken names. */
const trickCards = (user) => user.page.$$eval('.trick-circle .slot.filled .playing-card', (els) => els.map((e) => e.getAttribute('aria-label')));
/** How many cards are in our hand.  Not `button`: a card is only a button while we may play it. */
const handSize = (user) => user.page.$$eval('.hand .playing-card', (els) => els.length);

/**
 * Whatever this player should click next: the cards to pass (Hearts), a nomination (Nomination Whist), or a legal card.
 * Returns nothing while a finished trick is on the table, because the test does that click itself and times it.
 */
const finder = () => {
  const last = (selector) => [...document.querySelectorAll(selector)].at(-1) ?? null; // the hand is a fan: take the top card
  const confirm = document.querySelector('.confirm:not(.hidden) button.primary');
  if (confirm) return confirm.disabled ? last('.hand button.playing-card:not(.selected)') : confirm;
  const number = document.querySelector('.nominate .numbers button.number:not([disabled])');
  if (number) return number;
  if (document.querySelectorAll('.trick-circle .slot.filled').length === 4) return null;
  return last('.hand button.playing-card:not(.dimmed):not([disabled])');
};

/** The one card in the hand that may still be played. */
const topLive = () => [...document.querySelectorAll('.hand button.playing-card:not(.dimmed):not([disabled])')].at(-1) ?? null;

for (const { id, title } of [{ id: 'hearts', title: 'Hearts' }, { id: 'nomination-whist', title: 'Nomination Whist' }]) {
  test(`${title}: the winner of a trick leads the next one without waiting for the pause`, { timeout: 180000 }, (t) =>
    world.guard(`early lead ${id}`, async () => {
      const user = await world.newUser(id);
      await user.signUp('pause', { displayName: 'Hearty' });
      await user.goto(`/play/${id}`);
      await user.clickButton(`Start a new game of ${title}`);
      await user.waitForText('Waiting for players');
      await user.clickButton(`Fill up to ${SEATS} seats with computer players`);
      await user.waitForNoText('more seat');
      await user.clickButton('Start the game', { exact: true });
      await user.waitForSelector('.score-bar');

      // Play on until a full trick is sitting on the table with our own cards still live.  That only happens during the
      // pause, and only for the player who took the trick.
      const ourPause = () =>
        user.page.evaluate(
          () => document.querySelectorAll('.trick-circle .slot.filled').length === 4 && Boolean(document.querySelector('.hand button.playing-card:not(.dimmed):not([disabled])')),
        );
      await drive({ act: () => user.clickFoundOnTop(finder), finished: ourPause, what: `${title} until we take a trick`, timeout: 150000 });

      // The pause is real: the trick is still there a good while after it filled.
      const taken = await trickCards(user);
      assert.equal(taken.length, SEATS);
      await sleep(PAUSE / 4);
      assert.deepEqual(await trickCards(user), taken, 'the finished trick waits on the table');

      // Leading does not wait for the rest of it: the card leaves our hand as soon as the server takes it.
      const held = await handSize(user);
      const started = Date.now();
      assert.ok(await user.clickFoundOnTop(topLive), 'a card of ours is still live during the pause');
      await user.page.waitForFunction((was) => document.querySelectorAll('.hand .playing-card').length < was, { timeout: PAUSE - 500, polling: 20 }, held);
      const took = Date.now() - started;
      assert.ok(took < PAUSE / 2, `the card was played in ${took}ms, well inside the ${PAUSE}ms pause`);
      assert.equal(await handSize(user), held - 1);
      assert.deepEqual((await trickCards(user)).filter((card) => taken.includes(card)), [], 'and the trick that was on the table has gone');
    })(t));
}
