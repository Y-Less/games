// Concurrency and lifecycle for Tints and Hints, against the real site: simultaneous actions, several sockets for one
// account, disconnects and reconnects in every phase, the host going away, rooms vanishing and one game per account.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until, sleep } from '../../shared/testkit.js';
import { checkRun } from './checks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t) => launchModule(t, { id: 'tints-and-hints', moduleDir: here });

async function gameOf(site, names, { turnsEach = 1 } = {}) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const [host, ...others] = people;
  const created = await host.call('create', { turnsEach });
  assert.equal(created.ok, true);
  for (const p of others) assert.equal((await p.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === people.length), 'everyone in the lobby');
  return { people, host, others, code: created.code, hinter: () => people.find((p) => p.state?.hinter === p.id) };
}
const allIn = (people, phase) => until(() => people.every((p) => p.state?.phase === phase), `everyone in ${phase}`);

test('two actions in the same tick: only one wins (start, guess, advance), from different sockets and accounts', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat']);
  const { people, host } = g;
  const hostTab = await host.twin();
  await hostTab.call('resume', {});
  const replies = await Promise.all([host.call('start', {}), hostTab.call('start', {}), g.others[0].call('start', {})]);
  assert.deepEqual(replies.map((r) => r.ok).sort(), [false, false, true], 'exactly one start succeeds');
  await allIn(people, 'guessing1');
  const turnAtStart = host.state.turn;
  assert.equal(turnAtStart, 1);

  // Two guessers guess at once, and the same guesser from two sockets at once.
  const hinter = g.hinter();
  const [first, second] = people.filter((p) => p !== hinter);
  const firstTab = await first.twin();
  await firstTab.call('resume', {});
  await until(() => firstTab.state?.phase === 'guessing1', 'the second tab');
  const guessReplies = await Promise.all([first.call('guess', { cell: 'C3' }), firstTab.call('guess', { cell: 'D4' }), second.call('guess', { cell: 'E5' })]);
  assert.equal(guessReplies.filter((r) => r.ok).length, 2, 'one guess each, never two from one person');
  assert.equal(guessReplies[2].ok, true);
  await sleep(40);
  const mine = hinter.state.guesses.filter((x) => x.id === first.id);
  assert.equal(mine.length, 1, 'the hinter sees exactly one guess from that account');
  assert.deepEqual(first.state.guesses, firstTab.state.guesses, 'both of the account\'s sockets agree');

  // Two simultaneous advances close one round, not two.
  const hinterTab = await hinter.twin();
  await hinterTab.call('resume', {});
  await until(() => hinterTab.state?.phase === 'guessing1', 'the hinter tab');
  const adv = await Promise.all([hinter.call('advance', {}), hinterTab.call('advance', {}), hinter.call('advance', {})]);
  assert.equal(adv.filter((r) => r.ok).length, 1, 'the round closes once');
  await allIn(people, 'guessing2');
  await sleep(30);
  assert.equal(host.state.phase, 'guessing2', 'it did not skip on to the reveal');
  assert.equal(host.state.guesses.length === 0 || host.state.guesses.every((x) => x.round === 1), true);

  // Both rounds again, then two advances at the reveal move exactly one turn on.
  for (const p of [first, second]) assert.equal((await p.call('guess', { cell: 'A1' })).ok, true);
  assert.equal((await hinter.call('advance', {})).ok, true);
  await allIn(people, 'reveal');
  const reveal = await Promise.all([hinter.call('advance', {}), hinterTab.call('advance', {}), host.call('advance', {})]);
  assert.equal(reveal.filter((r) => r.ok).length, 1, 'the reveal closes once');
  await allIn(people, 'guessing1');
  await sleep(40);
  assert.equal(host.state.turn, 2, 'one turn on, not two');
  for (const p of people) checkRun(p.states, p.name);
});

test('two people try for the last seat: exactly one gets it', async (t) => {
  const site = await launch(t);
  const names = ['pat', 'quin', 'rex', 'sue', 'tom', 'una', 'vic'];
  const g = await gameOf(site, names);
  assert.equal(g.host.state.players.length, 7);
  const [x, y, z] = await Promise.all(['xan', 'yul', 'zed'].map((n) => site.person(n).open()));
  const replies = await Promise.all([x, y, z].map((p) => p.call('join', { code: g.code })));
  assert.equal(replies.filter((r) => r.ok).length, 1, 'one seat, one winner');
  assert.equal(replies.filter((r) => !r.ok).every((r) => /full/.test(r.error)), true);
  await sleep(40);
  assert.equal(g.host.state.players.length, 8);
  const losers = [x, y, z].filter((_, i) => !replies[i].ok);
  for (const l of losers) assert.equal(l.state, null);
  // Nobody can then be added later either, and joining twice does not take two seats.
  const winner = [x, y, z].find((_, i) => replies[i].ok);
  assert.equal((await winner.call('join', { code: g.code })).ok, true);
  assert.equal(g.host.state.players.length, 8);
});

test('disconnecting and reconnecting in every phase keeps your place, your guess and the secrets', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat']);
  const { people } = g;
  const [ann, bob, cat] = people;

  /** Bob drops his connection, everyone else sees him away, then he returns and resumes. */
  async function bounce(label, bobKeepsState) {
    const before = bob.state;
    bob.socket.close();
    await until(() => ann.state.players.find((p) => p.id === bob.id).online === false, `bob away (${label})`);
    assert.equal(ann.state.scoreboard.players.find((p) => p.id === bob.id).away, true);
    await bob.connect();
    assert.deepEqual(await bob.call('resume', { code: g.code }), { ok: true, code: g.code });
    await until(() => bob.state?.phase === before.phase, `bob back (${label})`);
    await until(() => ann.state.players.find((p) => p.id === bob.id).online === true, `bob online (${label})`);
    if (bobKeepsState) assert.deepEqual(bob.state.guesses, before.guesses);
    assert.equal(bob.state.you, bob.id);
    assert.equal(bob.state.code, g.code);
    return bob.state;
  }

  await bounce('lobby');
  assert.equal((await ann.call('start', {})).ok, true);
  await allIn(people, 'guessing1');
  const hinter = g.hinter();
  const tint = hinter.state.tint;
  const later = await bounce('guessing1');
  if (hinter !== bob) assert.equal(later.tint, null, 'a returning guesser does not get the tint');
  else assert.equal(later.tint, tint, 'a returning hinter still has it');

  const guessers = people.filter((p) => p !== hinter);
  await hinter.call('hint', { text: 'quite bright' });
  assert.equal((await guessers[0].call('guess', { cell: 'F5' })).ok, true);
  if (guessers[0] === bob) {
    const state = await bounce('after guessing', true);
    assert.equal(state.guesses.filter((x) => x.id === bob.id).length, 1);
    assert.equal((await bob.call('guess', { cell: 'F6' })).ok, false, 'still counts as having guessed');
  } else {
    assert.equal((await guessers[1].call('guess', { cell: 'G5' })).ok, true);
  }
  for (const p of guessers) if (!(await p.call('guess', { cell: 'H8' })).ok) continue;
  await until(() => hinter.state.guesses.length === 2, 'both guesses in');
  assert.equal((await hinter.call('advance', {})).ok, true);
  await allIn(people, 'guessing2');
  const second = await bounce('guessing2');
  assert.equal(second.hints.first, 'quite bright');
  for (const p of guessers) await p.call('guess', { cell: 'H8' });
  await until(() => hinter.state.guesses.filter((x) => x.round === 2).length === 2, 'round two guesses');
  assert.equal((await hinter.call('advance', {})).ok, true);
  await allIn(people, 'reveal');
  const revealed = await bounce('reveal');
  assert.equal(revealed.tint, tint);
  assert.ok(revealed.result);

  // Finish the game with bob dropping out and in at every step.
  for (let turn = 1; turn < 3; turn++) {
    assert.equal((await g.hinter().call('advance', {})).ok, true);
    await allIn(people, 'guessing1');
    await bounce(`turn ${turn + 1} guessing1`);
    for (let round = 0; round < 2; round++) {
      const h = g.hinter();
      for (const p of people.filter((x) => x !== h)) await p.call('guess', { cell: 'B2' });
      assert.equal((await h.call('advance', {})).ok, true);
      await allIn(people, round === 0 ? 'guessing2' : 'reveal');
    }
  }
  assert.equal((await g.hinter().call('advance', {})).ok, true);
  await allIn(people, 'finished');
  const done = await bounce('finished');
  assert.ok(done.players.every((p) => p.placement >= 1));
  // Back at the entry screen: a finished game no longer holds the account, a resume still finds its result.
  assert.deepEqual(await cat.call('resume', {}), { ok: true, code: null });
  assert.equal(cat.state, null, 'a finished game is not resumed without its code');
  await sleep(100);
  for (const p of people) assert.equal((await p.stats()).perGame[0].played, 1, 'recorded once despite the reconnections');
  for (const p of people) checkRun(p.states, p.name);
});

test('the host disconnecting keeps the host role; leaving passes it on; the host can remove anyone, online or not', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat']);
  const { people, host } = g;
  const [ann, bob, cat] = people;
  host.socket.close();
  await until(() => bob.state.players.find((p) => p.id === ann.id).online === false, 'ann away');
  assert.equal(bob.state.hostId, ann.id, 'a dropped connection does not move the host');
  assert.equal((await bob.call('start', {})).ok, false);
  await host.connect();
  await host.call('resume', {});
  await until(() => host.state?.phase === 'lobby', 'ann back');
  assert.equal(host.state.hostId, ann.id);

  assert.equal((await ann.call('kick', { userId: ann.id })).ok, false, 'cannot kick yourself');
  assert.equal((await ann.call('kick', { userId: 424242 })).ok, false, 'unknown id');
  assert.equal((await bob.call('kick', { userId: cat.id })).ok, false, 'only the host');

  assert.equal((await ann.call('start', {})).ok, true);
  await allIn(people, 'guessing1');
  bob.socket.close();
  await until(() => ann.state.players.find((p) => p.id === bob.id).online === false, 'bob away');
  assert.equal((await ann.call('kick', { userId: bob.id })).ok, true, 'a player can be removed mid-game');
  await until(() => ann.state.players.length === 2, 'bob removed');
  assert.ok(ann.state.players.every((p) => p.id !== bob.id));
  assert.equal(ann.state.phase === 'guessing1' || ann.state.phase === 'guessing2', true, 'the game went on with two');

  // Leaving passes the host role to whoever is first in the list.
  assert.equal((await ann.call('leave', {})).ok, true);
  await until(() => cat.state?.phase === 'abandoned' || cat.state?.hostId === cat.id, 'cat to host or the game to be abandoned');
  assert.equal(cat.state.hostId, cat.id);
  assert.equal(cat.state.phase, 'abandoned', 'one player left is not a game');
  for (const p of [ann, cat]) checkRun(p.states, p.name);
});

test('host transfer in the lobby, and a room vanishing while other sockets of the same account are connected', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob']);
  const [ann, bob] = g.people;
  const annTab = await ann.twin();
  await annTab.call('resume', {});
  await until(() => annTab.state?.phase === 'lobby', 'ann\'s second tab');
  assert.equal((await ann.call('leave', {})).ok, true);
  await until(() => ann.state === null && annTab.state === null, 'both tabs sent out');
  await until(() => bob.state.hostId === bob.id && bob.state.players.length === 1, 'bob hosts');
  assert.equal((await annTab.call('start', {})).ok, false);
  assert.equal((await annTab.call('guess', { cell: 'A1' })).error, 'You are not in a game.');

  // The last person leaves: the room is gone, even for a second socket that is still attached to it.
  const bobTab = await bob.twin();
  await bobTab.call('resume', {});
  await until(() => bobTab.state?.phase === 'lobby', 'bob\'s second tab');
  assert.equal((await bob.call('leave', {})).ok, true);
  await until(() => bob.state === null && bobTab.state === null, 'room gone for both tabs');
  for (const p of [ann, bob, bobTab]) {
    assert.deepEqual(await p.call('join', { code: g.code }), { ok: false, error: 'No game has that code.' });
    for (const [event, payload] of [['start', {}], ['advance', {}], ['hint', { text: 'x' }], ['guess', { cell: 'A1' }], ['kick', { userId: 1 }], ['colour', { colour: '#000000' }], ['settings', { turnsEach: 2 }]]) {
      const reply = await p.call(event, payload);
      assert.equal(reply.ok, false, event);
    }
  }
  assert.equal((await site.alive()), true);
  // Everyone is free to start afresh.
  assert.equal((await ann.call('create', {})).ok, true);
});

test('a game abandoned or finished frees its players; one live game per account otherwise', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob']);
  const [ann, bob] = g.people;
  const other = await site.person('dan').open();
  const dan = await other.call('create', {});
  assert.equal(dan.ok, true);

  // In a room (the lobby counts): create and join elsewhere are refused, from any of the account's sockets.
  const annTab = await ann.twin();
  const refusal = await annTab.call('create', {});
  assert.equal(refusal.ok, false);
  assert.match(refusal.error, /already in the game/);
  assert.match(refusal.error, new RegExp(g.code));
  await until(() => annTab.state?.code === g.code, 'the second tab is attached to the existing game');
  const refusedJoin = await ann.call('join', { code: dan.code });
  assert.equal(refusedJoin.ok, false);
  assert.match(refusedJoin.error, /already in the game/);
  assert.equal((await ann.call('resume', { code: dan.code })).ok, false);
  assert.equal(other.state.players.length, 1, 'dan\'s room is untouched');
  // Joining your own game again is fine, and does not duplicate you.
  assert.equal((await ann.call('join', { code: g.code })).ok, true);
  assert.equal(ann.state.players.filter((p) => p.id === ann.id).length, 1);

  // Mid-game too.
  assert.equal((await ann.call('start', {})).ok, true);
  await allIn(g.people, 'guessing1');
  assert.equal((await bob.call('create', {})).ok, false);
  assert.equal((await bob.call('join', { code: dan.code })).ok, false);
  // A newcomer cannot join a started game.
  const late = await site.person('late').open();
  assert.match((await late.call('join', { code: g.code })).error, /already started/);

  // One of two leaves: the game is abandoned. The other is free at once to start or join something else.
  assert.equal((await bob.call('leave', {})).ok, true);
  await until(() => ann.state.phase === 'abandoned', 'abandoned');
  assert.ok(ann.state.players.length === 1);
  assert.equal((await ann.call('join', { code: dan.code })).ok, true, 'free to join another game');
  await until(() => other.state.players.length === 2, 'ann in dan\'s room');
  await sleep(20);
  // The abandoned game was not recorded.
  assert.equal((await ann.stats()).perGame.length, 0);
  assert.equal((await bob.stats()).perGame.length, 0);
  for (const p of [ann, bob, other]) checkRun(p.states, p.name);
});
