// A tournament in a real browser: the offer under an ordinary lobby, the tournament lobby that replaces it, the
// games it opens, and the bar that brings you back.
//
// What is NOT here is a tournament played to its end.  Every round waits on real games of Hearts being played out,
// which would be slow and would be testing Hearts rather than the tournament; the rounds taking themselves in, the
// standings, and the table nobody finishes are all covered at socket level in shared/tournamentServer.test.js,
// against a stand-in game that finishes on command.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
before(async () => {
  world = await createWorld({ suite: 'tournament' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
/** Ticks or unticks a checkbox by the words beside it. */
const tick = (user, label) =>
  user.page.$$eval(
    'label',
    (labels, wanted) => {
      const label = labels.find((one) => one.textContent.includes(wanted));
      label?.querySelector('input[type="checkbox"]')?.click();
    },
    label,
  );

test('a tournament: the offer, the lobby it replaces, and the game it draws you for', { timeout: 120000 }, guarded('tournament', async () => {
  const ann = await world.newUser('ann');
  await ann.signUp('tourney', { displayName: 'Ann' });
  const bob = await world.newUser('bob');
  await bob.signUp('tourney', { displayName: 'Bob' });

  // An ordinary Hearts lobby, with the tournament offered under it.
  await ann.goto('/play/hearts');
  await ann.clickButton('Start a new game of Hearts');
  await ann.waitForText('Waiting for players');
  await ann.waitForText('Play this as a tournament');
  const code = await ann.inviteCode();
  await bob.goto(`/play/hearts?${code}`);
  await ann.waitForText('Bob');

  // Switching it on puts the tournament in place of the game's own lobby: these two are not going to sit at one
  // table, so there is no table to show them.
  await tick(ann, 'Play this as a tournament');
  await ann.waitForText('people here');
  await ann.waitForNoText('Empty seat');
  await bob.waitForText('people here');
  // Hearts is normally four, so the first table offered is the two of them and two computer players.
  await ann.waitForText('2 people');
  await ann.waitForText('2 computer players');
  await ann.waitForText('1 game in all');
  // Only the host sets it up.
  assert.equal((await bob.page.$$eval('button', (bs) => bs.map((b) => b.innerText.trim()))).includes('Start the tournament'), false);

  await ann.clickButton('Start the tournament');
  await ann.waitForText('Round 1 of 1');
  await bob.waitForText('Round 1 of 1');
  await bob.waitForText('Ann — Bob');

  // The game it opened is a room of its own, and nobody is moved into it: it is offered and taken.
  await ann.clickButton('Go to your game');
  await ann.waitForSelector('.score-bar');
  const where = await ann.page.evaluate(() => ({ path: window.location.pathname, search: window.location.search }));
  assert.equal(where.path, '/play/hearts');
  assert.match(where.search, /^\?[a-z]+-[a-z]+-[a-z]+$/);
  assert.notEqual(where.search, `?${code}`, 'not the room the tournament is run from');

  // Bob is drawn for the same game, and both of them can find their way back to the tournament from inside it.
  await bob.clickButton('Go to your game');
  await bob.waitForSelector('.score-bar');
  assert.equal((await bob.page.evaluate(() => window.location.search)), where.search, 'the two of them are at the same table');
  await ann.clickButton('Back to the tournament');
  await ann.waitForText('Round 1 of 1');
  await ann.waitForCodeInUrl(code);
}));

test('the way back: a tournament is listed under "Your games", and an ordinary game can be played beside it', { timeout: 120000 }, guarded('tournament-list', async () => {
  const ann = await world.newUser('ann');
  await ann.signUp('tourney', { displayName: 'Ann' });
  const bob = await world.newUser('bob');
  await bob.signUp('tourney', { displayName: 'Bob' });

  await ann.goto('/play/hearts');
  await ann.clickButton('Start a new game of Hearts');
  await ann.waitForText('Waiting for players');
  const code = await ann.inviteCode();
  await bob.goto(`/play/hearts?${code}`);
  await ann.waitForText('Bob');
  await tick(ann, 'Play this as a tournament');
  await ann.waitForText('people here');
  await ann.clickButton('Start the tournament');
  await ann.waitForText('Round 1 of 1');

  // A game is left and come back to as long as its people like, so "Your games" in the top menu is the way back in.
  const menuItem = (label) => [...document.querySelectorAll('nav.links a')].find((link) => link.innerText.trim() === label) ?? null;
  assert.equal(await ann.clickFound(menuItem, 'Your games'), true, 'the menu has the way back in it');
  await ann.waitForText('Round 1 of 1');

  // And taking another game of the same thing off the menu does not give the tournament up: an account may have as
  // many games on the go as it likes, so a card means a game of that rather than the last one back.
  await ann.clickFound(menuItem, 'Games');
  await ann.clickButton('Hearts', { scope: 'main' });
  await ann.clickButton('Start a new game of Hearts');
  await ann.waitForText('Waiting for players');
  const other = await ann.inviteCode();
  assert.notEqual(other, code, 'a room of its own');

  // Only one of them is on the list: a room nobody has started is an invitation she sent, not a game to come back to.
  // The tournament is, and says the plainest thing it can, which is that her game of it is open.
  await ann.clickFound(menuItem, 'Your games');
  await ann.waitForText('your game is open');
  assert.equal(await ann.page.$$eval('.entry', (rows) => rows.length), 1, 'the game she has not started is not one she has on the go');
  await ann.clickButton('Go to your game');
  await ann.waitForSelector('.score-bar');
  await ann.waitForText('Round 1 of 1'); // the bar above the game, which came from the tournament
}));
