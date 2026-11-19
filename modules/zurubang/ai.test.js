// The computer players: that each of them plays whole games legally, that each one is recognisably itself, and that
// the choice of AI is made once, saved with the seat, and survives everything that can happen to a room.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { AIS } from './ai/index.js';
import { playGame, versus } from './arena.js';
import { aiById } from '../../shared/ai.js';
import { seeded } from '../../shared/random.js';

test('every AI is properly declared, and standard is the fallback', () => {
  assert.equal(AIS[0].id, 'standard', 'the first is the one a room with an unknown AI falls back to');
  for (const ai of AIS) {
    assert.match(ai.id, /^[a-z]+$/);
    assert.ok(ai.name && ai.description, `${ai.id} has to say what it is`);
    for (const decision of ['turn', 'accepts', 'startsWith', 'place', 'suddenPick']) assert.equal(typeof ai[decision], 'function', `${ai.id} cannot ${decision}`);
  }
  assert.equal(aiById(AIS, 'a-name-nobody-has-used').id, 'standard');
});

test('every AI plays whole games against every other, and all of them finish', () => {
  for (const subject of AIS) {
    for (const field of AIS) {
      for (let seed = 1; seed <= 3; seed++) {
        const { room } = playGame({ ais: [subject.id, field.id], seed });
        assert.equal(room.phase, 'finished', `${subject.id} against ${field.id}, seed ${seed}`);
      }
    }
  }
});

test('the Hasardeur throws whole hands away far more often than the standard player', () => {
  let risky = 0;
  let steady = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { room } = playGame({ ais: ['hasardeur', 'standard'], seed });
    risky += room.seats[0].stats.dumped;
    steady += room.seats[1].stats.dumped;
  }
  assert.ok(risky > steady, `the Hasardeur threw ${risky} hands away and the standard player ${steady}`);
});

test('the Hasardeur never declines a duel, and the standard player sometimes does', () => {
  let declined = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { room } = playGame({ ais: ['hasardeur', 'standard'], seed });
    assert.equal(room.seats[0].stats.declined, 0, `seed ${seed}: it turned a duel down`);
    declined += room.seats[1].stats.declined;
  }
  assert.ok(declined > 0, 'the standard player declined nothing in ten games, which says its judgement is not working');
});

test('the sharp player beats the random one over a run of games', () => {
  const out = versus({ subject: 'sharp', field: 'random', games: 24, seedBase: 100 });
  assert.ok(out.subjectWins > out.fieldWins, `sharp won ${out.subjectWins} of ${out.games}`);
});

test('the standard player beats the random one too', () => {
  const out = versus({ subject: 'standard', field: 'random', games: 24, seedBase: 200 });
  assert.ok(out.subjectWins > out.fieldWins, `standard won ${out.subjectWins} of ${out.games}`);
});

test('a computer player is given its AI when the game starts, and keeps it through a restart', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: {}, now: 0 });
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(12));
  const chosen = room.seats[1].ai;
  assert.ok(AIS.some((ai) => ai.id === chosen));
  const read = JSON.parse(JSON.stringify(room));
  assert.equal(game.migrate(read).seats[1].ai, chosen);
});

test('a room saved before AIs existed plays on, with the fallback', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: {}, now: 0 });
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(13));
  delete room.seats[1].ai;
  const pending = game.pendingBot(room) ?? { seat: 1, kind: 'turn' };
  room.turn = 1;
  assert.equal(game.botMove(room, seeded(14), { seat: 1, kind: 'turn' }).ok, true, `it could not take its turn (${pending.kind})`);
});

test('a view says which AI a computer player is using, and nothing else about it', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: {}, now: 0 });
  game.fillWithBots(room, 1);
  assert.equal(game.viewFor(room, 1).seats[1].ai, null, 'and says nothing at all before the game starts');
  game.start(room, 1, seeded(15));
  const shown = game.viewFor(room, 1).seats[1].ai;
  assert.deepEqual(Object.keys(shown).sort(), ['id', 'name']);
});

test('an AI that answers with nonsense is overruled rather than breaking the game', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: {}, now: 0 });
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(16));
  room.turn = 1;
  const broken = {
    id: 'broken',
    name: 'Broken',
    turn: () => ({ kind: 'swapOne', card: 'not-a-card-at-all' }),
    accepts: () => {
      throw new Error('this AI is broken');
    },
    startsWith: () => 99,
    place: () => 'nor-is-this',
    suddenPick: () => 42,
  };
  AIS.push(broken);
  try {
    room.seats[1].ai = 'broken';
    assert.equal(game.botMove(room, seeded(17), { seat: 1, kind: 'turn' }).ok, true, 'the turn was taken with a card it does hold');
    assert.equal(room.hands[1].length, 5);
  } finally {
    AIS.pop();
  }
});
