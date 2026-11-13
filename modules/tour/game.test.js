// The rules of a tour, without sockets: the lobby, the vote, and the cycle of game after game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import * as g from './game.js';

/** A catalogue like the one ctx.games.list() gives, covering a useful spread of player counts. */
const CATALOGUE = [
  { id: 'hearts', name: 'Hearts', minPlayers: 1, maxPlayers: 7 },
  { id: 'cheat', name: 'Cheat', minPlayers: 1, maxPlayers: 7 },
  { id: 'splendour', name: 'Splendour', minPlayers: 1, maxPlayers: 4 },
  { id: 'gtk', name: 'GTK', minPlayers: 3, maxPlayers: 8 },
  { id: 'draw', name: 'Draw', minPlayers: 3, maxPlayers: 8 },
  { id: 'scribblers', name: 'Scribblers', minPlayers: 2, maxPlayers: 12 },
];

/** A tour in the lobby with the host and `bots` computer players. */
function lobby(bots = 3) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 0 });
  if (bots) assert.ok(g.fillWithBots(room, 1, bots + 1).ok);
  return room;
}

/** A tour that has started and is on its first vote. */
function voting(bots = 3, rng = seeded(7)) {
  const room = lobby(bots);
  assert.ok(g.start(room, 1, rng, 1000, CATALOGUE).ok, 'the tour started');
  return room;
}

/** Everybody votes for the same thing. */
const allVote = (room, choice) => room.players.forEach((player) => assert.ok(g.vote(room, player.id, choice).ok));

test('a tour needs two and will not start without a game its table could play', () => {
  const alone = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 0 });
  assert.deepEqual(g.start(alone, 1, seeded(1), 0, CATALOGUE), { ok: false, error: 'minPlayers', params: { min: g.MIN_PLAYERS } });

  const nine = lobby(8);
  // Only Scribblers holds nine, so nine can start; with a catalogue that holds nobody, nothing can.
  assert.ok(g.start(nine, 1, seeded(1), 0, CATALOGUE).ok);
  const nobody = lobby(8);
  assert.deepEqual(g.start(nobody, 1, seeded(1), 0, [{ id: 'splendour', name: 'Splendour', minPlayers: 1, maxPlayers: 4 }]), { ok: false, error: 'noGamesForThisMany', params: { count: 9 } });

  const notHost = lobby(3);
  assert.equal(g.start(notHost, 2, seeded(1), 0, CATALOGUE).ok, false, 'only the host starts it');
});

test('only games the table could actually sit down to are ever offered', () => {
  for (const players of [2, 3, 4, 5, 8, 9]) {
    const pool = g.playable(CATALOGUE, players);
    assert.ok(pool.length, `${players} players have something to play`);
    for (const game of pool) assert.ok(players >= game.minPlayers && players <= game.maxPlayers, `${game.id} holds ${players}`);
    const room = voting(players - 1);
    assert.equal(room.players.length, players);
    for (const id of room.choices) assert.ok(pool.some((game) => game.id === id), `${id} suits ${players}`);
  }
});

test('a vote offers three distinct games, or every one there is when fewer suit', () => {
  const four = voting(3);
  assert.equal(four.choices.length, g.CHOICES);
  assert.equal(new Set(four.choices).size, g.CHOICES, 'no game is offered twice in one vote');

  // Nine can only play Scribblers, so that is the whole of the offer: three is a maximum, not a promise.
  const nine = voting(8);
  assert.deepEqual(nine.choices, ['scribblers']);
});

test('every vote draws a fresh three, with no memory of what has been played', () => {
  // The three are redrawn each time, and a game played earlier can come round again.  Over many votes with the same
  // small catalogue, every playable game turns up, and the offers are not all the same.
  const rng = seeded(11);
  const room = voting(3, rng);
  const offers = [];
  for (let vote = 0; vote < 40; vote++) {
    offers.push([...room.choices].sort().join(','));
    allVote(room, room.choices[0]);
    const settled = g.settle(room, rng);
    assert.ok(settled.ok);
    assert.ok(g.playing(room, settled.choice, `code-${vote}`, 2000).ok);
    assert.ok(g.gameOver(room, CATALOGUE, rng, 3000).ok);
  }
  assert.ok(new Set(offers).size > 1, 'the offer changes from one vote to the next');
  const everOffered = new Set(offers.flatMap((o) => o.split(',')));
  assert.deepEqual([...everOffered].sort(), g.playable(CATALOGUE, 4).map((game) => game.id).sort(), 'every playable game comes up sooner or later');
  const everPlayed = new Set(room.played.map((entry) => entry.game));
  assert.ok(everPlayed.size > 1 && room.played.length === 40, 'and a tour can play the same game more than once');
});

test('voting: only on offer, only by people in the tour, only while a vote is running, and changing your mind', () => {
  const room = voting(3);
  assert.deepEqual(g.vote(room, 1, 'cribbage'), { ok: false, error: 'notOnOffer' });
  assert.deepEqual(g.vote(room, 999, room.choices[0]), { ok: false, error: 'notInThisTour' });
  const mySlot = g.slotOf(room, 1);
  assert.ok(g.vote(room, 1, room.choices[0]).ok);
  assert.equal(room.votes[mySlot], room.choices[0]);
  assert.ok(g.vote(room, 1, g.END).ok, 'voting again changes your vote');
  assert.equal(room.votes[mySlot], g.END);
  assert.equal(Object.keys(room.votes).length, 1, 'and does not count twice');

  assert.equal(g.everybodyVoted(room), false);
  allVote(room, room.choices[0]);
  assert.equal(g.everybodyVoted(room), true);

  assert.ok(g.settle(room, seeded(1)).ok);
  assert.deepEqual(g.vote(room, 1, room.choices[0]), { ok: false, error: 'notVoting' });
});

test('the most votes wins; a tie is broken at random; a vote nobody answered falls to the games', () => {
  const room = voting(3);
  const [first, second] = room.choices;
  g.vote(room, room.players[0].id, first);
  g.vote(room, room.players[1].id, second);
  g.vote(room, room.players[2].id, second);
  assert.equal(g.winnerOf(room, seeded(1)), second, 'two votes beat one');

  // A tie between the two: both are possible, and nothing else is.
  const tied = voting(3);
  g.vote(tied, tied.players[0].id, tied.choices[0]);
  g.vote(tied, tied.players[1].id, tied.choices[1]);
  const winners = new Set(Array.from({ length: 50 }, (_, n) => g.winnerOf(tied, seeded(n + 1))));
  assert.deepEqual([...winners].sort(), [tied.choices[0], tied.choices[1]].sort());

  // Nobody voted: the tour carries on rather than ending by default, so END cannot win an empty vote.
  const silent = voting(3);
  const quiet = new Set(Array.from({ length: 50 }, (_, n) => g.winnerOf(silent, seeded(n + 1))));
  assert.ok(!quiet.has(g.END), 'an unanswered vote never ends the tour');
  for (const winner of quiet) assert.ok(silent.choices.includes(winner));
});

test('a game is played, then the vote comes round again with the game before it on the list', () => {
  const rng = seeded(3);
  const room = voting(3, rng);
  allVote(room, room.choices[0]);
  const settled = g.settle(room, rng);
  assert.equal(room.phase, 'opening');
  assert.equal(room.chosen, settled.choice, 'what won is kept, so a restart here knows what to open');

  assert.ok(g.playing(room, settled.choice, 'x-y-z', 2000).ok);
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.current, { game: settled.choice, code: 'x-y-z' });
  assert.deepEqual(room.played, [{ game: settled.choice, code: 'x-y-z' }]);
  assert.equal(room.chosen, null);
  assert.deepEqual(g.vote(room, 1, settled.choice), { ok: false, error: 'notVoting' }, 'nobody votes during a game');

  assert.ok(g.gameOver(room, CATALOGUE, rng, 3000).ok);
  assert.equal(room.phase, 'voting');
  assert.equal(room.current, null);
  assert.deepEqual(room.votes, {}, 'everybody votes afresh');
  assert.equal(room.until, 3000 + g.VOTE_MS);
  assert.deepEqual(g.gameOver(room, CATALOGUE, rng, 4000), { ok: false, error: 'notPlaying' });
});

test('voting to end finishes the tour, and the host can start another', () => {
  const rng = seeded(5);
  const room = voting(3, rng);
  allVote(room, g.END);
  const settled = g.settle(room, rng);
  assert.equal(settled.choice, g.END);
  assert.ok(g.finish(room).ok);
  assert.equal(room.phase, 'finished');
  assert.equal(g.isLive(room), false);
  assert.deepEqual(room.choices, []);

  assert.deepEqual(g.playAgain(room, 2), { ok: false, error: 'hostOnlyAgain' });
  assert.ok(g.playAgain(room, 1).ok);
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(room.played, []);
  assert.deepEqual(g.playAgain(room, 1), { ok: false, error: 'notFinished' });
});

test('a game that will not open is said so, and the tour votes again rather than stopping', () => {
  const rng = seeded(9);
  const room = voting(3, rng);
  allVote(room, room.choices[0]);
  assert.ok(g.settle(room, rng).ok);
  assert.ok(g.openingFailed(room, 'gameFull', CATALOGUE, rng, 5000).ok);
  assert.equal(room.phase, 'voting', 'the evening carries on');
  assert.equal(room.trouble, 'gameFull');
  assert.deepEqual(room.played, [], 'a game that never opened was never played');
  assert.equal(room.choices.length, g.CHOICES);
});

test('a tour has no settings and records no statistics', () => {
  const room = voting(3);
  assert.deepEqual(g.setSettings(room, 1, { anything: true }), { ok: false, error: 'noSettings' });
  assert.deepEqual(g.statsPlayers(room), [], 'nothing is recorded: the games it opens record themselves');
});

test('the view shows the vote, the game in hand and what has been played, and hides nothing', () => {
  const rng = seeded(13);
  const room = voting(3, rng);
  g.vote(room, 1, room.choices[0]);
  const view = g.viewFor(room, 1, { catalogue: CATALOGUE, nameOf: () => 'Ann' });
  assert.equal(view.phase, 'voting');
  assert.equal(view.you, 1, 'the account id, which the shared lobby panel matches players by');
  assert.equal(view.hostId, 1);
  assert.equal(view.isHost, true);
  assert.equal(view.yourVote, room.choices[0]);
  assert.equal(view.choices.length, g.CHOICES);
  assert.deepEqual(view.choices[0], { id: room.choices[0], name: CATALOGUE.find((c) => c.id === room.choices[0]).name, votes: 1 });
  assert.equal(view.players.length, 4);
  assert.equal(view.players[0].voted, true);
  assert.equal(view.players[1].voted, false);
  assert.equal(view.endVotes, 0);

  allVote(room, room.choices[0]);
  const settled = g.settle(room, rng);
  g.playing(room, settled.choice, 'x-y-z', 2000);
  const playing = g.viewFor(room, 1, { catalogue: CATALOGUE });
  assert.equal(playing.current.code, 'x-y-z');
  assert.equal(playing.current.name, CATALOGUE.find((c) => c.id === settled.choice).name);
  assert.equal(playing.played.length, 1);
  assert.equal(playing.until, 0, 'no vote is running, so no clock is shown');
});

test('a saved tour from before any of this still loads', () => {
  const old = { code: 'a-b-c', hostId: 1, phase: 'lobby', players: [{ kind: 'human', id: 1, name: 'Ann', slot: 's0' }], size: 12, nextIdx: 1, nextBot: 1 };
  const room = g.migrate(old, () => 'Ann');
  assert.deepEqual(room.choices, []);
  assert.deepEqual(room.votes, {});
  assert.deepEqual(room.played, []);
  assert.equal(room.current, null);
  assert.equal(room.chosen, null);
});
