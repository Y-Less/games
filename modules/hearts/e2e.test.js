// Hearts against the real site: accounts over HTTP, sockets, computer players on timers, statistics, and restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../../server/index.js';
import { assertNoLeaks as assertNoLeaks_ } from '../../shared/leaks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const platform = path.resolve(here, '..', '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CARD = /\b(?:[2-9]|10|[JQKA])[CDHS]\b/g;

const fast = () => {
  process.env.HEARTS_BOT_DELAY = '0-3';
  process.env.HEARTS_TRICK_PAUSE = '0';
};

const DEADLINE = 20000;

async function until(condition, what, { timeout = DEADLINE } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await condition()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

/**
 * The same patience `until` has, for the waits that are not polling loops.  Those give up by themselves; these are the
 * ones that would otherwise wait for ever on a site that accepts a request and never answers it.
 * @template T @param {Promise<T>} promise @param {string} what @param {{ timeout?: number }} [options] @returns {Promise<T>}
 */
async function withDeadline(promise, what, { timeout = DEADLINE } = {}) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeout}ms waiting for: ${what}`)), timeout);
  });
  try {
    return await Promise.race([promise, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The site with only this module, copied (with the shared files it imports) into a temporary folder.
 * Pass an existing { dataDir } to restart on the same data.
 */
async function launch(t, { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-e2e-')), keep = false } = {}) {
  const modulesDir = path.join(dataDir, 'copy', 'modules');
  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(path.join(modulesDir, 'hearts'), { recursive: true });
    // (every non-test file, not a short list: a list breaks silently whenever the module gains a file, and the
    // copied site then dies on an import the test can only see as a server that never answers)
    for (const file of fs.readdirSync(path.join(here), { withFileTypes: true })) {
      if (!file.isFile() || file.name.endsWith('.test.js')) continue;
      fs.copyFileSync(path.join(here, file.name), path.join(modulesDir, 'hearts', file.name));
    }
    fs.cpSync(path.join(here, 'ai'), path.join(modulesDir, 'hearts', 'ai'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'copy', 'shared'), { recursive: true });
    for (const file of fs.readdirSync(path.join(platform, 'shared'))) {
      if (file.endsWith('.js') && !file.endsWith('.test.js')) fs.copyFileSync(path.join(platform, 'shared', file), path.join(dataDir, 'copy', 'shared', file));
    }
  }
  const starting = startSite({ port: 0, dataDir: path.join(dataDir, 'site'), modulesDir, log: () => {} });
  const site = await withDeadline(starting, 'the site to start').catch((error) => {
    // If it does start, eventually, do not leave it listening: the test file would have nothing left to do and still
    // never exit.  (The catch also keeps a late rejection from being an unhandled one.)
    starting.then((late) => late.close(), () => {});
    throw error;
  });
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

  // The site starts whether or not its games do: `loadModules` prints a module that fails to load and carries on, which
  // is right for a live site with sixteen of them and wrong for a test with one.  The namespace is made before the
  // module is imported, so what is left accepts connections and answers nothing — every later call would sit on its
  // deadline in turn.  Say it once, here, while the reason loadModules printed is still the last thing on screen.
  const config = await withDeadline(fetch(`${base}/api/config`).then((r) => r.json()), 'the site to list its games');
  assert.ok(config.games?.some((g) => g.id === 'hearts'), 'the hearts module did not load; its error is printed above');

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
      await withDeadline(new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      }), `${this.name} to connect`);
      return this;
    }
    call(event, payload = {}) {
      return withDeadline(new Promise((resolve) => this.socket.emit(event, payload, resolve)), `the site to answer "${event}" for ${this.name}`);
    }
    async create(settings = {}) {
      // A room now opens as big as the game allows; these tests mean the usual four unless they say otherwise.
      const reply = await this.call('create', { seats: 4, ...settings });
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
    /** Does whatever this player has to do right now.  Returns true if it acted. */
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
    assertNoLeaks_(s, { allowed, pattern: CARD, who: person.name });
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
  // Achievements: every card the person played counts (13 a hand), and the game's own ones follow its statistics.
  const { sections } = (await ann.http('GET', '/api/achievements')).data;
  const achievement = (id) => sections.flatMap((section) => section.achievements).find((a) => a.id === id);
  assert.equal(achievement('global.cards').value, 13 * extras.handsPlayed);
  assert.equal(achievement('global.games').value, 1);
  assert.equal(achievement('hearts.moon').value, extras.moonsShot);
  assert.equal(achievement('hearts.jack').value, extrasOf(stats).jacksTaken ?? 0);
  assert.equal(achievement('hearts.perfect').value, mine.score <= 0 ? 1 : 0);
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

  const again = await ann.call('create', { seats: 4 });
  assert.equal(again.ok, false, 'one game per account');
  assert.equal((await bob.call('create')).ok, false);

  assert.equal((await ann.call('addBot')).ok, true);
  await until(() => ann.state.seats[2]?.bot, 'a computer player');
  assert.equal((await cat.join(ann.code)).ok, true);
  await until(() => ann.state.seats[3]?.name === 'cat', 'the room is full of people and computers');
  assert.equal((await dan.join(ann.code)).ok, false, 'a full room');
  assert.equal((await ann.call('removeBot', { slot: 's3' })).ok, false, 'a person is not removed like a computer player');
  assert.equal((await ann.call('removeBot', { slot: 's2' })).ok, true);
  assert.equal((await dan.join(ann.code)).ok, true, 'the freed seat');
  assert.equal((await eve.join(ann.code)).ok, false);
});

test('the table can vote somebody out, and they do not come back on the invitation', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob, cat, dan] = await Promise.all(['ann', 'bob', 'cat', 'dan'].map((n) => person(n).open()));
  await ann.create();
  for (const who of [bob, cat, dan]) await who.join(ann.code);
  await until(() => ann.state.seats.every(Boolean), 'four people');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.phase === 'passing', 'passing');
  const danSeat = ann.state.seats.find((s) => s.name === dan.name)?.seat ?? 3;

  // Nobody has been voted on yet, so nothing is in the view.
  assert.equal(ann.state.vote, undefined);
  assert.equal((await bob.call('voteAnswer', { agree: true })).error, 'noVoteRunning');

  // Ann asks, which is a yes from her; three people may vote, so two are needed.
  assert.equal((await ann.call('voteKick', { slot: `s${danSeat}` })).ok, true);
  await until(() => [ann, bob, cat, dan].every((who) => who.state?.vote), 'the vote to reach everybody');
  // The vote names people by their slot, which is the same word every game uses for a place (shared/layout.js).
  assert.deepEqual(ann.state.vote, { target: `s${danSeat}`, by: `s${ann.state.you}`, yes: 1, no: 0, needed: 2, answered: true, mine: true });
  assert.deepEqual(cat.state.vote.answered, null, 'Cat has not answered');
  assert.equal(dan.state.vote.target, `s${danSeat}`, 'and the one being voted on can see it too');

  assert.equal((await dan.call('voteAnswer', { agree: false })).error, 'cannotVoteOnYourself');
  assert.equal((await bob.call('voteKick', { slot: 's0' })).error, 'voteAlreadyRunning');

  // Bob agrees, which carries it: a computer player takes Dan's seat, as when anybody leaves.
  assert.deepEqual(await bob.call('voteAnswer', { agree: true }), { ok: true, passed: true });
  await until(() => ann.state.seats[danSeat].bot, 'a computer player in his seat');
  assert.equal(ann.state.vote, undefined, 'and the vote is over');
  await until(() => dan.state === null, 'Dan to be sent back to the menu');

  // And the invitation does not let him straight back in.
  assert.equal((await dan.join(ann.code)).error, 'removedFromGame');
  assert.equal(ann.state.seats[danSeat].bot, true, 'his seat is still the computer player’s');
});

test('coming late to the invitation: a newcomer takes a computer player seat, and a leaver gets their own back', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => person(n).open()));
  await ann.create();
  await bob.join(ann.code);
  await until(() => ann.state.seats[1], 'bob');
  assert.equal((await ann.call('fillBots')).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.phase === 'passing', 'passing');

  // Bob drops out and a computer player keeps his seat warm.
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => ann.state.seats[1].bot, "a computer in bob's seat");
  const kept = ann.state.seats[1].name;

  // Cat has only just opened the invitation.  She takes a seat nobody is being waited for in.
  assert.equal((await cat.join(ann.code)).ok, true);
  await until(() => cat.state?.you !== undefined, 'cat to be seated');
  assert.notEqual(cat.state.you, 1, "cat does not take the seat being kept for bob");
  assert.equal(ann.state.seats[cat.state.you].bot, false, 'she is a person in it now');

  // And bob comes back to his own seat, with the hand he left on it.
  assert.equal((await bob.join(ann.code)).ok, true);
  await until(() => bob.state?.you === 1, 'bob back in his own seat');
  assert.equal(ann.state.seats[1].bot, false, 'which is nobody’s stand-in any more');
  assert.notEqual(ann.state.seats[1].name, kept, 'and goes by his name again');
  assert.equal(bob.state.hand.length, 13, 'his cards were waiting for him');
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
  assert.equal((await bob.call('removeBot', { slot: 's0' })).ok, true);
  assert.equal((await bob.call('addBot', { seat: 0 })).ok, true);
  assert.equal((await bob.call('start')).ok, true);
  await until(() => bob.state.phase === 'passing', 'passing');
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
  assert.equal((await ann.call('fillBots', { count: 6 })).ok, true);
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
  // The snapshot has to be taken when the server has nothing of its own to do, or a computer player can finish the hand
  // between taking it and the shutdown below, and the restart then looks as though it gained a round.  On Ann's turn
  // nothing is pending — no computer player is waiting and no trick is resolving — so the room cannot move under us.
  await until(async () => {
    if (ann.state.phase === 'playing' && ann.state.legal) return true;
    await ann.step();
    return false;
  }, "Ann's turn, with the room waiting on her");
  const before = ann.state;
  assert.equal(before.phase, 'playing');
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
  assert.equal(again.state.scoreboard.rounds.length, before.scoreboard.rounds.length);

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

test('a site whose game did not load fails the test at once, instead of answering nothing for ever', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearts-e2e-unloadable-'));
  const moduleDir = path.join(dataDir, 'copy', 'modules', 'hearts');
  fs.mkdirSync(moduleDir, { recursive: true });
  // `launch` copies the module only when the folder is not already there, so this stands in for the copy: the real
  // manifest, because the loader insists the id matches the folder, and a server.js importing a file that was not
  // copied.  That is what a missing bot.js was, and the loader will print it to stderr below — that noise is the point.
  fs.copyFileSync(path.join(here, 'module.json'), path.join(moduleDir, 'module.json'));
  fs.writeFileSync(path.join(moduleDir, 'server.js'), "import './was-not-copied.js';\n\nexport default () => ({});\n");

  const started = Date.now();
  await assert.rejects(launch(t, { dataDir }), /hearts module did not load/);
  const took = Date.now() - started;
  assert.ok(took < DEADLINE / 2, `it should say so as soon as the site is up, not sit on a deadline; it took ${took}ms`);
});
