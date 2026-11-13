// Garbage in, for the two places server.test.js does not reach.  That file already throws malformed payloads at every
// socket event in the lobby, during a round, and after the game; what it never does is (1) send a `play` that is well
// formed and dishonest - a table laid with tiles the player does not hold, or the same tile twice, or thousands of
// sets - and (2) attack the screen between two rounds, where the game is waiting for people to press Continue.
//
// A play is the whole table as the client would like it to be, so it is the one request in Rummikub where the client
// states what the tiles are; if the server took its word for anything, a player could lay tiles out of the pool or
// out of somebody else's rack.  Every one of these must be refused with a code the game has words for, must leave the
// game exactly as it was for everybody, and must not stop the game being played afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, handledSocketEvents, launchModule, prototypeNames, until } from '../../shared/testkit.js';
import { bestPlay } from './testing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.RUMMIKUB_BOT_DELAY = '0-3';
process.env.RUMMIKUB_ROUND_WAIT = '600000'; // far longer than any wait here: only people pressing Continue start a round

// Every refusal is a code with words in the game's own locale file or the site's (never a sentence, never a stack).
const gameErrors = JSON.parse(fs.readFileSync(path.join(here, 'locales', 'en.json'), 'utf8')).errors;
const siteErrors = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'src', 'locales', 'en.json'), 'utf8')).errors;
const hasWords = (code) => Object.hasOwn(gameErrors, code) || Object.hasOwn(siteErrors, code);

/** The events the module handles, with the payload fields each one reads. */
const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['seats', 'numbers', 'colours', 'wildcards', 'rounds', 'meld', 'timer', 'playOnMeld'],
  leave: [],
  kick: ['slot'],
  voteKick: ['slot'],
  voteAnswer: ['agree'],
  voteDrop: [],
  settings: ['numbers', 'colours', 'wildcards', 'rounds', 'meld', 'timer', 'size', 'playOnMeld'],
  addBot: ['seat'],
  removeBot: ['slot'],
  fillBots: ['count'],
  start: [],
  play: ['table'],
  draw: [],
  next: [],
  again: [],
};

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), Object.keys(EVENTS).sort());
});

/** What a player can see of where every tile is: enough to tell whether anything moved. */
const picture = (s) => JSON.stringify({ phase: s.phase, round: s.round, turn: s.turn, table: s.table, rack: s.rack, pool: s.poolCount, counts: s.seats.map((seat) => seat.count), scores: s.seats.map((seat) => seat.score), melded: s.seats.map((seat) => seat.melded) });

/** A person takes their turn the way the standard computer logic would, from their own view only.  Returns true if they acted. */
async function step(person) {
  const s = person.state;
  if (!s || s.phase !== 'playing' || s.turn !== s.you) return false;
  const play = bestPlay({ settings: s.settings, racks: { [s.you]: s.rack }, table: s.table, melded: { [s.you]: s.seats[s.you].melded } }, s.you, { budget: 1500 });
  const reply = play ? await person.call('play', { table: play.table }) : await person.call('draw');
  assert.equal(reply.ok, true, reply.error);
  return true;
}

/** Plays everybody's turns until `done()`; the people's views are waited on, never the clock. */
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

/** Two people at a table of two, in a round, with a small set of tiles so that rounds are short. */
async function twoPlaying(t, settings = {}) {
  const site = await launchModule(t, { id: 'rummikub', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const created = await ann.call('create', { seats: 2, numbers: 9, colours: 4, wildcards: 2, ...settings });
  assert.equal(created.ok, true, created.error);
  assert.equal((await bob.call('join', { code: created.code })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => [ann, bob].every((p) => p.state?.phase === 'playing'), 'the round to begin');
  return { site, ann, bob, eve, code: created.code };
}

test('a play that lays tiles the player does not hold is refused, whoever sends it, and nothing moves', async (t) => {
  const before = prototypeNames();
  const { site, ann, bob, eve } = await twoPlaying(t);
  // A few turns first, so that there is a table to tamper with as well as racks.
  await playUntil([ann, bob], () => ann.state.table.length > 0 || ann.state.round > 1 || ann.state.phase !== 'playing', 'some tiles on the table');
  await until(() => [ann, bob].every((p) => p.state.phase === 'playing' && p.state.version === ann.state.version), 'both people to have the same picture of the round');
  assert.equal(ann.state.phase, 'playing', 'the round is still on');
  const mover = ann.state.turn === ann.state.you ? ann : bob;
  const other = mover === ann ? bob : ann;
  const s = mover.state;
  const total = s.deal.total;
  const onTable = s.table.flat();
  // Every tile there is, less the ones this player can account for, is in the pool or the other rack.
  const notMine = Array.from({ length: total }, (_, id) => id).filter((id) => !s.rack.includes(id) && !onTable.includes(id));
  assert.equal(notMine.length, s.poolCount + other.state.rack.length, 'the tiles a player cannot see are the pool and the other rack');
  const theirs = other.state.rack;
  const table = s.table.map((set) => [...set]);
  const triples = (ids) => ids.slice(0, 30).flatMap((_, i) => (i + 2 < ids.length ? [[ids[i], ids[i + 1], ids[i + 2]]] : []));
  const hostile = [
    ...triples(notMine).map((set) => [...table, set]), // sets made of tiles from the pool and the other rack
    ...triples(theirs).map((set) => [...table, set]), // the other player's tiles, by name
    [...table, [theirs[0], s.rack[0], s.rack[1]]], // one borrowed tile among two honest ones
    [...table, [s.rack[0], s.rack[0], s.rack[0]]], // one tile three times
    [...table, [s.rack[0], s.rack[1], s.rack[2]], [s.rack[0], s.rack[1], s.rack[2]]], // one set twice
    table.slice(1), // a set taken off the table
    table, // nothing added
    [], // the table swept clean
    [...table, [total, total + 1, total + 2]], // tiles that do not exist
    [...table, [-1, -2, -3]],
    [...table, [0.5, 1.5, 2.5]],
    [...table, ['0', '1', '2']],
    [...table, [null, null, null]],
    [...table, [[s.rack[0]], [s.rack[1]], [s.rack[2]]]],
    [...table, { 0: s.rack[0], 1: s.rack[1], 2: s.rack[2], length: 3 }],
    Array.from({ length: 5000 }, () => [s.rack[0], s.rack[1], s.rack[2]]), // thousands of sets
    [...table, Array.from({ length: 20000 }, (_, i) => i)], // one enormous set
  ];
  const pictures = { mover: picture(mover.state), other: picture(other.state) };
  const version = mover.state.version;
  for (const [who, person] of [['the player to move', mover], ['the other player', other], ['somebody not in the game', eve]]) {
    for (const proposed of hostile) {
      const reply = await person.call('play', { table: proposed });
      const what = `${who} playing ${JSON.stringify(proposed).slice(0, 70)}`;
      assert.equal(reply.ok, false, `${what}: must be refused`);
      assert.ok(hasWords(reply.error), `${what}: refused with a code that has words (${String(reply.error).slice(0, 60)})`);
      assert.ok(JSON.stringify(reply).length < 2000, `${what}: the refusal does not echo the table back`);
    }
  }
  // A refusal is told to nobody: no new state was sent, and what each player has is what they had.
  assert.equal((await mover.call('resume', {})).ok, true, 'the server still answers');
  assert.equal(mover.state.version, version, 'the round has not moved on');
  assert.equal(picture(mover.state), pictures.mover, 'the player to move sees exactly what they saw');
  assert.equal(picture(other.state), pictures.other, 'and so does the other player');
  assert.equal(await site.alive(), true);
  assert.deepEqual(site.serverErrors(), [], 'none of it reached a handler as an exception');
  assertNoPollution(before);
  // And an honest turn still works.
  assert.equal(await step(mover), true);
  await until(() => other.state.version > version, 'the turn to pass');
});

test('garbage for every event while the table waits between two rounds: the scores stand, and the next round still starts', async (t) => {
  const before = prototypeNames();
  const { site, ann, bob, eve } = await twoPlaying(t, { rounds: 2 });
  await playUntil([ann, bob], () => [ann, bob].every((p) => p.state.phase === 'between'), 'round one to end');
  const scores = ann.state.seats.map((seat) => seat.score);
  assert.equal(ann.state.scoreboard.rounds.length, 1, 'one round is on the scoreboard');

  /** The view is still a sound picture of a table waiting between rounds one and two (or playing round two). */
  const check = (person, label) => {
    const s = person.state;
    assert.ok(s, `${label}: still in the game`);
    assert.ok(s.phase === 'between' || (s.phase === 'playing' && s.round === 2), `${label}: between rounds, or in round two (was ${s.phase}, round ${s.round})`);
    assert.equal(s.seats.length, 2, `${label}: the table is the size it was`);
    assert.ok(s.seats.every((seat) => seat && !seat.bot), `${label}: both people are still seated`);
    assert.equal(s.seats.reduce((n, seat) => n + seat.count, 0) + s.poolCount + s.table.flat().length, s.deal.total, `${label}: every tile accounted for`);
    assert.ok(!JSON.stringify(s).includes('"pool"'), `${label}: no pool in a view`);
    if (s.phase === 'between') assert.deepEqual(s.seats.map((seat) => seat.score), scores, `${label}: the scores stand`);
    assert.deepEqual(s.settings, ann.state.settings, `${label}: the settings are as they were`);
  };
  const settings = JSON.stringify(ann.state.settings);
  const replyCheck = (reply, label) => {
    if (reply.ok === false) assert.ok(hasWords(reply.error), `${label}: refused with a code that has words (${String(reply.error).slice(0, 60)})`);
  };
  // An outsider first, then Bob (who is not the host): neither may change anything except Bob saying he is ready.
  let checked = 0;
  for (const event of Object.keys(EVENTS).filter((e) => !['create', 'leave'].includes(e))) {
    checked += await fuzzEvent(eve, event, EVENTS[event], { replyCheck });
    assert.equal((await ann.call('resume', {})).ok, true, `${event}: the server still answers`);
    check(ann, `after an outsider's ${event}`);
  }
  assert.equal(ann.state.phase, 'between', 'an outsider cannot start the round');
  assert.equal(ann.state.seats.some((seat) => seat.ready), false, 'or be ready on anybody\'s behalf');
  for (const event of Object.keys(EVENTS).filter((e) => !['create', 'leave', 'voteKick', 'voteAnswer', 'voteDrop'].includes(e))) {
    checked += await fuzzEvent(bob, event, EVENTS[event], { replyCheck });
    assert.equal((await ann.call('resume', {})).ok, true, `${event}: the server still answers`);
    check(ann, `after Bob's ${event}`);
    check(bob, `Bob after his own ${event}`);
  }
  assert.ok(checked > 500, `a big battery was thrown (${checked})`);
  assert.equal(ann.state.phase, 'between', 'Ann has not pressed Continue, so the round has not started');
  assert.equal(JSON.stringify(ann.state.settings), settings);
  assert.equal(await site.alive(), true);
  assertNoPollution(before);

  // The game is still a game: both press Continue, round two is dealt, and it can be played to the end.  (Bob's
  // garbage may already have said he was ready, in which case Ann's Continue starts the round and his has nothing to do.)
  assert.equal((await ann.call('next')).ok, true);
  await bob.call('next');
  await until(() => [ann, bob].every((p) => p.state.phase === 'playing' && p.state.round === 2), 'round two');
  assert.deepEqual(ann.state.table, [], 'a new round starts with a clear table');
  await playUntil([ann, bob], () => [ann, bob].every((p) => p.state.phase === 'finished'), 'the game to finish');
  assert.equal(ann.state.scoreboard.rounds.length, 2);
});
