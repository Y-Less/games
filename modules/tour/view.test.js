// What a tour sends each person (game.js viewFor), along whole seeded evenings.
//
// A tour hides nothing - "a vote is open so that people can argue about it" - so what there is to protect is not a
// secret but an agreement: everybody at the table, and anybody looking in, must be shown the same vote, with counts
// that add up to the votes actually cast, and the only things that differ from one person to the next are who they
// are, whether they host, and which way they voted themselves.  The one thing a view must not carry is the catalogue
// of other games, which the client is never meant to see: only the names of the games on offer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import * as g from './game.js';

const CATALOGUE = [
  { id: 'duo', name: 'Duo', minPlayers: 2, maxPlayers: 2 },
  { id: 'small', name: 'Small Game', minPlayers: 2, maxPlayers: 4 },
  { id: 'medium', name: 'Medium Game', minPlayers: 3, maxPlayers: 6 },
  { id: 'big', name: 'Big Game', minPlayers: 5, maxPlayers: 12 },
  { id: 'any', name: 'Anybody', minPlayers: 2, maxPlayers: 12 },
];
const STRANGER = 99;
const pick = (rng, items) => items[Math.floor(rng() * items.length)];
const nameOf = (id) => `Person ${id}`;

/** One person's view, as plain JSON (which is how it travels). */
const viewOf = (room, id, online = () => true) => JSON.parse(JSON.stringify(g.viewFor(room, id, { nameOf, online, catalogue: CATALOGUE })));

/** Everything that must be true of the views of a room, whoever is looking. */
function checkViews(room, label) {
  const lookers = [...g.humans(room).map((p) => p.id), STRANGER];
  const views = lookers.map((id) => viewOf(room, id));
  const cast = Object.values(room.votes);

  for (const [n, view] of views.entries()) {
    const id = lookers[n];
    const who = `${label}: ${id}`;
    const me = room.players.find((p) => p.id === id);

    // What is this person's alone.
    assert.equal(view.you, id, `${who}: who they are`);
    assert.equal(view.isHost, id === room.hostId, `${who}: whether they host`);
    assert.equal(view.yourVote, me ? (room.votes[me.slot] ?? null) : null, `${who}: their own vote`);

    // And everything else is the same for everybody.
    const { you, isHost, yourVote, ...shared } = view;
    const { you: a, isHost: b, yourVote: c, ...first } = views[0];
    assert.deepEqual(shared, first, `${who} is shown a different tour from ${lookers[0]}`);

    // The vote adds up: every vote cast is counted once, for something that is on offer.
    assert.deepEqual(view.choices.map((choice) => choice.id), room.choices, `${who}: the games on offer, in order`);
    for (const choice of view.choices) {
      assert.equal(choice.name, CATALOGUE.find((game) => game.id === choice.id).name, `${who}: ${choice.id} goes by its name`);
      assert.equal(choice.votes, cast.filter((v) => v === choice.id).length, `${who}: the votes for ${choice.id}`);
    }
    assert.equal(view.endVotes, cast.filter((v) => v === g.END).length, `${who}: the votes to end`);
    assert.equal(view.choices.reduce((n, choice) => n + choice.votes, 0) + view.endVotes, view.players.filter((p) => p.voted).length, `${who}: as many votes as people who have voted`);

    // The clock is the vote's, and is shown only while one is running.
    if (room.phase === 'voting') assert.equal(view.until, room.until, `${who}: when the vote closes`);
    else assert.equal(view.until, 0, `${who}: a clock with no vote running`);

    // The game in hand and the ones before it, by name.
    if (room.phase === 'playing') {
      assert.equal(view.current.code, room.current.code, `${who}: where the game is`);
      assert.equal(view.current.name, CATALOGUE.find((game) => game.id === room.current.game).name, `${who}: what it is called`);
    } else assert.equal(view.current, null, `${who}: a game in hand during ${room.phase}`);
    assert.deepEqual(view.played.map((entry) => entry.code), room.played.map((entry) => entry.code), `${who}: everything played, oldest first`);

    // The table: everybody in it once, people by their current name, and a count of what they could be offered.
    assert.deepEqual(view.players.map((p) => p.id), room.players.map((p) => p.id), `${who}: everybody at the table`);
    for (const p of view.players) {
      if (p.bot) assert.equal(p.userId, null, `${who}: a computer player is nobody's account`);
      else assert.deepEqual([p.userId, p.name], [p.id, nameOf(p.id)], `${who}: a person, by the name they go by now`);
    }
    assert.equal(view.suitable, CATALOGUE.filter((game) => room.players.length >= game.minPlayers && room.players.length <= game.maxPlayers).length, `${who}: how many games suit this many`);
    assert.ok(!/minPlayers|maxPlayers/.test(JSON.stringify(view)), `${who} was sent the catalogue itself`);
  }
}

/** One seeded evening, looked at after every step. */
function evening(seed) {
  const rng = seeded(seed);
  const room = g.createRoom({ code: `code-${seed}`, hostId: 1, hostName: 'Ann', now: 0 });
  const people = 1 + Math.floor(rng() * 4);
  for (let id = 2; id <= people; id++) assert.ok(g.addHuman(room, id, `P${id}`).ok);
  assert.ok(g.fillWithBots(room, 1, Math.max(2, people + Math.floor(rng() * 3))).ok);
  checkViews(room, `seed ${seed}, in the lobby`);
  assert.ok(g.start(room, 1, rng, 1000, CATALOGUE).ok, `seed ${seed}: the tour starts`);

  let clock = 1000;
  for (let step = 0; step < 60 && room.phase !== 'finished'; step++) {
    const label = `seed ${seed}, step ${step}`;
    clock += 500;
    if (room.phase === 'voting') {
      for (const player of room.players) {
        if (rng() < 0.75) assert.ok(g.vote(room, player.id, pick(rng, [...room.choices, g.END])).ok, label);
        checkViews(room, label);
      }
      assert.ok(g.settle(room, rng).ok, label);
    } else if (room.phase === 'opening') {
      if (room.chosen === g.END) assert.ok(g.finish(room).ok, label);
      else assert.ok(g.playing(room, room.chosen, `room-${step}`, clock).ok, label);
    } else if (room.phase === 'playing') {
      if (rng() < 0.2 && g.humans(room).length > 1) assert.ok(g.removeHuman(room, pick(rng, g.humans(room)).id, rng, clock).ok, label);
      else assert.ok(g.gameOver(room, CATALOGUE, rng, clock).ok, label);
    }
    checkViews(room, label);
  }
  return room;
}

test('everybody is shown the same tour, the votes add up, and only who you are and how you voted is yours alone', () => {
  const phases = new Set();
  for (let seed = 1; seed <= 250; seed++) phases.add(evening(seed).phase);
  assert.ok(phases.has('finished'), 'some evenings were voted to an end');
});

test('a person who is away is shown as away, and a computer player never is', () => {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 0 });
  assert.ok(g.addHuman(room, 2, 'Bob').ok);
  assert.ok(g.fillWithBots(room, 1, 4).ok);
  const view = viewOf(room, 1, (id) => id !== 2);
  assert.deepEqual(view.players.map((p) => [p.bot, p.online]), [[false, true], [false, false], [true, true], [true, true]]);
});

test('a stranger looking in sees the vote like anybody else, and has no vote in it', () => {
  const rng = seeded(3);
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 0 });
  assert.ok(g.addHuman(room, 2, 'Bob').ok);
  assert.ok(g.start(room, 1, rng, 1000, CATALOGUE).ok);
  assert.ok(g.vote(room, 2, g.END).ok);
  const view = viewOf(room, STRANGER);
  assert.equal(view.phase, 'voting');
  assert.equal(view.isHost, false);
  assert.equal(view.yourVote, null);
  assert.equal(view.endVotes, 1, 'the vote is open: anybody can see how it stands');
  assert.equal(g.vote(room, STRANGER, room.choices[0]).ok, false, 'but only the people in the tour can vote in it');
  assert.equal(viewOf(room, STRANGER).choices.reduce((n, choice) => n + choice.votes, 0), 0);
});
