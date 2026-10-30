// Cheat against the real site: a game over sockets, what each person is sent, computer players, calling, leaving, a restart
// of the site, and malformed requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { launchModule, fuzzEvent, assertNoPollution, prototypeNames, cardsIn, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.CHEAT_BOT_DELAY = '0-4';
const launch = (t, extra = {}) => launchModule(t, { id: 'cheat', moduleDir: here, ...extra });

async function table(site, names, { seats = names.length } = {}) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const [host, ...others] = people;
  const created = await host.call('create', { seats });
  assert.equal(created.ok, true, created.error);
  for (const p of others) assert.equal((await p.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.seats.filter(Boolean).length === names.length), 'everyone seated');
  return { people, host, code: created.code };
}

/** Plays a person's turn honestly or not: always one card from the hand. */
const playOne = (p) => p.call('play', { cards: [p.state.hand[0]] });

test('three people play a whole game: everyone sees only their own hand, calls change the pile and the game ends with statistics', async (t) => {
  const site = await launch(t);
  const { people, host } = await table(site, ['ann', 'bob', 'cat']);
  assert.equal((await people[1].call('start')).ok, false, 'only the host starts');
  assert.equal((await host.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'playing'), 'playing');

  const hands = people.map((p) => p.state.hand);
  assert.equal(hands.flat().length, 52);
  for (const p of people) {
    const others = people.filter((q) => q !== p).flatMap((q) => q.state.hand);
    assert.deepEqual(cardsIn(p.states.map((s) => ({ ...s, hand: undefined }))), [], 'no card is sent outside the hand');
    assert.ok(others.length > 0);
  }

  let steps = 0;
  while (!people.every((p) => p.state.phase === 'finished') && steps++ < 4000) {
    await until(() => people.every((p) => p.state.turn === people[0].state.turn && p.state.plays === people[0].state.plays) || people[0].state.phase === 'finished', 'in step');
    const state = people[0].state;
    if (state.phase === 'finished') break;
    if (state.phase === 'check') {
      for (const p of people) if (p.state.mustRespond) await p.call('accept');
      await until(() => people.every((p) => p.state.phase !== 'check' || p.state.plays !== state.plays), 'check settled').catch(() => {});
      continue;
    }
    const mover = people.find((p) => p.state.you === state.turn);
    assert.equal((await mover.call('play', { cards: [mover.state.hand[0]] })).ok, true);
    // The next person calls every fourth play, to move the pile around.
    if (steps % 4 === 0) {
      const caller = people.find((p) => p.state.canCall);
      if (caller) await caller.call('call');
    }
    await until(() => people.every((p) => p.state.plays > state.plays || p.state.phase !== 'playing' || p.state.lastCall), 'the play arrived');
  }
  await until(() => people.every((p) => p.state.phase === 'finished'), 'finished', { timeout: 60000 });
  assert.equal(people[0].state.scoreboard.players.filter((p) => p.score === 0).length, 1, 'one winner, out of cards');
  const stats = JSON.stringify((await host.http('GET', '/api/stats/me')).data);
  assert.ok(stats.includes('cheat'), 'the game was recorded');
});

test('computer players fill the table, play, call and finish a game; a person can call a computer player', async (t) => {
  const site = await launch(t);
  const ann = await site.person('ann').open();
  assert.ok((await ann.call('create', { seats: 5 })).ok);
  assert.ok((await ann.call('fillBots')).ok);
  await until(() => ann.state.seats.every(Boolean), 'full table');
  assert.ok((await ann.call('start')).ok);
  await until(() => ann.state.phase !== 'lobby', 'started');
  let called = 0;
  await until(
    async () => {
      const s = ann.state;
      if (s.phase === 'finished') return true;
      if (s.canPlay) await playOne(ann);
      else if (s.mustRespond) await ann.call(called++ % 3 === 0 ? 'call' : 'accept');
      else if (s.canCall && s.pile % 5 === 0) await ann.call('call');
      return false;
    },
    'the game to finish',
    { timeout: 120000 },
  );
  assert.ok(ann.state.winner !== null);
  assert.ok(ann.state.seats.every((seat) => seat.stats), 'the tallies are public once started');
});

test('leaving mid-game hands the seat to a computer player; the others carry on', async (t) => {
  const site = await launch(t);
  const { people, host } = await table(site, ['ann', 'bob', 'cat']);
  await host.call('start');
  await until(() => people.every((p) => p.state?.phase === 'playing'), 'playing');
  const [, bob] = people;
  assert.ok((await bob.call('leave')).ok);
  await until(() => bob.state === null, 'bob is out');
  await until(() => host.state.seats[1].bot, 'a computer took the seat');
  assert.equal(host.state.phase, 'playing');
  assert.equal(host.state.seatCount, 3);
});

test('a room survives a restart of the site, hands and pile included', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cheat-restart-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.call('create', { seats: 3 });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state?.phase === 'playing', 'playing');
  const code = ann.state.code;
  const hand = ann.state.hand;
  await new Promise((resolve) => setTimeout(resolve, 200)); // saves are batched
  await first.stop();
  const second = await launch(t, { dataDir, keep: true });
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true })); // registered last, so it runs after the site has closed
  const login = await fetch(`${second.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ann', password: 'ann password' }) });
  const socket = connect(`${second.base}/cheat`, { forceNew: true, extraHeaders: { cookie: login.headers.get('set-cookie').split(';')[0] } });
  t.after(() => socket.close());
  let state;
  socket.on('state', (next) => (state = next));
  await new Promise((resolve) => socket.on('connect', resolve));
  const reply = await new Promise((resolve) => socket.emit('resume', {}, resolve));
  assert.deepEqual(reply, { ok: true, code });
  await until(() => state?.code === code, 'the room is back');
  assert.deepEqual(state.hand, hand, 'the same cards');
  assert.equal(state.phase, 'playing');
});

test('malformed requests never break the game or leak a hand', async (t) => {
  const before = prototypeNames();
  const site = await launch(t);
  const { people, host } = await table(site, ['ann', 'bob', 'cat']);
  await host.call('start');
  await until(() => people.every((p) => p.state?.phase === 'playing'), 'playing');
  const secrets = () => people.slice(1).flatMap((p) => p.state?.hand ?? []).filter((c) => !people[0].state.hand.includes(c));
  const events = { play: ['cards'], call: [], accept: [], settings: ['seats'], addBot: ['seat'], removeBot: ['seat'], kick: ['seat'], fillBots: [], start: [], again: [], join: ['code'], create: ['seats'], resume: ['code'] };
  let acks = 0;
  for (const [event, fields] of Object.entries(events)) {
    if (['leave'].includes(event)) continue;
    acks += await fuzzEvent(people[1], event, fields, { secrets, extra: event === 'play' ? [{ cards: ['AS', 'AS', 'AS', 'AS', 'AS'] }, { cards: { length: 2 } }] : [] });
  }
  assert.ok(acks > 100);
  assertNoPollution(before);
  assert.ok(['playing', 'check', 'finished'].includes(host.state.phase) || host.state === null, 'the game is still sane');
});
