// Tests for the shared player-list rules (shared/roster.js): joining, computer players, leaving, kicking and loading old rooms.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRosterRules, humans, migratePlayers, renameInHistory, seatOf, uniqueName } from './roster.js';

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
      renameInHistory(room, oldId, bot.id);
    },
  });
}

/** A lobby with Ann (the host, account 1) in it. */
const lobby = () => ({ hostId: 1, phase: 'lobby', nextBot: 1, players: [{ kind: 'human', id: 1, name: 'Ann', score: 0 }] });

test('addHuman adds a newcomer at the end, once, with a name nobody else has and the extras the server gave', () => {
  const rules = makeRules();
  const room = lobby();
  assert.deepEqual(rules.addHuman(room, 2, 'ann', { colour: 'red' }), { ok: true, seat: 1 });
  assert.deepEqual(room.players[1], { kind: 'human', id: 2, name: 'ann (2)', score: 0, colour: 'red' });
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
  assert.equal(rules.addHuman(room, 5, 'Eve').error, 'That game is full.');
  room.phase = 'playing';
  assert.equal(rules.addHuman(room, 6, 'Fay').error, 'That game has already started.');
});

test('computer players are { kind: bot, id: bot:<n>, name } with the first unused name, and only the host adds them in the lobby', () => {
  const rules = makeRules();
  const room = lobby();
  assert.equal(rules.addBot(room, 2).ok, false);
  const first = rules.addBot(room, 1);
  assert.deepEqual(room.players[1], { kind: 'bot', id: 'bot:1', name: 'Ada', score: 0 });
  assert.equal(first.id, 'bot:1');
  rules.addBot(room, 1);
  rules.addBot(room, 1);
  assert.deepEqual(room.players.slice(1).map((p) => p.name), ['Ada', 'Bram', 'Computer']);
  assert.equal(rules.addBot(room, 1).error, 'That game is full.');
  assert.ok(room.players.every((p) => !('bot' in p)), 'never bot: true');
  room.phase = 'playing';
  assert.equal(rules.addBot(room, 1).error, 'Computer players can only be added in the lobby.');
});

test('fillWithBots fills up to the target, kept between the minimum and the maximum', () => {
  const rules = makeRules();
  const room = lobby();
  assert.ok(rules.fillWithBots(room, 1).ok);
  assert.equal(room.players.length, 2, 'enough to start, by default');
  rules.fillWithBots(room, 1, 99);
  assert.equal(room.players.length, 4);
  assert.equal(rules.fillWithBots(room, 2).ok, false, 'only the host');
});

test('removeBot works in the lobby only, for the host and only for computer players', () => {
  const rules = makeRules();
  const room = lobby();
  rules.fillWithBots(room, 1, 3);
  assert.equal(rules.removeBot(room, 2, 'bot:1').ok, false, 'only the host');
  assert.equal(rules.removeBot(room, 1, 1).error, 'That is not a computer player.', 'a person is not a computer player');
  assert.ok(rules.removeBot(room, 1, 'bot:1').ok);
  assert.deepEqual(room.players.map((p) => p.id), [1, 'bot:2']);
  rules.fillWithBots(room, 1, 3);
  room.phase = 'playing';
  assert.equal(rules.removeBot(room, 1, room.players[1].id).error, 'Computer players can only be removed in the lobby.', 'its turns are part of the game now');
  assert.equal(room.players.length, 3);
  room.phase = 'finished';
  assert.equal(rules.removeBot(room, 1, room.players[1].id).error, 'The game is over: there is nobody to remove.');
});

test('removeHuman: the lobby just loses them, the host passes to the next person, and the last person leaving empties the room', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.addBot(room, 1);
  assert.deepEqual(rules.removeHuman(room, 1), { ok: true, empty: false, replaced: false });
  assert.equal(room.hostId, 2, 'the host is now the next person, not a computer player');
  assert.deepEqual(room.players.map((p) => p.id), [2, 'bot:1']);
  assert.equal(rules.removeHuman(room, 99).error, 'You are not in this game.');
  assert.equal(rules.removeHuman(room, 'bot:1').error, 'You are not in this game.', 'computer players are removed with removeBot');
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
  room.history = [{ label: 'Turn 1', deltas: { 2: 7, 1: 0 }, notes: { 2: 'guessed it' } }];
  assert.deepEqual(rules.removeHuman(room, 2), { ok: true, empty: false, replaced: true });
  assert.deepEqual(room.players.map((p) => p.id), [1, 'bot:1', 3], 'same slot, so the turn order is unchanged');
  assert.deepEqual(room.players[1], { kind: 'bot', id: 'bot:1', name: 'Ada', score: 7, ai: 'standard' }, 'the score carries over and the game gave it an AI');
  assert.deepEqual(taken, [{ oldId: 2, bot: room.players[1] }]);
  assert.deepEqual(room.history[0], { label: 'Turn 1', deltas: { 'bot:1': 7, 1: 0 }, notes: { 'bot:1': 'guessed it' } }, 'the history still adds up');
  assert.equal(seatOf(room, 2), -1, 'the person is free to join another game');
  assert.deepEqual(rules.removeHuman(room, 1), { ok: true, empty: false, replaced: true }, 'the host leaving mid-game is replaced too');
  assert.equal(room.hostId, 3, 'and the host passes to the next person');
  assert.equal(rules.removeHuman(room, 3).empty, true, 'the last person leaving empties the room, however many computers are left');
  const done = lobby();
  rules.addHuman(done, 2, 'Bob');
  done.phase = 'finished';
  const before = JSON.stringify(done);
  assert.deepEqual(rules.removeHuman(done, 2), { ok: true, empty: false, replaced: false, changed: false }, 'and says so, so the room server does not save or send anything');
  assert.equal(JSON.stringify(done), before);
});

test('kick: only the host, only another person, and never once the game is over', () => {
  const rules = makeRules();
  const room = lobby();
  rules.addHuman(room, 2, 'Bob');
  rules.addHuman(room, 3, 'Cy');
  rules.addBot(room, 1);
  assert.equal(rules.kick(room, 2, 3).error, 'Only the host can remove players.');
  assert.equal(rules.kick(room, 1, 1).error, 'That player is not in the game.', 'not themselves');
  assert.equal(rules.kick(room, 1, 'bot:1').error, 'That player is not in the game.', 'computer players are removed with removeBot');
  assert.equal(rules.kick(room, 1, 99).error, 'That player is not in the game.');
  assert.deepEqual(rules.kick(room, 1, 3), { ok: true, userId: 3, replaced: false });
  assert.deepEqual(humans(room).map((p) => p.id), [1, 2]);
  room.phase = 'playing';
  assert.deepEqual(rules.kick(room, 1, 2), { ok: true, userId: 2, replaced: true }, 'in a game a computer player takes their place');
  assert.deepEqual(room.players.map((p) => p.kind), ['human', 'bot', 'bot']);
  room.phase = 'finished';
  assert.deepEqual(rules.kick(room, 1, 2), { ok: false, error: 'That player is not in the game.' });
  room.players[1] = { kind: 'human', id: 2, name: 'Bob', score: 0 };
  assert.deepEqual(rules.kick(room, 1, 2), { ok: false, error: 'The game is over: there is nobody to remove.' });
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
    { id: 1, score: 3, kind: 'human', name: 'Ann' },
    { id: 'bot:1', name: 'Ada', score: 1, kind: 'bot' },
    { id: 2, name: 'Kept', score: 0, kind: 'human' },
    { id: 3, score: 0, kind: 'human' },
  ]);
  assert.equal(room.nextBot, 1);
  const again = JSON.stringify(room);
  migratePlayers(room);
  assert.equal(JSON.stringify(room), again);
});
