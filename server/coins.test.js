// Coins: prizes for the top three, no minimum number of people, nothing for computer accounts, and an exact ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoins, prizeFor } from './coins.js';
import { openDatabase } from './db.js';
import { createStats } from './stats.js';

function setup(t) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const stats = createStats(db, () => []);
  const coins = createCoins(db);
  let n = 0;
  const addUser = (name, { bot = false } = {}) =>
    Number(db.prepare('INSERT INTO users (username, username_lower, password_hash, display_name, is_bot, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(name, name, 'x', name, bot ? 1 : 0, ++n).lastInsertRowid);
  return { db, stats, coins, addUser };
}

test('prizes: 500, 200 and 100 for 1st, 2nd and 3rd, and nothing below that', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((placement) => prizeFor({ placement, outcome: 'loss' })), [500, 200, 100, 0, 0]);
});

test('a win with no placement counts as 1st; a loss with none earns nothing', () => {
  assert.equal(prizeFor({ outcome: 'win' }), 500);
  assert.equal(prizeFor({ outcome: 'loss' }), 0);
  assert.equal(prizeFor({ outcome: 'draw' }), 0);
});

test('record pays each person by placement, and the balance is the sum', (t) => {
  const { stats, coins, addUser } = setup(t);
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((name) => addUser(name));
  stats.record('g', { players: [{ userId: a, outcome: 'win', placement: 1 }, { userId: b, outcome: 'loss', placement: 2 }, { userId: c, outcome: 'loss', placement: 3 }, { userId: d, outcome: 'loss', placement: 4 }] });
  assert.deepEqual([a, b, c, d].map((id) => coins.balance(id)), [500, 200, 100, 0]);
  stats.record('g', { players: [{ userId: a, outcome: 'win', placement: 1 }] });
  assert.equal(coins.balance(a), 1000);
});

test('beating computer players pays the same: one person alone at the table still earns coins', (t) => {
  const { stats, coins, addUser } = setup(t);
  const solo = addUser('solo');
  stats.record('g', { players: [{ userId: solo, outcome: 'win', placement: 1 }] });
  assert.equal(coins.balance(solo), 500);
});

test('tied players share the prize of their placement', (t) => {
  const { stats, coins, addUser } = setup(t);
  const [a, b] = [addUser('a'), addUser('b')];
  stats.record('g', { players: [{ userId: a, outcome: 'win', placement: 1 }, { userId: b, outcome: 'win', placement: 1 }] });
  assert.deepEqual([coins.balance(a), coins.balance(b)], [500, 500]);
});

test('bot accounts earn nothing', (t) => {
  const { stats, coins, addUser, db } = setup(t);
  const robot = addUser('robot', { bot: true });
  stats.record('g', { players: [{ userId: robot, outcome: 'win', placement: 1 }] });
  assert.equal(coins.balance(robot), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM coin_ledger').get().n, 0);
});

test('a refused result pays nothing', (t) => {
  const { stats, coins, addUser } = setup(t);
  const [a, b] = [addUser('a'), addUser('b')];
  assert.throws(() => stats.record('g', { players: [{ userId: a, outcome: 'win', placement: 1 }, { userId: b, outcome: 'nonsense' }] }));
  assert.equal(coins.balance(a), 0);
});

test('a game cannot pay the same person twice', (t) => {
  const { db, coins, addUser } = setup(t);
  const a = addUser('a');
  db.prepare("INSERT INTO results (id, game, finished_at) VALUES (1, 'g', 0)").run();
  assert.equal(coins.awardPlacement(a, 1, { placement: 1 }), 500);
  assert.equal(coins.awardPlacement(a, 1, { placement: 1 }), 0);
  assert.equal(coins.balance(a), 500);
});

test('spending takes coins, and refuses to go below zero', (t) => {
  const { stats, coins, addUser } = setup(t);
  const a = addUser('a');
  stats.record('g', { players: [{ userId: a, outcome: 'win', placement: 1 }] });
  coins.spend(a, 300, 'shop:test');
  assert.equal(coins.balance(a), 200);
  assert.throws(() => coins.spend(a, 201, 'shop:test'), /Not enough coins/);
  assert.throws(() => coins.spend(a, -5, 'shop:test'));
  assert.throws(() => coins.spend(a, 1.5, 'shop:test'));
  assert.equal(coins.balance(a), 200);
  assert.deepEqual(coins.history(a).map((row) => row.amount), [-300, 500]);
});

test('the start-up step pays for games recorded before coins existed, once, and not for computer accounts', (t) => {
  const { db, stats, coins, addUser } = setup(t);
  const [a, b] = ['a', 'b'].map((name) => addUser(name));
  const bot = addUser('bot', { bot: true });
  stats.record('g', { players: [{ userId: a, outcome: 'win', placement: 1 }, { userId: b, outcome: 'loss', placement: 2 }, { userId: bot, outcome: 'loss', placement: 3 }] });
  stats.record('g', { players: [{ userId: a, outcome: 'loss', placement: 4 }, { userId: b, outcome: 'win' }] });
  const lastTime = db.prepare('SELECT MAX(finished_at) AS t FROM results').get().t;
  db.exec('DELETE FROM coin_ledger'); // as if these games were played before coins were added
  assert.equal(coins.balance(a), 0);
  assert.deepEqual(coins.creditPastResults(), { games: 3, coins: 1200 });
  assert.deepEqual([a, b, bot].map((id) => coins.balance(id)), [500, 700, 0]);
  assert.equal(db.prepare('SELECT MAX(created_at) AS t FROM coin_ledger').get().t, lastTime, 'dated when the game finished');
  assert.deepEqual(coins.creditPastResults(), { games: 0, coins: 0 }, 'a second run adds nothing');
});

test('the start-up step leaves games that have already paid alone', (t) => {
  const { stats, coins, addUser } = setup(t);
  const a = addUser('a');
  stats.record('g', { players: [{ userId: a, outcome: 'win', placement: 1 }] });
  coins.spend(a, 300, 'shop:test');
  assert.deepEqual(coins.creditPastResults(), { games: 0, coins: 0 });
  assert.equal(coins.balance(a), 200);
});
