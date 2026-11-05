// The rules of Trivium, with no sockets and no network: the settings, the wheel, a question going up and closing,
// what it is worth, what each player is allowed to see, and what happens when somebody leaves in the middle.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';
import { CATEGORY_ORDER, buildWheel } from './wheel.js';

const COUNTS = Object.fromEntries(CATEGORY_ORDER.map((category, index) => [category, 100 + index * 10]));
const TIMING = { answerMs: 1000, spinMs: 100, revealStep: 10, revealHold: 20 };

/** A room with the host in it, and whatever settings the test wants. */
const room = (settings = {}) => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings, counts: COUNTS, now: 1000, ...TIMING });

/** Four made-up answers, with the n-th one right. */
const questions = (count, correct = 0, category = 'history') =>
  Array.from({ length: count }, (unused, index) => ({
    id: `q${index}`,
    question: `question ${index}?`,
    answers: ['a', 'b', 'c', 'd'],
    correct,
    category,
    difficulty: 'medium',
  }));

/**
 * A room with `size` players, started, with the first question of the round up.
 * @param {object} [options]  settings, how many players, and which answer is right
 * @returns {{ room: object, rng: () => number, clock: number }}
 */
function playing({ size = 3, rounds = 1, perRound = 2, correct = 0 } = {}) {
  const rng = seeded(5);
  const r = room({ rounds, perRound });
  for (let n = 2; n <= size; n++) assert.equal(game.addHuman(r, n, `P${n}`).ok, true);
  assert.equal(game.start(r, 1, rng, 2000).ok, true);
  assert.equal(r.phase, 'spin');
  assert.equal(game.deal(r, questions(perRound, correct)).ok, true);
  assert.equal(game.askNext(r, rng, 3000).ok, true);
  assert.equal(r.phase, 'question');
  return { room: r, rng };
}

test('a new room is in the lobby with the host in it and a wheel to spin', () => {
  const r = room();
  assert.equal(r.phase, 'lobby');
  assert.equal(r.players.length, 1);
  assert.equal(r.rounds, game.ROUNDS.default);
  assert.equal(r.perRound, game.PER_ROUND.default);
  assert.ok(r.wheel.length > 1, 'the wheel has wedges');
  assert.ok(r.players[0].colour, 'the host has a marker colour');
});

test('the host sets the length, and only within the limits', () => {
  const r = room();
  assert.equal(game.setSettings(r, 1, { rounds: 5, perRound: 7 }).ok, true);
  assert.deepEqual([r.rounds, r.perRound], [5, 7]);
  assert.equal(game.setSettings(r, 1, { rounds: 0 }).error, 'roundsRange');
  assert.equal(game.setSettings(r, 1, { rounds: 99 }).error, 'roundsRange');
  assert.equal(game.setSettings(r, 1, { perRound: 0 }).error, 'perRoundRange');
  assert.equal(game.setSettings(r, 1, { perRound: 2.5 }).error, 'perRoundRange');
  assert.deepEqual([r.rounds, r.perRound], [5, 7], 'a refused setting changes nothing');
  assert.equal(game.addHuman(r, 2, 'Bob').ok, true);
  assert.equal(game.setSettings(r, 2, { rounds: 2 }).ok, false, 'only the host');
  assert.equal(game.createRoom({ code: 'x', hostId: 1, settings: { rounds: 99 }, now: 1 }).rounds, game.ROUNDS.default, 'a bad setting at creation is simply ignored');
});

test('marker colours are unique, free unless unlocked, and fixed once the game starts', () => {
  const r = room();
  assert.equal(game.addHuman(r, 2, 'Bob').ok, true);
  assert.notEqual(r.players[0].colour, r.players[1].colour);
  assert.equal(game.setColour(r, 2, r.players[0].colour).error, 'colourTaken');
  assert.equal(game.setColour(r, 2, '#123456').error, 'colourIsUnlock');
  assert.equal(game.setColour(r, 2, '#123456', true).ok, true);
  assert.equal(game.setColour(r, 9, game.COLOURS[3]).error, 'notInGame');
  const rng = seeded(1);
  assert.equal(game.start(r, 1, rng, 2000).ok, true);
  assert.equal(game.setColour(r, 2, game.COLOURS[4]).error, 'coloursBeforeStart');
});

test('only the host starts, only once, and only with enough players', () => {
  const r = room();
  const rng = seeded(1);
  assert.equal(game.start(r, 1, rng, 2000).error, 'minPlayers');
  assert.equal(game.addHuman(r, 2, 'Bob').ok, true);
  assert.equal(game.start(r, 2, rng, 2000).error, 'hostOnlyStart');
  assert.equal(game.start(r, 1, rng, 2000).ok, true);
  assert.equal(game.start(r, 1, rng, 2000).error, 'alreadyStarted');
  assert.equal(r.phase, 'spin');
  assert.ok(r.spin.category, 'the wheel picked a category');
  assert.ok(r.spin.angle >= 0 && r.spin.angle < 360, 'and stopped somewhere on itself');
});

test('a round is dealt once, and only questions that can be asked', () => {
  const r = room({ rounds: 1, perRound: 2 });
  const rng = seeded(2);
  assert.equal(game.addBot(r, 1).ok, true);
  assert.equal(game.start(r, 1, rng, 2000).ok, true);
  assert.equal(game.deal(r, [{ question: 'no answers?', answers: [], correct: 0 }]).error, 'triviaUnavailable');
  assert.equal(game.deal(r, [{ question: 'out of range?', answers: ['a', 'b'], correct: 5 }]).error, 'triviaUnavailable');
  assert.equal(game.deal(r, questions(9)).ok, true, 'more than the round needs is fine');
  assert.equal(r.deck.length, 2, 'but only the round is kept');
  assert.equal(game.deal(r, questions(2)).error, 'alreadyDealt');
  assert.equal(game.askNext(r, rng, 3000).ok, true);
  assert.equal(game.deal(r, questions(2)).error, 'notSpinning');
});

test('an answer is the first one given, on a real button, at a real spot', () => {
  const { room: r } = playing({ size: 3 });
  assert.equal(game.answer(r, 2, 1, 0.5, 0.5, 3100).ok, true);
  assert.equal(game.answer(r, 2, 0, 0.5, 0.5, 3200).error, 'alreadyAnswered');
  assert.equal(game.answer(r, 3, 9, 0.5, 0.5, 3100).error, 'notAnAnswer');
  assert.equal(game.answer(r, 3, -1, 0.5, 0.5, 3100).error, 'notAnAnswer');
  assert.equal(game.answer(r, 3, 1.5, 0.5, 0.5, 3100).error, 'notAnAnswer');
  assert.equal(game.answer(r, 3, 0, 1.5, 0.5, 3100).error, 'tapOnTheButton');
  assert.equal(game.answer(r, 3, 0, 0.5, -0.1, 3100).error, 'tapOnTheButton');
  assert.equal(game.answer(r, 3, 0, 0.5, Number.NaN, 3100).error, 'tapOnTheButton');
  assert.equal(game.answer(r, 99, 0, 0.5, 0.5, 3100).error, 'notInGame');
  assert.equal(r.answers.length, 1);
  assert.deepEqual(r.answers[0], { id: 2, choice: 1, x: 0.5, y: 0.5, at: 100 });
});

test('being right scores five, and being first scores five more', () => {
  const { room: r } = playing({ size: 3, correct: 0 });
  assert.equal(game.answer(r, 2, 0, 0.5, 0.5, 3100).ok, true); // right, first
  assert.equal(game.answer(r, 3, 0, 0.5, 0.5, 3200).ok, true); // right, second
  assert.equal(game.answer(r, 1, 2, 0.5, 0.5, 3300).ok, true); // wrong
  assert.equal(r.phase, 'reveal', 'the last answer closes the question');
  const score = (id) => r.players.find((p) => p.id === id).score;
  assert.equal(score(2), 10);
  assert.equal(score(3), 9);
  assert.equal(score(1), 0);
  assert.equal(r.result.entries.length, 3);
  assert.deepEqual(r.result.entries.map((e) => e.right), [true, true, false], 'the answers are kept in the order they came');
  assert.deepEqual(r.result.missed, []);
});

test('a question that nobody finishes closes on its deadline, with the rest marked as missed', () => {
  const { room: r } = playing({ size: 3, correct: 1 });
  assert.equal(game.answer(r, 2, 1, 0.2, 0.3, 3500).ok, true);
  assert.equal(r.phase, 'question');
  assert.equal(game.timeUp(r, 4000).ok, true);
  assert.equal(r.phase, 'reveal');
  assert.deepEqual(r.result.missed.sort(), [1, 3]);
  assert.equal(r.players.find((p) => p.id === 2).score, 10);
  assert.equal(r.players.find((p) => p.id === 1).questionsMissed, 1);
  assert.equal(game.timeUp(r, 4100).error, 'noQuestionUp');
});

test('the reveal lasts a step for each answer, one more, and then the hold', () => {
  const { room: r } = playing({ size: 3, correct: 0 });
  assert.equal(game.answer(r, 2, 0, 0.5, 0.5, 3100).ok, true);
  assert.equal(game.timeUp(r, 3500).ok, true);
  assert.equal(r.revealUntil - r.revealAt, 2 * TIMING.revealStep + TIMING.revealHold);
});

test('a round runs through its questions and then spins again, and the game ends after the last round', () => {
  const { room: r, rng } = playing({ size: 2, rounds: 2, perRound: 2, correct: 0 });
  const answerAndMoveOn = (clock) => {
    assert.equal(game.timeUp(r, clock).ok, true);
    return game.nextQuestion(r, rng, clock + 100);
  };
  assert.equal(answerAndMoveOn(4000).finished, false);
  assert.equal(r.phase, 'question', 'straight on to the second question of the round');
  assert.equal(r.ask, 1);
  assert.equal(answerAndMoveOn(5000).finished, false);
  assert.equal(r.phase, 'spin', 'and then the wheel for the second round');
  assert.equal(r.round, 1);
  assert.equal(r.ask, 0);
  assert.equal(game.deal(r, questions(2)).ok, true);
  assert.equal(game.askNext(r, rng, 6000).ok, true);
  assert.equal(answerAndMoveOn(7000).finished, false);
  assert.equal(answerAndMoveOn(8000).finished, true);
  assert.equal(r.phase, 'finished');
  assert.equal(r.history.length, 4, 'one history line per question');
  assert.equal(game.nextQuestion(r, rng, 9000).error, 'nothingToMoveOn');
});

test('a round that comes up short ends where it ran out', () => {
  const { room: r, rng } = playing({ size: 2, rounds: 1, perRound: 1 });
  assert.equal(game.timeUp(r, 4000).ok, true);
  assert.equal(game.nextQuestion(r, rng, 4100).finished, true);
});

test('nobody sees the right answer, or anybody else, until the question has closed', () => {
  const { room: r } = playing({ size: 3, correct: 2 });
  assert.equal(game.answer(r, 2, 2, 0.1, 0.9, 3100).ok, true);
  for (const id of [1, 2, 3, 99]) {
    const view = game.viewFor(r, id, { now: 3200 });
    assert.equal(view.correct, null, `${id} was shown the answer`);
    assert.equal(view.result, null, `${id} was shown the answers`);
    assert.ok(!JSON.stringify(view.question).includes('correct'), 'the question carries no answer key');
    assert.equal(view.mine, id === 2 ? view.mine : null);
  }
  assert.deepEqual(game.viewFor(r, 2, { now: 3200 }).mine, { choice: 2, x: 0.1, y: 0.9 });
  assert.equal(game.timeUp(r, 4000).ok, true);
  const after = game.viewFor(r, 1, { now: 4000 });
  assert.equal(after.correct, 2);
  assert.equal(after.result.entries.length, 1);
  assert.equal(after.result.entries[0].name, 'P2');
});

test('the rest of the round is never sent to anybody', () => {
  const { room: r } = playing({ size: 2, perRound: 3 });
  assert.equal(r.deck.length, 2);
  const text = JSON.stringify(game.viewFor(r, 1, { now: 3100 }));
  assert.ok(!text.includes('question 1?'), 'the next question is not in the view');
  assert.ok(text.includes('question 0?'), 'but this one is');
});

test('the scoreboard waits for everybody who has still to answer, and for nobody otherwise', () => {
  const { room: r } = playing({ size: 3 });
  const waiting = (clock) => game.viewFor(r, 1, { now: clock }).scoreboard.players.filter((p) => p.current).map((p) => p.id);
  assert.deepEqual(waiting(3100).sort(), [1, 2, 3]);
  assert.equal(game.answer(r, 2, 0, 0.5, 0.5, 3100).ok, true);
  assert.deepEqual(waiting(3200).sort(), [1, 3]);
  assert.equal(game.timeUp(r, 4000).ok, true);
  assert.deepEqual(waiting(4000), []);
});

test('a computer player decides its answer when the question goes up, and gives it when its moment comes', () => {
  const rng = seeded(11);
  const r = room({ rounds: 1, perRound: 1 });
  assert.equal(game.addHuman(r, 2, 'Bob').ok, true);
  assert.equal(game.addBot(r, 1).ok, true);
  assert.equal(game.start(r, 1, rng, 2000).ok, true);
  assert.equal(game.deal(r, questions(1)).ok, true);
  assert.equal(game.askNext(r, rng, 3000).ok, true);
  const bot = r.players.find((p) => p.kind === 'bot');
  assert.ok(bot.ai, 'it was given an AI at the start');
  assert.ok(bot.plan, 'and a plan the moment the question went up');
  const due = game.pendingBotAction(r);
  assert.equal(due.id, bot.id);
  assert.equal(due.at, 3000 + bot.plan.wait);
  assert.ok(due.at < r.deadline, 'which is inside the time allowed');
  assert.equal(game.runBotAction(r, due.at, due), true);
  assert.equal(game.pendingBotAction(r), null);
  assert.equal(r.answers[0].id, bot.id);
  assert.ok(!JSON.stringify(game.viewFor(r, 2, { now: due.at })).includes('plan'), 'and nobody is told what it meant to do');
});

test('a computer player that means to let the question go by is not waited for', () => {
  const rng = seeded(31);
  const r = room({ rounds: 1, perRound: 1 });
  assert.equal(game.addHuman(r, 2, 'Bob').ok, true);
  assert.equal(game.addBot(r, 1).ok, true);
  assert.equal(game.start(r, 1, rng, 2000).ok, true);
  assert.equal(game.deal(r, questions(1)).ok, true);
  assert.equal(game.askNext(r, rng, 3000).ok, true);
  const bot = r.players.find((p) => p.kind === 'bot');

  // With something to answer, the question waits for it however long it means to take.
  bot.plan = { choice: 0, x: 0.5, y: 0.5, wait: 900 };
  assert.equal(game.answer(r, 1, 0, 0.5, 0.5, 3100).ok, true);
  assert.equal(game.answer(r, 2, 0, 0.5, 0.5, 3200).ok, true);
  assert.equal(r.phase, 'question', 'the computer player has still to answer');
  assert.ok(game.pendingBotAction(r), 'and the server knows when to make it');

  // Having decided to answer nothing, it is not waited for: the question closes on the last answer that is coming.
  bot.plan = null;
  assert.equal(game.pendingBotAction(r), null);
  assert.equal(game.timeUp(r, 3300).ok, true); // stand in for the next answer closing it
  assert.equal(r.phase, 'reveal');
  assert.deepEqual(r.result.missed, [bot.id]);
});

test('the last answer closes the question when the rest of the table is computer players with nothing to say', () => {
  const rng = seeded(32);
  const r = room({ rounds: 1, perRound: 1 });
  for (let n = 0; n < 3; n++) assert.equal(game.addBot(r, 1).ok, true);
  assert.equal(game.start(r, 1, rng, 2000).ok, true);
  assert.equal(game.deal(r, questions(1)).ok, true);
  assert.equal(game.askNext(r, rng, 3000).ok, true);
  for (const bot of r.players.filter((p) => p.kind === 'bot')) bot.plan = null;
  assert.equal(game.answer(r, 1, 0, 0.5, 0.5, 3100).ok, true);
  assert.equal(r.phase, 'reveal', 'nobody else was ever going to answer, so it did not wait');
  assert.equal(r.result.entries.length, 1);
  assert.equal(r.result.missed.length, 3);
});

test('a person who leaves mid-question is replaced by a computer player that answers for them', () => {
  const { room: r } = playing({ size: 3, correct: 0 });
  assert.equal(game.answer(r, 2, 0, 0.5, 0.5, 3100).ok, true);
  const rng = seeded(3);
  assert.equal(game.removeHuman(r, 3, rng, 3200).ok, true);
  const bot = r.players[2];
  assert.equal(bot.kind, 'bot');
  assert.ok(bot.ai, 'it has an AI');
  assert.ok(bot.plan, 'and something to answer');
  assert.equal(game.removeHuman(r, 2, rng, 3300).ok, true, 'and the one who had answered keeps their answer');
  assert.equal(r.answers[0].id, r.players[1].id);
  assert.equal(r.answers[0].id.toString().startsWith('bot:'), true);
});

test('a person who leaves when the question was only waiting for them closes it', () => {
  const { room: r } = playing({ size: 2, correct: 0 });
  assert.equal(game.answer(r, 1, 0, 0.5, 0.5, 3100).ok, true);
  const rng = seeded(4);
  // The computer player that takes over may answer at once (it is given what is left of the clock) or close it.
  assert.equal(game.removeHuman(r, 2, rng, 3200).ok, true);
  assert.ok(['question', 'reveal'].includes(r.phase));
});

test('a game with nothing to ask ends on what it has, or is abandoned if it has nothing', () => {
  const fresh = room({ rounds: 1, perRound: 1 });
  assert.equal(game.addHuman(fresh, 2, 'Bob').ok, true);
  assert.equal(game.start(fresh, 1, seeded(1), 2000).ok, true);
  assert.equal(game.giveUp(fresh).ok, true);
  assert.equal(fresh.phase, 'abandoned');
  assert.equal(game.isLive(fresh), false);

  const { room: r } = playing({ size: 2, rounds: 2, perRound: 1 });
  assert.equal(game.timeUp(r, 4000).ok, true);
  assert.equal(game.nextQuestion(r, seeded(1), 4100).finished, false);
  assert.equal(game.giveUp(r).ok, true);
  assert.equal(r.phase, 'finished', 'a quiz that asked something is scored');
  assert.equal(game.giveUp(r).error, 'nothingToMoveOn');
});

test('the statistics record people only, with the counters the game kept', () => {
  const { room: r, rng } = playing({ size: 3, rounds: 1, perRound: 1, correct: 0 });
  assert.equal(game.answer(r, 1, 0, 0.5, 0.5, 3050).ok, true);
  assert.equal(game.answer(r, 2, 0, 0.5, 0.5, 3100).ok, true);
  assert.equal(game.answer(r, 3, 1, 0.01, 0.5, 3200).ok, true);
  assert.equal(game.nextQuestion(r, rng, 4000).finished, true);
  const rows = game.statsPlayers(r);
  assert.equal(rows.length, 3);
  const row = (id) => rows.find((entry) => entry.userId === id);
  assert.equal(row(1).outcome, 'win');
  assert.equal(row(1).placement, 1);
  assert.equal(row(1).extras.rightAnswers, 1);
  assert.equal(row(1).extras.fastestRight, 1);
  assert.equal(row(1).extras.snapAnswers, 1, 'answered in under half a second');
  assert.equal(row(1).extras.questionsFaced, 1);
  assert.equal(row(1).extras.flawlessGames, 1, 'the only question of the quiz, right and first');
  assert.equal(row(1).extras.bullseyes, 1, 'tapped the middle');
  assert.equal(row(3).extras.rightAnswers, 0);
  assert.equal(row(3).extras.edgeClicks, 1, 'tapped the edge');
  assert.equal(row(3).extras.questionsFaced, 1);
  assert.equal(row(3).extras.blankRounds, 0, 'a round of one question is no verdict on the category');
  assert.equal(row(3).extras.flawlessGames, 0);
  assert.equal(row(2).extras.rightAnswers, 1);
  assert.equal(row(2).extras.flawlessGames, 0, 'right, but beaten to it');
  assert.equal(row(2).extras.soleRight, 0);
  assert.equal(row(2).outcome, 'loss');
});

test('a saved room from before these fields loads and plays', () => {
  const old = JSON.parse(JSON.stringify(room()));
  delete old.deck;
  delete old.answers;
  delete old.answerMs;
  delete old.wheel;
  delete old.roundScored;
  delete old.roundRight;
  old.players[0] = { id: 1, name: 'Ann', bot: false, colour: '#ffffff', score: 3 };
  const brought = game.migrate(old, () => 'Ann');
  assert.equal(brought.players[0].kind, 'human');
  assert.equal(brought.players[0].rightThisGame, 0);
  assert.deepEqual(brought.answers, []);
  assert.equal(brought.answerMs, game.ANSWER_MS);
  assert.deepEqual(brought.wheel, buildWheel({}));
  assert.equal(game.addHuman(brought, 2, 'Bob').ok, true);
  assert.equal(game.start(brought, 1, seeded(1), 5000).ok, true);
});

test('there is no play again: a new quiz is started from the menu', () => {
  assert.equal(game.playAgain().error, 'startFromMenu');
});
