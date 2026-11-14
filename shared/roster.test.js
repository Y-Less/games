// Tests for the shared player-list rules (shared/roster.js): joining, computer players, leaving, kicking, and loading old rooms.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRosterRules, historyView, humans, isBot, migratePlayers, seatOf, uniqueName } from './roster.js';

const LIVE = ['lobby', 'playing'];

/** The rules with a tiny game: players have a score, and a computer player taking over mid-game is reported through `taken`. */
function makeRules(taken = []) {
  return createRosterRules({
    isLive: (room) => LIVE.includes(room.phase),
    minPlayers: 2,
    maxPlayers: 4,
    botNames: ['Ada', 'Bram'],
    makePlayer: (room, base, extras = {}) => ({ ...base, score: 0, ...extras }),
    takeOver: (room, oldId, bot) => {
      taken.push({ oldId, bot });
      bot.ai = 'standard';
      // Nothing is done to the history here: it is written by slot, and the computer player took the slot.
    },
  });
}

/** A lobby with Ann (the host, account 1) in it. */
const lobby = () => ({ hostId: 1, phase: 'lobby', nextBot: 1, nextSlot: 1, players: [{ kind: 'human', id: 1, name: 'Ann', score: 0, slot: 's0' }] });

test('addHuman adds a newcomer at the end, once, with a name nobody else has and the extras the server gave', () => {
  const rules = makeRules();
  const room = lobby();
  assert.deepEqual(rules.addHuman(room, 2, 'ann', { colour: 'red' }), { ok: true, seat: 1 });
  assert.deepEqual(room.players[1], { kind: 'human', id: 2, name: 'ann (2)', score: 0, colour: 'red', slot: 's1' });
  assert.deepEqual(rules.addHuman(room, 2, 'ann'), { ok: true, seat: 1 }, 'joining twice keeps the same place');
  assert.equal(room.players.length, 2);
  assert.equal(uniqueName(room, 'Bob'), 'Bob');
  assert.equal(seatOf(room, 2), 1);
  assert.equal(seatOf(room, 99), -1);
});

test('addHuman leaves the name off when none is given, and refuses a full room and a game that has started', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2);
  assert.ok(!('name' in room.players[1]));
  rules.fillWithBots(room, 1, 4);
  assert.equal(rules.addHuman(room, 5, 'Eve').error, 'gameFull');
  room.phase = 'over'; // not live, so there is nothing left to take over
  assert.equal(rules.addHuman(room, 6, 'Fay').error, 'thatGameStarted');
});

// --- coming late to the invitation: a newcomer takes a computer player's place rather than being turned away ---

/** The rules with a `handOver` that reports what it was given and puts the newcomer into the room's own field. */
function lateRules(handed = []) {
  return createRosterRules({
    isLive: (room) => LIVE.includes(room.phase),
    minPlayers: 2,
    maxPlayers: 4,
    botNames: ['Ada', 'Bram'],
    makePlayer: (room, base, extras = {}) => ({ ...base, score: 0, ...extras }),
    handOver: (room, botId, person) => {
      handed.push({ botId, person: { ...person } });
      if (room.turn === botId) room.turn = person.id;
    },
  });
}

test('somebody arriving at a game under way takes the first computer player place, and everything in it', () => {
  const rules = makeRules();
  const room = lobby();
  rules.fillWithBots(room, 1, 3);
  Object.assign(room.players[1], { score: 12, colour: 'red', ai: 'standard' });
  room.phase = 'playing';
  assert.deepEqual(rules.addHuman(room, 5, 'Eve'), { ok: true, seat: 1, tookOver: 'Ada' });
  assert.deepEqual(room.players[1], { kind: 'human', id: 5, name: 'Eve', score: 12, colour: 'red', slot: 's1' }, 'the score, the colour, and the slot stay; the AI goes');
  assert.ok(isBot(room.players[2]), 'and only the first computer player is taken over');
  assert.equal(seatOf(room, 5), 1);
  assert.equal(humans(room).length, 2);
});

test('a newcomer may go by the name the computer player was using, and answers to it if they bring none', () => {
  const rules = makeRules();
  const room = lobby();
  rules.fillWithBots(room, 1, 3);
  room.phase = 'playing';
  assert.equal(rules.addHuman(room, 5, 'Ada').seat, 1);
  assert.equal(room.players[1].name, 'Ada', 'the Ada they are replacing is gone');
  assert.equal(rules.addHuman(room, 6).seat, 2);
  assert.equal(room.players[2].name, 'Bram', 'and somebody with no name of their own keeps the one in the place');
});

test('a game under way with nobody but people in it has no place to take', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  room.phase = 'playing';
  assert.equal(rules.addHuman(room, 5, 'Eve').error, 'gameFull');
  assert.deepEqual(rules.addHuman(room, 2, 'Bob'), { ok: true, seat: 1 }, 'and somebody already playing just comes back');
});

test('handOver is told which computer player went, and may put the newcomer in its place in the game itself', () => {
  const handed = [];
  const rules = lateRules(handed);
  const room = lobby();
  rules.fillWithBots(room, 1, 3);
  room.phase = 'playing';
  room.turn = 'bot:1'; // it was the computer player's turn when they arrived
  rules.addHuman(room, 5, 'Eve');
  assert.deepEqual(handed, [{ botId: 'bot:1', person: { kind: 'human', id: 5, name: 'Eve', score: 0, slot: 's1' } }]);
  assert.equal(room.turn, 5, 'and now it is theirs');
});

test('coming back puts you where you were, with what you left behind', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.addHuman(room, 3, 'Cy');
  rules.fillWithBots(room, 1, 4); // and one the host added, which is nobody's stand-in
  room.phase = 'playing';
  room.players[1].score = 7;
  room.players[2].score = 4;
  assert.equal(rules.removeHuman(room, 2).replaced, true);
  assert.equal(rules.removeHuman(room, 3).replaced, true);
  assert.deepEqual(room.players.map((p) => p.stoodInFor), [undefined, 2, 3, undefined]);

  assert.deepEqual(rules.addHuman(room, 3, 'Cy'), { ok: true, seat: 2, tookOver: 'Computer' }, 'Cy comes back to his own place');
  assert.equal(room.players[2].score, 4, 'with the score he left behind');
  assert.equal(room.players[2].stoodInFor, undefined, 'and it is nobody else\u2019s place now');
  assert.equal(room.players[1].stoodInFor, 2, "Bob's is still being kept for him");
});

test('somebody with no place of their own takes one that is nobody\u2019s, so a leaver can still come back to theirs', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.fillWithBots(room, 1, 3); // the host adds one
  room.phase = 'playing';
  assert.equal(rules.removeHuman(room, 2).replaced, true); // and Bob leaves, so there are two computer players
  assert.deepEqual(room.players.map((p) => p.stoodInFor), [undefined, 2, undefined]);

  assert.equal(rules.addHuman(room, 9, 'Zoe').seat, 2, "a stranger takes the host's one, not the one being kept for Bob");
  assert.equal(rules.addHuman(room, 2, 'Bob').seat, 1, 'so Bob still gets his own back');
  assert.equal(rules.addHuman(room, 8, 'Yan').error, 'gameFull', 'and now there is nothing left to take');
});

test('a place kept for somebody is taken by a stranger only when there is nothing else', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.addHuman(room, 3, 'Cy');
  room.phase = 'playing';
  assert.equal(rules.removeHuman(room, 3).replaced, true);
  assert.equal(rules.addHuman(room, 9, 'Zoe').seat, 2, "Cy's place is all there is, so Zoe has it");
  assert.equal(rules.addHuman(room, 3, 'Cy').error, 'gameFull', 'and Cy comes back to nothing');
});

test('a person leaving and a person arriving are the same move the other way round', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  room.players[1].score = 7;
  room.phase = 'playing';
  assert.equal(rules.removeHuman(room, 2, () => 0).replaced, true);
  assert.equal(room.players[1].score, 7, 'the computer player carries on with their score');
  assert.equal(rules.addHuman(room, 3, 'Cat').seat, 1);
  assert.deepEqual(room.players[1], { kind: 'human', id: 3, name: 'Cat', score: 7, slot: 's1' }, 'and so does the next person along');
});

test('computer players are { kind: bot, id: bot:<n>, name } with the first unused name, and only the host adds them in the lobby', () => {
  const rules = makeRules();
  const room = lobby();
  assert.equal(rules.addBot(room, 2).ok, false);
  const first = rules.addBot(room, 1);
  assert.deepEqual(room.players[1], { kind: 'bot', id: 'bot:1', name: 'Ada', score: 0, slot: 's1' });
  assert.equal(first.id, 'bot:1');
  rules.addBot(room, 1);
  rules.addBot(room, 1);
  assert.deepEqual(room.players.slice(1).map((p) => p.name), ['Ada', 'Bram', 'Computer']);
  assert.equal(rules.addBot(room, 1).error, 'gameFull');
  assert.ok(room.players.every((p) => !('bot' in p)), 'never bot: true');
  room.phase = 'playing';
  assert.equal(rules.addBot(room, 1).error, 'botsLobbyOnly');
});

test('fillWithBots makes up a normal table, never more than the cap, or a number the host names', () => {
  const rules = makeRules();
  const room = lobby();
  assert.ok(rules.fillWithBots(room, 1).ok);
  assert.equal(room.players.length, 4, 'a normal table, not as many as the game could hold');
  const capped = lobby();
  assert.ok(rules.setSize(capped, 1, 3).ok);
  assert.ok(rules.fillWithBots(capped, 1).ok);
  assert.equal(capped.players.length, 3, 'and never past a cap the host has set');
  rules.fillWithBots(room, 1, 99);
  assert.equal(room.players.length, 4, 'a number of its own is still kept within the limits');
  assert.equal(rules.fillWithBots(room, 2).ok, false, 'only the host');
});

test('removeBot works in the lobby only, for the host and only for computer players', () => {
  const rules = makeRules();
  const room = lobby();
  rules.fillWithBots(room, 1, 3);
  assert.equal(rules.removeBot(room, 2, 's1').ok, false, 'only the host');
  assert.equal(rules.removeBot(room, 1, 's0').error, 'notAComputer', 'a person is not a computer player');
  assert.ok(rules.removeBot(room, 1, 's1').ok);
  assert.deepEqual(room.players.map((p) => p.id), [1, 'bot:2']);
  rules.fillWithBots(room, 1, 3);
  room.phase = 'playing';
  assert.equal(rules.removeBot(room, 1, room.players[1].slot).error, 'botsRemoveLobbyOnly', 'its turns are part of the game now');
  assert.equal(room.players.length, 3);
  room.phase = 'finished';
  assert.equal(rules.removeBot(room, 1, room.players[1].slot).error, 'gameOverNobodyToRemove');
});

test('removeHuman: the lobby just loses them, the host passes to the next person, and the last person leaving empties the room', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.addBot(room, 1);
  assert.deepEqual(rules.removeHuman(room, 1), { ok: true, empty: false, replaced: false, seat: 0 }, 'and it says which place was freed, as the seated games always did');
  assert.equal(room.hostId, 2, 'the host is now the next person, not a computer player');
  assert.deepEqual(room.players.map((p) => p.id), [2, 'bot:1']);
  assert.equal(rules.removeHuman(room, 99).error, 'notInGame');
  assert.equal(rules.removeHuman(room, 'bot:1').error, 'notInGame', 'computer players are removed with removeBot');
  assert.equal(rules.removeHuman(room, 2).empty, true);
});

test('removeHuman in a game puts a computer player in their place, with their score and slot, and a finished game is left alone', () => {
  const taken = [];
  const rules = makeRules(taken);
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.addHuman(room, 3, 'Cy');
  room.phase = 'playing';
  room.players[1].score = 7;
  room.history = [{ label: 'Turn 1', deltas: { s1: 7, s0: 0 }, notes: { s1: 'guessed it' } }]; // by slot: Bob is s1
  assert.deepEqual(rules.removeHuman(room, 2), { ok: true, empty: false, replaced: true, seat: 1 });
  assert.deepEqual(room.players.map((p) => p.id), [1, 'bot:1', 3], 'same slot, so the turn order is unchanged');
  assert.deepEqual(room.players[1], { kind: 'bot', id: 'bot:1', name: 'Ada', score: 7, ai: 'standard', stoodInFor: 2, slot: 's1' }, 'the score and the slot carry over, the game gave it an AI, and it knows whose place it is keeping');
  assert.deepEqual(taken, [{ oldId: 2, bot: room.players[1] }]);
  assert.equal(room.players[1].slot, 's1', 'the computer player took the slot along with the score');
  assert.deepEqual(room.history[0], { label: 'Turn 1', deltas: { s1: 7, s0: 0 }, notes: { s1: 'guessed it' } }, 'and the history was not touched at all');
  assert.deepEqual(historyView(room)[0].deltas, { 'bot:1': 7, 1: 0 }, 'the scoreboard names whoever holds the slot now');
  assert.equal(seatOf(room, 2), -1, 'the person is free to join another game');
  assert.deepEqual(rules.removeHuman(room, 1), { ok: true, empty: false, replaced: true, seat: 0 }, 'the host leaving mid-game is replaced too');
  assert.equal(room.hostId, 3, 'and the host passes to the next person');
  assert.equal(rules.removeHuman(room, 3).empty, true, 'the last person leaving empties the room, however many computers are left');
  const done = lobby();
  rules.addHuman(done, 2, 'Bob');
  done.phase = 'finished';
  // Once the game is over nobody is replaced: the leaver stays on the standings, marked as gone.
  assert.deepEqual(rules.removeHuman(done, 2), { ok: true, empty: false, seat: 1, replaced: false });
  assert.deepEqual(done.players.map((p) => [p.id, Boolean(p.left)]), [[1, false], [2, true]], 'the standings still name them');
  assert.equal(done.hostId, 1);
  assert.equal(rules.removeHuman(done, 1).empty, false, 'and the room stands when the last of them has gone: the invitation still shows the standings');
  assert.deepEqual(done.players.map((p) => p.id), [1, 2]);
});

test('the host leaving a game that is over passes the hosting to somebody who is still there', () => {
  const rules = makeRules();
  const done = lobby();
  rules.addHuman(done, 2, 'Bob');
  rules.addHuman(done, 3, 'Cat');
  done.phase = 'finished';
  assert.equal(rules.removeHuman(done, 2).ok, true);
  assert.equal(rules.removeHuman(done, 1).empty, false);
  assert.equal(done.hostId, 3, 'not to Bob, who left before the host did');
});

test('kick: only the host, only another person, and never once the game is over', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.addHuman(room, 3, 'Cy');
  rules.addBot(room, 1);
  // Ann is s0 (the host), Bob s1, Cy s2, and the computer player s3.
  assert.equal(rules.kick(room, 2, 's2').error, 'hostOnlyRemove');
  assert.equal(rules.kick(room, 1, 's0').error, 'playerNotInGame', 'not themselves');
  assert.equal(rules.kick(room, 1, 's3').error, 'playerNotInGame', 'computer players are removed with removeBot');
  assert.equal(rules.kick(room, 1, 's99').error, 'playerNotInGame');
  assert.deepEqual(rules.kick(room, 1, 's2'), { ok: true, userId: 3, replaced: false });
  assert.deepEqual(humans(room).map((p) => p.id), [1, 2]);
  room.phase = 'playing';
  assert.deepEqual(rules.kick(room, 1, 's1'), { ok: true, userId: 2, replaced: true }, 'in a game a computer player takes their place');
  assert.deepEqual(room.players.map((p) => p.kind), ['human', 'bot', 'bot']);
  room.phase = 'finished';
  assert.deepEqual(rules.kick(room, 1, 's1'), { ok: false, error: 'playerNotInGame' });
  room.players[1] = { kind: 'human', id: 2, name: 'Bob', score: 0, slot: 's1' };
  assert.deepEqual(rules.kick(room, 1, 's1'), { ok: false, error: 'gameOverNobodyToRemove' });
  assert.deepEqual(humans(room).map((p) => p.id), [1, 2], 'nobody was removed');
});

test('migratePlayers turns bot: true into kind: bot, names people from the account, and is safe to run twice', () => {
  const room = {
    nextBot: undefined,
    players: [
      { id: 1, score: 3 },
      { id: 'bot:1', bot: true, name: 'Ada', score: 1 },
      { id: 2, name: 'Kept', score: 0 },
      { id: 3, score: 0 },
    ],
  };
  migratePlayers(room, (id) => (id === 1 ? 'Ann' : undefined));
  assert.deepEqual(room.players, [
    { id: 1, score: 3, kind: 'human', name: 'Ann', slot: 's0' },
    { id: 'bot:1', name: 'Ada', score: 1, kind: 'bot', slot: 's1' },
    { id: 2, name: 'Kept', score: 0, kind: 'human', slot: 's2' },
    { id: 3, score: 0, kind: 'human', slot: 's3' },
  ]);
  assert.equal(room.nextBot, 1);
  assert.equal(room.nextSlot, 4);
  assert.deepEqual(room.history ?? [], [], 'a room with no history needs none rewritten');
  const again = JSON.stringify(room);
  migratePlayers(room);
  assert.equal(JSON.stringify(room), again);
});

test('a room saved before slots existed has its history rewritten from ids to slots, once', () => {
  const room = {
    nextBot: 2,
    players: [
      { kind: 'human', id: 1, name: 'Ann', score: 3 },
      { kind: 'bot', id: 'bot:1', name: 'Ada', score: 1 },
    ],
    history: [{ label: 'Turn 1', deltas: { 1: 3, 'bot:1': 1 }, notes: { 1: 'guessed it' } }],
  };
  migratePlayers(room);
  assert.deepEqual(room.players.map((p) => p.slot), ['s0', 's1'], 'the list order becomes the slots');
  assert.deepEqual(room.history[0], { label: 'Turn 1', deltas: { s0: 3, s1: 1 }, notes: { s0: 'guessed it' } });
  assert.deepEqual(historyView(room)[0].deltas, { 1: 3, 'bot:1': 1 }, 'and it goes back out under the same ids as before');
  const again = JSON.stringify(room);
  migratePlayers(room);
  assert.equal(JSON.stringify(room), again, 'migrating twice changes nothing');
});

test('a slot nobody holds any more is left out of the scoreboard', () => {
  const room = {
    players: [{ kind: 'human', id: 1, name: 'Ann', score: 3, slot: 's0' }],
    nextSlot: 2,
    history: [{ label: 'Turn 1', deltas: { s0: 3, s1: 5 }, notes: { s1: 'left' } }],
  };
  assert.deepEqual(historyView(room)[0], { label: 'Turn 1', deltas: { 1: 3 }, notes: {} });
});
