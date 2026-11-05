// The statistics page: zeros for a new person, then a finished game.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
let user;
before(async () => {
  world = await createWorld({ suite: 'stats' });
  user = await world.newUser('stats');
  await user.signUp('stats', { displayName: 'Stat Sam' });
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);
const allTilesOf = (u) =>
  u.page.$$eval('.tile', (els) => Object.fromEntries(els.map((e) => [e.querySelector('.muted').textContent.trim(), e.querySelector('strong').textContent.trim()])));

/**
 * The counted tiles, with the clock taken out and checked separately: "Time on the site" runs while the test does,
 * so it is a shape to match rather than a number to pin.
 * @param {object} u  a person from the world
 * @returns {Promise<object>} the tiles, less the clock
 */
async function tilesOf(u) {
  const tiles = await allTilesOf(u);
  assert.match(tiles['Time on the site'], /^\d+:\d\d:\d\d$/, 'the clock is a time');
  delete tiles['Time on the site'];
  return tiles;
}

/**
 * Opens a game's panel on the statistics page.  They start shut, so what is in one is not on the page until it is
 * asked for; `innerText` of a panel that is still folded is only its heading.
 * @param {object} u  a person from the world
 * @param {string} title  the game's name, as its heading reads
 * @returns {Promise<void>}
 */
async function openGame(u, title) {
  const opened = await u.clickFound(
    (name) => [...document.querySelectorAll('.collapsible h2 button')].find((b) => b.textContent.trim() === name && b.getAttribute('aria-expanded') === 'false'),
    title,
  );
  assert.ok(opened, `there is a shut ${title} panel to open`);
  await u.page.waitForFunction(
    (name) => [...document.querySelectorAll('.collapsible h2 button')].some((b) => b.textContent.trim() === name && b.getAttribute('aria-expanded') === 'true'),
    { timeout: 5000 },
    title,
  );
}

test('a new user sees zeros and an invitation to play', { timeout: 60000 }, guarded('zeros', async () => {
  await user.clickButton('Statistics', { scope: 'header nav', exact: true });
  await user.waitForText('Statistics for Stat Sam');
  assert.equal(user.url.pathname, '/stats');
  await user.waitForText("You haven't finished a game yet.");
  assert.deepEqual(await tilesOf(user), { 'Games played': '0', Wins: '0', Losses: '0', 'Win rate': '0%' });
  assert.equal(await user.page.$('.panel h2'), null, 'no per-game panels yet');
}));

test('a finished game shows up in the totals, the per-game table and the recent list', { timeout: 60000 }, guarded('finished game', async () => {
  const me = (await user.api('GET', '/api/me')).user;
  const rival = await world.newUser('rival');
  await rival.signUp('rival', { displayName: 'Rival Rae' });
  const rivalId = (await rival.api('GET', '/api/me')).user.id;
  // A finished Hearts game, reported the way the module reports it.
  world.site.stats.record('hearts', {
    code: 'test-game-code',
    players: [
      { userId: me.id, outcome: 'win', placement: 1, score: 42, extras: {} },
      { userId: rivalId, outcome: 'loss', placement: 2, score: 77, extras: {} },
    ],
  });

  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForText('Recent games');
  assert.deepEqual(await tilesOf(user), { 'Games played': '1', Wins: '1', Losses: '0', 'Win rate': '100%' });
  await openGame(user, 'Hearts');
  const hearts = await user.page.$$eval('.panel.stack', (panels) => {
    const panel = panels.find((p) => p.querySelector('h2')?.textContent.trim() === 'Hearts');
    return panel ? panel.innerText.replace(/\s+/g, ' ') : null;
  });
  assert.ok(hearts, 'there is a Hearts panel');
  assert.match(hearts, /Played 1/);
  assert.match(hearts, /Won \/ lost 1 \/ 0/);
  assert.match(hearts, /Total score 42/);
  assert.match(hearts, /Best score 42/);
  assert.match(hearts, /Most wins/);
  assert.match(hearts, /Stat Sam 1 won from 1/);

  // The other player sees the loss.
  await rival.goto('/stats');
  await rival.waitForText('Recent games');
  assert.deepEqual(await tilesOf(rival), { 'Games played': '1', Wins: '0', Losses: '1', 'Win rate': '0%' });
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
