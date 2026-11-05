// The GTK computer players: that each of them plays whole games legally and they finish, that each shows the trait it
// is named for, and that the choice of AI is made at the start, kept with the room, and found again afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { AIS } from './ai/index.js';
import { wordCount } from './ai/standard.js';
import { seeded } from '../../shared/random.js';

/**
 * Plays a whole game of computer players, forcing every one of them to use `aiId` when one is named.
 * @param {object} options  { seed, size, roundsEach, aiId }
 * @returns {object} the finished room
 * Side effects: none outside the room it builds.
 */
function playGame({ seed = 1, size = 4, roundsEach = 1, aiId = null } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1, roundsEach });
  assert.equal(game.fillWithBots(room, 1, size).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  room.players[0].kind = 'bot'; // the host plays by the computer's judgement too, so no human input is needed
  for (const p of room.players) if (aiId) p.ai = aiId;
  for (let guard = 0; guard < 4000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'reveal') {
      game.forceNext(room, rng);
      continue;
    }
    const action = game.pendingBotAction(room);
    assert.ok(action, `seed ${seed}: somebody always has something to do in ${room.phase}`);
    assert.equal(game.runBotAction(room, rng, action), true, `seed ${seed}: ${action.type} by ${action.id}`);
  }
  return room;
}

test('every AI plays whole games to the end, legally, at every table size', () => {
  for (const ai of AIS) {
    for (const seed of [1, 2, 3]) {
      for (const size of [game.MIN_PLAYERS, 5, game.MAX_PLAYERS]) {
        const room = playGame({ seed, size, aiId: ai.id });
        assert.equal(room.phase, 'finished', `${ai.id}, seed ${seed}, ${size} players`);
        assert.equal(room.history.length, room.roundsTotal * room.questionsPerRound);
        for (const p of room.players) assert.ok(Number.isInteger(p.score) && p.score >= 0);
      }
    }
  }
});

test('a game of several rounds each finishes too, and asks a fresh question every time', () => {
  const room = playGame({ seed: 9, size: 3, roundsEach: game.ROUNDS_EACH.max });
  assert.equal(room.phase, 'finished');
  assert.equal(room.used.length, room.roundsTotal * room.questionsPerRound);
  assert.equal(new Set(room.used).size, room.used.length);
});

test('a broken AI does not stop the game: a legal move is played for it', () => {
  const broken = {
    id: 'broken',
    name: 'Broken',
    write() {
      throw new Error('no');
    },
    pick() {
      return 'not a number';
    },
  };
  const rng = seeded(5);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  game.fillWithBots(room, 1, 4);
  game.start(room, 1, rng);
  room.players[0].kind = 'bot';
  for (const p of room.players) p.ai = broken.id; // no such AI, so aiById falls back; the throwing one is tried below
  AIS.push(broken);
  try {
    for (let guard = 0; guard < 2000 && room.phase !== 'finished'; guard++) {
      if (room.phase === 'reveal') game.forceNext(room, rng);
      else assert.equal(game.runBotAction(room, rng), true);
    }
  } finally {
    AIS.pop();
  }
  assert.equal(room.phase, 'finished');
});

test('"sharp" believes the plainest answer, which "random" does not', () => {
  // The two are shown the same answers; sharp should land on the shortest far more often than chance.
  const options = ['Tea', 'A cup of very strong builders tea', 'Something hot and milky please'];
  const shortest = 0;
  const count = (id) => {
    const ai = AIS.find((entry) => entry.id === id);
    const rng = seeded(3);
    let hits = 0;
    for (let n = 0; n < 300; n++) if (ai.pick({ options }, rng) === shortest) hits++;
    return hits;
  };
  const sharp = count('sharp');
  const chance = count('random');
  assert.ok(sharp > 250, `sharp picks the plainest answer ${sharp} times in 300`);
  assert.ok(chance < 150, `random picks it ${chance} times in 300`);
  assert.equal(wordCount(options[shortest]), 1);
});

test('"sharp" writes from a different part of the pool than "standard"', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const wrote = (id) => {
    const ai = AIS.find((entry) => entry.id === id);
    const rng = seeded(4);
    return new Set(Array.from({ length: 200 }, () => ai.write({ pool, offset: 0 }, rng)));
  };
  const standard = wrote('standard');
  const sharp = wrote('sharp');
  assert.ok(!standard.has('j'), 'the standard player keeps to the obvious answers');
  assert.ok(!sharp.has('a'), 'the sharp one keeps away from them');
  assert.ok([...sharp].some((answer) => standard.has(answer)), 'but the two halves overlap, so they do not always differ');
});

test('an AI is given out at the start, kept with the room, and found again by id', () => {
  const rng = seeded(7);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  game.addHuman(room, 2, 'Bob');
  game.addBot(room, 1);
  assert.equal(room.players.find((p) => p.kind === 'bot').ai, undefined, 'not before the game starts');
  game.start(room, 1, rng);
  const bot = room.players.find((p) => p.kind === 'bot');
  assert.ok(AIS.some((ai) => ai.id === bot.ai), `it plays as ${bot.ai}`);
  const saved = game.migrate(JSON.parse(JSON.stringify(room)));
  assert.equal(saved.players.find((p) => p.kind === 'bot').ai, bot.ai, 'the choice survives a restart');
  assert.deepEqual(Object.keys(game.viewFor(room, 2).players.find((p) => p.bot).ai).sort(), ['description', 'id', 'name'], 'the view says which, and nothing else');
  assert.equal(game.viewFor(room, 2).players.find((p) => !p.bot).ai, null, 'people have none');
});

test('a room saved before AIs existed, or naming one that has gone, still plays', () => {
  const rng = seeded(8);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  game.fillWithBots(room, 1, 4);
  game.start(room, 1, rng);
  room.players[0].kind = 'bot';
  for (const p of room.players) delete p.ai; // as a room saved before there were AIs
  room.players[1].ai = 'long-since-removed';
  for (let guard = 0; guard < 2000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'reveal') game.forceNext(room, rng);
    else assert.equal(game.runBotAction(room, rng), true);
  }
  assert.equal(room.phase, 'finished');
});
