// Hearts over real sockets: simultaneous actions, one account on two sockets, disconnects in every phase, hosts leaving,
// rooms disappearing under connected sockets and the one-game-per-account rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fast = () => {
  process.env.HEARTS_BOT_DELAY = '0-2';
  process.env.HEARTS_TRICK_PAUSE = '0';
};
const firstLegal = (s) => Object.keys(s.legal).find((c) => s.legal[c] === null);
const oks = (replies) => replies.filter((r) => r.ok === true).length;

async function step(p) {
  const s = p.state;
  if (!s) return false;
  if (s.phase === 'passing' && !s.pass.chosen) return (await p.call('pass', { cards: s.hand.slice(0, 3) })).ok;
  if (s.phase === 'playing' && s.legal) return (await p.call('play', { card: firstLegal(s) })).ok;
  if (s.phase === 'handEnd') return (await p.call('next', {})).ok;
  return false;
}
async function playOn(people, done, limit = 40000) {
  const started = Date.now();
  while (!done()) {
    assert.ok(Date.now() - started < limit, 'stuck');
    let moved = false;
    for (const p of people) moved = (await step(p)) || moved;
    if (!moved) await sleep(3);
  }
}

/** Ann (host), Bob and two computer players, started and waiting for passes. */
async function started(t, opts = {}) {
  fast();
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { target: opts.target ?? 50 });
  assert.equal((await bob.call('join', { code })).ok, true);
  await ann.call('fillBots', {});
  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => ann.state?.phase === 'passing' && bob.state?.phase === 'passing', 'passing');
  return { site, ann, bob, code };
}

test('both pressing start in the same tick starts exactly one game', async (t) => {
  fast();
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const twin = await ann.twin();
  const { code } = await ann.call('create', {});
  await bob.call('join', { code });
  await twin.call('resume', { code });
  await ann.call('fillBots', {});
  const replies = await Promise.all([ann.call('start', {}), twin.call('start', {}), bob.call('start', {})]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  await until(() => ann.state.phase === 'passing', 'passing');
  const hand = [...ann.state.hand];
  await sleep(30);
  assert.deepEqual(ann.state.hand, hand, 'the cards were dealt once');
  assert.equal(ann.state.hand.length, 13);
  assert.deepEqual(twin.state.hand, hand);
});

test('four people racing for the last seat: exactly one gets it and everybody agrees who', async (t) => {
  fast();
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const names = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay'];
  const [ann, ...rest] = await Promise.all(names.map((n) => site.person(n).open()));
  const { code } = await ann.call('create', {});
  await ann.call('addBot', { seat: 1 });
  await ann.call('addBot', { seat: 2 });
  const racers = rest.slice(0, 5);
  const replies = await Promise.all(racers.map((p) => p.call('join', { code })));
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  await until(() => ann.state.seats.every(Boolean), 'full');
  const winner = racers[replies.findIndex((r) => r.ok)];
  assert.equal(ann.state.seats[3].name, winner.name);
  await sleep(30);
  for (const p of racers) assert.equal(p.state?.seats?.[3]?.name ?? null, p === winner ? winner.name : null, `${p.name} sees the right thing`);
  assert.equal(ann.state.seats.filter((s) => s && !s.bot).length, 2);
});

test('two people (and two sockets of one account) playing at the same instant: only the right move counts', async (t) => {
  const { ann, bob } = await started(t);
  const twin = await ann.twin();
  await twin.call('resume', {});
  // Pass from both of ann's sockets at once: one is accepted, the other says already passed.
  const hand = ann.state.hand.slice(0, 3);
  const passes = await Promise.all([ann.call('pass', { cards: hand }), twin.call('pass', { cards: hand }), bob.call('pass', { cards: bob.state.hand.slice(0, 3) })]);
  assert.equal(oks(passes.slice(0, 2)), 1);
  assert.equal(passes[2].ok, true);
  await until(() => ann.state.phase === 'playing' && [ann, bob].some((p) => p.state.legal), 'a person to move');
  const mover = ann.state.legal ? ann : bob;
  const other = mover === ann ? bob : ann;
  const card = firstLegal(mover.state);
  const moverTwin = mover === ann ? twin : await bob.twin();
  if (mover === bob) await moverTwin.call('resume', {});
  const plays = await Promise.all([mover.call('play', { card }), moverTwin.call('play', { card }), other.call('play', { card: other.state.hand[0] })]);
  assert.equal(oks(plays.slice(0, 2)), 1, JSON.stringify(plays));
  await until(() => !mover.state.hand.includes(card), 'the card to leave the hand');
  assert.equal(mover.state.hand.length, 12);
  await sleep(20);
  for (const st of mover.states) assert.ok(!st?.trick || st.trick.filter((p) => p.card === card).length <= 1, 'the card is never on the table twice');
  assert.deepEqual(mover.state.hand, moverTwin.state.hand, 'both sockets agree');
  // And the game carries on to the end from here.
  await playOn([ann, bob], () => ann.state.phase === 'finished' && bob.state.phase === 'finished');
  for (const s of ann.states.filter(Boolean)) {
    if (s.phase === 'playing') assert.equal(s.seats.reduce((n, seat) => n + seat.cards + seat.tricks * 4, 0) + s.trick.length, 52);
  }
});

test('disconnecting and reconnecting in every phase keeps the seat, the hand and the game', async (t) => {
  const { site, ann, bob } = await started(t);
  const drop = async (person) => {
    const hand = [...person.state.hand];
    person.socket.close();
    await until(() => [ann, bob].filter((p) => p !== person).every((p) => p.state.seats[person === ann ? 0 : 1].online === false), `${person.name} to show as away`);
    await person.connect();
    assert.equal((await person.call('resume', {})).ok, true);
    await until(() => person.state?.phase, 'the state after resuming');
    assert.deepEqual(person.state.hand.filter((c) => hand.includes(c)).sort(), hand.filter((c) => person.state.hand.includes(c)).sort());
    await until(() => [ann, bob].every((p) => p.state.seats.every((s) => s.online)), 'everyone online again');
    return person.state;
  };
  // passing
  const during = await drop(bob);
  assert.equal(during.phase, 'passing');
  assert.equal(during.hand.length, 13);
  assert.equal((await ann.call('pass', { cards: ann.state.hand.slice(0, 3) })).ok, true);
  await drop(ann);
  assert.deepEqual(ann.state.pass.chosen?.length, 3, 'the pass chosen before the drop is remembered');
  assert.equal((await bob.call('pass', { cards: bob.state.hand.slice(0, 3) })).ok, true);
  // playing
  await until(() => ann.state.phase === 'playing' && [ann, bob].some((p) => p.state.legal), 'play');
  const mover = ann.state.legal ? ann : bob;
  await drop(mover);
  assert.ok(mover.state.legal, 'still our turn after coming back');
  assert.equal((await mover.call('play', { card: firstLegal(mover.state) })).ok, true);
  // handEnd
  await playOn([ann, bob], () => ann.state.phase === 'handEnd' && bob.state.phase === 'handEnd');
  const afterDrop = await drop(ann);
  assert.equal(afterDrop.phase, 'handEnd');
  assert.equal(afterDrop.lastHand.hand, 1);
  // finished
  await playOn([ann, bob], () => ann.state.phase === 'finished' && bob.state.phase === 'finished');
  const fin = await drop(bob);
  assert.equal(fin.phase, 'finished');
  assert.ok(fin.winners.length >= 1);
  await sleep(100);
  assert.equal((await ann.stats()).perGame[0].played, 1);
  assert.equal((await bob.stats()).perGame[0].played, 1);
  assert.equal(await site.alive(), true);
});

test('everybody disconnecting mid-game: the computers wait for the people, and the people can come back', async (t) => {
  const { ann, bob, code } = await started(t);
  const cookies = [ann.cookie, bob.cookie];
  ann.socket.close();
  bob.socket.close();
  await sleep(150);
  const [a, b] = await Promise.all(cookies.map(async (cookie, i) => {
    const p = (await (i ? bob : ann).twin());
    return p;
  }));
  assert.equal((await a.call('resume', { code })).ok, true);
  assert.equal((await b.call('resume', { code })).ok, true);
  await until(() => a.state?.phase === 'passing' && b.state?.phase === 'passing', 'the game as it was');
  await playOn([a, b], () => a.state.phase === 'finished' && b.state.phase === 'finished');
});

test('the host leaving hands the game to another person; a disconnected host keeps it', async (t) => {
  const { ann, bob } = await started(t);
  ann.socket.close();
  await until(() => bob.state.seats[0].online === false, 'ann away');
  assert.equal(bob.state.hostSeat, 0, 'a dropped connection does not hand the host over');
  await ann.connect();
  await ann.call('resume', {});
  await until(() => ann.state?.phase === 'passing', 'ann back');
  assert.equal((await ann.call('leave', {})).ok, true);
  await until(() => ann.state === null, 'ann out');
  await until(() => bob.state.hostSeat === 1, 'bob is host');
  assert.equal(bob.state.seats[0].bot, true, 'a computer took the seat');
  await playOn([bob], () => bob.state.phase === 'finished');
  assert.equal((await bob.call('again', {})).ok, true, 'the new host can restart');
  await sleep(100);
  assert.equal((await ann.stats()).perGame.length, 0, 'the leaver is not recorded');
});

test('a room that disappears under connected sockets leaves them cleanly out', async (t) => {
  fast();
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const twin = await ann.twin();
  const { code } = await ann.call('create', {});
  await twin.call('resume', { code });
  await until(() => twin.state?.code === code, 'twin attached');
  assert.equal((await ann.call('leave', {})).ok, true);
  await until(() => ann.state === null && twin.state === null, 'both sockets out');
  for (const event of ['start', 'addBot', 'fillBots', 'settings', 'kick', 'play', 'pass', 'next', 'again']) {
    const reply = await twin.call(event, { seat: 1, card: '2C', cards: ['2C', '3C', '4C'], target: 50 });
    assert.equal(reply.ok, false, event);
    assert.match(reply.error, /not in a game/, event);
  }
  assert.equal((await bob.call('join', { code })).ok, false, 'the code is dead');
  assert.deepEqual(await twin.call('resume', {}), { ok: true, code: null });
  assert.equal((await twin.call('create', {})).ok, true, 'free to start a new one');
  assert.equal(await site.alive(), true);
});

test('one live game per account: creating or joining a second is refused, and leaving frees the account', async (t) => {
  fast();
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const first = (await ann.call('create', {})).code;
  const second = (await cat.call('create', {})).code;
  const again = await ann.call('create', {});
  assert.equal(again.ok, false);
  assert.match(again.error, new RegExp(first));
  const hop = await ann.call('join', { code: second });
  assert.equal(hop.ok, false);
  assert.match(hop.error, /already in the game/);
  assert.equal((await ann.call('resume', { code: second })).ok, false);
  assert.equal(ann.state.code, first, 'still in the first game');
  assert.equal(cat.state.seats.filter(Boolean).length, 1, 'the other game was not joined');
  // Joining a game you are already in is simply a return.
  assert.equal((await ann.call('join', { code: first })).ok, true);
  assert.equal((await bob.call('join', { code: first })).ok, true);
  assert.equal((await bob.call('join', { code: second })).ok, false);
  await ann.call('leave', {});
  await until(() => ann.state === null, 'ann out');
  assert.equal((await ann.call('join', { code: second })).ok, true, 'free again');
  await until(() => cat.state.seats.filter(Boolean).length === 2, 'ann in cat\'s game');
});

test('a finished game does not block joining another, and a finished seat can be left', async (t) => {
  const { ann, bob } = await started(t);
  await playOn([ann, bob], () => ann.state.phase === 'finished' && bob.state.phase === 'finished');
  const fresh = await ann.twin();
  const other = (await fresh.call('create', {}));
  assert.equal(other.ok, true, 'a finished game is not live');
  await until(() => fresh.state?.code === other.code, 'the new game');
  assert.equal((await bob.call('leave', {})).ok, true);
  await until(() => bob.state === null, 'bob out');
});
