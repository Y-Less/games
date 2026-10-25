// Nomination Whist against the real site: accounts over HTTP, rooms over sockets, computer players, statistics, leaving,
// reconnecting and restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../../server/index.js';
import { totalsFromRounds } from '../../shared/scores.js';

process.env.NOMINATION_WHIST_BOT_DELAY = '1-4';
process.env.NOMINATION_WHIST_TRICK_PAUSE = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'nomination-whist';
const CARD = /"(?:[2-9]|10|[JQKA])[CDHS]"/g;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, what, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await condition()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

/** A copy of just this module (and the shared folder it imports), so other modules cannot affect these tests. */
function ownModulesDir(root) {
  const dir = path.join(root, 'modules');
  if (!fs.existsSync(path.join(dir, ID))) {
    fs.cpSync(here, path.join(dir, ID), { recursive: true, filter: (source) => !/\.test\.js$/.test(source) });
    fs.cpSync(path.join(here, '..', '..', 'shared'), path.join(root, 'shared'), { recursive: true });
  }
  return dir;
}

async function launch(t, existingDir) {
  const root = existingDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'whist-e2e-'));
  const dataDir = path.join(root, 'site');
  const site = await startSite({ port: 0, dataDir, modulesDir: ownModulesDir(root), log: () => {} });
  const base = `http://127.0.0.1:${site.port}`;
  const everyone = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    everyone.forEach((p) => p.socket?.close());
    await site.close();
  };
  t.after(async () => {
    await close();
    if (!existingDir) fs.rmSync(root, { recursive: true, force: true });
  });

  class Person {
    constructor(name) {
      this.name = name;
      this.cookie = '';
      this.socket = null;
      this.state = undefined;
      this.payloads = [];
    }
    async http(method, url, body) {
      const res = await fetch(base + url, {
        method,
        headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) this.cookie = set.split(';')[0];
      return res.json().catch(() => null);
    }
    async register() {
      const registered = await this.http('POST', '/api/auth/register', { username: this.name, password: `${this.name} password` });
      this.id = registered.user.id;
      return this;
    }
    /** Opens a (further) socket; `state` follows the latest payload this person's newest socket was sent. */
    async open() {
      const socket = connect(`${base}/${ID}`, { forceNew: true, extraHeaders: { cookie: this.cookie } });
      this.socket = socket;
      this.state = undefined;
      everyone.push(this);
      socket.on('state', (s) => {
        if (this.socket !== socket) return;
        this.state = s;
        this.payloads.push(JSON.stringify(s));
      });
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return this;
    }
    send(event, payload = {}) {
      return new Promise((resolve) => this.socket.emit(event, payload, resolve));
    }
    stats() {
      return this.http('GET', '/api/stats/me');
    }
  }

  const person = async (name) => (await new Person(name).register()).open();
  /** The same account (its session cookie survives a restart), connected to this site. */
  const returning = async (old) => {
    const again = new Person(old.name);
    again.cookie = old.cookie;
    again.id = old.id;
    return again.open();
  };
  return { site, base, person, returning, close, root };
}

/** Starts a room: the first person hosts, the others join by code, then seats are set and filled with computers. */
async function setUp(people, { seats, length = 'full', missPoints, instantWin = false } = {}) {
  const [host, ...others] = people;
  const created = await host.send('create', { seats, length, instantWin, ...(missPoints === undefined ? {} : { missPoints }) });
  assert.ok(created.ok, created.error);
  for (const p of others) assert.ok((await p.send('join', { code: created.code })).ok);
  await until(() => host.state?.seats.filter((s) => s && !s.bot).length === people.length, 'everyone in the lobby');
  assert.ok((await host.send('fillBots')).ok);
  await until(() => host.state.seats.every(Boolean), 'full seats');
  return created.code;
}

/** Everything in every payload that looks like a card must be one the viewer may see. */
function assertNoLeaks(person) {
  for (const raw of person.payloads) {
    const payload = JSON.parse(raw);
    if (!payload) continue;
    const allowed = new Set([...(payload.hand ?? []), ...(payload.trick ?? []).map((p) => p.card), ...(payload.lastTrick?.plays ?? []).map((p) => p.card)]);
    for (const token of raw.match(CARD) ?? []) assert.ok(allowed.has(JSON.parse(token)), `${person.name} was sent ${token}, which is not theirs to see`);
    assert.equal('hands' in payload, false);
    for (const seat of payload.seats) if (seat) assert.equal(typeof seat.cards, 'number', 'others only get a card count');
  }
}

/** Plays one move for a person if it is their turn (or moves the round on). Returns what it did, or null. */
async function move(p, { next = false } = {}) {
  const s = p.state;
  if (!s || s.you < 0) return null;
  if (s.phase === 'nominating' && s.turn === s.you) {
    const options = Array.from({ length: s.round.cards + 1 }, (_, n) => n).filter((n) => n !== s.forbidden);
    const reply = await p.send('nominate', { number: options[Math.floor(options.length / 2)] });
    assert.ok(reply.ok, reply.error);
    return 'nominate';
  }
  if (s.phase === 'playing' && s.turn === s.you && s.legal) {
    const card = s.hand.find((c) => s.legal[c] === null);
    assert.ok(card, 'a legal card exists');
    const reply = await p.send('play', { card });
    assert.ok(reply.ok, reply.error);
    return 'play';
  }
  if (s.phase === 'roundEnd' && next) {
    await p.send('next');
    return 'next';
  }
  return null;
}

/** Plays until the game is over for these people; the first of them moves each round on. */
async function playToEnd(people, { timeout = 60000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (people.every((p) => p.state?.phase === 'finished')) return;
    let moved = false;
    for (const [i, p] of people.entries()) if (await move(p, { next: i === 0 })) moved = true;
    if (!moved) await sleep(5);
  }
  assert.fail(`the game did not finish: ${people.map((p) => p.state?.phase).join(', ')}`);
}

function assertHistory(person, { rounds, seats }) {
  const s = person.state;
  assert.equal(s.rounds.length, rounds);
  const totals = totalsFromRounds(s.rounds, s.seats.map((x) => x.seat));
  s.seats.forEach((seat) => assert.equal(seat.score, totals[seat.seat], `${seat.name}: the rounds add up to the total`));
  s.rounds.forEach((r, i) => {
    assert.match(r.label, new RegExp(`^Round ${i + 1}: \\d cards?, `));
    for (const seat of s.seats) {
      assert.match(r.notes[seat.seat], /^bid \d, took \d$/);
      const [bid, took] = [r.bids[seat.seat], r.taken[seat.seat]];
      assert.equal(r.deltas[seat.seat], bid === took ? 10 + bid : s.settings.missPoints ? took : 0);
    }
  });
  assert.equal(s.seats.length, seats);
}

async function assertRecorded(p, { seats, won = null }) {
  const stats = await p.stats();
  const [game] = stats.perGame;
  assert.equal(stats.perGame.length, 1);
  assert.equal(game.name, 'Nomination Whist');
  assert.equal(game.played, 1, 'recorded exactly once');
  const mine = p.state.seats[p.state.you];
  const winner = p.state.winners.includes(p.state.you);
  assert.equal(game.wins, winner ? 1 : 0);
  assert.equal(game.losses, winner ? 0 : 1);
  assert.equal(game.totalScore, mine.score);
  const extras = Object.fromEntries(game.extras.map((e) => [e.key, e.value]));
  const rounds = p.state.rounds;
  assert.equal(extras.roundsPlayed, rounds.length);
  assert.equal(extras.bidsMade, rounds.filter((r) => r.bids[p.state.you] === r.taken[p.state.you]).length);
  assert.equal(extras.tricksWon, rounds.reduce((sum, r) => sum + r.taken[p.state.you], 0));
  assert.equal(extras.perfectGames, extras.bidsMade === extras.roundsPlayed ? 1 : 0);
  assert.equal(stats.recent[0].players, p.state.settings.seats - p.state.seats.filter((s) => s.bot).length, 'only accounts are recorded');
  assert.equal(stats.recent[0].placement, 1 + p.state.seats.filter((s) => s.score > mine.score).length);
  if (won !== null) assert.equal(winner, won);
  void seats;
}

test('a short game with 3 seats: one person and two computer players, to the end, with statistics', async (t) => {
  const { person } = await launch(t);
  const ann = await person('ann');
  assert.equal((await ann.send('resume')).ok, true);
  await until(() => ann.state === null, 'no game to resume');
  const code = await setUp([ann], { seats: 3, length: 'short' });
  assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
  assert.equal(ann.state.phase, 'lobby');
  assert.ok((await ann.send('start')).ok);
  assert.equal(ann.state.round.number, 1);
  assert.equal(ann.state.round.cards, 7);
  assert.equal(ann.state.round.trump, 'H');
  assert.equal(ann.state.hand.length, 7);
  await playToEnd([ann]);
  assertHistory(ann, { rounds: 7, seats: 3 });
  assert.deepEqual(ann.state.rounds.map((r) => r.cards), [7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(ann.state.rounds.map((r) => r.trump), ['H', 'C', 'D', 'S', null, 'H', 'C']);
  assert.ok(ann.state.winners.length >= 1);
  await until(async () => (await ann.stats()).perGame.length === 1, 'statistics');
  await sleep(100);
  await assertRecorded(ann, { seats: 3 });
  assertNoLeaks(ann);
});

test('a full 14-round game with seven seats, two people and five computers; both are recorded and nothing leaks', async (t) => {
  const { person } = await launch(t);
  const [ann, bob] = [await person('ann'), await person('bob')];
  await setUp([ann, bob], { seats: 7 });
  assert.equal(ann.state.settings.length, 'full');
  assert.equal(ann.state.settings.missPoints, true);
  assert.ok((await ann.send('start')).ok);
  await until(() => bob.state.phase !== 'lobby', 'bob to see the game');
  assert.notDeepEqual(ann.state.hand, bob.state.hand);
  await playToEnd([ann, bob]);
  for (const p of [ann, bob]) assertHistory(p, { rounds: 14, seats: 7 });
  assert.deepEqual(ann.state.rounds.map((r) => r.cards), [7, 6, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ann.state.rounds.map((r) => r.cards), bob.state.rounds.map((r) => r.cards));
  assert.deepEqual(ann.state.rounds.map((r) => r.deltas), bob.state.rounds.map((r) => r.deltas), 'everyone sees the same history');
  await sleep(150);
  await assertRecorded(ann, { seats: 7 });
  await assertRecorded(bob, { seats: 7 });
  assertNoLeaks(ann);
  assertNoLeaks(bob);
  for (const p of [ann, bob]) {
    assert.ok(p.payloads.length > 100);
    assert.ok(p.payloads.every((raw) => !/"hands"|"played"/.test(raw)));
  }
});

test('five seats with missed nominations scoring nothing when the host turns the option off', async (t) => {
  const { person } = await launch(t);
  const ann = await person('ann');
  await setUp([ann], { seats: 5, length: 'short', missPoints: false });
  assert.equal(ann.state.settings.missPoints, false);
  assert.ok((await ann.send('start')).ok);
  await playToEnd([ann]);
  for (const r of ann.state.rounds) {
    for (const seat of ann.state.seats) {
      const hit = r.bids[seat.seat] === r.taken[seat.seat];
      assert.equal(r.deltas[seat.seat], hit ? 10 + r.bids[seat.seat] : 0);
    }
  }
  assertHistory(ann, { rounds: 7, seats: 5 });
});

test('the lobby: only the host changes things, seats and computer players, and the start rules', async (t) => {
  const { person } = await launch(t);
  const [ann, bob] = [await person('ann'), await person('bob')];
  assert.equal((await ann.send('join', { code: 'nonsense' })).ok, false);
  assert.match((await ann.send('join', { code: 'boss-aware-you' })).error, /No game has that code/);
  assert.equal((await ann.send('start')).ok, false, 'not in a game');
  const created = await ann.send('create', {});
  assert.ok(created.ok);
  assert.equal((await ann.send('create')).ok, false, 'already in a game');
  assert.equal(ann.state.seats.length, 4);
  assert.equal(ann.state.settings.instantWin, true, 'the instant win is on by default');
  assert.equal((await bob.send('settings', { instantWin: false })).ok, false, 'only the host');
  assert.equal((await ann.send('settings', { instantWin: 'yes' })).ok, false);
  assert.ok((await ann.send('settings', { instantWin: false })).ok);
  await until(() => ann.state.settings.instantWin === false, 'the option off');
  assert.ok((await ann.send('settings', { instantWin: true })).ok);
  assert.equal(ann.state.settings.instantWin, true);
  assert.ok((await bob.send('join', { code: ` ${created.code.toUpperCase()} ` })).ok, 'codes are tidied');
  await until(() => ann.state.seats[1]?.name === 'bob', 'bob seated');
  assert.equal((await bob.send('settings', { seats: 5 })).ok, false);
  assert.equal((await bob.send('addBot', {})).ok, false);
  assert.equal((await bob.send('start')).ok, false);
  assert.equal((await ann.send('start')).ok, false, 'empty seats');
  assert.ok((await ann.send('settings', { seats: 6, length: 'short', missPoints: false })).ok);
  await until(() => bob.state.seats.length === 6 && bob.state.settings.length === 'short', 'new settings');
  assert.equal((await ann.send('settings', { seats: 9 })).ok, false);
  assert.ok((await ann.send('addBot', {})).ok);
  assert.ok((await ann.send('addBot', { seat: 5 })).ok);
  await until(() => ann.state.seats[5]?.bot, 'a computer in seat 5');
  assert.ok((await ann.send('removeBot', { seat: 5 })).ok);
  assert.equal((await ann.send('removeBot', { seat: 0 })).ok, false);
  assert.ok((await ann.send('fillBots')).ok);
  assert.ok((await ann.send('settings', { seats: 3 })).ok, 'fewer seats drop computer players');
  await until(() => ann.state.seats.length === 3 && ann.state.seats.every((x) => x.name), 'three seats');
  const stranger = await person('cat');
  assert.equal((await stranger.send('join', { code: created.code })).ok, false, 'the game is full');
  assert.ok((await ann.send('start')).ok);
  assert.equal((await ann.send('start')).ok, false);
  assert.equal((await ann.send('settings', { seats: 4 })).ok, false, 'too late');
  const late = await person('dan');
  assert.equal((await late.send('join', { code: created.code })).ok, false, 'too late to join');
});

test('invalid moves are refused and never change the game', async (t) => {
  const { person } = await launch(t);
  const ann = await person('ann');
  await setUp([ann], { seats: 3, length: 'short' });
  assert.equal((await ann.send('nominate', { number: 1 })).ok, false, 'not started');
  await ann.send('start');
  await until(() => ann.state.phase === 'nominating' && ann.state.turn === ann.state.you, 'my turn to nominate');
  for (const number of [-1, 8, 1.5, '1', null, undefined]) assert.equal((await ann.send('nominate', { number })).ok, false);
  assert.equal((await ann.send('play', { card: ann.state.hand[0] })).ok, false, 'nominations first');
  const reply = await ann.send('nominate', { number: ann.state.forbidden === 2 ? 1 : 2 });
  assert.ok(reply.ok);
  await until(() => ann.state.phase === 'playing' && ann.state.turn === ann.state.you, 'my turn to play');
  const before = JSON.stringify(ann.state.hand);
  for (const card of ['ZZ', 7, null, '1S', 'AS AS']) assert.equal((await ann.send('play', { card })).ok, false);
  const illegal = ann.state.hand.find((c) => ann.state.legal[c] !== null);
  if (illegal) assert.match((await ann.send('play', { card: illegal })).error, /follow suit/);
  assert.equal(JSON.stringify(ann.state.hand), before);
  assert.equal((await ann.send('next')).ok, false);
  assert.equal((await ann.send('again')).ok, false);
});

test('the dealer cannot make the nominations add up to the tricks, whoever deals', async (t) => {
  const { person } = await launch(t);
  const ann = await person('ann');
  await setUp([ann], { seats: 3 });
  await ann.send('start');
  let checked = 0;
  for (let guard = 0; guard < 4000 && checked < 6; guard++) {
    const s = ann.state;
    if (s.phase === 'nominating' && s.turn === s.you) {
      if (s.round.dealer === s.you && s.forbidden !== null) {
        const refused = await ann.send('nominate', { number: s.forbidden });
        assert.equal(refused.ok, false);
        assert.match(refused.error, /cannot nominate/);
        checked++;
      }
    }
    if (s.phase === 'finished') break;
    if (!(await move(ann, { next: true }))) await sleep(3);
  }
  assert.ok(checked >= 3, `only checked ${checked} dealer turns`);
  for (const r of ann.state.rounds) assert.notEqual(r.bids.reduce((a, b) => a + b, 0), r.cards);
});

test('reconnecting and several sockets: the same state comes back, and every open socket is kept up to date', async (t) => {
  const { person, base } = await launch(t);
  const ann = await person('ann');
  await setUp([ann], { seats: 4, length: 'short' });
  await ann.send('start');
  const second = connect(`${base}/${ID}`, { forceNew: true, extraHeaders: { cookie: ann.cookie } });
  t.after(() => second.close());
  const seen = [];
  second.on('state', (s) => seen.push(s));
  await new Promise((resolve) => second.once('connect', resolve));
  const resumed = await new Promise((resolve) => second.emit('resume', {}, resolve));
  assert.ok(resumed.ok);
  await until(() => seen.length > 0, 'the second socket to get the game');
  assert.equal(seen.at(-1).you, ann.state.you);
  assert.deepEqual(seen.at(-1).hand, ann.state.hand);
  // A new connection after the old one dropped gets the game back.
  const code = ann.state.code;
  ann.socket.close();
  await sleep(30);
  await ann.open();
  assert.equal(ann.state, undefined);
  assert.ok((await ann.send('resume', { code })).ok);
  await until(() => ann.state?.code === code, 'the game after reconnecting');
  assert.equal(ann.state.phase === 'lobby', false);
  assert.ok((await ann.send('resume', {})).ok, 'resuming without a code finds the game');
  await playToEnd([ann]);
  await until(() => seen.at(-1)?.phase === 'finished', 'the other socket to see the end');
  assert.equal(seen.at(-1).rounds.length, 7);
  assertNoLeaks(ann);
});

test('a dropped connection shows the person as away to the others, and they come back as themselves', async (t) => {
  const { person } = await launch(t);
  const [ann, bob] = [await person('ann'), await person('bob')];
  await setUp([ann, bob], { seats: 4, length: 'short' });
  await ann.send('start');
  bob.socket.close();
  await until(() => ann.state.seats[ann.state.seats.findIndex((s) => s.name === 'bob')].away, 'bob away');
  const code = ann.state.code;
  await bob.open();
  assert.ok((await bob.send('resume', { code })).ok);
  await until(() => bob.state?.phase === 'nominating' || bob.state?.phase === 'playing', 'bob back in the game');
  await until(() => !ann.state.seats[bob.state.you].away, 'bob no longer away');
  assert.equal(bob.state.seats[bob.state.you].name, 'bob');
});

test('two rooms at once do not interfere', async (t) => {
  const { person } = await launch(t);
  const [ann, bob, cat, dan] = [await person('ann'), await person('bob'), await person('cat'), await person('dan')];
  const first = await setUp([ann, bob], { seats: 4, length: 'short' });
  const second = await setUp([cat, dan], { seats: 5, length: 'short' });
  assert.notEqual(first, second);
  await ann.send('start');
  await cat.send('start');
  await Promise.all([playToEnd([ann, bob]), playToEnd([cat, dan])]);
  assert.equal(ann.state.code, first);
  assert.equal(cat.state.code, second);
  assert.equal(ann.state.seats.length, 4);
  assert.equal(cat.state.seats.length, 5);
  assert.deepEqual(ann.state.seats.filter((s) => !s.bot).map((s) => s.name).sort(), ['ann', 'bob']);
  assert.deepEqual(cat.state.seats.filter((s) => !s.bot).map((s) => s.name).sort(), ['cat', 'dan']);
  for (const p of [ann, bob, cat, dan]) assertNoLeaks(p);
  await sleep(150);
  for (const p of [ann, bob, cat, dan]) assert.equal((await p.stats()).perGame[0].played, 1);
});

test('a person who leaves mid-game is replaced by a computer player; the game goes on and they are not recorded', async (t) => {
  const { person } = await launch(t);
  const [ann, bob, cat] = [await person('ann'), await person('bob'), await person('cat')];
  const code = await setUp([ann, bob, cat], { seats: 4, length: 'short' });
  await ann.send('start');
  for (let i = 0; i < 40; i++) for (const p of [ann, bob, cat]) await move(p, { next: p === ann });
  const bobSeat = bob.state.you;
  assert.ok((await bob.send('leave')).ok);
  await until(() => bob.state === null, 'bob out of the game');
  await until(() => ann.state.seats[bobSeat].bot, 'a computer in bob\'s seat');
  assert.equal(ann.state.seats.filter((s) => !s.bot).length, 2);
  await playToEnd([ann, cat]);
  assertHistory(ann, { rounds: 7, seats: 4 });
  await sleep(150);
  assert.equal((await bob.stats()).perGame.length, 0, 'the person who left is not recorded');
  await assertRecorded(ann, { seats: 4 });
  const recent = (await ann.stats()).recent[0];
  assert.equal(recent.players, 2);
  assert.equal((await bob.send('join', { code })).ok, false, 'cannot come back to a game in progress');
});

test('when the last person leaves, the game is abandoned and nothing is recorded', async (t) => {
  const { person } = await launch(t);
  const [ann, bob] = [await person('ann'), await person('bob')];
  const code = await setUp([ann, bob], { seats: 3 });
  await ann.send('start');
  await ann.send('leave');
  await bob.send('leave');
  await until(() => ann.state === null && bob.state === null, 'both out');
  await sleep(200);
  assert.match((await ann.send('join', { code })).error, /No game has that code/);
  assert.equal((await ann.stats()).perGame.length, 0);
  assert.equal((await bob.stats()).perGame.length, 0);
});

test('after the final scores the host can play again from the lobby, and a second game is recorded separately', async (t) => {
  const { person } = await launch(t);
  const [ann, bob] = [await person('ann'), await person('bob')];
  await setUp([ann, bob], { seats: 3, length: 'short' });
  await ann.send('start');
  await playToEnd([ann, bob]);
  assert.equal((await bob.send('again')).ok, false, 'only the host');
  assert.ok((await ann.send('again')).ok);
  await until(() => bob.state.phase === 'lobby' && ann.state.phase === 'lobby', 'back in the lobby');
  assert.deepEqual(ann.state.rounds, []);
  assert.ok((await ann.send('start')).ok);
  await until(() => ann.state.phase === 'nominating' || ann.state.phase === 'playing', 'second game');
  await playToEnd([ann, bob]);
  await sleep(150);
  assert.equal((await ann.stats()).perGame[0].played, 2);
  assert.equal((await bob.stats()).perGame[0].played, 2);
});

test('a restart keeps the games, and the computer players carry on from where they were', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whist-restart-'));
  const first = await launch(t, root);
  const ann = await first.person('ann');
  const code = await setUp([ann], { seats: 5, length: 'short' });
  await ann.send('start');
  for (let i = 0; i < 25; i++) await move(ann);
  await until(() => ann.state.phase !== 'lobby' && ann.state.round.number >= 1, 'a game under way');
  await sleep(50);
  const seatsBefore = ann.state.seats.map((s) => s.name);
  await first.close();

  const second = await launch(t, root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const again = await second.returning(ann);
  assert.ok((await again.send('resume', {})).ok);
  await until(() => again.state?.code === code, 'the saved game');
  assert.deepEqual(again.state.seats.map((s) => s.name), seatsBefore);
  assert.equal(again.state.phase === 'lobby', false);
  await playToEnd([again]);
  assertHistory(again, { rounds: 7, seats: 5 });
  await sleep(150);
  assert.equal((await again.stats()).perGame[0].played, 1);
});

test('a finished game is recorded only once, even across a restart', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whist-once-'));
  const first = await launch(t, root);
  const ann = await first.person('ann');
  await setUp([ann], { seats: 3, length: 'short' });
  await ann.send('start');
  await playToEnd([ann]);
  await sleep(250);
  assert.equal((await ann.stats()).perGame[0].played, 1);
  await first.close();
  const second = await launch(t, root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const again = await second.returning(ann);
  assert.ok((await again.send('resume', {})).ok);
  await until(() => again.state?.phase === 'finished', 'the finished game');
  await sleep(200);
  assert.equal((await again.stats()).perGame[0].played, 1);
});

// ---- instant win on a 7 ----

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) return full;
  }
  return null;
}

/**
 * Ann (seat 0), Bob (seat 1) and a computer player (seat 2, the dealer) in a short game. The saved room is rewritten across a
 * restart so that Ann holds the seven top hearts (the first round's trumps) and so wins every trick she plays.
 */
async function riggedFirstRound(t, { instantWin }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whist-instant-'));
  const first = await launch(t, root);
  const [ann, bob] = [await first.person('ann'), await first.person('bob')];
  await setUp([ann, bob], { seats: 3, length: 'short', instantWin });
  assert.equal(ann.state.settings.instantWin, instantWin);
  assert.ok((await ann.send('start')).ok);
  await until(() => ann.state.phase === 'nominating', 'the game to start');
  await sleep(50);
  await first.close();

  const file = findFile(root, 'rooms.json');
  assert.ok(file, 'the room was saved');
  const rooms = JSON.parse(fs.readFileSync(file, 'utf8'));
  const room = rooms[0];
  const stack = ['A', 'K', 'Q', 'J', '10', '9', '8'].map((r) => `${r}H`);
  const rest = ALL_CARDS.filter((c) => !stack.includes(c));
  room.hands = [stack, rest.slice(0, 7), rest.slice(7, 14)];
  room.dealer = 2;
  room.turn = 0;
  room.nominations = [null, null, null];
  fs.writeFileSync(file, JSON.stringify(rooms));

  const second = await launch(t, root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [annAgain, bobAgain] = [await second.returning(ann), await second.returning(bob)];
  await annAgain.send('resume', {});
  await bobAgain.send('resume', {});
  await until(() => annAgain.state?.phase === 'nominating' && annAgain.state.turn === 0 && bobAgain.state?.phase === 'nominating', 'the rigged round');
  assert.deepEqual(annAgain.state.hand.slice().sort(), stack.slice().sort());
  assert.ok((await annAgain.send('nominate', { number: 7 })).ok);
  return { ann: annAgain, bob: bobAgain };
}
const ALL_CARDS = ['H', 'C', 'D', 'S'].flatMap((s) => ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map((r) => `${r}${s}`));

test('nominating 7 and winning all 7 tricks in round 1 wins the game for that person at once, and the statistics say so', async (t) => {
  const { ann, bob } = await riggedFirstRound(t, { instantWin: true });
  await playToEnd([ann, bob]);
  for (const p of [ann, bob]) {
    assert.equal(p.state.rounds.length, 1, 'the one round is on the scoreboard');
    assert.equal(p.state.instantWin, ann.state.you);
    assert.deepEqual(p.state.winners, [ann.state.you]);
    assert.equal(p.state.rounds[0].instantWin, ann.state.you);
    assert.equal(p.state.rounds[0].bids[ann.state.you], 7);
    assert.equal(p.state.rounds[0].taken[ann.state.you], 7);
  }
  await sleep(150);
  const annStats = (await ann.stats()).perGame[0];
  const bobStats = (await bob.stats()).perGame[0];
  assert.equal(annStats.played, 1);
  assert.equal(annStats.wins, 1);
  assert.equal(bobStats.losses, 1);
  assert.equal(bobStats.wins, 0);
  const annExtras = Object.fromEntries(annStats.extras.map((e) => [e.key, e.value]));
  const bobExtras = Object.fromEntries(bobStats.extras.map((e) => [e.key, e.value]));
  assert.equal(annExtras.instantWins, 1);
  assert.equal(bobExtras.instantWins, 0);
  assert.equal(annExtras.roundsPlayed, 1);
  assert.equal((await ann.stats()).recent[0].placement, 1);
  assert.ok([2, 3].includes((await bob.stats()).recent[0].placement));
});

test('with the instant win option off the same 7 just scores 17 and the game goes on', async (t) => {
  const { ann, bob } = await riggedFirstRound(t, { instantWin: false });
  const started = Date.now();
  while (ann.state.phase !== 'roundEnd' && Date.now() - started < 20000) {
    let moved = false;
    for (const p of [ann, bob]) if (await move(p)) moved = true;
    if (!moved) await sleep(5);
  }
  assert.equal(ann.state.phase, 'roundEnd');
  assert.equal(ann.state.instantWin, null);
  assert.equal(ann.state.winners, null);
  assert.equal(ann.state.seats[ann.state.you].score, 17);
});
