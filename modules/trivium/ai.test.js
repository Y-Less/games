// The computer players: they all answer legally, they all finish a game between them, and each one does the thing it
// is for - the bookish one knows more, the quick one is quicker, the chancer is no better than a coin, and the
// ditherer sometimes leaves it too late altogether.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiById, pickAI } from '../../shared/ai.js';
import { seeded } from '../../shared/random.js';
import * as game from './game.js';
import { AIS } from './ai/index.js';

const ANSWER_MS = 1000;
const TIMING = { answerMs: ANSWER_MS, spinMs: 10, revealStep: 2, revealHold: 4 };

/** The question an AI is asked about, with the right answer in a different place each time. */
const question = (n) => ({ answers: ['a', 'b', 'c', 'd'], correct: n % 4, question: `q${n}?`, category: 'history', difficulty: ['easy', 'medium', 'hard'][n % 3], answerMs: ANSWER_MS });

/**
 * Asks one AI a great many questions.
 * @param {object} ai  the AI
 * @param {number} count  how many questions
 * @returns {{ right: number, asked: number, silent: number, speed: number }} how it did, and how long it took on average
 */
function quiz(ai, count = 2000) {
  const rng = seeded(1234);
  let right = 0;
  let silent = 0;
  let speed = 0;
  for (let n = 0; n < count; n++) {
    const asked = question(n);
    const given = ai.answer(asked, rng);
    if (!given) {
      silent++;
      continue;
    }
    assert.ok(Number.isInteger(given.choice) && given.choice >= 0 && given.choice < asked.answers.length, `${ai.id} answered ${given.choice}`);
    assert.ok(given.x >= 0 && given.x <= 1 && given.y >= 0 && given.y <= 1, `${ai.id} tapped at ${given.x},${given.y}`);
    assert.ok(given.speed >= 0 && given.speed <= 1, `${ai.id} took ${given.speed}`);
    if (given.choice === asked.correct) right++;
    speed += given.speed;
  }
  return { right, asked: count, silent, speed: speed / Math.max(1, count - silent) };
}

const scores = Object.fromEntries(AIS.map((ai) => [ai.id, quiz(ai)]));

test('every AI answers legally, and they are all different people', () => {
  assert.ok(AIS.length >= 4, 'there is a range to choose from');
  assert.equal(AIS[0].id, 'standard', 'the fallback stays first');
  assert.equal(new Set(AIS.map((ai) => ai.id)).size, AIS.length);
  for (const ai of AIS) assert.ok(ai.name && ai.description, `${ai.id} introduces itself`);
});

test('the bookish one knows more than the steady one, which knows more than the chancer', () => {
  const share = (id) => scores[id].right / scores[id].asked;
  assert.ok(share('swot') > share('standard'), `swot ${share('swot')} vs standard ${share('standard')}`);
  assert.ok(share('standard') > share('quickfire'), `standard ${share('standard')} vs quickfire ${share('quickfire')}`);
  assert.ok(share('quickfire') > share('chancer'), `quickfire ${share('quickfire')} vs chancer ${share('chancer')}`);
  assert.ok(Math.abs(share('chancer') - 0.25) < 0.04, `the chancer is a one-in-four guess (${share('chancer')})`);
});

test('the quick one is quick and the dithering one is not, and only the dithering one lets questions go by', () => {
  assert.ok(scores.quickfire.speed < scores.standard.speed, 'quickfire is in first');
  assert.ok(scores.standard.speed < scores.swot.speed, 'the bookish one thinks about it');
  assert.ok(scores.swot.speed < scores.ditherer.speed, 'and the ditherer thinks about it longer');
  assert.equal(scores.swot.silent, 0);
  assert.equal(scores.chancer.silent, 0);
  assert.ok(scores.ditherer.silent > scores.ditherer.asked * 0.1, `the ditherer missed ${scores.ditherer.silent}`);
});

test('the bookish one taps the middle and the quick one does not', () => {
  const rng = seeded(8);
  let centre = 0;
  let edge = 0;
  for (let n = 0; n < 500; n++) {
    centre += Math.abs(aiById(AIS, 'swot').answer(question(n), rng).x - 0.5) < 0.08 ? 1 : 0;
    const quick = aiById(AIS, 'quickfire').answer(question(n), rng);
    edge += Math.min(quick.x, 1 - quick.x, quick.y, 1 - quick.y) <= 0.04 ? 1 : 0;
  }
  assert.ok(centre > 450, `the bookish one tapped the middle ${centre} times in 500`);
  assert.ok(edge > 450, `the quick one tapped the edge ${edge} times in 500`);
});

test('an AI that throws answers nothing rather than stopping the game', () => {
  const broken = { id: 'broken', name: 'Broken', answer: () => { throw new Error('no'); } };
  const room = playable({ size: 3, ais: ['standard', 'broken'] }, [...AIS, broken]);
  assert.equal(room.players.filter((p) => p.kind === 'bot').length, 2);
  assert.ok(room.phase === 'question');
});

/**
 * A started room with computer players, each given the AI named (so a trait can be looked for without waiting on luck).
 * @param {{ size: number, ais: string[] }} options  how many players, and the AI ids for the bot seats
 * @param {object[]} [list]  the AIs to choose from (the module's own by default)
 * @returns {object} the room, with its first question up
 */
function playable({ size, ais }, list = AIS) {
  const rng = seeded(21);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { rounds: 1, perRound: 2 }, now: 1000, ...TIMING });
  while (room.players.length < size) assert.equal(game.addBot(room, 1).ok, true);
  assert.equal(game.start(room, 1, rng, 2000).ok, true);
  const bots = room.players.filter((p) => p.kind === 'bot');
  for (const [index, bot] of bots.entries()) {
    bot.ai = ais[index % ais.length];
    assert.ok(aiById(list, bot.ai), `${bot.ai} is a real AI`);
  }
  assert.equal(game.deal(room, [0, 1].map((n) => ({ id: `q${n}`, question: `q${n}?`, answers: ['a', 'b', 'c', 'd'], correct: n % 4, category: 'history', difficulty: 'medium' }))).ok, true);
  assert.equal(game.askNext(room, rng, 3000).ok, true);
  return room;
}

test('a table of computer players plays a whole quiz by itself, from several seeds', () => {
  for (const seed of [1, 2, 3, 7, 11]) {
    const rng = seeded(seed);
    let clock = 1000;
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { rounds: 2, perRound: 3 }, now: clock, ...TIMING });
    while (room.players.length < 6) assert.equal(game.addBot(room, 1).ok, true);
    assert.equal(game.start(room, 1, rng, clock).ok, true);
    let serial = 0;
    for (let guard = 0; guard < 500 && game.isLive(room); guard++) {
      if (room.phase === 'spin' && !room.deck.length) {
        const deck = Array.from({ length: 3 }, () => ({ id: `q${serial}`, question: `q${serial}?`, answers: ['a', 'b', 'c', 'd'], correct: serial++ % 4, category: 'music', difficulty: 'easy' }));
        assert.equal(game.deal(room, deck).ok, true);
      } else if (room.phase === 'spin') {
        clock = Math.max(clock, room.spinUntil);
        assert.equal(game.askNext(room, rng, clock).ok, true);
      } else if (room.phase === 'question') {
        const due = game.pendingBotAction(room);
        if (due) {
          clock = Math.max(clock, due.at);
          assert.equal(game.runBotAction(room, clock, due), true, `seed ${seed}: the move was refused`);
        } else {
          clock = Math.max(clock, room.deadline);
          assert.equal(game.timeUp(room, clock).ok, true);
        }
      } else {
        clock = Math.max(clock, room.revealUntil);
        assert.equal(game.nextQuestion(room, rng, clock).ok, true);
      }
    }
    assert.equal(room.phase, 'finished', `seed ${seed} finished`);
    assert.equal(room.history.length, 6);
    assert.ok(room.players.some((p) => p.score > 0), `seed ${seed}: somebody scored`);
  }
});

test('an AI is given at the start, kept with the room, and fallen back on when it is unknown', () => {
  const rng = seeded(5);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { rounds: 1, perRound: 1 }, now: 1000, ...TIMING });
  assert.equal(game.addHuman(room, 2, 'Bob').ok, true);
  for (let n = 0; n < 3; n++) assert.equal(game.addBot(room, 1).ok, true);
  assert.equal(game.start(room, 1, rng, 2000).ok, true);
  const bots = room.players.filter((p) => p.kind === 'bot');
  for (const bot of bots) assert.ok(AIS.some((ai) => ai.id === bot.ai), `${bot.name} has one of this game's AIs`);
  // A room saved with an AI that has since gone falls back to the first, rather than breaking.
  bots[0].ai = 'a-removed-ai';
  const saved = JSON.parse(JSON.stringify(room));
  const brought = game.migrate(saved, () => 'Ann');
  assert.equal(game.deal(brought, [{ id: 'q', question: 'q?', answers: ['a', 'b'], correct: 1, category: 'music' }]).ok, true);
  assert.equal(game.askNext(brought, rng, 3000).ok, true);
  assert.ok(brought.players.find((p) => p.id === bots[0].id).plan, 'the fallback still answered');
  // The view shows a computer player's AI by name, and never its workings.
  const shown = game.viewFor(brought, 2, { now: 3000 }).players.find((p) => p.id === bots[1].id);
  assert.deepEqual(Object.keys(shown.ai).sort(), ['description', 'id', 'name']);
});

test('picking an AI at random favours the ones with the weight', () => {
  const rng = seeded(17);
  const seen = {};
  for (let n = 0; n < 5000; n++) {
    const id = pickAI(AIS, rng).id;
    seen[id] = (seen[id] ?? 0) + 1;
  }
  assert.equal(Object.keys(seen).length, AIS.length, 'all of them turn up');
  assert.ok(seen.standard > seen.chancer, 'the ordinary one most often');
});
