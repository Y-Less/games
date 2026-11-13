// Rummikub over real sockets, for the moments in a room's life that server.test.js does not visit.  That file restarts
// the site in the middle of a round, has a person leave and a second socket look on; this one is about two things
// happening at once (two people starting, one account drawing from two sockets), the site restarting while the table
// is waiting between rounds and after the game is over, the host walking out, and people dropping their connection
// when it is nobody's turn.  What is protected is that a game is dealt once, a turn is taken once, a result is
// recorded once, and nobody loses their seat or their score to a restart or a lost connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, until } from '../../shared/testkit.js';
import { bestPlay } from './testing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.RUMMIKUB_BOT_DELAY = '0-3';
process.env.RUMMIKUB_ROUND_WAIT = '600000'; // far longer than any wait here: only people pressing Continue start a round

const launch = (t, options = {}) => launchModule(t, { id: 'rummikub', moduleDir: here, ...options });
const oks = (replies) => replies.filter((r) => r.ok === true).length;
const played = async (person) => (await person.stats()).perGame.find((g) => g.name === 'Rummikub')?.played ?? 0;
const SMALL = { numbers: 9, colours: 4, wildcards: 2 }; // a small set of tiles, so that a round is short

/** A person takes their turn the way the standard computer logic would, from their own view only.  Returns true if they acted. */
async function step(person) {
  const s = person.state;
  if (!s || s.phase !== 'playing' || s.turn !== s.you) return false;
  const play = bestPlay({ settings: s.settings, racks: { [s.you]: s.rack }, table: s.table, melded: { [s.you]: s.seats[s.you].melded } }, s.you, { budget: 1500 });
  const reply = play ? await person.call('play', { table: play.table }) : await person.call('draw');
  return reply.ok === true; // a view can be a moment old: a turn refused as not theirs is simply tried again
}

/** Plays the people's turns until `done()`; the people's views are waited on, never the clock. */
async function playUntil(people, done, what) {
  await until(
    async () => {
      if (done()) return true;
      for (const p of people) if (!done()) await step(p);
      return done();
    },
    what,
    { timeout: 120000 },
  );
}

/** Ann (the host) and Bob at a table with `seats` places, the rest computer players, in round one. */
async function started(t, { seats = 2, settings = {}, site = null } = {}) {
  site ??= await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const created = await ann.call('create', { seats, ...SMALL, ...settings });
  assert.equal(created.ok, true, created.error);
  assert.equal((await bob.call('join', { code: created.code })).ok, true);
  if (seats > 2) assert.equal((await ann.call('fillBots', { count: seats })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => [ann, bob].every((p) => p.state?.phase === 'playing'), 'the round to begin');
  return { site, ann, bob, code: created.code };
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

test('the host pressing start on two sockets at once, and a guest pressing it too, deals exactly one game', async (t) => {
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 2, ...SMALL });
  assert.equal((await bob.call('join', { code })).ok, true);
  const twin = await ann.twin();
  assert.equal((await twin.call('resume', { code })).ok, true);
  const replies = await Promise.all([ann.call('start'), twin.call('start'), bob.call('start')]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  assert.equal(replies[2].ok, false, 'only the host starts');
  await until(() => [ann, twin, bob].every((p) => p.state?.phase === 'playing'), 'everybody to see the round');
  assert.equal(ann.state.round, 1, 'round one, dealt once');
  assert.deepEqual(twin.state.rack, ann.state.rack, 'both of the host\'s sockets hold the same rack');
  const total = ann.state.deal.total;
  assert.equal(ann.state.rack.length + bob.state.rack.length + ann.state.poolCount, total, 'every tile was dealt once');
  assert.equal(new Set([...ann.state.rack, ...bob.state.rack]).size, ann.state.rack.length + bob.state.rack.length, 'and no tile is in both racks');
});

test('one account drawing from two sockets at once, while the other player draws out of turn: one tile is drawn', async (t) => {
  const { ann, bob } = await started(t);
  const mover = ann.state.turn === ann.state.you ? ann : bob;
  const other = mover === ann ? bob : ann;
  const twin = await mover.twin();
  assert.equal((await twin.call('resume', {})).ok, true);
  await until(() => twin.state?.phase === 'playing', 'the second socket to see the round');
  const rack = mover.state.rack.length;
  const pool = mover.state.poolCount;
  const replies = await Promise.all([mover.call('draw'), twin.call('draw'), other.call('draw')]);
  // The mover's two draws: one is their turn, and by the time the second arrives the turn has passed.  The other
  // player's draw is either out of turn (refused) or, arriving after the mover's, their own turn (accepted): either way
  // nobody draws twice in one turn.
  assert.equal(oks(replies.slice(0, 2)), 1, JSON.stringify(replies));
  const drawn = oks(replies);
  await until(() => [mover, twin, other].every((p) => p.state.poolCount === pool - drawn), 'everybody to see the pool');
  assert.equal(mover.state.rack.length, rack + 1, 'one tile, not two');
  assert.deepEqual(twin.state.rack, mover.state.rack, 'both sockets agree on the rack');
  assert.equal(other.state.seats[mover.state.you].count, rack + 1, 'and so does the other player');
  assert.equal(mover.state.rack.length + other.state.rack.length + mover.state.poolCount + mover.state.table.flat().length, mover.state.deal.total, 'every tile is still somewhere, once');
});

test('a restart while the table waits between rounds: the scores, and who has pressed Continue, are as they were', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rummikub-between-'));
  const first = await launch(t, { dataDir, keep: true });
  const { ann, bob, code } = await started(t, { site: first, settings: { rounds: 2 } });
  await playUntil([ann, bob], () => [ann, bob].every((p) => p.state.phase === 'between'), 'round one to end');
  assert.equal((await ann.call('next')).ok, true);
  await until(() => bob.state.seats[ann.state.you].ready === true, 'Ann to show as ready');
  const before = bob.state;
  await first.stop();

  const second = await launch(t, { dataDir });
  const [annBack, bobBack] = [await comeBack(second, ann, code), await comeBack(second, bob, code)];
  for (const p of [annBack, bobBack]) {
    assert.equal(p.state.phase, 'between', 'still between the rounds');
    assert.equal(p.state.round, 1);
    assert.deepEqual(p.state.seats.map((seat) => seat.score), before.seats.map((seat) => seat.score), 'the scores of round one');
    assert.deepEqual(p.state.scoreboard.rounds, before.scoreboard.rounds, 'and the line on the scoreboard');
    assert.deepEqual(p.state.lastRound, before.lastRound, 'and the racks everybody was shown');
    assert.deepEqual(p.state.settings, before.settings);
  }
  assert.equal(bobBack.state.seats[annBack.state.you].ready, true, 'Ann had pressed Continue, and need not again');
  assert.equal(bobBack.state.seats[bobBack.state.you].ready, false, 'the table is still waiting for Bob');
  assert.equal((await bobBack.call('next')).ok, true);
  await until(() => [annBack, bobBack].every((p) => p.state.phase === 'playing' && p.state.round === 2), 'round two');
  await playUntil([annBack, bobBack], () => [annBack, bobBack].every((p) => p.state.phase === 'finished'), 'the game to finish');
  await until(async () => (await played(annBack)) === 1 && (await played(bobBack)) === 1, 'the game to be recorded for both');
});

test('a restart after the game is over: the result is there to look at, and is not recorded a second time', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rummikub-finished-'));
  const first = await launch(t, { dataDir, keep: true });
  const { ann, bob, code } = await started(t, { site: first });
  await playUntil([ann, bob], () => [ann, bob].every((p) => p.state.phase === 'finished'), 'the game to finish');
  await until(async () => (await played(ann)) === 1, 'the game to be recorded');
  const before = ann.state;
  await first.stop();

  const second = await launch(t, { dataDir });
  const annBack = await comeBack(second, ann, code); // a finished game is found by its code
  assert.equal(annBack.state.phase, 'finished');
  assert.deepEqual(annBack.state.winners, before.winners);
  assert.deepEqual(annBack.state.final, before.final);
  assert.deepEqual(annBack.state.scoreboard.rounds, before.scoreboard.rounds);
  const bobBack = await comeBack(second, bob, code);
  assert.equal(bobBack.state.phase, 'finished');
  // The host sends everybody back to the lobby, which is a change to the room and a save of it: if a restart were going
  // to record the finished game again, it has had every chance to by now.
  assert.equal((await annBack.call('again')).ok, true);
  await until(() => [annBack, bobBack].every((p) => p.state.phase === 'lobby'), 'the lobby');
  assert.equal(await played(annBack), 1, 'recorded once');
  assert.equal(await played(bobBack), 1, 'for each of them');
  assert.equal(second.site.db.prepare('SELECT COUNT(*) AS n FROM results').get().n, 1, 'one result in the statistics');
});

test('the host walking out mid-game: a computer player takes the seat, the other person is the host, and can play again', async (t) => {
  const { ann, bob } = await started(t, { seats: 3 });
  const seat = ann.state.you;
  assert.equal(bob.state.hostSeat, seat);
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'Ann to be out');
  await until(() => bob.state.seats[seat].bot === true, 'a computer player in her seat');
  assert.equal(bob.state.hostSeat, bob.state.you, 'the person left at the table is the host');
  assert.equal(bob.state.seats.filter((s) => s.bot).length, 2);
  await playUntil([bob], () => bob.state.phase === 'finished', 'the game to finish');
  await until(async () => (await played(bob)) === 1, 'the game to be recorded for Bob');
  assert.equal(await played(ann), 0, 'somebody who left is not in the result');
  assert.equal((await ann.call('again')).ok, false, 'and is nobody\'s host');
  assert.equal((await bob.call('again')).ok, true, 'the new host sends the table back to the lobby');
  await until(() => bob.state.phase === 'lobby', 'the lobby');
  assert.equal((await ann.call('create', { seats: 2 })).ok, true, 'the one who left is free to start a game of their own');
});

test('a dropped connection between rounds and after the game costs nobody their seat', async (t) => {
  const { ann, bob, code } = await started(t, { settings: { rounds: 2 } });
  const seat = bob.state.you;
  /** Bob's connection drops and comes back: he is shown as away, never replaced, and gets the same game again. */
  const dropAndReturn = async (phase) => {
    bob.socket.close();
    await until(() => ann.state.seats[seat].online === false, `Bob to show as away (${phase})`);
    assert.equal(ann.state.seats[seat].bot, false, 'a lost connection is not leaving: no computer player takes the seat');
    assert.equal(ann.state.phase, phase, 'and the table waits');
    await bob.connect();
    assert.deepEqual(await bob.call('resume', { code }), { ok: true, code });
    await until(() => bob.state?.phase === phase && ann.state.seats[seat].online === true, `Bob to be back (${phase})`);
    assert.equal(bob.state.you, seat, 'in the seat he had');
    assert.deepEqual(bob.state.seats.map((s) => s.score), ann.state.seats.map((s) => s.score));
  };
  await playUntil([ann, bob], () => [ann, bob].every((p) => p.state.phase === 'between'), 'round one to end');
  assert.equal((await ann.call('next')).ok, true);
  await dropAndReturn('between');
  assert.equal(ann.state.phase, 'between', 'the round did not start while he was away: the table waits for every person');
  assert.equal((await bob.call('next')).ok, true);
  await until(() => [ann, bob].every((p) => p.state.phase === 'playing' && p.state.round === 2), 'round two');
  await playUntil([ann, bob], () => [ann, bob].every((p) => p.state.phase === 'finished'), 'the game to finish');
  await dropAndReturn('finished');
  await until(async () => (await played(ann)) === 1 && (await played(bob)) === 1, 'the game to be recorded for both');
});

test('when the last person leaves, the room is gone: the code no longer opens anything', async (t) => {
  const { site, ann, bob, code } = await started(t, { seats: 3 });
  assert.equal((await ann.call('leave')).ok, true);
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => ann.state === null && bob.state === null, 'both to be out');
  const cat = await site.person('cat').open();
  assert.equal((await cat.call('join', { code })).ok, false, 'a table of computer players is not kept');
  assert.equal((await ann.call('resume', { code })).ok, false);
  assert.equal((await ann.call('draw')).ok, false);
  assert.equal(await played(ann), 0);
  assert.equal(await site.alive(), true);
});
