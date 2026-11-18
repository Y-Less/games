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

test('the way back: a tournament is listed on the home page, and an ordinary game can be played beside it', { timeout: 120000 }, guarded('tournament-list', async () => {
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

  // A tournament is played over as long as its people like, so the home page is the way back into it.
  await ann.goto('/');
  await ann.waitForText('Your tournaments');
  await ann.waitForText('Round 1 of 1');

  // And leaving the page for another game of the same thing does not give the tournament up: an account may have as
  // many games on the go as it likes.  `?new` is what asks for a game to start rather than the last one to resume,
  // which is the whole difference once somebody can be in two.
  await ann.goto('/play/hearts?new');
  await ann.clickButton('Start a new game of Hearts');
  await ann.waitForText('Waiting for players');
  const other = await ann.inviteCode();
  assert.notEqual(other, code, 'a room of its own');

  // The list still knows where she belongs, and says the plainest thing it can: her game of the tournament is open.
  await ann.goto('/');
  await ann.waitForText('Your tournaments');
  await ann.waitForText('your game is open');
  await ann.clickButton('Go to your game');
  await ann.waitForSelector('.score-bar');
  await ann.waitForText('Round 1 of 1'); // the bar above the game, which came from the tournament
}));
