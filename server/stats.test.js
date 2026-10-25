// Statistics unit tests: recording results, per-user summaries, extras aggregation and leaderboards (in-memory database).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, transaction } from './db.js';
import { createStats } from './stats.js';

const GAMES = [
  { id: 'alpha', name: 'Alpha', stats: [{ key: 'points', label: 'Points', agg: 'sum' }, { key: 'streak', label: 'Streak', agg: 'max' }, { key: 'plain', label: 'Plain' }] },
  { id: 'beta', name: 'Beta' },
  { id: 'gamma', name: 'Gamma', stats: [] },
];

function setup(t, games = GAMES) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const stats = createStats(db, () => games);
  let n = 0;
  const addUser = (name, { bot = false } = {}) => {
    const id = Number(db.prepare('INSERT INTO users (username, username_lower, password_hash, display_name, is_bot, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(name, name.toLowerCase(), 'x', name, bot ? 1 : 0, ++n).lastInsertRowid);
    return id;
  };
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return { db, stats, addUser, count };
}

const one = (userId, outcome, extra = {}) => ({ players: [{ userId, outcome, ...extra }] });

test('a new player has empty statistics', (t) => {
  const { stats, addUser } = setup(t);
  const id = addUser('nobody');
  assert.deepEqual(stats.forUser(id), { summary: { played: 0, wins: 0, losses: 0, draws: 0, winRate: 0 }, perGame: [], recent: [] });
  assert.deepEqual(stats.forUser(9999), { summary: { played: 0, wins: 0, losses: 0, draws: 0, winRate: 0 }, perGame: [], recent: [] });
  assert.deepEqual(stats.leaderboard('alpha'), []);
});

test('record: wins, losses and draws are counted, and a draw is neither a win nor a loss', (t) => {
  const { stats, addUser } = setup(t);
  const id = addUser('ann');
  for (const outcome of ['win', 'win', 'win', 'loss', 'draw', 'draw']) stats.record('alpha', one(id, outcome));
  const result = stats.forUser(id);
  assert.deepEqual(result.summary, { played: 6, wins: 3, losses: 1, draws: 2, winRate: 0.5 });
  const [alpha] = result.perGame;
  assert.deepEqual([alpha.played, alpha.wins, alpha.losses, alpha.draws, alpha.winRate], [6, 3, 1, 2, 0.5]);
});

test('record returns the new result id, or null when there is nothing to record', (t) => {
  const { stats, addUser, count } = setup(t);
  const id = addUser('ann');
  const first = stats.record('alpha', one(id, 'win'));
  const second = stats.record('alpha', one(id, 'win'));
  assert.equal(typeof first, 'number');
  assert.equal(second, first + 1);
  const before = count('results');
  for (const empty of [undefined, null, {}, { players: [] }, { players: undefined }, { players: [{ userId: 12345, outcome: 'win' }] }]) {
    assert.equal(stats.record('alpha', empty), null, JSON.stringify(empty));
  }
  assert.equal(count('results'), before, 'nothing was stored');
});

test('record keeps the room code, and a result needs no code', (t) => {
  const { stats, addUser, db } = setup(t);
  const id = addUser('ann');
  stats.record('alpha', { code: 'boss-aware-you', players: [{ userId: id, outcome: 'win' }] });
  stats.record('alpha', one(id, 'loss'));
  assert.deepEqual(db.prepare('SELECT code FROM results ORDER BY id').all().map((r) => r.code), ['boss-aware-you', null]);
});

test('placement and score are optional; zero is a real value and bad numbers become nothing', (t) => {
  const { stats, addUser, db } = setup(t);
  const id = addUser('ann');
  stats.record('alpha', one(id, 'win'));
  stats.record('alpha', one(id, 'win', { placement: 0, score: 0 }));
  stats.record('alpha', one(id, 'loss', { placement: 3, score: -40.5 }));
  stats.record('alpha', one(id, 'loss', { placement: NaN, score: Infinity }));
  stats.record('alpha', one(id, 'loss', { placement: '2', score: '10' }));
  stats.record('alpha', one(id, 'loss', { placement: null, score: null }));
  const rows = db.prepare('SELECT placement, score FROM result_players ORDER BY rowid').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { placement: null, score: null },
    { placement: 0, score: 0 },
    { placement: 3, score: -40.5 },
    { placement: null, score: null },
    { placement: null, score: null },
    { placement: null, score: null },
  ]);
  const [alpha] = stats.forUser(id).perGame;
  assert.equal(alpha.totalScore, -40.5);
  assert.equal(alpha.bestScore, 0);
});

test('a game with no scores at all reports null totals rather than zero', (t) => {
  const { stats, addUser } = setup(t);
  const id = addUser('ann');
  stats.record('beta', one(id, 'win'));
  const [beta] = stats.forUser(id).perGame;
  assert.equal(beta.totalScore, null);
  assert.equal(beta.bestScore, null);
});

test('record: non-finite or non-numeric extras are dropped, finite ones kept', (t) => {
  const { stats, addUser, db } = setup(t);
  const id = addUser('ann');
  stats.record('alpha', one(id, 'win', { extras: { ok: 3, zero: 0, neg: -2.5, nan: NaN, inf: Infinity, ninf: -Infinity, text: '5', nothing: null, none: undefined, flag: true, list: [1], obj: { a: 1 } } }));
  stats.record('alpha', one(id, 'win', { extras: null }));
  stats.record('alpha', one(id, 'win', { extras: 'nope' }));
  stats.record('alpha', one(id, 'win'));
  const rows = db.prepare('SELECT extras FROM result_players ORDER BY rowid').all().map((r) => JSON.parse(r.extras));
  assert.deepEqual(rows[0], { ok: 3, zero: 0, neg: -2.5 });
  assert.deepEqual(rows.slice(1), [{}, {}, {}]);
});

test('record: unknown user ids are ignored, but the known players of the same game are kept', (t) => {
  const { stats, addUser, db, count } = setup(t);
  const a = addUser('ann');
  const b = addUser('bea');
  const id = stats.record('alpha', {
    players: [
      { userId: a, outcome: 'win' },
      { userId: 424242, outcome: 'loss' },
      { userId: undefined, outcome: 'loss' },
      { userId: null, outcome: 'loss' },
      { userId: b, outcome: 'loss' },
      { userId: 99999, outcome: 'not-even-valid' }, // ignored before it is checked
    ],
  });
  assert.equal(count('result_players'), 2);
  assert.deepEqual(db.prepare('SELECT user_id FROM result_players WHERE result_id = ? ORDER BY user_id').all(id).map((r) => r.user_id), [a, b]);
  assert.equal(stats.forUser(a).recent[0].players, 2, 'the recent list shows how many players took part');
});

test('record: an invalid outcome throws and records nothing at all', (t) => {
  const { stats, addUser, count } = setup(t);
  const a = addUser('ann');
  const b = addUser('bea');
  for (const outcome of ['won', 'WIN', 'Win', ' win', 'tie', '', undefined, null, 1, true, ['win'], {}]) {
    assert.throws(() => stats.record('alpha', { players: [{ userId: a, outcome: 'win' }, { userId: b, outcome }] }), /Unknown outcome/, JSON.stringify(outcome));
  }
  assert.equal(count('results'), 0);
  assert.equal(count('result_players'), 0);
  assert.deepEqual(stats.forUser(a).perGame, []);
  assert.ok(stats.record('alpha', { players: [{ userId: a, outcome: 'win' }, { userId: b, outcome: 'loss' }] }), 'recording works as normal afterwards');
  assert.equal(count('result_players'), 2);
});

test('record: a failure part-way through the writes is rolled back and leaves the database usable', (t) => {
  const { stats, addUser, count } = setup(t);
  const a = addUser('ann');
  // An object cannot be stored as the room code, so the insert itself fails inside the transaction.
  assert.throws(() => stats.record('alpha', { code: { not: 'text' }, players: [{ userId: a, outcome: 'win' }] }));
  assert.equal(count('results'), 0);
  assert.equal(count('result_players'), 0);
  assert.ok(stats.record('alpha', one(a, 'win')), 'no transaction is left open');
  assert.equal(count('results'), 1);
});

test('transaction() commits on success and rolls back everything on a throw', (t) => {
  const { db, addUser, count } = setup(t);
  const a = addUser('ann');
  const insert = () => db.prepare('INSERT INTO results (game, code, finished_at) VALUES (?, ?, ?)').run('alpha', null, 1);
  assert.equal(transaction(db, () => { insert(); insert(); return 'done'; }), 'done');
  assert.equal(count('results'), 2);
  assert.throws(() => transaction(db, () => { insert(); insert(); throw new Error('boom'); }), /boom/);
  assert.equal(count('results'), 2, 'both inserts were undone');
  assert.equal(transaction(db, () => { insert(); return 1; }), 1, 'and a new transaction can start');
  assert.equal(count('results'), 3);
  assert.ok(a);
});

test('extras: declared "sum" keys add up, "max" keys keep the best, and the default is sum', (t) => {
  const { stats, addUser } = setup(t);
  const id = addUser('ann');
  stats.record('alpha', one(id, 'win', { extras: { points: 10, streak: 3, plain: 1, undeclared: 100 } }));
  stats.record('alpha', one(id, 'loss', { extras: { points: 5.5, streak: 7, plain: 2 } }));
  stats.record('alpha', one(id, 'win', { extras: { points: 0, streak: 2 } }));
  stats.record('alpha', one(id, 'win', {}));
  const [alpha] = stats.forUser(id).perGame;
  assert.deepEqual(alpha.extras, [
    { key: 'points', label: 'Points', value: 15.5 },
    { key: 'streak', label: 'Streak', value: 7 },
    { key: 'plain', label: 'Plain', value: 3 },
  ]);
  assert.ok(!alpha.extras.some((e) => e.key === 'undeclared'), 'undeclared keys are not shown');
});

test('extras: declared stats a player never reported show as zero', (t) => {
  const { stats, addUser } = setup(t);
  const id = addUser('ann');
  stats.record('alpha', one(id, 'win'));
  assert.deepEqual(stats.forUser(id).perGame[0].extras.map((e) => e.value), [0, 0, 0]);
});

test('extras: games without declarations (or unknown to the site) show none', (t) => {
  const { stats, addUser } = setup(t);
  const id = addUser('ann');
  stats.record('beta', one(id, 'win', { extras: { anything: 5 } }));
  stats.record('gamma', one(id, 'win', { extras: { anything: 5 } }));
  stats.record('removed-game', one(id, 'loss', { extras: { anything: 5 } }));
  const byGame = Object.fromEntries(stats.forUser(id).perGame.map((g) => [g.game, g]));
  assert.deepEqual(byGame.beta.extras, []);
  assert.deepEqual(byGame.gamma.extras, []);
  assert.deepEqual(byGame['removed-game'].extras, []);
  assert.equal(byGame['removed-game'].name, 'removed-game', 'a game that is no longer installed is shown by its id');
  assert.equal(byGame.beta.name, 'Beta');
});

test('extras are kept per game: the same key in two games does not mix', (t) => {
  const games = [{ id: 'one', name: 'One', stats: [{ key: 'k', label: 'K' }] }, { id: 'two', name: 'Two', stats: [{ key: 'k', label: 'K', agg: 'max' }] }];
  const { stats, addUser } = setup(t, games);
  const id = addUser('ann');
  stats.record('one', one(id, 'win', { extras: { k: 4 } }));
  stats.record('one', one(id, 'win', { extras: { k: 5 } }));
  stats.record('two', one(id, 'win', { extras: { k: 4 } }));
  stats.record('two', one(id, 'win', { extras: { k: 2 } }));
  const byGame = Object.fromEntries(stats.forUser(id).perGame.map((g) => [g.game, g.extras[0].value]));
  assert.deepEqual(byGame, { one: 9, two: 4 });
});

test('the summary adds up every game', (t) => {
  const { stats, addUser } = setup(t);
  const id = addUser('ann');
  stats.record('alpha', one(id, 'win'));
  stats.record('alpha', one(id, 'loss'));
  stats.record('beta', one(id, 'win'));
  stats.record('gamma', one(id, 'draw'));
  const { summary, perGame } = stats.forUser(id);
  assert.deepEqual(summary, { played: 4, wins: 2, losses: 1, draws: 1, winRate: 0.5 });
  assert.equal(perGame.length, 3);
});

test("several users' statistics are kept apart, even in the same game", (t) => {
  const { stats, addUser } = setup(t);
  const a = addUser('ann');
  const b = addUser('bea');
  const c = addUser('cyd');
  stats.record('alpha', { players: [{ userId: a, outcome: 'win', score: 10, extras: { points: 10 } }, { userId: b, outcome: 'loss', score: 4, extras: { points: 4 } }] });
  stats.record('alpha', { players: [{ userId: a, outcome: 'loss', score: 1, extras: { points: 1 } }, { userId: b, outcome: 'win', score: 9, extras: { points: 9 } }] });
  stats.record('beta', one(b, 'win'));

  const sa = stats.forUser(a);
  const sb = stats.forUser(b);
  assert.deepEqual(sa.summary, { played: 2, wins: 1, losses: 1, draws: 0, winRate: 0.5 });
  assert.deepEqual(sb.summary, { played: 3, wins: 2, losses: 1, draws: 0, winRate: 2 / 3 });
  assert.deepEqual(stats.forUser(c).summary, { played: 0, wins: 0, losses: 0, draws: 0, winRate: 0 });
  assert.equal(sa.perGame[0].totalScore, 11);
  assert.equal(sb.perGame.find((g) => g.game === 'alpha').totalScore, 13);
  assert.equal(sa.perGame[0].extras[0].value, 11);
  assert.equal(sa.perGame.length, 1);
  assert.equal(sb.perGame.length, 2);
  assert.equal(sa.recent.length, 2);
  assert.equal(sb.recent.length, 3);
});

test('recent: newest first, limited to 15, with the game name, outcome and score', (t) => {
  const { stats, addUser } = setup(t);
  const id = addUser('ann');
  for (let i = 1; i <= 20; i++) stats.record(i % 2 ? 'alpha' : 'beta', one(id, 'win', { score: i, placement: 1 }));
  const { recent } = stats.forUser(id);
  assert.equal(recent.length, 15);
  assert.deepEqual(recent.map((r) => r.score), [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6], 'newest first, even when finished in the same millisecond');
  assert.deepEqual(recent[0], { game: 'beta', finishedAt: recent[0].finishedAt, outcome: 'win', score: 20, placement: 1, players: 1, name: 'Beta' });
  assert.equal(recent[1].name, 'Alpha');
  assert.equal(stats.forUser(id).summary.played, 20, 'the summary still counts them all');
});

test('recent: ordered by finish time first', (t) => {
  const { stats, addUser, db } = setup(t);
  const id = addUser('ann');
  const early = stats.record('alpha', one(id, 'win', { score: 1 }));
  stats.record('alpha', one(id, 'win', { score: 2 }));
  db.prepare('UPDATE results SET finished_at = finished_at + 100000 WHERE id = ?').run(early);
  assert.deepEqual(stats.forUser(id).recent.map((r) => r.score), [1, 2]);
});

function leaderboardSetup(t) {
  const ctx = setup(t);
  const people = {};
  for (const name of ['ann', 'bea', 'cyd', 'dan', 'eve']) people[name] = ctx.addUser(name);
  people.robot = ctx.addUser('robot', { bot: true });
  const play = (name, game, wins, losses = 0, draws = 0) => {
    for (let i = 0; i < wins; i++) ctx.stats.record(game, one(people[name], 'win'));
    for (let i = 0; i < losses; i++) ctx.stats.record(game, one(people[name], 'loss'));
    for (let i = 0; i < draws; i++) ctx.stats.record(game, one(people[name], 'draw'));
  };
  return { ...ctx, people, play };
}

test('leaderboard: ordered by wins, then win rate, then games played', (t) => {
  const { stats, play } = leaderboardSetup(t);
  play('ann', 'alpha', 2, 0); // 2 wins, rate 1
  play('bea', 'alpha', 2, 2); // 2 wins, rate 0.5
  play('cyd', 'alpha', 2, 1); // 2 wins, rate 2/3
  play('dan', 'alpha', 5, 5); // most wins
  play('eve', 'alpha', 0, 1); // no wins, one game
  assert.deepEqual(stats.leaderboard('alpha').map((r) => r.name), ['dan', 'ann', 'cyd', 'bea', 'eve']);
});

test('leaderboard: with no wins at all, more games played comes first', (t) => {
  const { stats, play } = leaderboardSetup(t);
  play('ann', 'alpha', 0, 1);
  play('bea', 'alpha', 0, 3);
  play('cyd', 'alpha', 0, 0, 2);
  assert.deepEqual(stats.leaderboard('alpha').map((r) => [r.name, r.played, r.wins]), [['bea', 3, 0], ['cyd', 2, 0], ['ann', 1, 0]]);
});

test('leaderboard rows carry user id, display name, games played and wins; draws count as played', (t) => {
  const { stats, play, people } = leaderboardSetup(t);
  play('ann', 'alpha', 1, 1, 1);
  assert.deepEqual(stats.leaderboard('alpha').map((r) => ({ ...r })), [{ userId: people.ann, name: 'ann', played: 3, wins: 1 }]);
});

test('leaderboard: only that game counts, and bots are left out unless asked for', (t) => {
  const { stats, play, people } = leaderboardSetup(t);
  play('ann', 'alpha', 1);
  play('bea', 'beta', 5);
  play('robot', 'alpha', 9);
  assert.deepEqual(stats.leaderboard('alpha').map((r) => r.name), ['ann']);
  assert.deepEqual(stats.leaderboard('beta').map((r) => r.name), ['bea']);
  assert.deepEqual(stats.leaderboard('alpha', { includeBots: true }).map((r) => r.name), ['robot', 'ann']);
  assert.deepEqual(stats.leaderboard('nonexistent'), []);
  assert.ok(people.robot);
});

test('leaderboard: a limit (10 by default), and a player appears once however many games they played', (t) => {
  const { stats, addUser } = setup(t);
  for (let i = 1; i <= 14; i++) {
    const id = addUser(`player${String(i).padStart(2, '0')}`);
    for (let w = 0; w < i; w++) stats.record('alpha', one(id, 'win'));
  }
  const top = stats.leaderboard('alpha');
  assert.equal(top.length, 10);
  assert.deepEqual(top.map((r) => r.wins), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  assert.equal(new Set(top.map((r) => r.userId)).size, 10);
  assert.deepEqual(stats.leaderboard('alpha', { limit: 3 }).map((r) => r.wins), [14, 13, 12]);
  assert.equal(stats.leaderboard('alpha', { limit: 100 }).length, 14);
  assert.equal(stats.leaderboard('alpha', { limit: 0 }).length, 0);
});

test('the leaderboard shows the current display name', (t) => {
  const { stats, addUser, db } = setup(t);
  const id = addUser('ann');
  stats.record('alpha', one(id, 'win'));
  db.prepare("UPDATE users SET display_name = 'Queen Ann' WHERE id = ?").run(id);
  assert.equal(stats.leaderboard('alpha')[0].name, 'Queen Ann');
});

test('deleting a user removes their results from the lists (cascade)', (t) => {
  const { stats, addUser, db, count } = setup(t);
  const a = addUser('ann');
  const b = addUser('bea');
  stats.record('alpha', { players: [{ userId: a, outcome: 'win' }, { userId: b, outcome: 'loss' }] });
  db.prepare('DELETE FROM users WHERE id = ?').run(a);
  assert.equal(count('result_players'), 1);
  assert.deepEqual(stats.leaderboard('alpha').map((r) => r.name), ['bea']);
});
