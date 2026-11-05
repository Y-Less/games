// The leaderboard page: a folding table per game, and the sorting that changes who is in it.  Two crowds of players
// are set up so that each column's top ten is a different ten: sorting has to fetch nothing and still be right.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

const SHOWS = 10; // the rows a table shows before the player looking is added (server/stats.js TOP_PLAYERS)
const CROWD = 11; // one more than that in each crowd, so there is always somebody left out

let world;
let user;
let me;

/** An account made straight in the database: signing each of twenty-odd in through a browser is not worth the time. */
function addPlayer(name, displayName) {
  const at = Date.now();
  const row = world.site.db
    .prepare('INSERT INTO users (username, username_lower, password_hash, display_name, is_bot, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run(name, name.toLowerCase(), 'x', displayName, at);
  return Number(row.lastInsertRowid);
}

/** Records one finished game of Hearts for one player. */
const played = (userId, outcome, score) => world.site.stats.record('hearts', { players: [{ userId, outcome, placement: outcome === 'win' ? 1 : 2, score, extras: {} }] });

before(async () => {
  world = await createWorld({ suite: 'leaderboard' });
  user = await world.newUser('board');
  await user.signUp('board', { displayName: 'Board Bob' });
  me = (await user.api('GET', '/api/me')).user;
  // The scorers each won their one game with a big score; the grinders lost three apiece with none.  So the best
  // scores count down from the last scorer, the wins count up from the first, and the games played are all grinders.
  for (let i = 1; i <= CROWD; i++) {
    const n = String(i).padStart(2, '0');
    played(addPlayer(`scorer${n}`, `Scorer ${n}`), 'win', 100 + i);
    const grinder = addPlayer(`grinder${n}`, `Grinder ${n}`);
    for (let g = 0; g < 3; g++) played(grinder, 'loss', 0);
  }
  played(me.id, 'loss', 1); // Bob beats the grinders on score and nobody on anything else
});
after(async () => {
  await world?.close();
});

const guarded = (name, body) => (t) => world.guard(name, body)(t);

/** The game's table as rows of cells. */
const rowsOf = (u) => u.page.$$eval('.collapsible tbody tr', (rows) => rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.innerText.replace(/\s+/g, ' ').trim())));
const namesIn = (rows) => rows.map((row) => row[1]);
const placesIn = (rows) => rows.map((row) => row[0]);
/** How many times this page has fetched the standings, as the browser itself counts it. */
const boardRequests = (u) => u.page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/leaderboard')).length);
/** The names a crowd takes up, counting from `from` towards `to` (either way round). */
const crowd = (prefix, from, to) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => `${prefix} ${String(from + (to > from ? i : -i)).padStart(2, '0')}`);

test('the page lists a folded-up table per game, sorted by best score', { timeout: 60000 }, guarded('opens', async () => {
  await user.clickButton('Leaderboard', { scope: 'header nav', exact: true });
  await user.waitForText('Hearts');
  assert.equal(user.url.pathname, '/leaderboard');
  const headings = await user.page.$$eval('.collapsible h2 button', (buttons) => buttons.map((b) => [b.textContent.trim(), b.getAttribute('aria-expanded')]));
  assert.deepEqual(headings, [['Hearts', 'false']], 'one game, folded up to start with');
  await user.clickButton('Hearts', { exact: true });

  const rows = await rowsOf(user);
  assert.deepEqual(namesIn(rows), [...crowd('Scorer', CROWD, 2), 'Board Bob'], 'the ten best scores, and the player looking below them');
  assert.deepEqual(placesIn(rows), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12'], 'who is told where he really came');
  assert.deepEqual(rows[0], ['1', `Scorer ${CROWD}`, '1', '1', String(100 + CROWD)], 'position, name, played, won, best score');
  assert.deepEqual(rows.at(-1), ['12', 'Board Bob', '1', '0', '1']);
}));

test('sorting by another column changes who is in the table, and asks the server for nothing', { timeout: 60000 }, guarded('sorting', async () => {
  const asked = await boardRequests(user);
  assert.ok(asked >= 1, 'the page fetched the standings when it opened');
  await user.clickButton('Games won', { exact: true });
  let rows = await rowsOf(user);
  assert.deepEqual(namesIn(rows), [...crowd('Scorer', 1, SHOWS), 'Board Bob'], 'the wins count up from the first scorer, so the tenth drops out and the first comes in');
  assert.deepEqual(placesIn(rows).at(-1), '23');

  await user.clickButton('Games played', { exact: true });
  rows = await rowsOf(user);
  assert.deepEqual(namesIn(rows), [...crowd('Grinder', 1, SHOWS), 'Board Bob'], 'and games played is a different crowd altogether');
  assert.deepEqual(rows[0], ['1', 'Grinder 01', '3', '0', '0']);

  await user.clickButton('Best score', { exact: true });
  assert.deepEqual(namesIn(await rowsOf(user)), [...crowd('Scorer', CROWD, 2), 'Board Bob'], 'and back again');
  assert.equal(await boardRequests(user), asked, 'none of that went to the server');
}));

test("a name leads to that player's statistics", { timeout: 60000 }, guarded('name links', async () => {
  await user.goto('/leaderboard');
  await user.clickButton('Hearts', { exact: true });
  await user.clickButton(`Scorer ${CROWD}`, { exact: true });
  await user.waitForText(`Statistics for Scorer ${CROWD}`);
  assert.match(user.url.pathname, /^\/stats\/\d+$/);
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});
