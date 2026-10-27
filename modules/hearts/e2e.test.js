// Hearts against the real site: accounts over HTTP, sockets, computer players on timers, statistics and restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../../server/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const platform = path.resolve(here, '..', '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CARD = /\b(?:[2-9]|10|[JQKA])[CDHS]\b/g;

const fast = () => {
  process.env.HEARTS_BOT_DELAY = '0-3';
  process.env.HEARTS_TRICK_PAUSE = '0';
};

async function until(condition, what, { timeout = 20000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await condition()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

/**
 * The site with only this module, copied (with the shared files it imports) into a temporary folder.
 * Pass an existing { dataDir } to restart on the same data.
 */
async function launch(t, { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-e2e-')), keep = false } = {}) {
  const modulesDir = path.join(dataDir, 'copy', 'modules');
  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(path.join(modulesDir, 'hearts'), { recursive: true });
    for (const file of ['server.js', 'game.js', 'deals.js', 'module.json', 'rules.md']) fs.copyFileSync(path.join(here, file), path.join(modulesDir, 'hearts', file));
    fs.cpSync(path.join(here, 'ai'), path.join(modulesDir, 'hearts', 'ai'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'copy', 'shared'), { recursive: true });
    for (const file of ['ai.js', 'cards.js', 'scores.js']) fs.copyFileSync(path.join(platform, 'shared', file), path.join(dataDir, 'copy', 'shared', file));
  }
  const site = await startSite({ port: 0, dataDir: path.join(dataDir, 'site'), modulesDir, log: () => {} });
  const base = `http://127.0.0.1:${site.port}`;
  const people = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    people.forEach((p) => p.socket?.close());
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
      this.states = [];
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
    async open() {
      if (!this.cookie) {
        const registered = await this.http('POST', '/api/auth/register', { username: this.name, password: `${this.name} password` });
        assert.equal(registered.status, 200, registered.data?.error);
        this.id = registered.data.user.id;
      }
      return this.connect();
    }
    async connect() {
      const socket = connect(`${base}/hearts`, { forceNew: true, extraHeaders: { cookie: this.cookie } });
      this.socket = socket;
      people.push(this);
      socket.on('state', (s) => {
        if (this.socket !== socket) return;
        this.state = s;
        this.states.push(s);
      });
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return this;
    }
    call(event, payload = {}) {
      return new Promise((resolve) => this.socket.emit(event, payload, resolve));
    }
    async create(settings = {}) {
      const reply = await this.call('create', settings);
      assert.equal(reply.ok, true, reply.error);
      this.code = reply.code;
      return reply;
    }
    async join(code) {
      const reply = await this.call('join', { code });
      if (reply.ok) this.code = code;
      return reply;
    }
    async stats() {
      return (await this.http('GET', '/api/stats/me')).data;
    }
    /** Does whatever this player has to do right now. Returns true if it acted. */
    async step() {
      const s = this.state;
      if (!s) return false;
      if (s.phase === 'passing' && !s.pass.chosen) {
        assert.equal((await this.call('pass', { cards: s.hand.slice(0, 3) })).ok, true);
        return true;
      }
      if (s.phase === 'playing' && s.legal) {
        const card = Object.keys(s.legal).find((c) => s.legal[c] === null);
        const reply = await this.call('play', { card });
        assert.equal(reply.ok, true, reply.error);
        return true;
      }
      if (s.phase === 'handEnd') {
        await this.call('next');
        return true;
      }
      return false;
    }
  }

  const person = (name) => new Person(name);
  return { site, base, dataDir, person, stop };
}

/** Plays every person's turns until all of them see the finished game. */
async function playToEnd(humans, { timeout = 60000 } = {}) {
  const started = Date.now();
  while (!humans.every((p) => p.state?.phase === 'finished')) {
    if (Date.now() - started > timeout) assert.fail(`the game did not finish: ${JSON.stringify(humans.map((p) => [p.name, p.state?.phase, p.state?.turn]))}`);
    let acted = false;
    for (const p of humans) acted = (await p.step()) || acted;
    if (!acted) await sleep(5);
  }
}

const extrasOf = (stats) => Object.fromEntries(stats.perGame[0].extras.map((e) => [e.key, e.value]));

/** Every card named anywhere in a payload is one that player may see. */
function assertNoLeaks(person) {
  for (const s of person.states) {
    if (!s) continue;
    const allowed = new Set([...(s.hand ?? []), ...(s.received ?? []), ...(s.pass?.chosen ?? []), ...(s.trick ?? []).map((p) => p.card), ...(s.lastTrick?.plays ?? []).map((p) => p.card), ...(s.deal?.removed ?? []), s.deal?.openingCard]); // the deal is public
    for (const card of JSON.stringify(s).match(CARD) ?? []) assert.ok(allowed.has(card), `${person.name} was sent ${card}, which is not theirs to see`);
    assert.ok(s.seats.every((seat) => !seat || !('hand' in seat)));
  }
}

test('one person and three computer players play a whole game; the result is recorded once', async (t) => {
  fast();
  const { person } = await launch(t);
  const ann = await person('ann').open();
  assert.equal((await ann.call('resume')).ok, true);
  assert.equal(ann.state, null, 'nothing to resume yet');
  await ann.create({ target: 50, jackOfDiamonds: true, moon: 'self' });
  assert.match(ann.code, /^[a-z]+-[a-z]+-[a-z]+$/);
  await until(() => ann.state?.phase === 'lobby', 'the lobby');
  assert.deepEqual(ann.state.settings, { target: 50, jackOfDiamonds: true, moon: 'self' });
  assert.equal((await ann.call('start')).ok, false, 'three seats are empty');
  assert.equal((await ann.call('fillBots')).ok, true);
  await until(() => ann.state.seats.every(Boolean), 'four seats');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.phase === 'passing', 'the deal');
  assert.equal(ann.state.hand.length, 13);
  assert.equal(ann.state.pass.direction, 'left');

  await playToEnd([ann]);
  const final = ann.state;
  assert.equal(final.phase, 'finished');
  assert.ok(final.scoreboard.players.some((p) => p.score >= 50));
  assert.equal(final.scoreboard.rounds.length, final.scoreboard.rounds.length);
  assert.equal(final.scoreboard.lowIsBetter, true);
  const mine = final.scoreboard.players.find((p) => p.isMe);
  const lowest = Math.min(...final.scoreboard.players.map((p) => p.score));
  assert.equal(final.winners.includes(final.you), mine.score === lowest);
  assertNoLeaks(ann);

  await sleep(100);
  const stats = await ann.stats();
  const [game] = stats.perGame;
  assert.equal(game.name, 'Hearts');
  assert.equal(game.played, 1, 'recorded exactly once');
  assert.equal(game.wins, mine.score === lowest ? 1 : 0);
  assert.equal(game.losses, mine.score === lowest ? 0 : 1);
  assert.equal(game.totalScore, mine.score);
  const extras = extrasOf(stats);
  assert.equal(extras.handsPlayed, final.scoreboard.rounds.length);
  assert.ok(extras.heartsTaken >= 0 && extras.heartsTaken <= 13 * extras.handsPlayed);
  assert.ok(extras.queensTaken >= 0 && extras.queensTaken <= extras.handsPlayed);
  assert.ok(extras.moonsShot >= 0);
  assert.equal(stats.recent[0].players, 1);
  assert.equal(stats.recent[0].placement, 1 + final.scoreboard.players.filter((p) => p.score < mine.score).length);

  assert.equal((await ann.call('again')).ok, true, 'back to the lobby');
  await until(() => ann.state.phase === 'lobby', 'the lobby again');
  assert.deepEqual(ann.state.scoreboard.rounds, []);
  await sleep(100);
  assert.equal((await ann.stats()).perGame[0].played, 1, 'going back does not record it again');
});

test('the lobby: invite codes, settings, seats, hosting and one game per account', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob, cat, dan, eve] = await Promise.all(['ann', 'bob', 'cat', 'dan', 'eve'].map((n) => person(n).open()));
  await ann.create();
  assert.equal((await bob.join('nonsense')).ok, false);
  assert.equal((await bob.join('boss-aware-you')).ok, false, 'no such game');
  assert.equal((await bob.join(ann.code)).ok, true);
  await until(() => ann.state.seats.filter(Boolean).length === 2, 'bob in the lobby');
  assert.deepEqual(ann.state.seats.map((s) => s?.name), ['ann', 'bob', undefined, undefined]);
  assert.equal(bob.state.you, 1);
  assert.equal(bob.state.hostSeat, 0);

  assert.equal((await bob.call('settings', { target: 150 })).ok, false, 'only the host');
  assert.equal((await bob.call('addBot')).ok, false);
  assert.equal((await ann.call('settings', { target: 77 })).ok, false);
  assert.equal((await ann.call('settings', { target: 150, moon: 'self', jackOfDiamonds: true, hostId: 5 })).ok, true);
  await until(() => bob.state.settings.target === 150, 'the settings to reach bob');
  assert.deepEqual(bob.state.settings, { target: 150, jackOfDiamonds: true, moon: 'self' });

  const again = await ann.call('create');
  assert.equal(again.ok, false, 'one game per account');
  assert.equal((await bob.call('create')).ok, false);

  assert.equal((await ann.call('addBot')).ok, true);
  await until(() => ann.state.seats[2]?.bot, 'a computer player');
  assert.equal((await cat.join(ann.code)).ok, true);
  await until(() => ann.state.seats[3]?.name === 'cat', 'the room is full of people and computers');
  assert.equal((await dan.join(ann.code)).ok, false, 'a full room');
  assert.equal((await ann.call('removeBot', { seat: 3 })).ok, false, 'a person is not removed like a computer player');
  assert.equal((await ann.call('removeBot', { seat: 2 })).ok, true);
  assert.equal((await dan.join(ann.code)).ok, true, 'the freed seat');
  assert.equal((await eve.join(ann.code)).ok, false);
});

test('the lobby: leaving, hosts, starting needs four seats, and a started game cannot be joined', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob, cat, dan] = await Promise.all(['ann', 'bob', 'cat', 'dan'].map((n) => person(n).open()));
  await ann.create();
  await bob.join(ann.code);
  await until(() => ann.state.seats[1], 'bob');
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'ann to be out');
  await until(() => bob.state.hostSeat === 1 && !bob.state.seats[0], 'bob to host');
  assert.equal((await bob.call('start')).ok, false, 'not four seats');
  assert.equal((await bob.call('fillBots')).ok, true);
  await until(() => bob.state.seats.every(Boolean), 'full');
  assert.equal((await bob.call('removeBot', { seat: 0 })).ok, true);
  assert.equal((await bob.call('addBot', { seat: 0 })).ok, true);
  assert.equal((await bob.call('start')).ok, true);
  await until(() => bob.state.phase === 'passing', 'passing');
  assert.equal((await cat.join(bob.code)).ok, false, 'already started');
  assert.equal((await ann.join(bob.code)).ok, false, 'a leaver cannot return');
  assert.equal((await cat.call('play', { card: '2C' })).ok, false, 'an outsider cannot act');
  assert.equal((await dan.call('pass', { cards: ['2C', '3C', '4C'] })).ok, false);
  assert.equal((await bob.call('pass', { cards: ['2C', '2C', '2C'] })).ok, false);
  assert.equal((await bob.call('pass', { cards: 'nonsense' })).ok, false);
  assert.equal((await bob.call('play', { card: bob.state.hand[0] })).ok, false, 'cannot play while passing');
  assert.equal((await bob.call('settings', { target: 50 })).ok, false, 'settings are fixed once started');
});

test('hands stay hidden: nobody is ever sent a card they may not see', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => person(n).open()));
  await ann.create({ target: 50 });
  await bob.join(ann.code);
  await until(() => ann.state.seats[1], 'bob');
  await ann.call('fillBots');
  await ann.call('start');
  await playToEnd([ann, bob]);
  assert.ok(ann.states.length > 50 && bob.states.length > 50);
  assertNoLeaks(ann);
  assertNoLeaks(bob);
  const seen = new Set();
  for (const s of ann.states) if (s?.hand) s.hand.forEach((c) => seen.add(c));
  assert.ok(seen.size > 13, 'the test did see many different hands');
  // Bob's hand is never in Ann's payloads except when public: check one concrete moment.
  const moment = ann.states.find((s) => s?.phase === 'playing' && s.hand.length === 13);
  assert.ok(moment);
  const bobsThen = bob.states.find((s) => s?.phase === 'playing' && s.hand.length === 13 && s.trick.length === moment.trick.length);
  const text = JSON.stringify(moment);
  for (const card of bobsThen.hand.filter((c) => !moment.hand.includes(c) && !moment.trick.some((p) => p.card === c) && c !== moment.deal.openingCard)) assert.ok(!text.includes(`"${card}"`));

  const stats = await Promise.all([ann.stats(), bob.stats()]);
  for (const s of stats) assert.equal(s.perGame[0].played, 1);
  assert.equal(stats[0].recent[0].players, 2);
});

test('the host chooses the number of players: a six-player game of one person and five computers', async (t) => {
  fast();
  const { person } = await launch(t);
  const ann = await person('ann').open();
  assert.equal((await ann.call('create', { seats: 8 })).ok, false, 'eight seats is too many');
  assert.equal((await ann.call('create', { seats: 2 })).ok, false, 'two seats is too few');
  await ann.create({ seats: 6 });
  await until(() => ann.state?.phase === 'lobby', 'the lobby');
  assert.equal(ann.state.seatCount, 6);
  assert.equal(ann.state.seats.length, 6);
  assert.deepEqual([ann.state.limits.minSeats, ann.state.limits.maxSeats], [3, 7]);
  assert.equal((await ann.call('settings', { seats: 9 })).ok, false);
  assert.equal((await ann.call('settings', { seats: 5 })).ok, true);
  await until(() => ann.state.seatCount === 5, 'five seats');
  assert.equal((await ann.call('settings', { seats: 6 })).ok, true);
  assert.equal((await ann.call('fillBots')).ok, true);
  await until(() => ann.state.seats.every(Boolean), 'six seats');
  assert.equal((await ann.call('settings', { seats: 3 })).ok, false, 'cannot shrink below the seated players');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.phase === 'passing', 'the deal');
  assert.equal(ann.state.hand.length, 8);
  assert.equal(ann.state.pass.cards, 2);
  assert.equal(ann.state.deal.removed.length, 4);
  assert.equal((await ann.call('settings', { seats: 4 })).ok, false, 'not once started');
});

test('reconnects: a second socket, a new socket and a resume all find the same game', async (t) => {
  fast();
  process.env.HEARTS_BOT_DELAY = '5-10';
  const { person } = await launch(t);
  const ann = await person('ann').open();
  await ann.create({ target: 50 });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'passing', 'passing');

  const phone = person('ann');
  phone.cookie = ann.cookie;
  await phone.connect();
  assert.equal((await phone.call('resume')).ok, true);
  await until(() => phone.state?.phase === 'passing', 'the phone to see the game');
  assert.deepEqual(phone.state.hand, ann.state.hand);
  assert.equal(phone.state.you, 0);
  assert.equal((await phone.call('resume', { code: 'boss-aware-you' })).ok, false, 'one game per account, whatever code is asked for');

  assert.equal((await phone.call('pass', { cards: phone.state.hand.slice(0, 3) })).ok, true);
  // The computers may already have passed, in which case the hand moves straight on to the play.
  await until(() => ann.state.pass.chosen || ann.state.phase === 'playing', 'both sockets to see the pass');
  await until(() => phone.state.phase === ann.state.phase, 'both sockets to agree');
  assert.deepEqual(ann.state.pass.chosen, phone.state.pass.chosen);

  ann.socket.close();
  await sleep(50);
  assert.equal(phone.state.seats[0].online, true, 'still online through the phone');
  const back = person('ann');
  back.cookie = ann.cookie;
  await back.connect();
  await back.call('resume', { code: ann.code });
  await until(() => back.state?.phase, 'the state after resuming');
  assert.equal(back.state.code, ann.code);

  // Everything still works from the new socket, and from both at once.
  for (let i = 0; i < 1500 && back.state.phase !== 'finished'; i++) {
    for (const p of [back, phone]) await p.step().catch(() => {});
    await sleep(3);
  }
  assert.equal(back.state.phase, 'finished');
  await sleep(100);
  assert.equal((await back.stats()).perGame[0].played, 1);
});

test('two rooms at once do not interfere', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob, cat, dan] = await Promise.all(['ann', 'bob', 'cat', 'dan'].map((n) => person(n).open()));
  await ann.create({ target: 50 });
  await cat.create({ target: 100 });
  assert.notEqual(ann.code, cat.code);
  await bob.join(ann.code);
  await dan.join(cat.code);
  for (const host of [ann, cat]) await host.call('fillBots');
  await until(() => ann.state.seats.every(Boolean) && cat.state.seats.every(Boolean), 'both rooms full');
  assert.deepEqual(ann.state.seats.map((s) => s.name).filter((n) => ['ann', 'bob'].includes(n)), ['ann', 'bob']);
  assert.ok(!cat.state.seats.some((s) => ['ann', 'bob'].includes(s.name)));
  await ann.call('start');
  await sleep(30);
  assert.equal(cat.state.phase, 'lobby', 'the other room has not started');
  await cat.call('start');
  await Promise.all([playToEnd([ann, bob]), playToEnd([cat, dan])]);
  assert.equal(ann.state.settings.target, 50);
  assert.equal(cat.state.settings.target, 100);
  assert.ok(ann.state.scoreboard.players.some((p) => p.score >= 50));
  assert.ok(cat.state.scoreboard.players.some((p) => p.score >= 100));
  await sleep(100);
  for (const p of [ann, bob, cat, dan]) assert.equal((await p.stats()).perGame[0].played, 1);
  assert.equal((await ann.stats()).recent[0].players, 2);
});

test('a human who leaves mid-game is replaced by a computer, is not recorded, and the game goes on', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => person(n).open()));
  await ann.create({ target: 50 });
  await bob.join(ann.code);
  await cat.join(ann.code);
  await until(() => ann.state.seats[2], 'cat');
  await ann.call('addBot');
  await ann.call('start');
  await until(() => ann.state.phase === 'passing', 'the game');
  for (let i = 0; i < 20; i++) for (const p of [ann, bob, cat]) await p.step();
  assert.equal((await cat.call('leave')).ok, true);
  await until(() => cat.state === null, 'cat to be out');
  await until(() => ann.state.seats[2].bot, 'a computer in cat\'s seat');
  assert.equal(ann.state.seats[2].name !== 'cat', true);
  assert.equal((await cat.call('resume')).ok, true);
  assert.equal(cat.state, null, 'there is nothing to go back to');
  assert.equal((await cat.join(ann.code)).ok, false);
  await playToEnd([ann, bob]);
  await sleep(100);
  assert.equal((await ann.stats()).perGame[0].played, 1);
  assert.equal((await bob.stats()).perGame[0].played, 1);
  assert.equal((await cat.stats()).perGame.length, 0, 'the leaver is not recorded');
  assert.equal((await ann.stats()).recent[0].players, 2);
});

test('when the last human leaves the room is dropped and nothing is recorded', async (t) => {
  fast();
  process.env.HEARTS_BOT_DELAY = '5-10';
  const { person } = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => person(n).open()));
  await ann.create({ target: 50 });
  await bob.join(ann.code);
  await until(() => ann.state.seats[1], 'bob');
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'passing', 'the game');
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => ann.state.seats[1].bot, 'a computer for bob');
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'ann to be out');
  await sleep(150);
  assert.equal((await bob.join(ann.code)).ok, false, 'the room is gone');
  assert.equal((await ann.stats()).perGame.length, 0);
  assert.equal((await bob.stats()).perGame.length, 0);
  assert.equal((await ann.call('create')).ok, true, 'free to start another');
});

test('a restart loses nothing: the room comes back and the computer players carry on', async (t) => {
  fast();
  process.env.HEARTS_BOT_DELAY = '15-25';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-restart-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.create({ target: 50 });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state?.phase === 'passing', 'the game');
  assert.equal((await ann.call('pass', { cards: ann.state.hand.slice(0, 3) })).ok, true);
  await until(() => ann.state.phase === 'playing', 'the play to begin');
  for (let i = 0; i < 40 && ann.state.phase === 'playing'; i++) {
    await ann.step();
    await sleep(25);
  }
  const code = ann.code;
  const before = ann.state;
  assert.ok(before.phase === 'playing' || before.phase === 'handEnd');
  const cookie = ann.cookie;
  await first.stop();

  const second = await launch(t, { dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  assert.equal((await again.call('resume')).ok, true);
  await until(() => again.state?.phase, 'the saved game');
  assert.equal(again.state.code, code);
  assert.deepEqual(again.state.settings, before.settings);
  assert.equal(again.state.seats.length, 4);
  assert.ok(again.state.seats.slice(1).every((s) => s.bot));
  assert.deepEqual(again.state.seats.map((s) => s.ai), before.seats.map((s) => s.ai), 'every computer player keeps its AI over a restart');
  assert.ok(again.state.seats.slice(1).every((s) => s.ai?.id && s.ai?.name));
  assert.ok(again.state.hand.length > 0 || again.state.phase === 'handEnd');
  if (before.phase === 'playing') assert.equal(again.state.scoreboard.rounds.length, before.scoreboard.rounds.length);

  // The computer players' turns resume by themselves: let the human move only when it is their turn.
  process.env.HEARTS_BOT_DELAY = '0-3';
  await playToEnd([again]);
  assert.equal(again.state.phase, 'finished');
  assert.ok(again.state.scoreboard.rounds.length >= 1);
  await sleep(100);
  assert.equal((await again.stats()).perGame[0].played, 1);
});

test('a restart after the game has finished does not record it a second time', async (t) => {
  fast();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-restart2-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.create({ target: 50 });
  await ann.call('fillBots');
  await ann.call('start');
  await playToEnd([ann]);
  await sleep(150);
  const cookie = ann.cookie;
  const code = ann.code;
  await first.stop();
  const second = await launch(t, { dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  await again.call('resume', { code }); // a finished game is only resumed with its code
  await until(() => again.state?.phase === 'finished', 'the finished game');
  await sleep(150);
  assert.equal((await again.stats()).perGame[0].played, 1);
});
