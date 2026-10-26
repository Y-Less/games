// Cribbage over real sockets: simultaneous actions, one account on two sockets, disconnects in every phase, hosts
// leaving, kicking someone who has gone away, rooms disappearing under connected sockets and one game per account.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.CRIBBAGE_BOT_DELAY = '0-2';
const oks = (replies) => replies.filter((r) => r.ok === true).length;

async function step(p) {
  const s = p.state;
  if (!s) return false;
  if (s.phase === 'discard' && s.need) return (await p.call('discard', { cards: s.hand.slice(0, s.need) })).ok;
  if (s.phase === 'play' && s.play.turn === s.you && s.play.playable.length) return (await p.call('play', { card: s.play.playable[0] })).ok;
  if (s.phase === 'show' && !s.seats[s.you].ready) return (await p.call('ready', {})).ok;
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

/** Ann (host), Bob and a computer player, started and in the discard phase. */
async function started(t, { target = 61 } = {}) {
  const site = await launchModule(t, { id: 'cribbage', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { target, seats: 3 });
  assert.equal((await bob.call('join', { code })).ok, true);
  assert.equal((await ann.call('addBot', {})).ok, true);
  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => ann.state?.phase === 'discard' && bob.state?.phase === 'discard', 'discard');
  return { site, ann, bob, code };
}

test('both pressing start in the same tick starts exactly one game', async (t) => {
  const site = await launchModule(t, { id: 'cribbage', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const twin = await ann.twin();
  const { code } = await ann.call('create', { seats: 2 });
  await bob.call('join', { code });
  await twin.call('resume', { code });
  const replies = await Promise.all([ann.call('start', {}), twin.call('start', {}), bob.call('start', {})]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  await until(() => ann.state.phase === 'discard', 'discard');
  const hand = [...ann.state.hand];
  await sleep(30);
  assert.deepEqual(ann.state.hand, hand, 'dealt once');
  assert.equal(ann.state.handNo, 1);
  assert.deepEqual(twin.state.hand, hand);
});

test('five people racing for the last seat: exactly one gets it and everybody agrees who', async (t) => {
  const site = await launchModule(t, { id: 'cribbage', moduleDir: here });
  const [ann, ...racers] = await Promise.all(['ann', 'bob', 'cat', 'dan', 'eve', 'fay'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 2 });
  const replies = await Promise.all(racers.map((p) => p.call('join', { code })));
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  const winner = racers[replies.findIndex((r) => r.ok)];
  await until(() => ann.state.seats.length === 2, 'full');
  assert.equal(ann.state.seats[1].name, winner.name);
  await sleep(30);
  for (const p of racers) assert.equal(p.state?.seats?.[1]?.name ?? null, p === winner ? winner.name : null);
});

test('simultaneous discards, plays and readies: only the right ones count, and nothing is dealt twice', async (t) => {
  const { ann, bob } = await started(t);
  const twin = await ann.twin();
  await twin.call('resume', {});
  const hand = ann.state.hand.slice(0, ann.state.need);
  const discards = await Promise.all([ann.call('discard', { cards: hand }), twin.call('discard', { cards: hand }), bob.call('discard', { cards: bob.state.hand.slice(0, bob.state.need) })]);
  assert.equal(oks(discards.slice(0, 2)), 1, JSON.stringify(discards));
  assert.equal(discards[2].ok, true);
  await until(() => ann.state.phase === 'play' && [ann, bob].some((p) => p.state.play.turn === p.state.you), 'a person to play');
  const mover = ann.state.play.turn === ann.state.you ? ann : bob;
  const moverTwin = mover === ann ? twin : await bob.twin();
  if (mover === bob) await moverTwin.call('resume', {});
  const card = mover.state.play.playable[0];
  const plays = await Promise.all([mover.call('play', { card }), moverTwin.call('play', { card })]);
  assert.equal(oks(plays), 1, JSON.stringify(plays));
  await until(() => !mover.state.hand.includes(card), 'the card to leave the hand');
  assert.deepEqual(mover.state.hand, moverTwin.state.hand);
  for (const s of mover.states) if (s?.play) assert.ok(s.play.sequence.filter((p) => p.card === card).length <= 1);
  // Both pressing ready in the same tick deals the next hand once.
  await playOn([ann, bob], () => ann.state.phase === 'show' && bob.state.phase === 'show' && [ann, bob].every((p) => !p.state.seats[p.state.you].ready));
  const handNo = ann.state.handNo;
  const readies = await Promise.all([ann.call('ready', {}), twin.call('ready', {}), bob.call('ready', {})]);
  assert.ok(readies.every((r) => r.ok === true), 'ready is harmless to repeat');
  await until(() => ann.state.phase === 'discard' || ann.state.phase === 'finished', 'the next hand');
  await sleep(40);
  assert.equal(ann.state.handNo, handNo + 1, 'dealt once');
});

test('disconnecting and reconnecting in every phase keeps the seat, the hand and the game', async (t) => {
  const { site, ann, bob } = await started(t);
  const drop = async (person) => {
    const mine = person === ann ? 0 : 1;
    const other = person === ann ? bob : ann;
    const hand = [...person.state.hand];
    const code = person.state.code;
    person.socket.close();
    await until(() => other.state.seats[mine].online === false, `${person.name} to show as away`);
    await person.connect();
    assert.equal((await person.call('resume', { code })).ok, true);
    await until(() => person.state?.phase, 'the state after resuming');
    assert.deepEqual(person.state.hand, hand, 'the same hand');
    await until(() => [ann, bob].every((p) => p.state.seats.every((s) => s.online)), 'everyone online again');
    return person.state;
  };
  const d = await drop(bob);
  assert.equal(d.phase, 'discard');
  assert.equal((await ann.call('discard', { cards: ann.state.hand.slice(0, ann.state.need) })).ok, true);
  const afterAnn = await drop(ann);
  assert.equal(afterAnn.need, 0, 'the discard before the drop is remembered');
  assert.equal((await bob.call('discard', { cards: bob.state.hand.slice(0, bob.state.need) })).ok, true);
  await playOn([ann, bob], () => ann.state.phase === 'play' && [ann, bob].some((p) => p.state.play.turn === p.state.you));
  const mover = ann.state.play.turn === ann.state.you ? ann : bob;
  const inPlay = await drop(mover);
  assert.equal(inPlay.play.turn, inPlay.you, 'still our turn after coming back');
  await playOn([ann, bob], () => ann.state.phase === 'show' && bob.state.phase === 'show' && !ann.state.seats[0].ready);
  const inShow = await drop(ann);
  assert.ok(['show', 'finished'].includes(inShow.phase));
  assert.ok(inShow.show.entries.length >= 1);
  await playOn([ann, bob], () => ann.state.phase === 'finished' && bob.state.phase === 'finished');
  const fin = await drop(bob);
  assert.equal(fin.phase, 'finished');
  await sleep(100);
  assert.equal((await ann.stats()).perGame[0].played, 1);
  assert.equal((await bob.stats()).perGame[0].played, 1);
  assert.equal(await site.alive(), true);
});

test('everybody disconnecting mid-game: the game waits for the people, who can come back', async (t) => {
  const { ann, bob, code } = await started(t);
  ann.socket.close();
  bob.socket.close();
  await sleep(150);
  const a = await ann.twin();
  const b = await bob.twin();
  assert.equal((await a.call('resume', { code })).ok, true);
  assert.equal((await b.call('resume', { code })).ok, true);
  await until(() => a.state?.phase === 'discard' && b.state?.phase === 'discard', 'the game as it was');
  await playOn([a, b], () => a.state.phase === 'finished' && b.state.phase === 'finished');
});

test('the host: a dropped connection keeps the role, leaving hands it on, and any other player can be removed', async (t) => {
  const { ann, bob } = await started(t);
  ann.socket.close();
  await until(() => bob.state.seats[0].online === false, 'ann away');
  assert.equal(bob.state.isHost, false);
  assert.equal(bob.state.seats[0].host, true, 'a dropped connection does not hand the host over');
  // Bob is not the host: he cannot remove ann.
  assert.deepEqual((await bob.call('kick', { seat: 0 })).ok, false);
  await ann.connect();
  await ann.call('resume', {});
  await until(() => ann.state?.phase === 'discard', 'ann back');
  // Now bob drops: ann (host) may remove him, and a computer takes over (she could have while he was connected too).
  bob.socket.close();
  await until(() => ann.state.seats[1].online === false, 'bob away');
  assert.deepEqual(await ann.call('kick', { seat: 1 }), { ok: true });
  await until(() => ann.state.seats[1].bot && ann.state.seats[1].replaced, 'a computer in bob\'s seat');
  await bob.connect();
  await bob.call('resume', {});
  assert.equal(bob.state, null, 'bob was removed from the game');
  // The host leaving mid-game hands over to the one remaining person... here nobody remains, so the room goes.
  assert.equal((await ann.call('leave', {})).ok, true);
  await until(() => ann.state === null, 'ann out');
  assert.equal((await bob.call('join', { code: 'boss-aware-you' })).ok, false);
});

test('the host leaving hands the host role to another person', async (t) => {
  const { ann, bob } = await started(t);
  assert.equal((await ann.call('leave', {})).ok, true);
  await until(() => ann.state === null, 'ann out');
  await until(() => bob.state.isHost === true, 'bob is host');
  assert.ok(bob.state.seats[0].bot && bob.state.seats[0].replaced, 'a computer took ann\'s seat');
  await playOn([bob], () => bob.state.phase === 'finished');
  assert.equal((await bob.call('rematch', {})).ok, true, 'the new host can go back to the lobby');
  await until(() => bob.state.phase === 'lobby', 'the lobby');
  await sleep(100);
  assert.equal((await ann.stats()).perGame.length, 0, 'the leaver is not recorded');
});

test('a room that disappears under connected sockets leaves them cleanly out', async (t) => {
  const site = await launchModule(t, { id: 'cribbage', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const twin = await ann.twin();
  const { code } = await ann.call('create', {});
  await twin.call('resume', { code });
  await until(() => twin.state?.code === code, 'twin attached');
  assert.equal((await ann.call('leave', {})).ok, true);
  await until(() => ann.state === null && twin.state === null, 'both sockets out');
  for (const event of ['start', 'addBot', 'fillBots', 'settings', 'kick', 'play', 'discard', 'ready', 'rematch', 'removeBot']) {
    const reply = await twin.call(event, { seat: 1, card: 'AS', cards: ['AS', 'KS'], target: 61 });
    assert.equal(reply.ok, false, event);
    assert.match(reply.error, /not in a game/, event);
  }
  assert.equal((await bob.call('join', { code })).ok, false, 'the code is dead');
  assert.deepEqual(await twin.call('resume', {}), { ok: true, code: null });
  assert.equal((await twin.call('create', {})).ok, true);
  assert.equal(await site.alive(), true);
});

test('one live game per account: a second create or join is refused, and leaving frees the account', async (t) => {
  const site = await launchModule(t, { id: 'cribbage', moduleDir: here });
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
  assert.equal(ann.state.code, first);
  assert.equal(cat.state.seats.length, 1);
  assert.equal((await ann.call('join', { code: first })).ok, true);
  assert.equal((await bob.call('join', { code: first })).ok, true);
  assert.equal((await bob.call('join', { code: second })).ok, false);
  await ann.call('leave', {});
  await until(() => ann.state === null, 'ann out');
  assert.equal((await ann.call('join', { code: second })).ok, true);
  await until(() => cat.state.seats.length === 2, 'ann in cat\'s game');
});

test('a finished game does not block joining another one', async (t) => {
  const { ann, bob } = await started(t);
  await playOn([ann, bob], () => ann.state.phase === 'finished' && bob.state.phase === 'finished');
  const fresh = await ann.twin();
  const other = await fresh.call('create', {});
  assert.equal(other.ok, true, 'a finished game is not live');
  await until(() => fresh.state?.code === other.code, 'the new game');
  assert.equal((await bob.call('leave', {})).ok, true);
  await until(() => bob.state === null, 'bob out');
});
