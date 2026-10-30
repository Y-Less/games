import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.js';
import { createAchievements } from './achievements.js';
import { createCoins } from './coins.js';

const GAMES = [
  {
    id: 'hearts',
    name: 'Hearts',
    stats: [{ key: 'moonsShot', label: 'Moons' }],
    achievements: [
      { key: 'moon', name: 'Shot the moon', text: 'Shoot the moon {n} times', one: null, levels: [1, 5, 10], stat: 'moonsShot' },
      { key: 'streak', name: 'Streak', text: 'Win {n} in a row', one: null, levels: [2, 4], stat: null },
    ],
  },
  { id: 'plain', name: 'Plain', stats: [], achievements: [] },
];

function setup() {
  const db = openDatabase(':memory:');
  const user = (name, bot = 0) =>
    Number(db.prepare("INSERT INTO users (username, username_lower, password_hash, display_name, is_bot, created_at) VALUES (?, ?, 'x', ?, ?, 0)").run(name, name, name, bot).lastInsertRowid);
  const results = new Map();
  const statsFor = (id) => results.get(id) ?? { summary: { played: 0, wins: 0, losses: 0, draws: 0 }, perGame: [] };
  const notified = [];
  const achievements = createAchievements(db, { listGames: () => GAMES, statsFor, notify: (id) => notified.push(id) });
  return { db, user, results, achievements, notified, coins: createCoins(db) };
}

test('saved progress adds up, can be raised, and reports unlocks', () => {
  const { user, achievements } = setup();
  const ann = user('ann');
  assert.deepEqual(achievements.add('hearts', ann, 'global.cards', 99), { before: 0, after: 99, level: 0, unlocked: false });
  assert.deepEqual(achievements.add('hearts', ann, 'global.cards', 1), { before: 99, after: 100, level: 1, unlocked: true });
  assert.equal(achievements.get(ann, 'global.cards'), 100);
  assert.equal(achievements.raise('hearts', ann, 'streak', 3).level, 1);
  assert.equal(achievements.raise('hearts', ann, 'streak', 2).after, 3, 'raise never lowers');
  assert.equal(achievements.add('hearts', ann, 'streak', -5).after, 3, 'nothing is taken away');
  assert.equal(achievements.add('hearts', ann, 'streak', NaN).after, 3);
});

test('keys are checked, computer players collect nothing, and stat-based ones cannot be set', () => {
  const { user, achievements } = setup();
  const ann = user('ann');
  const bot = user('robot', 1);
  assert.throws(() => achievements.add('hearts', ann, 'nope'), /Unknown achievement/);
  assert.throws(() => achievements.add('hearts', ann, 'moon'), /cannot be set/);
  assert.throws(() => achievements.add('plain', ann, 'streak'), /Unknown achievement/, "another game's key is not yours");
  assert.equal(achievements.add('hearts', bot, 'streak', 5), null);
  assert.equal(achievements.add('hearts', 9999, 'streak', 5), null);
  assert.equal(achievements.get(bot, 'hearts.streak'), 0);
});

test('forUser lists the global achievements first, then each game that has any, with levels worked out', () => {
  const { user, results, achievements } = setup();
  const ann = user('ann');
  results.set(ann, {
    summary: { played: 60, wins: 12, losses: 48, draws: 0 },
    perGame: [{ game: 'hearts', played: 60, wins: 12, losses: 48, draws: 0, totalScore: 0, bestScore: 0, extras: [{ key: 'moonsShot', label: 'Moons', value: 6 }] }],
  });
  achievements.add('hearts', ann, 'global.cards', 600);
  achievements.add('hearts', ann, 'streak', 2);
  const { sections } = achievements.forUser(ann);
  assert.deepEqual(sections.map((s) => s.id), ['global', 'hearts'], 'a game without achievements has no section');
  const byId = Object.fromEntries(sections.flatMap((s) => s.achievements).map((a) => [a.id, a]));
  assert.equal(byId['global.games'].level, 2, '60 games: level 2 (10, 50)');
  assert.equal(byId['global.games'].next.n, 100);
  assert.equal(byId['global.games'].progress, 0.6);
  assert.equal(byId['global.wins'].value, 12);
  assert.equal(byId['global.cards'].level, 2, '600 cards: level 2 (100, 500)');
  assert.equal(byId['global.cards'].progress, 0.6);
  assert.equal(byId['hearts.moon'].value, 6);
  assert.equal(byId['hearts.moon'].level, 2);
  assert.equal(byId['hearts.streak'].level, 1);
});

test('a newcomer sees every achievement at zero', () => {
  const { user, achievements } = setup();
  const { sections } = achievements.forUser(user('new'));
  for (const a of sections.flatMap((s) => s.achievements)) assert.deepEqual([a.value, a.level], [0, 0], a.id);
});

test('a game can look at any achievement, its own or the global ones', () => {
  const { user, results, achievements } = setup();
  const ann = user('ann');
  results.set(ann, { summary: { played: 11, wins: 0, losses: 11, draws: 0 }, perGame: [] });
  const hearts = achievements.forGame('hearts');
  hearts.add(ann, 'global.cards', 120);
  hearts.add(ann, 'streak', 4);
  assert.equal(hearts.get(ann, 'global.cards'), 120);
  assert.equal(hearts.level(ann, 'global.cards'), 1);
  assert.equal(hearts.get(ann, 'global.games'), 11, 'worked out from the results');
  assert.equal(hearts.level(ann, 'global.games'), 1);
  assert.equal(hearts.level(ann, 'streak'), 2);
  assert.equal(hearts.level(ann, 'unknown'), 0);
});

test('a definition whose stat the game does not declare is reported', () => {
  const { achievements } = setup();
  assert.deepEqual(achievements.problems(GAMES[0]), []);
  assert.equal(achievements.problems({ id: 'x', stats: [], achievements: [{ key: 'a', stat: 'missing' }] }).length, 1);
  assert.deepEqual(achievements.problems({ id: 'x', stats: [], achievements: [{ key: 'a', stat: 'wins' }] }), [], 'built-in stats are always there');
});

test('every level unlocked pays 1,000 coins, once, and is queued to be shown', () => {
  const { user, achievements, coins, notified } = setup();
  const ann = user('ann');
  achievements.add('hearts', ann, 'global.cards', 99);
  assert.equal(coins.balance(ann), 0);
  assert.deepEqual(notified, []);
  achievements.add('hearts', ann, 'global.cards', 1);
  assert.equal(coins.balance(ann), 1000, 'level 1 (100 cards)');
  assert.deepEqual(notified, [ann]);
  achievements.add('hearts', ann, 'global.cards', 1);
  assert.equal(coins.balance(ann), 1000, 'nothing more until the next level');
  achievements.add('hearts', ann, 'global.cards', 5000);
  assert.equal(coins.balance(ann), 4000, 'levels 2, 3 and 4 in one go: 1,000 each whichever level');
  assert.deepEqual(achievements.pending(ann).map((u) => [u.id, u.level, u.coins]), [['global.cards', 1, 1000], ['global.cards', 2, 1000], ['global.cards', 3, 1000], ['global.cards', 4, 1000]]);
  assert.equal(achievements.pending(ann)[0].name, 'Played cards');
  assert.equal(achievements.pending(ann)[0].text, 'Play 100 cards');
  assert.equal(achievements.pending(ann)[0].game, 'Global');
});

test('settling works out what the results have unlocked, once, and does the same for everything already earned', () => {
  const { user, results, achievements, coins, notified } = setup();
  const ann = user('ann');
  results.set(ann, {
    summary: { played: 12, wins: 1, losses: 11, draws: 0 },
    perGame: [{ game: 'hearts', played: 12, wins: 1, losses: 11, draws: 0, totalScore: 0, bestScore: 0, extras: [{ key: 'moonsShot', label: 'Moons', value: 5 }] }],
  });
  const fresh = achievements.settle(ann);
  const ids = fresh.map((f) => `${f.id}:${f.level}`).sort();
  assert.deepEqual(ids, ['global.games:1', 'global.wins:1', 'hearts.moon:1', 'hearts.moon:2']);
  assert.equal(coins.balance(ann), 4000, 'four levels');
  assert.deepEqual(achievements.settle(ann), [], 'a second settle pays nothing');
  assert.equal(coins.balance(ann), 4000);
  assert.equal(notified.length, 1);
  results.get(ann).perGame[0].extras[0].value = 6;
  assert.deepEqual(achievements.settle(ann), [], '6 moons is still level 2 (the next is at 10)');
});

test('a person is shown their unlocks until they have seen them, and computer players earn nothing', () => {
  const { user, achievements, coins } = setup();
  const ann = user('ann');
  const bot = user('robot', 1);
  achievements.add('hearts', ann, 'global.cards', 100);
  assert.equal(achievements.pending(ann).length, 1);
  achievements.seen(ann, [{ id: 'global.cards', level: 1 }]);
  assert.deepEqual(achievements.pending(ann), []);
  achievements.seen(ann, [null, { id: 5 }, { id: 'global.cards', level: 'x' }, 'junk']);
  achievements.seen(ann, 'not a list');
  assert.deepEqual(achievements.settle(bot), []);
  assert.equal(coins.balance(bot), 0);
  assert.deepEqual(achievements.pending(bot), []);
});

test('levels of an achievement a game has since dropped are not shown', () => {
  const { user, db, achievements } = setup();
  const ann = user('ann');
  db.prepare("INSERT INTO achievement_awards (user_id, id, level, coins, awarded_at) VALUES (?, 'old.gone', 1, 1000, 0)").run(ann);
  assert.deepEqual(achievements.pending(ann), []);
});
