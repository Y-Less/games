// A tour in a real browser: the lobby, the vote, being sent to the game that won, and the band that brings you back.
//
// What is NOT here is a game played to its end.  The game a vote picks is one of three drawn at random, and most of
// them run to a target score over many hands, so playing one out in a browser would be slow and would be testing that
// game rather than the tour.  The cycle — the game ending, the tour opening the next vote by itself — is covered at
// socket level in modules/tour/e2e.test.js, against a stand-in game that ends on command.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
before(async () => {
  world = await createWorld({ suite: 'tour' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
/** The names on the vote's choices, in order, with the standing "End the tour" last. */
const choiceNames = (user) => user.page.$$eval('.choice .choice-name', (els) => els.map((e) => e.textContent.trim()));

test('a tour: the lobby, a vote between three games, and being sent to the one that won', { timeout: 120000 }, guarded('tour', async () => {
  const user = await world.newUser('host');
  await user.signUp('tour', { displayName: 'Tilda' });
  await user.goto('/play/tour');
  await user.clickButton('Start a new tour');
  await user.waitForText('Waiting for players');
  const code = await user.inviteCode();

  // The lobby says what the table could be offered before anybody commits to starting.
  await user.waitForText('will be offered each time');
  await user.clickButton('Fill up to 4 seats with computer players');
  await user.waitForNoText('more seat');
  await user.clickButton('Start the tour', { exact: true });

  // The vote: three games, and a fourth choice that is not a game.
  await user.waitForText('What next?');
  const choices = await choiceNames(user);
  assert.equal(choices.length, 4, `three games and End the tour, got ${choices.join(', ')}`);
  assert.equal(choices.at(-1), 'End the tour');
  assert.equal(new Set(choices).size, 4, 'no choice is offered twice');

  // Vote for the first game, and let the computer players vote for themselves.  Which one wins is not ours to say —
  // three computer players outvote one person — so the test reads what the table chose rather than assuming it.
  await user.page.$$eval('.choice', (els) => els[0].click());
  await user.waitForText('waits here until that game ends');
  const wanted = await user.page.$eval('.tour-table h2', (el) => el.textContent.trim().replace(/^Playing /, ''));
  assert.ok(choices.slice(0, 3).includes(wanted), `${wanted} was one of the three offered: ${choices.join(', ')}`);

  // The band offers the way to it, and taking it really does put you in that game's room.
  await user.waitForSelector('.tour-band');
  assert.match(await user.page.$eval('.tour-band', (el) => el.innerText), new RegExp(`playing ${wanted}`, 'i'));
  await user.clickButton('Go to the game', { scope: '.tour-band' });
  await user.waitForSelector('.score-bar');
  const where = await user.page.evaluate(() => ({ path: window.location.pathname, search: window.location.search }));
  assert.match(where.path, /^\/play\/[a-z][a-z0-9-]*$/, 'you are on the game the vote chose');
  assert.notEqual(where.path, '/play/tour');
  assert.match(where.search, /^\?[a-z]+-[a-z]+-[a-z]+$/, 'in a room of its own, by invite code');
  assert.notEqual(where.search, `?${code}`, 'which is not the tour\'s own room');
  assert.equal(await user.page.$eval('header.bar h1', (el) => el.textContent.trim()), wanted);

  // From inside the game, the band offers the tour back, and the tour still knows what is being played.
  await user.waitForSelector('.tour-band');
  await user.clickButton('The tour', { scope: '.tour-band' });
  await user.waitForText(`Playing ${wanted}`);
  await user.waitForCodeInUrl(code);
}));

test('a tour the table votes to finish ends, and the host can start another', { timeout: 120000 }, guarded('tour end', async () => {
  // A fresh pair of people: the one above is still in a tour, and nobody is in two at once.
  const ann = await world.newUser('ann');
  await ann.signUp('tourend', { displayName: 'Ann' });
  const bob = await world.newUser('bob');
  await bob.signUp('tourend', { displayName: 'Bob' });

  await ann.goto('/play/tour');
  await ann.clickButton('Start a new tour');
  const code = await ann.inviteCode();
  await bob.goto(`/play/tour?${code}`);
  await ann.waitForText('Bob');
  await ann.clickButton('Start the tour', { exact: true });
  await ann.waitForText('What next?');
  await bob.waitForText('What next?');

  // Both vote to finish, so nothing is opened at all.  (The choice is itself the button, so it is clicked directly.)
  await ann.page.click('.choice.end');
  await bob.page.click('.choice.end');
  await ann.waitForText('The tour is over');
  await ann.waitForText('ended before anything was played');
  await bob.waitForText('The tour is over');

  // Only the host is offered another, and it goes back to the lobby.
  assert.equal((await bob.page.$$eval('button', (bs) => bs.map((b) => b.innerText.trim()))).includes('Start another tour'), false);
  await ann.clickButton('Start another tour');
  await ann.waitForText('Waiting for players');
}));
