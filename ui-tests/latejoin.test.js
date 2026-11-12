// Coming late to an invitation, in a browser: a game under way is no longer a closed door.  Somebody opening the
// link takes a computer player's place, and somebody who dropped out gets their own place back, cards and all.
// The score bar is read rather than the table, because it names every player in seat order whoever is looking.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
let host; // starts the game and stays in it
let flake; // joins, then drops out, then comes back
let late; // only opens the invitation once the cards are dealt
let link;

before(async () => {
  world = await createWorld({ suite: 'latejoin' });
  host = await world.newUser('host');
  await host.signUp('host', { displayName: 'Host Hetty' });
  flake = await world.newUser('flake');
  await flake.signUp('flake', { displayName: 'Flaky Fred' });
  late = await world.newUser('late');
  await late.signUp('late', { displayName: 'Late Lucy' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
/** Everyone in the game, in seat order: whether a computer is playing them, and the name on the chip. */
const players = (u) =>
  u.page.$$eval('.score-bar .chips li.chip', (els) => els.map((e) => ({ bot: Boolean(e.querySelector('.bot')), name: (e.querySelector('.name')?.textContent ?? '').replace(/\s+/g, ' ').trim() })));
/** How many cards are in your hand. */
const handSize = async (u) => {
  await u.waitForSelector('.hand .fan-card');
  return u.page.$$eval('.hand .fan-card', (els) => els.length);
};
/** Where somebody sits, or -1. */
const seatOf = (list, name) => list.findIndex((p) => p.name.includes(name));

test('the host starts a four-seat game with one friend and two computer players', { timeout: 90000 }, guarded('start', async () => {
  await host.goto('/play/hearts');
  await host.clickButton('Start a new game of Hearts');
  await host.waitForText('Waiting for players');
  link = `/play/hearts?${await host.inviteCode()}`;

  await flake.goto(link);
  await flake.waitForText('Waiting for players');
  await host.clickButton('Fill up to 4 seats with computer players');
  await host.clickButton('Start the game', { exact: true });
  await host.waitForText('Hand 1');
  const seated = await players(host);
  assert.equal(seated.length, 4);
  assert.equal(seated.filter((p) => !p.bot).length, 2, `two people and two computer players: ${JSON.stringify(seated)}`);
}));

test('somebody opening the invitation mid-game takes a computer player place, with its cards', { timeout: 90000 }, guarded('late join', async () => {
  await late.goto(link);
  await late.waitForText('Hand 1');
  // She holds whatever the computer player was holding, which in the middle of the pass is fewer than a full hand:
  // it had already passed its three and is waiting on the slower people for the three coming back.
  assert.ok((await handSize(late)) > 0, 'she holds the cards the computer player was holding');
  const now = await players(late);
  assert.equal(now.length, 4, 'the table is the same size as it was');
  assert.equal(now.filter((p) => !p.bot).length, 3, 'three people at it now');
  assert.ok(seatOf(now, 'Late Lucy') >= 0, `Late Lucy is one of them: ${JSON.stringify(now)}`);
}));

test('somebody who dropped out comes back to their own place', { timeout: 90000 }, guarded('rejoin', async () => {
  const before = seatOf(await players(flake), 'Flaky Fred');
  assert.ok(before >= 0, 'Fred is in the game to begin with');

  await flake.clickButton('Leave game');
  await flake.clickButton('Yes, leave');
  await host.page.waitForFunction(
    (name) => ![...document.querySelectorAll('.score-bar .chips li.chip .name')].some((e) => e.textContent.includes(name)),
    { timeout: 20000 },
    'Flaky Fred',
  );
  assert.equal((await players(host))[before].bot, true, 'a computer player is keeping his place warm');

  await flake.goto(link);
  await flake.waitForText('Hand 1');
  const after = await players(flake);
  assert.equal(seatOf(after, 'Flaky Fred'), before, 'and he comes back to the very same place');
  assert.equal(after[before].bot, false, 'which is nobody’s stand-in any more');
  assert.ok((await handSize(flake)) > 0, 'with the cards that were his still in front of him');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
