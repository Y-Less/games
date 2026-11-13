// Property-style tests for the tour's rules: hundreds of seeded evenings, driven the way the server drives them, with
// everything that should always be true of a tour checked after every step.
//
// A tour holds no cards and keeps no score, so what there is to get wrong is all about *shape*: the phase it is in,
// whose votes count, what it may offer, and what it remembers.  These are the things a change to the vote could break
// quietly, and no single scripted test would notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import * as g from './game.js';

/** A catalogue with a wide spread of player counts, so that `playable` really does filter. */
const CATALOGUE = [
  { id: 'duo', name: 'Duo', minPlayers: 2, maxPlayers: 2 },
  { id: 'small', name: 'Small', minPlayers: 2, maxPlayers: 4 },
  { id: 'medium', name: 'Medium', minPlayers: 3, maxPlayers: 6 },
  { id: 'big', name: 'Big', minPlayers: 5, maxPlayers: 12 },
  { id: 'any', name: 'Any', minPlayers: 2, maxPlayers: 12 },
  { id: 'party', name: 'Party', minPlayers: 4, maxPlayers: 10 },
  { id: 'wide', name: 'Wide', minPlayers: 2, maxPlayers: 8 },
];

const pick = (rng, items) => items[Math.floor(rng() * items.length)];

/** Everything that must be true of a tour, whatever has just happened to it. */
function check(room, label) {
  assert.ok(['lobby', 'voting', 'opening', 'playing', 'finished'].includes(room.phase), `${label}: phase ${room.phase}`);
  assert.ok(room.players.length <= g.MAX_PLAYERS, `${label}: never more than the most it holds`);
  assert.equal(new Set(room.players.map((p) => p.id)).size, room.players.length, `${label}: no player twice`);
  assert.equal(new Set(room.players.map((p) => p.slot)).size, room.players.length, `${label}: no slot twice`);

  // Votes belong to people who are here, and are for something that was actually offered.
  const slots = new Set(room.players.map((p) => p.slot));
  for (const [slot, choice] of Object.entries(room.votes)) {
    assert.ok(slots.has(slot), `${label}: a vote from ${slot}, who is not in the tour`);
    assert.ok(choice === g.END || room.choices.includes(choice), `${label}: a vote for ${choice}, which was not offered`);
  }

  if (room.phase === 'voting') {
    assert.ok(room.choices.length > 0 && room.choices.length <= g.CHOICES, `${label}: ${room.choices.length} games offered`);
    assert.equal(new Set(room.choices).size, room.choices.length, `${label}: the same game offered twice`);
    for (const id of room.choices) {
      const game = CATALOGUE.find((entry) => entry.id === id);
      assert.ok(game, `${label}: ${id} is not a game`);
      assert.ok(room.players.length >= game.minPlayers && room.players.length <= game.maxPlayers, `${label}: ${id} does not hold ${room.players.length}`);
    }
    assert.equal(room.current, null, `${label}: nothing is being played during a vote`);
  }
  if (room.phase === 'playing') {
    assert.ok(room.current && room.current.game && room.current.code, `${label}: something is being played`);
    assert.deepEqual(room.played.at(-1), room.current, `${label}: what is being played is the last thing played`);
  }
  if (room.phase === 'finished') {
    assert.equal(g.isLive(room), false, `${label}: a finished tour is not live`);
    assert.equal(room.current, null);
    assert.deepEqual(room.choices, []);
  }
  // A vote stands while it is running and while the server is acting on what won; after that it is gone, so a
  // finished vote never rides along in the view for the length of a game.
  if (!['voting', 'opening'].includes(room.phase)) {
    assert.deepEqual(room.votes, {}, `${label}: votes outlived the vote`);
    assert.deepEqual(room.choices, [], `${label}: the choices outlived the vote`);
  }
}

/** Plays one whole evening with random choices, checking everything after every step. */
function playTour(seed) {
  const rng = seeded(seed);
  const label = `seed ${seed}`;
  const people = 2 + Math.floor(rng() * 6);
  const room = g.createRoom({ code: `code-${seed}`, hostId: 1, hostName: 'Ann', now: 0 });
  // A second person sometimes, and computer players for the rest: a tour of one person is still a tour.
  if (rng() < 0.5) assert.ok(g.addHuman(room, 2, 'Bob').ok);
  assert.ok(g.fillWithBots(room, 1, people).ok);
  check(room, label);

  const started = g.start(room, 1, rng, 1000, CATALOGUE);
  if (!started.ok) {
    // The only honest reason to refuse is that nothing here suits this many.
    assert.equal(started.error, 'noGamesForThisMany', `${label}: ${started.error}`);
    assert.equal(g.playable(CATALOGUE, room.players.length).length, 0);
    return room;
  }
  check(room, label);

  let clock = 2000;
  let played = 0;
  for (let step = 0; step < 200 && room.phase !== 'finished'; step++) {
    clock += 1000;
    if (room.phase === 'voting') {
      // Everybody votes, or some do: either way the vote settles when the server says so.
      for (const player of room.players) {
        if (rng() < 0.8) assert.ok(g.vote(room, player.id, pick(rng, [...room.choices, g.END])).ok);
        check(room, label);
      }
      const settled = g.settle(room, rng);
      assert.ok(settled.ok);
      assert.ok(settled.choice === g.END || room.choices.includes(settled.choice), `${label}: ${settled.choice} won without being offered`);
      check(room, label);
      continue;
    }
    if (room.phase === 'opening') {
      if (room.chosen === g.END) {
        assert.ok(g.finish(room).ok);
      } else if (rng() < 0.15) {
        // Sometimes the game will not open: the tour says so and votes again rather than ending the evening.
        assert.ok(g.openingFailed(room, 'gameFull', CATALOGUE, rng, clock).ok);
        assert.equal(room.phase, 'voting');
        assert.equal(room.trouble, 'gameFull');
      } else {
        assert.ok(g.playing(room, room.chosen, `room-${step}`, clock).ok);
        played += 1;
      }
      check(room, label);
      continue;
    }
    if (room.phase === 'playing') {
      // Somebody sometimes leaves while a game is on; a computer player takes their place and the tour carries on.
      if (rng() < 0.2 && g.humans(room).length > 1) {
        const leaver = pick(rng, g.humans(room));
        assert.ok(g.removeHuman(room, leaver.id, rng, clock).ok);
        check(room, label);
      }
      assert.ok(g.gameOver(room, CATALOGUE, rng, clock).ok);
      check(room, label);
    }
  }
  assert.equal(room.played.length, played, `${label}: it remembers exactly what it played`);
  return room;
}

test('a hundred seeded evenings stay consistent, whatever is voted for', () => {
  let finished = 0;
  let everPlayed = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const room = playTour(seed);
    if (room.phase === 'finished') finished += 1;
    everPlayed += room.played.length;
  }
  assert.ok(finished > 50, `most evenings end by vote (${finished} of 100)`);
  assert.ok(everPlayed > 50, `and plenty of games were played along the way (${everPlayed})`);
});

test('what is offered always suits the table, at every size the tour allows', () => {
  for (let players = g.MIN_PLAYERS; players <= g.MAX_PLAYERS; players++) {
    const pool = g.playable(CATALOGUE, players);
    for (let seed = 1; seed <= 20; seed++) {
      const chosen = g.drawChoices(pool, seeded(seed));
      assert.ok(chosen.length <= g.CHOICES, `${players}: never more than ${g.CHOICES}`);
      assert.equal(chosen.length, Math.min(g.CHOICES, pool.length), `${players}: as many as there are, up to ${g.CHOICES}`);
      assert.equal(new Set(chosen).size, chosen.length, `${players}: distinct`);
      for (const id of chosen) assert.ok(pool.some((game) => game.id === id), `${players}: ${id} suits them`);
    }
  }
});

test('the draw is even-handed: over many votes every suitable game comes up about as often as the others', () => {
  // Three of seven are offered each time, so each game should appear in roughly 3/7 of the votes.  This is what a
  // "fresh three, no memory" draw buys, and a draw that quietly favoured the front of the catalogue would fail here.
  const pool = g.playable(CATALOGUE, 6);
  assert.ok(pool.length >= 4, 'a pool worth measuring');
  const rng = seeded(99);
  const counts = Object.fromEntries(pool.map((game) => [game.id, 0]));
  const votes = 3000;
  for (let n = 0; n < votes; n++) for (const id of g.drawChoices(pool, rng)) counts[id] += 1;
  const expected = (votes * Math.min(g.CHOICES, pool.length)) / pool.length;
  for (const [id, count] of Object.entries(counts)) {
    assert.ok(Math.abs(count - expected) < expected * 0.15, `${id} came up ${count} times, expected about ${Math.round(expected)}`);
  }
});

test('a vote nobody answers never ends the evening, however the dice fall', () => {
  // The one asymmetry in the vote worth pinning down: silence means "carry on", not "stop".
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seeded(seed);
    const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 0 });
    assert.ok(g.fillWithBots(room, 1, 4).ok);
    assert.ok(g.start(room, 1, rng, 0, CATALOGUE).ok);
    const winner = g.winnerOf(room, rng);
    assert.notEqual(winner, g.END, `seed ${seed}: an unanswered vote ended the tour`);
    assert.ok(room.choices.includes(winner));
  }
});

test('somebody leaving a tour does not take their vote with them, or leave one behind', () => {
  const rng = seeded(4);
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 0 });
  assert.ok(g.addHuman(room, 2, 'Bob').ok);
  assert.ok(g.fillWithBots(room, 1, 4).ok);
  assert.ok(g.start(room, 1, rng, 0, CATALOGUE).ok);
  assert.ok(g.vote(room, 1, room.choices[0]).ok);
  assert.ok(g.vote(room, 2, room.choices[0]).ok);
  assert.equal(Object.keys(room.votes).length, 2);

  // Bob goes; a computer player takes his place and his slot, so the vote it inherits is his.
  const bobSlot = g.slotOf(room, 2);
  assert.ok(g.removeHuman(room, 2, rng, 1000).ok);
  check(room, 'after a leaver');
  assert.equal(g.slotOf(room, 2), -1, 'Bob is gone');
  assert.equal(room.votes[bobSlot], room.choices[0], 'and the place he left still holds its vote');
  assert.equal(g.everybodyVoted(room), false, 'the computer players have still not voted');
});
