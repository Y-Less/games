// The life of a tour against the real site: the site restarting in the middle of a vote and in the middle of a game,
// people leaving and coming back, a connection dropping, one account on two devices, and the host walking out.
//
// rules.md makes three promises that only a running site can keep or break, and they are what is protected here:
// "come back to its address and you will find it where you left it"; "leaving the tour does not take you out of a game
// it sent you to, and leaving that game does not take you out of the tour"; and "when it ends, the tour opens the next
// vote" - which has to stay true of a game that was opened before the site was restarted.
//
// The games a tour opens are the stand-ins the other tour suites use (fixtures/standIn.js): they start at once and end
// when they are told to, so nothing here waits on how a real game happens to play.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { launchModule, until } from '../../shared/testkit.js';
import { modulesWithStandIns } from './fixtures/standIn.js';

process.env.TOUR_BOT_DELAY = '1-4';

const here = path.dirname(fileURLToPath(import.meta.url));
const STAND_INS = ['mini', 'midi', 'maxi']; // three, so a vote has three games to offer
const CODE = /^[a-z]+-[a-z]+-[a-z]+$/;

/**
 * Starts the site with the tour and its stand-ins.  Give it the `dataDir` of a site that has been stopped (and
 * `keep: true` the first time) to start again on the same saved rooms and accounts; the second site, started without
 * `keep`, is the one that clears the folder away once it has closed.
 */
async function launch(t, { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-life-')), keep = false } = {}) {
  // launchModule copies one module; a tour needs something to open, so the folder is built first and it finds it made.
  if (!fs.existsSync(path.join(dataDir, 'copy'))) modulesWithStandIns(path.join(dataDir, 'copy'), here, STAND_INS);
  return launchModule(t, { id: 'tour', moduleDir: here, dataDir, keep });
}

/**
 * This person's socket on another module's namespace: the game a tour sent them to.  (A testkit person talks only to
 * the tour.)
 * @returns {Promise<{ state: object | null | undefined, call: (event: string, payload?: object) => Promise<object> }>}
 */
async function inGame(t, site, person, module) {
  const socket = connect(`${site.base}/${module}`, { forceNew: true, extraHeaders: { cookie: person.cookie } });
  t.after(() => socket.close());
  const seat = {
    state: undefined,
    call: (event, payload = {}) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: 'timeout' }), 5000);
        socket.emit(event, payload, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
      }),
  };
  socket.on('state', (state) => (seat.state = state));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return seat;
}

/** The same account on a site that has been started again: its cookie still signs it in. */
async function comeBack(site, person) {
  const again = site.person(person.name);
  again.cookie = person.cookie;
  again.id = person.id;
  await again.connect();
  return again;
}

/** A tour of these people, started, with its first vote open and seen by all of them. */
async function votingTour(site, names) {
  const people = await Promise.all(names.map((name) => site.person(name).open()));
  const [host, ...rest] = people;
  const created = await host.call('create', {});
  assert.equal(created.ok, true, created.error);
  assert.match(created.code, CODE);
  for (const p of rest) assert.equal((await p.call('join', { code: created.code })).ok, true, `${p.name} joined`);
  await until(() => people.every((p) => p.state?.players.length === people.length), 'everybody in the lobby');
  assert.equal((await host.call('start', {})).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'voting'), 'the first vote to open');
  return { people, code: created.code };
}

/** Everybody votes for the first game on offer, and the tour opens it. */
async function playFirstChoice(people) {
  const choice = people[0].state.choices[0].id;
  for (const p of people) assert.equal((await p.call('vote', { choice })).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'playing'), 'the tour to open the game');
  const { game, code } = people[0].state.current;
  assert.equal(game, choice, 'what everybody voted for is what was opened');
  return { game, code };
}

const playerOf = (state, person) => state.players.find((p) => p.userId === person.id);

test('a vote survives a restart of the site: the same games on offer, and the votes already cast', async (t) => {
  const first = await launch(t, { keep: true });
  const { people, code } = await votingTour(first, ['ann', 'bob']);
  const [ann, bob] = people;
  const offered = ann.state.choices.map((choice) => choice.id);
  assert.equal(offered.length, 3, 'three stand-ins, so three games on offer');
  assert.equal((await ann.call('vote', { choice: offered[1] })).ok, true);
  await until(() => bob.state.players.find((p) => p.userId === ann.id).voted, 'the vote to reach the table');
  await first.stop();

  const second = await launch(t, { dataDir: first.dataDir });
  const [annBack, bobBack] = [await comeBack(second, ann), await comeBack(second, bob)];
  for (const p of [annBack, bobBack]) assert.deepEqual(await p.call('resume', {}), { ok: true, code });
  await until(() => [annBack, bobBack].every((p) => p.state?.phase === 'voting'), 'the vote still open after the restart');
  assert.deepEqual(annBack.state.choices.map((choice) => choice.id), offered, 'the same three games, in the same order');
  assert.equal(annBack.state.yourVote, offered[1], 'her vote was kept');
  assert.equal(bobBack.state.yourVote, null, 'and nobody voted for him');
  assert.equal(bobBack.state.choices[1].votes, 1);
  assert.ok(annBack.state.until > Date.now(), 'the vote is still on its clock');

  // The vote can still be finished, and what wins is what the two of them chose.
  assert.equal((await bobBack.call('vote', { choice: offered[1] })).ok, true);
  await until(() => [annBack, bobBack].every((p) => p.state?.phase === 'playing'), 'the tour to open the game');
  assert.equal(annBack.state.current.game, offered[1]);
  assert.match(annBack.state.current.code, CODE);
});

test('a game the tour opened before a restart still brings the tour back to a vote when it ends', async (t) => {
  const first = await launch(t, { keep: true });
  const { people, code } = await votingTour(first, ['ann', 'bob']);
  const [ann, bob] = people;
  const current = await playFirstChoice(people);
  await first.stop();

  const second = await launch(t, { dataDir: first.dataDir });
  const [annBack, bobBack] = [await comeBack(second, ann), await comeBack(second, bob)];
  for (const p of [annBack, bobBack]) assert.deepEqual(await p.call('resume', {}), { ok: true, code });
  await until(() => [annBack, bobBack].every((p) => p.state?.phase === 'playing'), 'the tour still out at its game');
  assert.deepEqual({ game: annBack.state.current.game, code: annBack.state.current.code }, current, 'the same game, in the same room');
  assert.deepEqual(annBack.state.played.map((p) => p.code), [current.code]);

  // The game itself came through too, with both of them still at its table.
  const table = await inGame(t, second, annBack, current.game);
  assert.deepEqual(await table.call('resume', { code: current.code }), { ok: true, code: current.code });
  await until(() => table.state?.phase === 'playing', 'the game still under way');
  assert.deepEqual(table.state.players.filter((p) => !p.bot).map((p) => p.id).sort(), [ann.id, bob.id].sort());

  assert.equal((await table.call('endIt')).ok, true);
  await until(() => [annBack, bobBack].every((p) => p.state?.phase === 'voting'), 'the tour to come back to a vote');
  assert.equal(annBack.state.current, null);
  assert.deepEqual(annBack.state.played.map((p) => p.code), [current.code], 'and it remembers what it played');
  assert.equal(annBack.state.yourVote, null, 'everybody votes afresh');
});

test('a tour that has ended is still ended after a restart, and its host can start another', async (t) => {
  const first = await launch(t, { keep: true });
  const { people, code } = await votingTour(first, ['ann', 'bob']);
  for (const p of people) assert.equal((await p.call('vote', { choice: 'end' })).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'finished'), 'the tour to end');
  await first.stop();

  const second = await launch(t, { dataDir: first.dataDir });
  const [ann, bob] = [await comeBack(second, people[0]), await comeBack(second, people[1])];
  for (const p of [ann, bob]) assert.equal((await p.call('resume', { code })).ok, true);
  await until(() => [ann, bob].every((p) => p.state?.phase === 'finished'), 'the finished tour');
  assert.equal((await bob.call('again', {})).ok, false, 'starting another is the host\'s to do');
  assert.equal((await ann.call('again', {})).ok, true);
  await until(() => [ann, bob].every((p) => p.state?.phase === 'lobby'), 'the lobby again');
  assert.equal(ann.state.players.length, 2, 'with the same people');
  assert.deepEqual(ann.state.played, []);
});

test('leaving the tour does not take you out of the game it sent you to, and leaving the game does not take you out of the tour', async (t) => {
  const site = await launch(t);
  const { people, code } = await votingTour(site, ['ann', 'bob', 'cat']);
  const [ann, bob, cat] = people;
  const current = await playFirstChoice(people);

  const bobAtTable = await inGame(t, site, bob, current.game);
  const catAtTable = await inGame(t, site, cat, current.game);
  for (const seat of [bobAtTable, catAtTable]) assert.deepEqual(await seat.call('resume', { code: current.code }), { ok: true, code: current.code });
  await until(() => bobAtTable.state?.phase === 'playing' && catAtTable.state?.phase === 'playing', 'both of them at the game');

  // Bob leaves the tour.  He is out of it, and still in the game.
  assert.equal((await bob.call('leave', {})).ok, true);
  await until(() => bob.state === null, 'bob to be out of the tour');
  await until(() => ann.state.players.every((p) => p.userId !== bob.id), 'the tour to show him gone');
  assert.deepEqual(await bobAtTable.call('resume', { code: current.code }), { ok: true, code: current.code });
  assert.ok(bobAtTable.state.players.some((p) => p.id === bob.id), 'he still has his place at the game');

  // Cat leaves the game.  She is out of it, and still in the tour.
  assert.equal((await catAtTable.call('leave', {})).ok, true);
  await until(() => catAtTable.state === null, 'cat to be out of the game');
  assert.deepEqual(await cat.call('resume', {}), { ok: true, code });
  assert.equal(cat.state.phase, 'playing');
  assert.ok(playerOf(cat.state, cat), 'she is still in the tour');
  assert.equal(ann.state.players.length, 3, 'which is as big as it was');
});

test('somebody who leaves in the middle of a vote can come back to their place with the same code', async (t) => {
  const site = await launch(t);
  const { people, code } = await votingTour(site, ['ann', 'bob', 'cat']);
  const [ann, bob] = people;
  const slot = playerOf(ann.state, bob).slot;

  assert.equal((await bob.call('leave', {})).ok, true);
  await until(() => bob.state === null, 'bob to be out');
  await until(() => ann.state.players.every((p) => p.userId !== bob.id), 'the tour to show him gone');
  assert.equal(ann.state.phase, 'voting', 'the vote carries on without him');
  assert.equal(ann.state.players.length, 3, 'a computer player keeps his place');
  assert.equal(ann.state.players.find((p) => p.slot === slot).bot, true);
  assert.equal((await bob.call('vote', { choice: ann.state.choices[0].id })).ok, false, 'he has no vote while he is out');

  assert.equal((await bob.call('join', { code })).ok, true);
  await until(() => bob.state?.phase === 'voting' && playerOf(ann.state, bob), 'bob back in the vote');
  assert.equal(playerOf(ann.state, bob).slot, slot, 'in the place he left');
  assert.equal(ann.state.players.length, 3);
  assert.equal(ann.state.players.filter((p) => p.bot).length, 0, 'and the computer player has gone');
  assert.deepEqual(bob.state.choices.map((c) => c.id), ann.state.choices.map((c) => c.id), 'looking at the same vote');
  assert.equal((await bob.call('vote', { choice: bob.state.choices[0].id })).ok, true, 'and able to vote in it');
});

test('a connection that drops in the middle of a vote loses nothing: the vote cast before it is still there', async (t) => {
  const site = await launch(t);
  const { people, code } = await votingTour(site, ['ann', 'bob']);
  const [ann, bob] = people;
  const choice = bob.state.choices[2].id;
  assert.equal((await bob.call('vote', { choice })).ok, true);

  bob.socket.close();
  await until(() => playerOf(ann.state, bob).online === false, 'bob to show as away');
  assert.equal(ann.state.phase, 'voting');
  assert.equal(playerOf(ann.state, bob).voted, true, 'being away does not take a vote back');

  await bob.connect();
  assert.deepEqual(await bob.call('resume', {}), { ok: true, code });
  await until(() => playerOf(ann.state, bob).online === true, 'bob to show as back');
  assert.equal(bob.state.yourVote, choice);
  assert.equal(bob.state.choices[2].votes, 1);
});

test('one account on two devices has one vote, whichever device it is cast or changed from', async (t) => {
  const site = await launch(t);
  const { people, code } = await votingTour(site, ['ann', 'bob']);
  const [ann, bob] = people;
  const phone = await bob.twin();
  assert.deepEqual(await phone.call('resume', {}), { ok: true, code });
  await until(() => phone.state?.phase === 'voting', 'the phone to see the vote');
  const [one, two] = bob.state.choices.map((c) => c.id);

  const replies = await Promise.all([bob.call('vote', { choice: one }), phone.call('vote', { choice: two })]);
  assert.deepEqual(replies.map((r) => r.ok), [true, true], 'voting again changes your vote');
  await until(() => bob.state.yourVote !== null && bob.state.yourVote === phone.state.yourVote, 'both devices to agree');
  assert.ok([one, two].includes(bob.state.yourVote));
  const cast = (state) => state.choices.reduce((n, c) => n + c.votes, 0) + state.endVotes;
  assert.equal(cast(ann.state), 1, 'one person, one vote');
  assert.equal(ann.state.phase, 'voting', 'and the vote is not over: ann has yet to vote');

  assert.equal((await phone.call('vote', { choice: 'end' })).ok, true);
  await until(() => bob.state.yourVote === 'end', 'the change of mind to reach the other device');
  assert.equal(cast(ann.state), 1);
  assert.equal(ann.state.endVotes, 1);
});

test('when the host leaves, the tour passes to somebody still in it; when the last person leaves, it is gone', async (t) => {
  const site = await launch(t);
  const { people, code } = await votingTour(site, ['ann', 'bob']);
  const [ann, bob] = people;
  assert.equal(bob.state.isHost, false);

  assert.equal((await ann.call('leave', {})).ok, true);
  await until(() => ann.state === null, 'ann to be out');
  await until(() => bob.state.hostId === bob.id, 'the tour to pass to bob');
  assert.equal(bob.state.isHost, true);
  assert.equal(bob.state.phase, 'voting');

  assert.equal(bob.state.players.length, 2, 'with a computer player keeping her place');

  assert.equal((await bob.call('leave', {})).ok, true);
  await until(() => bob.state === null, 'bob to be out');
  const stranger = await site.person('eve').open();
  await until(async () => (await stranger.call('join', { code })).ok === false, 'the tour to be gone');
  assert.equal((await bob.call('create', {})).ok, true, 'and he is free to start another');
});

test('a vote to end the tour does not outlive the person who cast it', { todo: 'rules.md: "Computer players only ever vote for a game - when to stop is for the people at the table"; but the computer player that takes a leaver\'s place keeps the leaver\'s vote, so a vote to end still counts after its voter has gone' }, async (t) => {
  const site = await launch(t);
  const { people } = await votingTour(site, ['ann', 'bob', 'cat']);
  const [ann, bob] = people;
  assert.equal((await bob.call('vote', { choice: 'end' })).ok, true);
  await until(() => ann.state.endVotes === 1, 'the vote to reach the table');
  assert.equal((await bob.call('leave', {})).ok, true);
  await until(() => ann.state.players.every((p) => p.userId !== bob.id), 'a computer player in his place');
  assert.equal(ann.state.phase, 'voting');
  assert.equal(ann.state.endVotes, 0, 'no computer player is voting to end the tour');
});
