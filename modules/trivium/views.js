// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
//
// The questions are made up here rather than fetched, because the rules never fetch anything: server.js is what talks
// to shared/trivia.js, and `deal` is the door it hands them through.  That door is all this needs.
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';
import { CATEGORY_ORDER } from './wheel.js';

/** How many questions each category is pretended to hold, so the test wheel has wedges of different widths. */
const COUNTS = Object.fromEntries(CATEGORY_ORDER.map((category, index) => [category, 20 + index * 70]));
/** Timings small enough that a whole game is a few hundred ticks of a made-up clock. */
const TIMING = { answerMs: 1000, spinMs: 100, revealStep: 10, revealHold: 20 };

/**
 * A round's worth of made-up questions of one category.
 *
 * @param {string} category  the category the wheel stopped on
 * @param {number} count  how many to make
 * @param {number} serial  a number that makes every question of a game different
 * @returns {object[]} questions in the shape shared/trivia.js prepares them in
 * Side effects: none.
 */
const questionsFor = (category, count, serial) =>
  Array.from({ length: count }, (unused, index) => {
    const n = serial + index;
    return {
      id: `${category}-${n}`,
      question: `${category} question ${n}?`,
      answers: [`answer ${n}a`, `answer ${n}b`, `answer ${n}c`, `answer ${n}d`],
      correct: n % 4,
      category,
      difficulty: ['easy', 'medium', 'hard'][n % 3],
    };
  });

/**
 * Plays a seeded game through and returns every view it sent.  The people are played by the same judgement the
 * computer players use, so that a game of any size can be played out without a table.
 *
 * @param {number} seed  the seed for the random source
 * @param {number} size  how many players (two of them people, the rest computers)
 * @param {number} rounds  how many rounds
 * @param {number} perRound  how many questions a round
 * @returns {{ views: string[], finished: boolean }} every view, as JSON text, and whether the game ran to its end
 * Side effects: none outside the room it builds.
 */
export function recordedViews(seed, size, rounds, perRound) {
  const rng = seeded(seed);
  let clock = 1000;
  let serial = 0;
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { rounds, perRound }, counts: COUNTS, now: clock, ...TIMING });
  assert.equal(game.addHuman(room, 2, 'Bob').ok, true);
  const names = (id) => `Player ${id}`;
  const views = [];
  const look = () => {
    room.updatedAt = clock;
    for (const id of [1, 2, 99]) views.push(JSON.stringify(game.viewFor(room, id, { nameOf: names, now: clock })), JSON.stringify(game.viewFor(room, id, { online: () => false, now: clock })));
  };
  look();
  while (room.players.length < size) assert.equal(game.addBot(room, 1).ok, true);
  look();
  assert.equal(game.start(room, 1, rng, clock).ok, true);
  look();

  for (let guard = 0; guard < 4000 && game.isLive(room); guard++) {
    if (room.phase === 'spin' && !room.deck.length) {
      assert.equal(game.deal(room, questionsFor(room.spin.category, perRound, serial)).ok, true);
      serial += perRound;
    } else if (room.phase === 'spin') {
      clock = Math.max(clock, room.spinUntil);
      assert.equal(game.askNext(room, rng, clock).ok, true);
    } else if (room.phase === 'question') {
      const bot = game.pendingBotAction(room);
      // The people answer first, so that a game always has human answers in it; then the computers, by their clock.
      const person = [1, 2].find((id) => room.players.some((p) => p.id === id) && !room.answers.some((a) => a.id === id));
      if (person !== undefined) {
        clock += 1 + Math.floor(rng() * 50);
        // Right rather more often than not, so that the views include people who score, lead and win.
        const choice = rng() < 0.6 ? room.question.correct : Math.floor(rng() * room.question.answers.length);
        assert.equal(game.answer(room, person, choice, rng(), rng(), clock).ok, true);
      } else if (bot) {
        clock = Math.max(clock, bot.at);
        assert.equal(game.runBotAction(room, clock, bot), true);
      } else {
        clock = Math.max(clock, room.deadline);
        assert.equal(game.timeUp(room, clock).ok, true);
      }
    } else if (room.phase === 'reveal') {
      clock = Math.max(clock, room.revealUntil);
      assert.equal(game.nextQuestion(room, rng, clock).ok, true);
    }
    look();
  }
  look();
  return { views, finished: room.phase === 'finished' };
}
