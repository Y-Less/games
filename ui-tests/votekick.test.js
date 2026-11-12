// Voting somebody out from the player pop-up, in a browser: the button on a chip's pop-up, the tally everybody sees,
// and what happens to the person once it carries.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
let host; // asks for the vote
let second; // agrees, which carries it
let third; // the one voted out
let link;

before(async () => {
  world = await createWorld({ suite: 'votekick' });
  host = await world.newUser('host');
  await host.signUp('vhost', { displayName: 'Vote Hetty' });
  second = await world.newUser('second');
  await second.signUp('vsec', { displayName: 'Second Sam' });
  third = await world.newUser('third');
  await third.signUp('vthi', { displayName: 'Third Tom' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
/**
 * Opens the pop-up for the chip with this name on it, and leaves it pinned open.  The chip is pressed in the page
 * rather than with the mouse: the score bar of a five-seat table can sit below the fold, and this test is about the
 * vote rather than about reaching the chip (the Azulejo and Dixnt tests click chips for real).
 */
async function openChip(u, name) {
  await u.waitForSelector('.score-bar button.chip-button');
  const chips = () => u.page.$$eval('.score-bar button.chip-button', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  // The chip may be pressed while the table is still settling after the last change, and that press does nothing, so
  // keep pressing until the pop-up for that player is up.
  for (let tries = 0; tries < 12; tries++) {
    const found = await u.page.evaluate((who) => {
      const open = document.querySelector('.player-popup');
      if (open?.innerText.includes(who)) return 'open';
      const chip = [...document.querySelectorAll('.score-bar button.chip-button')].find((b) => b.innerText.includes(who));
      chip?.click();
      return chip ? 'pressed' : 'missing';
    }, name);
    assert.notEqual(found, 'missing', `there is a chip for ${name} among ${JSON.stringify(await chips())}`);
    if (found === 'open') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`the pop-up for ${name} never opened`);
}
/** The text of the open pop-up. */
const popupText = (u) => u.page.$eval('.player-popup', (el) => el.innerText.replace(/\s+/g, ' ').trim());
/** Presses a button inside the open pop-up by its text. */
const pressInPopup = (u, text) =>
  u.page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('.player-popup button')].find((b) => b.innerText.trim() === wanted);
    button?.click();
    return Boolean(button);
  }, text);

test('three people start a game together', { timeout: 90000 }, guarded('start', async () => {
  await host.goto('/play/hearts');
  await host.clickButton('Start a new game of Hearts');
  await host.waitForText('Waiting for players');
  link = `/play/hearts?${await host.inviteCode()}`;
  await host.waitForText('2 more seats to fill.'); // three are needed, and the host is alone
  for (const who of [second, third]) {
    await who.goto(link);
    await who.waitForText('Waiting for players');
  }
  await host.waitForNoText('more seat'); // three people: enough to play
  await host.clickButton('Fill up to 4 seats with computer players'); // and one computer player makes up the table
  await host.clickButton('Start the game', { exact: true });
  await host.waitForText('Hand 1');
}));

test("the pop-up offers a vote about somebody else, but never about yourself or a computer player", { timeout: 90000 }, guarded('offered', async () => {
  await openChip(host, 'Third Tom');
  assert.match(await popupText(host), /Vote to remove/);

  await openChip(host, 'Vote Hetty');
  assert.doesNotMatch(await popupText(host), /Vote to remove/, 'not about yourself');

  const bot = await host.page.$$eval('.score-bar li.chip', (els) => els.filter((e) => e.querySelector('.bot')).map((e) => e.querySelector('.name').textContent.trim())[0]);
  await openChip(host, bot);
  assert.doesNotMatch(await popupText(host), /Vote to remove/, 'nor about a computer player');
}));

test('asking puts the tally in front of everybody, and the second yes carries it', { timeout: 90000 }, guarded('vote', async () => {
  await openChip(host, 'Third Tom');
  assert.ok(await pressInPopup(host, 'Vote to remove'), 'the button is there');
  assert.ok(await pressInPopup(host, 'Yes, ask them'), 'and its confirmation');

  // Three people may vote, so two are needed, and asking is the first of them.
  await host.waitForText('1 of 2 to remove Third Tom');

  // The person it is about sees it too, on their own chip's pop-up.
  await openChip(third, 'Third Tom');
  await third.waitForText('1 of 2 to remove Third Tom');

  // The second player agrees, which carries it: Third Tom is out and a computer player takes his seat.
  await openChip(second, 'Third Tom');
  await second.waitForText('1 of 2 to remove Third Tom');
  assert.ok(await pressInPopup(second, 'Remove them'));
  await third.waitForText('Start a new game of Hearts');
  await host.page.waitForFunction(
    (name) => ![...document.querySelectorAll('.score-bar .chips li.chip .name')].some((e) => e.textContent.includes(name)),
    { timeout: 20000 },
    'Third Tom',
  );
  assert.equal(await host.page.$$eval('.score-bar li.chip', (els) => els.length), 5, 'the table is the same size');
}));

test('and the invitation does not let him back in', { timeout: 90000 }, guarded('barred', async () => {
  await third.goto(link);
  await third.waitForText('You were removed from that game.');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
