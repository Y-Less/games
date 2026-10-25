// Cribbage against the real site: accounts over HTTP, games over sockets, computer players, statistics and restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from '../../server/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.CRIBBAGE_BOT_DELAY = '0-3';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, what, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await condition()) return;
    await sleep(15);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

const CARD = /"(?:10|[2-9JQKA])[CDHS]"/g;

/** Starts the site with only this module (linked into a temporary modules folder) and a data folder. */
async function launch(t, { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cribbage-e2e-')), keep = false } = {}) {
  // The module and the shared folder it imports from, copied so that the site loads only this module.
  const modulesDir = path.join(dataDir, 'platform', 'modules');
  if (!fs.existsSync(modulesDir)) {
    fs.cpSync(here, path.join(modulesDir, 'cribbage'), { recursive: true });
    fs.cpSync(path.join(here, '..', '..', 'shared'), path.join(dataDir, 'platform', 'shared'), { recursive: true });
  }
  const site = await startSite({ port: 0, dataDir: path.join(dataDir, 'site'), modulesDir, log: () => {} });
  const base = `http://127.0.0.1:${site.port}`;
  const everyone = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    everyone.forEach((p) => p.sockets.forEach((s) => s.close()));
    await site.close();
  };
  t.after(async () => {
    await stop();
    if (!keep) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  class Person {
    constructor(name) {
      this.name = name;
      this.cookie = '';
      this.sockets = [];
      this.state = null;
      this.states = [];
      this.autoplay = false;
      this.lastActed = '';
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
    /** Registers the account (once) and opens a socket. */
    async open() {
      if (!this.cookie) {
        const registered = await this.http('POST', '/api/auth/register', { username: this.name, password: `${this.name} password` });
        assert.equal(registered.status, 200, registered.data?.error);
        this.id = registered.data.user.id;
      }
      return this.connect();
    }
    async connect() {
      if (!everyone.includes(this)) everyone.push(this);
      const socket = connect(`${base}/cribbage`, { forceNew: true, extraHeaders: { cookie: this.cookie } });
      this.sockets.push(socket);
      socket.on('state', (s) => {
        this.state = s;
        this.states.push(s);
        if (this.autoplay) this.act(s, socket);
      });
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      this.socket = socket;
      return this;
    }
    call(event, payload = {}, socket = this.socket) {
      return new Promise((resolve) => socket.emit(event, payload, resolve));
    }
    /** A scripted human: discards its first cards, plays its first legal card and presses ready. */
    act(s, socket) {
      if (!s) return;
      const key = `${s.phase}/${s.handNo}/${s.hand.length}/${s.play?.count}/${s.play?.sequence.length}/${s.seats[s.you]?.ready}`;
      if (key === this.lastActed) return;
      if (s.phase === 'discard' && s.need) this.call('discard', { cards: s.hand.slice(0, s.need) }, socket);
      else if (s.phase === 'play' && s.play.turn === s.you && s.play.playable.length) this.call('play', { card: s.play.playable[0] }, socket);
      else if (s.phase === 'show' && !s.seats[s.you].ready) this.call('ready', {}, socket);
      else return;
      this.lastActed = key;
    }
    /** Another connection (another device) for the same account. */
    again() {
      const other = new Person(this.name);
      other.cookie = this.cookie;
      other.id = this.id;
      return other;
    }
    stats() {
      return this.http('GET', '/api/stats/me').then((r) => r.data);
    }
    /** Waits until the server has told this person they are out of the game. */
    gone() {
      return until(() => this.states.length && this.state === null, `${this.name}: to be out of the game`);
    }
    until(predicate, what) {
      return until(() => this.state && predicate(this.state), `${this.name}: ${what}`);
    }
    async create(settings = {}) {
      const reply = await this.call('create', settings);
      assert.ok(reply.ok, reply.error);
      this.code = reply.code;
      return reply.code;
    }
    async join(code) {
      const reply = await this.call('join', { code });
      if (reply.ok) this.code = reply.code;
      return reply;
    }
  }
  const person = (name) => new Person(name);
  return { site, base, person, stop, dataDir };
}

const cardsIn = (value) => new Set((JSON.stringify(value).match(CARD) ?? []).map((c) => c.slice(1, -1)));

/** No state a person was ever sent may contain a card they are not entitled to see. */
function assertNoLeaks(person) {
  for (const s of person.states) {
    if (!s) continue;
    const text = JSON.stringify(s);
    for (const key of ['"hands":', '"kept":', '"crib":', '"deck":']) assert.ok(!text.includes(key), `${key} is never sent`);
    const allowed = new Set([...s.hand, ...(s.starter ? [s.starter] : []), ...(s.play ? [...s.play.sequence.map((x) => x.card), ...s.play.previous] : [])]);
    for (const entry of s.show?.entries ?? []) for (const card of [...entry.cards, ...entry.items.flatMap((i) => i.cards)]) allowed.add(card);
    for (const card of cardsIn(s)) assert.ok(allowed.has(card), `${person.name} was sent ${card} in phase ${s.phase}`);
    if (s.phase === 'discard' || s.phase === 'play') assert.ok(s.seats.every((seat) => typeof seat.cards === 'number'));
  }
}

function assertHistoryAddsUp(state) {
  const sums = state.seats.map((_, i) => state.scoreboard.rounds.reduce((total, round) => total + (round.deltas[i] ?? 0), 0));
  assert.deepEqual(sums, state.seats.map((s) => s.score), 'the rounds add up to the final scores');
  assert.deepEqual(sums, state.scoreboard.players.map((p) => p.score));
}

/** A room for `humans` (the first is the host) and computer players, started, with scripted humans. */
async function startGame(humans, { seats = humans.length, target = 61, autoplay = true } = {}) {
  const [host, ...rest] = humans;
  const code = await host.create({ seats, target });
  for (const p of rest) assert.ok((await p.join(code)).ok);
  assert.ok((await host.call('fillBots')).ok);
  await host.until((s) => s.seats.length === seats, 'all seats filled');
  humans.forEach((p) => (p.autoplay = autoplay));
  assert.ok((await host.call('start')).ok);
  return code;
}

for (const seats of [2, 3, 4]) {
  test(`a whole game with ${seats} seats: one human, computer players, statistics and no leaks`, async (t) => {
    const { person } = await launch(t);
    const alex = await person(`alex${seats}`).open();
    await startGame([alex], { seats, target: seats === 3 ? 121 : 61 });
    await alex.until((s) => s.phase === 'discard' || s.phase === 'play', 'dealt');
    await alex.until((s) => s.phase === 'finished', 'the game to finish');
    const final = alex.state;
    assert.equal(final.seats.filter((s) => s.score >= final.target).length, 1);
    assert.equal(final.seats[final.winner].score, final.target);
    assertHistoryAddsUp(final);
    assert.equal(final.scoreboard.rounds.length, final.handNo);
    assertNoLeaks(alex);

    const need = seats === 2 ? 2 : 1;
    const firstDeal = alex.states.find((s) => s.phase === 'discard');
    assert.equal(firstDeal.need, need);
    assert.equal(firstDeal.hand.length, seats === 2 ? 6 : 5);
    assert.equal(firstDeal.cribCount, seats === 3 ? 1 : 0);

    const stats = await alex.stats();
    const [cribbage] = stats.perGame;
    assert.equal(cribbage.game, 'cribbage');
    assert.equal(cribbage.played, 1);
    const won = final.winner === final.you;
    assert.equal(cribbage.wins, won ? 1 : 0);
    assert.equal(cribbage.losses, won ? 0 : 1);
    assert.equal(cribbage.totalScore, final.seats[final.you].score);
    const extra = Object.fromEntries(cribbage.extras.map((e) => [e.key, e.value]));
    assert.equal(extra.handsPlayed, final.handNo);
    assert.ok(extra.pegPoints > 0 && extra.bestHand >= 0 && extra.skunks >= 0);
    await sleep(150);
    assert.equal((await alex.stats()).perGame[0].played, 1, 'recorded only once');
  });
}

test('two humans and two computer players: everyone is recorded with placements and one winner', async (t) => {
  const { person } = await launch(t);
  const [ann, bob] = [await person('ann').open(), await person('bob').open()];
  await startGame([ann, bob], { seats: 4, target: 61 });
  await ann.until((s) => s.phase === 'finished', 'the game to finish');
  await bob.until((s) => s.phase === 'finished', 'bob to see the end');
  assert.deepEqual(ann.state.scoreboard.rounds, bob.state.scoreboard.rounds, 'the same history for everyone');
  assertHistoryAddsUp(ann.state);
  assertHistoryAddsUp(bob.state);
  assert.equal(ann.state.you, 0);
  assert.equal(bob.state.you, 1);
  assertNoLeaks(ann);
  assertNoLeaks(bob);

  const results = [await ann.stats(), await bob.stats()].map((s) => s.perGame[0]);
  assert.deepEqual(results.map((r) => r.played), [1, 1]);
  const wins = results.reduce((n, r) => n + r.wins, 0);
  assert.equal(wins, ann.state.winner < 2 ? 1 : 0, 'at most one human can win, and only if the winner is a person');
  assert.equal(results[0].totalScore, ann.state.seats[0].score);
  assert.equal(results[1].totalScore, bob.state.seats[1].score);
  for (const [i, person] of [ann, bob].entries()) {
    const recent = (await person.stats()).recent[0];
    assert.equal(recent.placement, ann.state.placements[i]);
  }
});

test('lobby rules: host only, full seats, a full room and a started room refuse newcomers', async (t) => {
  const { person } = await launch(t);
  const [host, guest, third, fourth] = [await person('host').open(), await person('guest').open(), await person('third').open(), await person('fourth').open()];
  const code = await host.create({ seats: 3 });
  assert.equal(host.state.phase, 'lobby');
  assert.equal(host.state.target, 121);
  assert.equal((await host.call('start')).ok, false, 'not every seat is filled');
  assert.ok((await guest.join(code)).ok);
  assert.equal((await guest.call('addBot')).ok, false, 'only the host');
  assert.equal((await guest.call('start')).ok, false);
  assert.equal((await guest.call('settings', { target: 61 })).ok, false);
  assert.ok((await host.call('settings', { target: 61 })).ok);
  await guest.until((s) => s.target === 61, 'the new target');
  assert.equal((await host.call('settings', { seats: 9 })).ok, false);
  assert.ok((await third.join(code)).ok);
  assert.equal((await fourth.join(code)).ok, false, 'the room is full');
  assert.equal(fourth.state, null);
  assert.equal((await host.call('addBot')).ok, false, 'no free seat');
  assert.ok((await host.call('kick', { seat: 2 })).ok);
  await third.gone();
  assert.ok((await host.call('addBot')).ok);
  assert.equal(host.state.seats.filter((s) => s.bot).length, 1);
  assert.ok((await host.call('removeBot', { seat: 2 })).ok);
  assert.ok((await host.call('fillBots')).ok);
  assert.ok((await host.call('start')).ok);
  await guest.until((s) => s.phase === 'discard', 'the game to start');
  assert.equal((await fourth.join(code)).ok, false, 'already started');
  assert.equal((await host.call('create')).ok, false, 'already in a game');
  assert.equal((await host.call('join', { code: 'not a code' })).ok, false);
  assert.match((await host.call('join', { code: 'boss-aware-you' })).error, /already in the game/);
  assert.equal((await fourth.call('resume', { code: 'boss-aware-you' })).ok, false, 'no such game');
});

test('bad requests are refused without harm', async (t) => {
  const { person } = await launch(t);
  const alex = await person('alex').open();
  await startGame([alex], { seats: 2, autoplay: false });
  await alex.until((s) => s.phase === 'discard', 'dealt');
  const before = JSON.stringify(alex.state.hand);
  for (const payload of [{}, { cards: 'AS' }, { cards: ['AS', 'AS'] }, { cards: [1, 2] }, { cards: ['ZZ', 'QQ'] }, null, 7]) {
    assert.equal((await alex.call('discard', payload)).ok, false);
  }
  assert.equal((await alex.call('play', { card: 'AS' })).ok, false);
  assert.equal((await alex.call('ready')).ok, false);
  assert.ok(alex.state, 'still in the game');
  assert.equal(JSON.stringify(alex.state.hand), before, 'nothing changed');
}, { timeout: 20000 });

test('reconnecting: several sockets for one account, and a new connection picks the game up', async (t) => {
  const { person } = await launch(t);
  const alex = await person('alex').open();
  const first = alex.socket;
  const code = await startGame([alex], { seats: 2, target: 121, autoplay: false });
  await alex.until((s) => s.phase === 'discard', 'dealt');

  const phone = await alex.again().connect();
  assert.ok((await phone.call('resume', {})).ok);
  await until(() => phone.state?.code === code, 'the second socket to get the game');
  assert.deepEqual(phone.state.hand, alex.state.hand, 'both sockets see the same hand');
  const handBefore = alex.state.hand;
  const second = phone.socket;

  assert.ok((await alex.call('discard', { cards: handBefore.slice(0, 2) }, first)).ok);
  await until(() => phone.state.need === 0 && phone.state.hand.length === 4, 'the other socket to update');
  first.close();
  await sleep(50);
  assert.ok(phone.state.seats[0].online, 'still online through the other socket');

  second.close();
  await sleep(50);
  const back = alex.again();
  back.autoplay = true;
  await back.connect();
  assert.equal(back.state, null, 'a fresh socket knows nothing until it asks');
  const reply = await back.call('resume', {});
  assert.equal(reply.code, code);
  await until(() => back.state?.code === code, 'the game after reconnecting');
  assert.equal(back.state.hand.length === 4 || back.state.phase !== 'discard', true);
  await until(() => back.state.phase === 'finished' || back.state.phase === 'discard', 'progress');
  await back.until((s) => s.phase === 'finished', 'the game to finish by itself');
  assertHistoryAddsUp(back.state);
  assertNoLeaks(back);
}, { timeout: 90000 });

test('concurrent rooms are independent', async (t) => {
  const { person } = await launch(t);
  const alice = await person('alice').open();
  const bruno = await person('bruno').open();
  const codes = [await startGame([alice], { seats: 2 }), await startGame([bruno], { seats: 3 })];
  assert.notEqual(codes[0], codes[1]);
  await Promise.all([alice.until((s) => s.phase === 'finished', 'alice finishes'), bruno.until((s) => s.phase === 'finished', 'bruno finishes')]);
  assert.equal(alice.state.seats.length, 2);
  assert.equal(bruno.state.seats.length, 3);
  assert.ok(alice.state.seats.every((s) => !s.name.includes('bruno')));
  assertHistoryAddsUp(alice.state);
  assertHistoryAddsUp(bruno.state);
  assertNoLeaks(alice);
  assertNoLeaks(bruno);
  assert.equal((await alice.stats()).perGame[0].played, 1);
  assert.equal((await bruno.stats()).perGame[0].played, 1);
});

test('a human leaving mid-game is replaced by a computer player; the others carry on and only they are recorded', async (t) => {
  const { person } = await launch(t);
  const [host, leaver] = [await person('host').open(), await person('leaver').open()];
  const code = await host.create({ seats: 3, target: 61 });
  await leaver.join(code);
  await host.call('fillBots');
  await host.call('start');
  await host.until((s) => s.phase === 'discard', 'dealt');
  assert.ok((await leaver.call('leave')).ok);
  await leaver.gone();
  await host.until((s) => s.seats[1].bot && s.seats[1].replaced, 'a computer player in the seat');
  host.autoplay = true;
  host.act(host.state, host.socket);
  await host.until((s) => s.phase === 'finished', 'the game to finish');
  assert.equal(host.state.seats.length, 3);
  assertHistoryAddsUp(host.state);
  assert.equal((await host.stats()).perGame[0].played, 1);
  assert.deepEqual((await leaver.stats()).perGame, [], 'the person who left is not recorded');
  assert.equal((await leaver.call('create', {})).ok, true, 'and may start another game');
});

test('when no human is left the game is abandoned and not recorded', async (t) => {
  const { person } = await launch(t);
  const alex = await person('alex').open();
  const code = await startGame([alex], { seats: 2, target: 121, autoplay: false });
  await alex.until((s) => s.phase === 'discard', 'dealt');
  assert.ok((await alex.call('leave')).ok);
  await sleep(100);
  const other = await person('other').open();
  assert.equal((await other.join(code)).ok, false, 'the room is gone');
  assert.deepEqual((await alex.stats()).perGame, []);
});

test('a finished game goes back to the lobby for another round', async (t) => {
  const { person } = await launch(t);
  const [host, guest] = [await person('host').open(), await person('guest').open()];
  await startGame([host, guest], { seats: 3, target: 61 });
  await host.until((s) => s.phase === 'finished', 'the first game');
  await guest.until((s) => s.phase === 'finished', 'the first game');
  assert.equal((await guest.call('rematch')).ok, false, 'host only');
  host.autoplay = false;
  guest.autoplay = false;
  assert.ok((await host.call('rematch')).ok);
  await guest.until((s) => s.phase === 'lobby', 'the lobby');
  assert.equal(guest.state.seats.length, 3);
  assert.ok(guest.state.seats.every((s) => s.score === 0));
  assert.deepEqual(guest.state.scoreboard.rounds, []);
  host.autoplay = true;
  guest.autoplay = true;
  assert.ok((await host.call('start')).ok);
  await host.until((s) => s.phase === 'finished' && s.handNo >= 1 && s.scoreboard.rounds.length === s.handNo, 'the second game');
  assert.equal((await host.stats()).perGame[0].played, 2);
});

test('restart: the room, the hands and the computer players carry on; the result is recorded once', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cribbage-restart-'));
  const first = await launch(t, { dataDir, keep: true });
  const alex = await first.person('alex').open();
  const code = await startGame([alex], { seats: 3, target: 121, autoplay: false });
  await alex.until((s) => s.phase === 'discard' && s.need > 0, 'dealt');
  const hand = alex.state.hand;
  const cookie = alex.cookie;
  const dealer = alex.state.dealer;
  await first.stop();
  await sleep(50);

  const second = await launch(t, { dataDir, keep: true });
  const again = second.person('alex');
  again.cookie = cookie;
  again.id = alex.id;
  await again.connect();
  assert.ok((await again.call('resume', {})).ok);
  await again.until((s) => s.code === code, 'the saved room');
  assert.deepEqual(again.state.hand, hand, 'the same hand');
  assert.equal(again.state.dealer, dealer);
  assert.equal(again.state.target, 121);
  assert.equal(again.state.phase, 'discard');
  await again.until((s) => s.seats.filter((x) => x.discarded).length === 2, 'the computer players to discard after the restart');
  again.autoplay = true;
  again.act(again.state, again.socket);
  await again.until((s) => s.phase === 'finished', 'the game to finish');
  assertHistoryAddsUp(again.state);
  assertNoLeaks(again);
  assert.equal((await again.stats()).perGame[0].played, 1);
  await second.stop();

  const third = await launch(t, { dataDir });
  const last = third.person('alex');
  last.cookie = cookie;
  await last.connect();
  await last.call('resume', { code });
  await last.until((s) => s.phase === 'finished', 'the finished game after another restart');
  assert.equal((await last.stats()).perGame[0].played, 1, 'not recorded a second time');
}, { timeout: 90000 });
