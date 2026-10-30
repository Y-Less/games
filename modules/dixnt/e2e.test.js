// End-to-end tests: the real site on a spare port with the Dixnt module, real accounts, sockets, bot processes and statistics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../../server/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const botScript = path.join(here, 'bots', 'bot.js');

/** Two small fake categories (empty image files are enough: the server only looks at the file names). */
function makeFakeCards(cardsDir) {
  fs.mkdirSync(path.join(cardsDir, 'medium'), { recursive: true });
  const categories = [
    { key: 'alpha', label: 'Alpha', start: 10001 },
    { key: 'beta', label: 'Beta', start: 20001 },
  ].map(({ key, label, start }) => {
    const ids = Array.from({ length: 120 }, (_, i) => start + i);
    for (const id of ids) fs.writeFileSync(path.join(cardsDir, 'medium', `card_${id}.jpg`), '');
    return { key, label, description: `${label} cards`, ids };
  });
  fs.writeFileSync(path.join(cardsDir, 'categories.json'), JSON.stringify({ categories }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition, what, { timeout = 15000, extra = () => '' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await condition()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for: ${what}${extra()}`);
}

/**
 * Starts the site with only this module (a copy in a temporary folder) and fake cards.
 * Pass an existing { dataDir } to restart on the same data.
 */
async function startDixnt(t, { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dixnt-e2e-')), keep = false } = {}) {
  const cardsDir = path.join(dataDir, 'cards');
  if (!fs.existsSync(cardsDir)) makeFakeCards(cardsDir);
  const modulesDir = path.join(dataDir, 'modules-copy');
  if (!fs.existsSync(modulesDir)) {
    fs.cpSync(here, path.join(modulesDir, 'dixnt'), {
      recursive: true,
      filter: (source) => !['cards', 'node_modules', '.bot-tokens.json'].includes(path.basename(source)),
    });
  }
  // The module imports ../../shared/scores.js, ai.js and tally.js, so the copy needs a shared folder beside its modules folder.
  fs.mkdirSync(path.join(dataDir, 'shared'), { recursive: true });
  for (const file of ['scores.js', 'ai.js', 'tally.js']) fs.copyFileSync(path.join(here, '..', '..', 'shared', file), path.join(dataDir, 'shared', file));
  process.env.DIXNT_CARDS_DIR = cardsDir;
  const site = await startSite({ port: 0, dataDir: path.join(dataDir, 'site'), modulesDir, log: () => {} });
  const base = `http://127.0.0.1:${site.port}`;
  const people = [];
  const processes = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    people.forEach((p) => p.socket?.close());
    processes.forEach((p) => p.kill());
    await site.close();
  };
  t.after(async () => {
    await stop();
    if (!keep) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  class Person {
    constructor(name) {
      this.name = name;
      this.cookie = '';
      this.state = null;
      this.socket = null;
    }
    async http(method, url, body) {
      const res = await fetch(base + url, {
        method,
        headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) this.cookie = set.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => null) };
    }
    /** Registers the account (or signs in again) and opens a socket to the game. */
    async open({ displayName } = {}) {
      if (!this.cookie) {
        const registered = await this.http('POST', '/api/auth/register', { username: this.name, password: `${this.name} password`, displayName });
        assert.equal(registered.status, 200, registered.data?.error);
        this.id = registered.data.user.id;
      }
      return this.connect();
    }
    async connect() {
      this.socket?.close();
      this.socket = connect(`${base}/dixnt`, { forceNew: true, extraHeaders: { cookie: this.cookie } });
      this.state = null;
      this.socket.on('state', (s) => (this.state = s));
      people.push(this);
      await new Promise((resolve, reject) => {
        this.socket.once('connect', resolve);
        this.socket.once('connect_error', reject);
      });
      return this;
    }
    call(event, payload = {}) {
      return new Promise((resolve) => this.socket.emit(event, payload, resolve));
    }
    /** Joins the game with this code, or starts a new game (and becomes its host) when no code is given. */
    async join(code) {
      const reply = code ? await this.call('join', { code }) : await this.call('create');
      if (reply.ok) this.code = reply.code;
      return reply;
    }
    stats() {
      return this.http('GET', '/api/stats/me').then((r) => r.data);
    }
    me() {
      return this.state.players.find((p) => p.id === this.state.me.id);
    }
  }

  const person = (name) => new Person(name);
  const people4 = async (names) => Promise.all(names.map((n) => person(n).open()));
  const userId = (name) => site.db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  return { site, base, dataDir, person, people4, userId, stop, processes };
}

/**
 * Plays a game to the end. `humans` are the people this test controls (the first is the host, who moves rounds on); any
 * other players (bots) act for themselves. Returns what each finished round showed.
 */
async function playToEnd(humans, { vote = (p, round) => p.state.voteTargets[round % p.state.voteTargets.length], log = () => '' } = {}) {
  const [host] = humans;
  const rounds = [];
  const waitFor = (condition, what) => until(condition, what, { extra: () => `\nphase=${host.state?.phase} round=${host.state?.round}${log()}` });
  const roundOf = () => host.state.round;
  for (let guard = 0; guard < 100; guard++) {
    const { phase, round } = host.state;
    if (phase === 'finished') return rounds;
    await waitFor(() => humans.every((p) => p.state?.phase === phase && p.state.round === round), `everyone to see ${phase}`);
    if (phase === 'word') {
      const chooser = humans.find((p) => p.state.me.isChooser);
      if (chooser) assert.equal((await chooser.call('submitWord', { word: `a word for round ${round}` })).ok, true);
      await waitFor(() => host.state.phase !== 'word' || roundOf() !== round, 'the word to be chosen');
    } else if (phase === 'picking') {
      for (const p of humans) {
        if (p.state.me.isChooser || p.state.me.waiting || p.state.me.myPick !== null) continue;
        const reply = await p.call('playCard', { cardId: p.state.me.hand[0] });
        assert.equal(reply.ok, true, reply.error);
      }
      await waitFor(() => host.state.phase !== 'picking' || roundOf() !== round, 'every card to be played');
    } else if (phase === 'voting') {
      for (const p of humans) {
        if (!p.state.voteTargets.length || p.state.me.myVote !== null) continue;
        const reply = await p.call('vote', { targetId: vote(p, round) });
        assert.equal(reply.ok, true, reply.error);
      }
      await waitFor(() => host.state.phase !== 'voting' || roundOf() !== round, 'the verdict');
    } else if (phase === 'results') {
      const { results, players, chooserId } = host.state;
      rounds.push({ results, chooserId, names: Object.fromEntries(players.map((p) => [p.id, p.name])) });
      assert.equal((await host.call('nextRound')).ok, true);
      await waitFor(() => host.state.phase !== 'results', 'the next round');
    } else {
      assert.fail(`unexpected phase ${phase}`);
    }
  }
  assert.fail('the game did not finish');
}

/** Every player's view carries the same round history, and its totals equal the scores shown. */
function assertScoreboard(people, rounds) {
  const [first] = people;
  assert.equal(first.state.scoreboard.rounds.length, rounds);
  for (const p of people) {
    const { players, rounds: history, lowIsBetter } = p.state.scoreboard;
    assert.deepEqual(history, first.state.scoreboard.rounds, 'everybody sees the same history');
    assert.equal(lowIsBetter, false);
    assert.equal(players.find((x) => x.isMe).id, p.state.me.id);
    for (const row of players) {
      const total = history.reduce((sum, r) => sum + (r.deltas[row.id] ?? 0), 0);
      assert.equal(total, row.score, `${row.name}'s column adds up to their score`);
      assert.equal(row.score, p.state.players.find((x) => x.id === row.id).score);
    }
  }
}

/** What the statistics should say about each player after these rounds. */
function expectedExtras(rounds) {
  const extras = {};
  const of = (name) => (extras[name] ??= { roundsAsImposter: 0, timesFooledGroup: 0, correctGuesses: 0, cardsPlayed: 0 });
  for (const { results, chooserId, names } of rounds) {
    for (const id of Object.keys(names)) if (id !== chooserId) of(names[id]).cardsPlayed++;
    if (!results.imposterId) continue;
    const imposter = of(names[results.imposterId]);
    imposter.roundsAsImposter++;
    if (!results.groupCorrect) imposter.timesFooledGroup++;
    for (const [voterId, targetId] of Object.entries(results.votes)) {
      if (targetId === results.imposterId && voterId !== results.imposterId) of(names[voterId]).correctGuesses++;
    }
  }
  return extras;
}

/** The first four statistics (the others, which are hidden, have their own checks in tally.test.js). */
const COUNTED = ['roundsAsImposter', 'timesFooledGroup', 'correctGuesses', 'cardsPlayed'];
const extrasOf = (stats) => Object.fromEntries(stats.perGame[0].extras.filter((e) => COUNTED.includes(e.key)).map((e) => [e.key, e.value]));

async function assertRecorded(person, finalState, rounds, { players = finalState.players.length } = {}) {
  const stats = await person.stats();
  assert.equal(stats.perGame.length, 1);
  const [game] = stats.perGame;
  const mine = finalState.players.find((p) => p.name === person.name);
  const winner = finalState.winners.includes(mine.id);
  assert.equal(game.name, 'Dixnt');
  assert.equal(game.played, 1, 'the game is recorded exactly once');
  assert.equal(game.wins, winner ? 1 : 0);
  assert.equal(game.losses, winner ? 0 : 1);
  assert.equal(game.totalScore, mine.score);
  assert.deepEqual(extrasOf(stats), { roundsAsImposter: 0, timesFooledGroup: 0, correctGuesses: 0, cardsPlayed: 0, ...expectedExtras(rounds)[person.name] });
  const [recent] = stats.recent;
  assert.equal(recent.score, mine.score);
  assert.equal(recent.players, players);
  assert.equal(recent.placement, 1 + finalState.players.filter((p) => p.score > mine.score).length, 'ties share a placement');
}

test('four accounts play a whole game: identity comes from the account, and the result is recorded once', async (t) => {
  const { people4, person } = await startDixnt(t);
  const players = await people4(['ann', 'bob', 'cat', 'dan']);
  const [ann, bob, cat, dan] = players;

  assert.equal((await ann.join()).ok, true, 'the first player creates the game');
  assert.match(ann.code, /^[a-z]+-[a-z]+-[a-z]+$/, 'the invite code is three words');
  for (const p of [bob, cat, dan]) assert.equal((await p.join(ann.code)).ok, true);
  await until(() => ann.state?.players.length === 4, 'four players');
  assert.deepEqual(ann.state.players.map((p) => p.name), ['ann', 'bob', 'cat', 'dan'], 'players are named after their accounts');
  assert.equal(ann.state.phase, 'lobby');

  // Whatever a client sends, it is the signed-in account that joins.
  const sneak = await person('eve').open();
  const reply = await sneak.call('join', { code: ann.code, token: 'user:1', name: 'Somebody Else' });
  assert.equal(reply.ok, true);
  await until(() => ann.state.players.length === 5, 'the fifth player');
  assert.equal(ann.state.players[4].name, 'eve');
  assert.equal((await sneak.call('leave')).ok, true);
  await until(() => ann.state.players.length === 4, 'eve to leave');

  // A second account with the same display name gets a distinct name in the game.
  const twin = await person('ann2').open({ displayName: 'ann' });
  assert.equal((await twin.join(ann.code)).ok, true);
  await until(() => ann.state.players.length === 5, 'the twin');
  assert.equal(ann.state.players[4].name, 'ann (2)');
  assert.equal((await twin.call('leave')).ok, true);
  await until(() => ann.state.players.length === 4, 'the twin to leave');

  assert.equal((await bob.call('start')).ok, false, 'only the host can start');
  assert.equal((await ann.call('setRounds', { count: 1 })).ok, true);
  assert.equal((await ann.call('setHandSize', { size: 8 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => cat.state?.phase === 'word', 'the game to start');
  assert.equal(cat.state.me.hand.length, 8);

  const outsider = await person('fay').open();
  assert.equal((await outsider.call('vote', { targetId: 'x' })).ok, false, 'a non-player cannot act');
  assert.equal((await outsider.call('start')).ok, false);

  const rounds = await playToEnd(players);
  assert.equal(rounds.length, 4);
  await until(() => players.every((p) => p.state?.phase === 'finished'), 'everyone to see the end');
  const final = ann.state;
  assert.ok(final.winners.length >= 1);
  assertScoreboard(players, 4);
  assert.deepEqual(ann.state.scoreboard.rounds.map((r) => r.label), ['Round 1', 'Round 2', 'Round 3', 'Round 4']);

  // Reconnecting restores the player given the game's code; without one, a finished game is not resumed (back from the menu starts afresh).
  const before = bob.me().score;
  const again = person('bob');
  again.cookie = bob.cookie;
  await again.connect();
  assert.equal((await again.call('resume')).ok, false, 'a finished game is not resumed without its code');
  assert.equal((await again.call('resume', { code: bob.state.code })).ok, true);
  await until(() => again.state, 'the state after resuming');
  assert.equal(again.state.me.id, bob.state.me.id);
  assert.equal(again.me().score, before);
  const elsewhere = await again.call('resume', { code: 'some-other-game' });
  assert.equal(elsewhere.ok, false, 'a code that is not one of your games is refused');

  await sleep(100);
  for (const p of players) await assertRecorded(p, final, rounds);

  // Going back to the lobby afterwards does not record it again.
  assert.equal((await ann.call('endGame')).ok, true);
  await until(() => ann.state.phase === 'lobby', 'the lobby');
  await sleep(100);
  for (const p of players) assert.equal((await p.stats()).perGame[0].played, 1);
});

test('a game ended early by the host, or abandoned, is not recorded', async (t) => {
  const { people4, site } = await startDixnt(t);
  const players = await people4(['ann', 'bob', 'cat', 'dan']);
  const [ann, bob, cat, dan] = players;
  await ann.join();
  for (const p of [bob, cat, dan]) await p.join(ann.code);
  await ann.call('setRounds', { count: 1 });
  await ann.call('start');
  await until(() => players.every((p) => p.state?.phase === 'word'), 'the game to start');
  assert.equal((await ann.call('endGame')).ok, true, 'the host ends it early');
  await until(() => ann.state.phase === 'lobby', 'the lobby');

  await ann.call('start');
  await until(() => players.every((p) => p.state?.phase === 'word'), 'the second game to start');
  assert.equal((await bob.call('leave')).ok, true);
  assert.equal((await cat.call('leave')).ok, true, 'computer players take their seats, so the game carries on');
  await until(() => ann.state.players.filter((p) => p.bot).length === 2, 'two computer players');
  assert.equal(ann.state.phase, 'word');
  assert.equal(ann.state.players.length, 4);
  assert.equal((await dan.call('leave')).ok, true);
  assert.equal((await ann.call('leave')).ok, true, 'the last person closes the game');
  await sleep(100);
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM results').get().n, 0, 'nothing was recorded');
});

test('a tied game counts as a win for every tied winner, with a shared placement', async (t) => {
  const { people4 } = await startDixnt(t);
  const players = await people4(['ann', 'bob', 'cat']);
  const [ann, bob, cat] = players;
  await ann.join();
  for (const p of [bob, cat]) await p.join(ann.code);
  await ann.call('setJudging', { mode: 'favourite' });
  await ann.call('setRounds', { count: 1 });
  await ann.call('start');
  await until(() => players.every((p) => p.state?.phase === 'word'), 'the game to start');

  // ann picks bob, bob picks cat, cat picks ann: everyone scores a point.
  const next = { ann: 'bob', bob: 'cat', cat: 'ann' };
  const rounds = await playToEnd(players, {
    vote: (p) => p.state.players.find((q) => q.name === next[p.name]).id,
  });
  await until(() => players.every((p) => p.state?.phase === 'finished'), 'the end');
  assert.equal(ann.state.winners.length, 3);
  await sleep(100);
  for (const p of players) {
    const stats = await p.stats();
    assert.equal(stats.perGame[0].wins, 1);
    assert.equal(stats.perGame[0].totalScore, 2);
    assert.equal(stats.recent[0].placement, 1);
    assert.deepEqual(extrasOf(stats), { roundsAsImposter: 0, timesFooledGroup: 0, correctGuesses: 0, cardsPlayed: 2 }, 'no imposter in this style');
  }
  assert.equal(rounds.length, 3);
});

test('the chooser-decides style records who fooled the chooser', async (t) => {
  const { people4 } = await startDixnt(t);
  const players = await people4(['ann', 'bob', 'cat', 'dan']);
  const [ann, bob, cat, dan] = players;
  await ann.join();
  for (const p of [bob, cat, dan]) await p.join(ann.code);
  await ann.call('setJudging', { mode: 'chooser' });
  await ann.call('setRounds', { count: 1 });
  await ann.call('start');
  await until(() => players.every((p) => p.state?.phase === 'word'), 'the game to start');
  const rounds = await playToEnd(players);
  await until(() => players.every((p) => p.state?.phase === 'finished'), 'the end');
  await sleep(100);
  for (const p of players) await assertRecorded(p, ann.state, rounds);
});

test('the game state, and the fact that it was recorded, survive a restart', async (t) => {
  const first = await startDixnt(t, { keep: true });
  const players = await first.people4(['ann', 'bob', 'cat']);
  const [ann, bob, cat] = players;
  await ann.join();
  for (const p of [bob, cat]) await p.join(ann.code);
  await ann.call('setRounds', { count: 1 });
  await ann.call('start');
  await until(() => players.every((p) => p.state?.phase === 'word'), 'the game to start');
  const hand = bob.state.me.hand;
  const code = ann.code;
  const cookies = players.map((p) => p.cookie);
  await first.stop(); // saves the games

  const second = await startDixnt(t, { dataDir: first.dataDir, keep: true });
  const again = await Promise.all(['ann', 'bob', 'cat'].map(async (name, i) => {
    const p = second.person(name);
    p.cookie = cookies[i];
    return p.connect();
  }));
  const [ann2, bob2, cat2] = again;
  assert.equal((await bob2.call('resume', { code })).ok, true);
  await until(() => bob2.state, 'the state after the restart');
  assert.equal(bob2.state.phase, 'word');
  assert.deepEqual(bob2.state.me.hand, hand);
  for (const p of [ann2, cat2]) await p.call('resume', { code });

  const rounds = await playToEnd(again);
  await until(() => again.every((p) => p.state?.phase === 'finished'), 'the end');
  await sleep(100);
  for (const p of again) {
    await p.call('resume', { code });
    assert.equal((await p.stats()).perGame[0].played, 1);
  }
  assert.equal(rounds.length, 3);
  assertScoreboard(again, 3);

  // Restart again once the game is over: it must not be recorded a second time.
  await second.stop();
  const third = await startDixnt(t, { dataDir: first.dataDir, keep: true });
  t.after(() => fs.rmSync(first.dataDir, { recursive: true, force: true }));
  const last = third.person('ann');
  last.cookie = cookies[0];
  await last.connect();
  assert.equal((await last.call('resume', { code })).ok, true);
  await until(() => last.state?.phase === 'finished', 'the finished game after a restart');
  await sleep(100);
  assert.equal((await last.stats()).perGame[0].played, 1);
  assertScoreboard([last], 3);
});

test('the round history is saved, abandoned rounds are not in it, and an old save without one still loads', async (t) => {
  const first = await startDixnt(t, { keep: true });
  const players = await first.people4(['ann', 'bob', 'cat']);
  const [ann, bob, cat] = players;
  await ann.join();
  for (const p of [bob, cat]) await p.join(ann.code);
  await ann.call('setRounds', { count: 2 });
  await ann.call('start');
  await until(() => players.every((p) => p.state?.phase === 'word'), 'the game to start');
  assert.equal((await ann.call('abortRound')).ok, true, 'the host skips the first round');
  await until(() => players.every((p) => p.state?.round === 2 && p.state.phase === 'word'), 'the next round');
  assertScoreboard(players, 0);

  // Play one round by hand.
  const chooser = players.find((p) => p.state.me.isChooser);
  assert.equal((await chooser.call('submitWord', { word: 'anything' })).ok, true);
  await until(() => players.every((p) => p.state?.phase === 'picking'), 'picking');
  for (const p of players) if (!p.state.me.isChooser) assert.equal((await p.call('playCard', { cardId: p.state.me.hand[0] })).ok, true);
  await until(() => players.every((p) => p.state?.phase === 'voting'), 'voting');
  for (const p of players) if (p.state.voteTargets.length) await p.call('vote', { targetId: p.state.voteTargets[0] });
  await until(() => players.every((p) => p.state?.phase === 'results'), 'the results');
  assertScoreboard(players, 1);
  assert.equal(ann.state.scoreboard.rounds[0].label, 'Round 1', 'the skipped round does not use up a number');
  const history = ann.state.scoreboard.rounds;
  const code = ann.code;
  const cookies = players.map((p) => p.cookie);
  await first.stop();

  const reload = async (label) => {
    const site = await startDixnt(t, { dataDir: first.dataDir, keep: true });
    const again = await Promise.all(['ann', 'bob', 'cat'].map(async (name, i) => {
      const p = site.person(name);
      p.cookie = cookies[i];
      return p.connect();
    }));
    for (const p of again) await p.call('resume', { code });
    await until(() => again.every((p) => p.state), `the state ${label}`);
    return { site, again };
  };

  const second = await reload('after the restart');
  assertScoreboard(second.again, 1);
  assert.deepEqual(second.again[0].state.scoreboard.rounds, history, 'the history survived the restart');
  await second.site.stop();

  // An older save has scores but no history: it loads, with the scores as one earlier row.
  const file = path.join(first.dataDir, 'site', 'modules', 'dixnt', 'games.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.games[code].game.history.length, 1, 'the history is in the save file');
  delete saved.games[code].game.history;
  fs.writeFileSync(file, JSON.stringify(saved));
  const third = await reload('from the old save');
  assertScoreboard(third.again, 1);
  assert.equal(third.again[0].state.scoreboard.rounds[0].label, 'Earlier rounds');
  assert.equal((await third.again[0].call('nextRound')).ok, true, 'the game carries on');
  t.after(() => fs.rmSync(first.dataDir, { recursive: true, force: true })); // after the sites have stopped
});

/**
 * Plays a whole game against three real bot processes. The human host joins first, picks the settings, then plays
 * (or judges) alongside the bots.
 */
async function playBotGame(t, { judging, categories }) {
  const { site, base, person, userId, processes } = await startDixnt(t);
  const tokenFile = path.join(os.tmpdir(), `dixnt-bot-tokens-${process.pid}-${Date.now()}.json`);
  t.after(() => fs.rmSync(tokenFile, { force: true }));
  const botLog = [];
  const human = await person('host').open();

  assert.equal((await human.join()).ok, true);
  const code = human.code;
  await until(() => human.state, 'the first state update');
  assert.deepEqual(
    human.state.categories.map((c) => [c.key, c.count, c.selected]),
    [['alpha', 120, true], ['beta', 120, true]],
    'the server offers both categories, all selected by default',
  );
  assert.equal((await human.call('setJudging', { mode: judging })).ok, true);
  assert.equal((await human.call('setCategories', { keys: categories })).ok, true);
  assert.equal((await human.call('setRounds', { count: 1 })).ok, true);

  for (const name of ['Robin', 'Sam', 'Tess']) {
    const child = spawn(process.execPath, [botScript, '--join', code, '--name', name, '--url', base, '--delay', '0-50', '--token-file', tokenFile], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (chunk) => botLog.push(String(chunk)));
    processes.push(child);
  }
  await until(() => human.state?.players.length === 4, 'all bots to join', { extra: () => `\nbot output:\n${botLog.join('')}` });
  assert.deepEqual(human.state.players.map((p) => p.name).slice(1).sort(), ['Robin', 'Sam', 'Tess']);
  assert.equal(human.state.judging, judging);
  assert.ok(JSON.parse(fs.readFileSync(tokenFile, 'utf8')).Robin, 'the bot remembered its password');
  assert.equal((await human.call('start')).ok, true);

  for (const cardId of human.state.me.hand) {
    assert.ok(categories.some((key) => (key === 'alpha' ? cardId < 20000 : cardId >= 20000 && cardId < 30000)), 'only selected categories are dealt');
  }
  const rounds = await playToEnd([human], { log: () => `\nbot output:\n${botLog.join('')}` });
  await until(() => human.state.phase === 'finished', 'the end');
  assert.equal(rounds.length, 4);
  for (const { results } of rounds) {
    assert.equal(results.judging, judging);
    assert.equal(Object.keys(results.votes).length, judging === 'everyone' ? 4 : 1);
  }

  const log = botLog.join('');
  assert.match(log, /played card \d+/);
  if (judging === 'everyone') assert.match(log, /voted for /);
  else {
    const allowed = judging === 'favourite' ? [2] : [1, 5];
    for (const { results } of rounds) {
      const gained = Object.values(results.deltas).filter(Boolean);
      assert.equal(gained.length <= 1, true, 'only one player scores in the chooser-decides styles');
      assert.ok(gained.length === 0 || allowed.includes(gained[0]), `award ${gained[0]} is one of ${allowed}`);
      if (judging === 'favourite') {
        assert.equal(gained.length, 1, 'a favourite is always chosen');
        assert.equal(results.imposterId, null, 'there is no imposter');
      }
    }
  }
  assert.match(log, /chose the word "/, 'a bot picked a word from the hint list when it was the chooser');

  // The human and the bots are all in the statistics.
  await sleep(150);
  await assertRecorded(human, human.state, rounds);
  for (const name of ['Robin', 'Sam', 'Tess']) {
    const stats = site.stats.forUser(userId(name));
    assert.equal(stats.perGame[0].played, 1, `${name} was recorded`);
    assert.equal(stats.perGame[0].totalScore, human.state.players.find((p) => p.name === name).score);
  }
}

test('external bot processes play whole games using only the API (everyone votes)', (t) =>
  playBotGame(t, { judging: 'everyone', categories: ['alpha', 'beta'] }));

test('external bot processes play a whole game in chooser-only judging, with one category', (t) =>
  playBotGame(t, { judging: 'chooser', categories: ['beta'] }));

test('external bot processes play the favourite style: everyone sees the word, the chosen card scores 2', (t) =>
  playBotGame(t, { judging: 'favourite', categories: ['alpha'] }));

test('bots can only join an existing game, and they sign back in as the same account', async (t) => {
  const { base, site, person, processes } = await startDixnt(t);
  const tokenFile = path.join(os.tmpdir(), `dixnt-bot-tokens-${process.pid}-${Date.now()}-b.json`);
  t.after(() => fs.rmSync(tokenFile, { force: true }));
  const run = (args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [botScript, ...args, '--url', base, '--token-file', tokenFile], { stdio: ['ignore', 'pipe', 'pipe'] });
      processes.push(child);
      let output = '';
      child.stdout.on('data', (c) => (output += c));
      child.stderr.on('data', (c) => (output += c));
      child.on('exit', (code) => resolve({ code, output }));
    });

  assert.equal((await run(['--name', 'Robin'])).code, 1, '--join is required');
  const missing = await run(['--join', 'no-such-game', '--name', 'Robin']);
  assert.equal(missing.code, 1);
  assert.match(missing.output, /no game with that code/i);
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1, 'the bot account was made, and no game');

  const host = await person('host').open();
  await host.join();
  const stay = (name) => {
    const child = spawn(process.execPath, [botScript, '--join', host.code, '--name', name, '--url', base, '--token-file', tokenFile], { stdio: 'ignore' });
    processes.push(child);
    return child;
  };
  const first = stay('Robin');
  await until(() => host.state?.players.length === 2, 'the bot to join');
  const botId = host.state.players[1].id;
  first.kill();
  await until(() => host.state.players[1].connected === false, 'the bot to go offline');
  stay('Robin');
  await until(() => host.state.players[1].connected === true, 'the bot to come back');
  assert.equal(host.state.players.length, 2);
  assert.equal(host.state.players[1].id, botId, 'the same player');
  assert.equal(site.db.prepare('SELECT COUNT(*) AS n FROM users WHERE username = ?').get('Robin').n, 1);
});

test('several games run side by side, each with its own invite code', async (t) => {
  const { people4, person } = await startDixnt(t);
  const people = await people4(['ann', 'bob', 'cat', 'dan', 'eve', 'fay', 'gus']);
  const [ann, bob, cat, dan, eve, fay, gus] = people;

  assert.equal((await ann.join()).ok, true);
  assert.equal((await dan.join()).ok, true);
  assert.notEqual(ann.code, dan.code, 'every game gets its own code');

  // Codes are forgiving: capitals, spaces, and the whole invite link all work.
  assert.equal((await bob.join(`http://example.test/play/dixnt?${ann.code.toUpperCase()}`)).ok, true);
  assert.equal((await cat.join(ann.code.replaceAll('-', ' '))).ok, true);
  assert.equal((await eve.join(dan.code)).ok, true);
  await until(() => ann.state?.players.length === 3 && dan.state?.players.length === 2, 'both games to fill');

  assert.deepEqual(ann.state.players.map((p) => p.name), ['ann', 'bob', 'cat']);
  assert.deepEqual(dan.state.players.map((p) => p.name), ['dan', 'eve']);
  assert.equal(ann.state.code, ann.code);

  // Settings in one game do not touch the other.
  assert.equal((await ann.call('setHandSize', { size: 5 })).ok, true);
  await until(() => ann.state.handSize === 5, 'the hand size to change');
  assert.notEqual(dan.state.handSize, 5);
  assert.equal((await bob.call('setHandSize', { size: 6 })).ok, false, 'only the host of a game can change it');

  // The same account in the second game: resume without a code finds the most recently used one.
  assert.equal((await bob.join(dan.code)).ok, true);
  await until(() => dan.state.players.length === 3, 'bob to join the second game');
  assert.equal(bob.state.code, dan.code);

  // Unknown codes are refused, and a lookup says whether a game exists.
  assert.equal((await fay.join('no-such-game')).ok, false);
  assert.equal((await fay.call('lookup', { code: `?${ann.code}` })).exists, true);
  assert.equal((await fay.call('lookup', { code: 'no-such-game' })).exists, false);
  assert.equal((await fay.call('resume', { code: dan.code })).ok, false, 'only players can resume');
  assert.equal((await fay.call('resume')).ok, false, 'and an account in no game has nothing to resume');

  // The same account on a second device sees the same game.
  const laptop = gus;
  assert.equal((await laptop.join(ann.code)).ok, true);
  const second = person('gus');
  second.cookie = laptop.cookie;
  await second.connect();
  assert.equal((await second.call('resume')).ok, true);
  await until(() => second.state?.code === ann.code, 'the second device to see the game');
  assert.equal(second.state.me.id, laptop.state.me.id);
  assert.equal(ann.state.players.filter((p) => p.name === 'gus').length, 1);

  // The last player leaving closes the game, and its code stops working.
  assert.equal((await dan.call('leave')).ok, true);
  assert.equal((await eve.call('leave')).ok, true);
  assert.equal((await bob.call('leave')).ok, true);
  assert.equal((await fay.join(dan.code)).ok, false, 'the game is gone');
  assert.equal((await ann.call('lookup', { code: dan.code })).exists, false);
});

test('the card images are served from the module and the hint list loads', async (t) => {
  const { base, person } = await startDixnt(t);
  const ann = await person('ann').open();
  assert.equal((await fetch(`${base}/assets/dixnt/cards/medium/card_10001.jpg`)).status, 200);
  assert.equal((await fetch(`${base}/assets/dixnt/cards/medium/card_99999.jpg`)).status, 404);
  const bob = await person('bob').open();
  const cat = await person('cat').open();
  await ann.join();
  await bob.join(ann.code);
  await cat.join(ann.code);
  const reply = await ann.call('hints');
  assert.equal(reply.hints.length, 3);
  assert.ok(reply.hints.every((h) => typeof h === 'string' && h.length && !h.includes('﻿')));
});
