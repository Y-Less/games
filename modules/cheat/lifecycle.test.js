// Cheat over real sockets, for the moments in a room's life that server.test.js does not visit.  That file restarts
// the site in the middle of play and has a guest leave; this one is about two things happening at once (two people
// starting, one account playing from two sockets), the site restarting during the final check - when somebody has
// played their last card and the others are deciding whether to believe it - a lost connection at that same moment,
// the host walking out, and what is left of a table once the game is over.  What is protected is that the pack is dealt
// once, a turn is taken once, a result is recorded once, and no answer already given is lost to a restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankOf } from '../../shared/cards.js';
import { launchModule, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.CHEAT_BOT_DELAY = '0-4';
const launch = (t, options = {}) => launchModule(t, { id: 'cheat', moduleDir: here, ...options });
const oks = (replies) => replies.filter((r) => r.ok === true).length;
const played = async (person) => (await person.stats()).perGame.find((g) => g.name === 'Cheat')?.played ?? 0;

/** A started game of the named people (the first is the host) and nobody else. */
async function started(t, names, { site = null } = {}) {
  site ??= await launch(t);
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const created = await people[0].call('create', { seats: names.length });
  assert.equal(created.ok, true, created.error);
  for (const p of people.slice(1)) assert.equal((await p.call('join', { code: created.code })).ok, true);
  assert.equal((await people[0].call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'playing'), 'the game to begin');
  return { site, people, code: created.code };
}

/**
 * Everybody plays one card a turn and nobody calls, until somebody has played their last card and the table is in the
 * final check.  Returns the seat that went out.
 */
async function playToTheCheck(people) {
  await until(
    async () => {
      if (people.every((p) => p.state.phase === 'check')) return true;
      const plays = Math.max(...people.map((p) => p.state.plays));
      if (!people.every((p) => p.state.plays === plays)) return false; // somebody has yet to hear of the last play
      const mover = people.find((p) => p.state.canPlay);
      if (mover) await mover.call('play', { cards: [mover.state.hand[0]] });
      return false;
    },
    'somebody to play their last card',
    { timeout: 120000 },
  );
  return people[0].state.last.seat;
}

/** The same account, signed in on a restarted site with the cookie it had, and back in its game. */
async function comeBack(site, person, code) {
  const back = site.person(person.name);
  back.cookie = person.cookie;
  back.id = person.id;
  await back.connect();
  assert.deepEqual(await back.call('resume', { code }), { ok: true, code });
  await until(() => back.state?.code === code, `${person.name} to be sent the game`);
  return back;
}

test('the host pressing start on two sockets at once, and a guest pressing it too, deals the pack exactly once', async (t) => {
  const site = await launch(t);
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann, bob, cat] = people;
  const { code } = await ann.call('create', { seats: 3 });
  for (const p of [bob, cat]) assert.equal((await p.call('join', { code })).ok, true);
  const twin = await ann.twin();
  assert.equal((await twin.call('resume', { code })).ok, true);
  const replies = await Promise.all([ann.call('start'), twin.call('start'), bob.call('start')]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  assert.equal(replies[2].ok, false, 'only the host starts');
  await until(() => [...people, twin].every((p) => p.state?.phase === 'playing'), 'everybody to see the game');
  const hands = people.map((p) => p.state.hand);
  assert.equal(hands.flat().length, 52, 'the whole pack is dealt out');
  assert.equal(new Set(hands.flat()).size, 52, 'and each card once');
  assert.deepEqual(twin.state.hand, ann.state.hand, 'both of the host\'s sockets hold the same hand');
  assert.equal(ann.state.plays, 0, 'nothing has been played');
  assert.ok(people.find((p) => p.state.canPlay).state.hand.includes('AS'), 'the player holding the Ace of Spades goes first');
});

test('one account playing the same card from two sockets at once: it is played once', async (t) => {
  const { people } = await started(t, ['ann', 'bob', 'cat']);
  const mover = people.find((p) => p.state.canPlay);
  const twin = await mover.twin();
  assert.equal((await twin.call('resume', {})).ok, true);
  await until(() => twin.state?.canPlay === true, 'the second socket to see the turn');
  const card = mover.state.hand[0];
  const size = mover.state.hand.length;
  const replies = await Promise.all([mover.call('play', { cards: [card] }), twin.call('play', { cards: [card] })]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  await until(() => [...people, twin].every((p) => p.state.plays === 1), 'everybody to hear of the play');
  assert.equal(mover.state.pile, 1, 'one card on the pile, not two');
  assert.equal(mover.state.hand.length, size - 1);
  assert.deepEqual(twin.state.hand, mover.state.hand, 'both sockets agree on the hand');
  assert.equal(people.reduce((n, p) => n + p.state.hand.length, 0) + mover.state.pile, 52, 'the pack is whole');
  assert.deepEqual(mover.state.last, { seat: mover.state.you, count: 1, rank: 'A' }, 'the first play of a game claims Aces');
});

test('a restart during the final check: the last card can still be believed or called, and an answer already given stands', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cheat-check-'));
  const first = await launch(t, { dataDir, keep: true });
  const { people, code } = await started(t, ['ann', 'bob', 'cat'], { site: first });
  const out = await playToTheCheck(people);
  const waiting = people.filter((p) => p.state.you !== out);
  assert.ok(waiting.every((p) => p.state.mustRespond), 'the other two are asked whether they believe it');
  const [early, late] = waiting;
  assert.equal((await early.call('accept')).ok, true);
  await until(() => early.state.mustRespond === false, 'the first answer to be taken');
  assert.equal(early.state.phase, 'check', 'one answer is not enough: the table waits for the other');
  const before = late.state;
  await first.stop();

  const second = await launch(t, { dataDir });
  const back = Object.fromEntries(await Promise.all(people.map(async (p) => [p.name, await comeBack(second, p, code)])));
  for (const p of people) {
    const s = back[p.name].state;
    assert.equal(s.phase, 'check', 'still in the final check');
    assert.deepEqual(s.hand, p.state.hand, `${p.name} holds the same cards`);
    assert.equal(s.pile, before.pile, 'the pile is as it was');
    assert.deepEqual(s.last, before.last, 'and so is the play in question');
    assert.equal(s.plays, before.plays);
  }
  assert.equal(back[early.name].state.mustRespond, false, 'the answer given before the restart stands');
  assert.equal(back[late.name].state.mustRespond, true, 'and the other is still owed');
  assert.equal((await back[late.name].call('accept')).ok, true);
  await until(() => Object.values(back).every((p) => p.state.phase === 'finished'), 'the game to finish');
  assert.equal(back.ann.state.winner, out, 'everybody believed the last card: its player wins');
  await until(async () => (await Promise.all(Object.values(back).map(played))).every((n) => n === 1), 'the game to be recorded once for each of them');
  assert.equal(second.site.db.prepare('SELECT COUNT(*) AS n FROM results').get().n, 1, 'one result in the statistics');
});

test('a connection lost during the final check costs nobody their seat, and the game waits for their answer', async (t) => {
  const { people, code } = await started(t, ['ann', 'bob', 'cat']);
  const out = await playToTheCheck(people);
  const [away, stays] = people.filter((p) => p.state.you !== out);
  const seat = away.state.you;
  away.socket.close();
  await until(() => stays.state.seats[seat].online === false, 'them to show as away');
  assert.equal(stays.state.seats[seat].bot, false, 'a lost connection is not leaving: no computer player takes the seat');
  assert.equal((await stays.call('accept')).ok, true);
  await until(() => stays.state.mustRespond === false, 'the answer to be taken');
  assert.equal(stays.state.phase, 'check', 'the table waits for the one who is away');
  await away.connect();
  assert.deepEqual(await away.call('resume', { code }), { ok: true, code });
  await until(() => away.state?.phase === 'check', 'them to be back');
  assert.equal(away.state.mustRespond, true, 'and they are still asked');
  // This time the last card is called.  Whoever is wrong picks up the whole pile.
  const pile = away.state.pile;
  const claimed = away.state.last.rank;
  const held = away.state.seats.map((s) => s.cards);
  assert.equal((await away.call('call')).ok, true);
  await until(() => people.every((p) => p.state.lastCall !== null), 'everybody to see the call');
  const { lie, picker, cards } = stays.state.lastCall;
  assert.equal(lie, cards.some((card) => rankOf(card) !== claimed), 'it was a lie exactly when a card turned over was not of the rank claimed');
  assert.equal(picker, lie ? out : seat, 'whoever was wrong picks up');
  assert.equal(stays.state.seats[picker].cards, held[picker] + pile, 'the whole pile');
  assert.equal(stays.state.pile, 0);
  if (lie) assert.equal(stays.state.phase, 'playing', 'caught on a last card: the game goes on');
  else assert.deepEqual([stays.state.phase, stays.state.winner], ['finished', out], 'called on a true last card: its player wins');
});

test('the host walking out mid-game: a computer player takes the seat and another person is the host', async (t) => {
  const { people } = await started(t, ['ann', 'bob', 'cat']);
  const [ann, bob, cat] = people;
  const seat = ann.state.you;
  const cards = bob.state.seats[seat].cards;
  assert.equal(bob.state.hostSeat, seat);
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'Ann to be out');
  await until(() => [bob, cat].every((p) => p.state.seats[seat].bot === true), 'a computer player in her seat');
  assert.ok([bob.state.you, cat.state.you].includes(bob.state.hostSeat), 'one of the people left at the table is the host');
  assert.equal(cat.state.hostSeat, bob.state.hostSeat, 'and they agree who');
  assert.ok(bob.state.seats[seat].cards <= cards, 'the computer player took over the hand (and may have played from it since)');
  assert.equal(bob.state.seatCount, 3);
  assert.equal((await ann.call('create', { seats: 3 })).ok, true, 'the one who left is free to start a game of their own');
});

test('after the game: somebody who leaves stays on the final table, and playing again frees their seat', async (t) => {
  const { people, code } = await started(t, ['ann', 'bob', 'cat']);
  const [ann, bob, cat] = people;
  const out = await playToTheCheck(people);
  for (const p of people.filter((x) => x.state.you !== out)) assert.equal((await p.call('accept')).ok, true);
  await until(() => people.every((p) => p.state.phase === 'finished'), 'the game to finish');
  assert.equal(ann.state.winner, out);
  await until(async () => (await Promise.all(people.map(played))).every((n) => n === 1), 'the game to be recorded once for each of them');

  const seat = cat.state.you;
  const left = ann.state.seats[seat].cards;
  assert.equal((await cat.call('leave')).ok, true);
  await until(() => cat.state === null, 'Cat to be out');
  await until(() => ann.state.seats[seat]?.online === false, 'her seat to show as away');
  assert.deepEqual([ann.state.seats[seat].name, ann.state.seats[seat].cards, ann.state.seats[seat].bot], ['cat', left, false], 'the final table still names her and her cards');
  assert.equal(ann.state.winner, out, 'and the result stands');
  assert.equal((await bob.call('again')).ok, false, 'only the host sends the table back to the lobby');
  assert.equal((await ann.call('again')).ok, true);
  await until(() => [ann, bob].every((p) => p.state.phase === 'lobby'), 'the lobby');
  assert.equal(ann.state.seats[seat], null, 'the seat of the one who left is free for the next game');
  assert.equal(ann.state.seats.filter(Boolean).length, 2);
  assert.equal((await cat.call('join', { code })).ok, true, 'and she may sit down again');
  assert.equal(await played(ann), 1, 'going back to the lobby records nothing more');
});
