// Randomised play of the Trivium rules: hundreds of seeded quizzes in which people, computer players, and strangers
// do legal and illegal things in any order - answer, answer again, answer nonsense, leave, come back, get removed -
// while questions are dealt (some of them malformed), asked, closed, and revealed around them.
//
// After every single step the room must still be a quiz as rules.md describes one: your first press is your answer,
// a right answer is worth 5 and the quickest right answers a further 5, 4, 3, 2, 1, a wrong answer or none is worth
// nothing, the scoreboard adds up to the scores, the room can be saved and loaded, and nobody is told the right
// answer, anybody else's answer, a computer player's intentions, or the questions still to come before they should be.
//
// Every failure names its seed and step, so a quiz that goes wrong can be played again exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/testkit.js';
import { CATEGORY_ORDER } from './wheel.js';

const PHASES = ['lobby', 'spin', 'question', 'reveal', 'finished', 'abandoned'];
const OVER = ['finished', 'abandoned'];
/** rules.md, Scoring: any right answer, and what the quickest right answers get on top of it, in order. */
const RIGHT = 5;
const QUICKEST = [5, 4, 3, 2, 1];
const PEOPLE = [1, 2, 3, 4, 5];
const STRANGER = 99;
const COUNTS = Object.fromEntries(CATEGORY_ORDER.map((category, index) => [category, 30 + index * 40]));
const TIMING = { answerMs: 1000, spinMs: 100, revealStep: 10, revealHold: 20 };

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const sum = (numbers) => numbers.reduce((a, b) => a + b, 0);

/** Made-up questions whose text says which they are, so that one turning up where it should not is recognisable. */
function questions(count, serial, rng) {
  return Array.from({ length: count }, (unused, index) => {
    const n = serial + index;
    return { id: `q${n}`, question: `secret question ${n}?`, answers: [`a${n}`, `b${n}`, `c${n}`, `d${n}`], correct: Math.floor(rng() * 4), category: 'history', difficulty: 'medium' };
  });
}

/** What the rules say a closed question was worth to each answer, worked out here from the answers alone. */
function expectedPoints(answers, correct) {
  let place = 0;
  return answers.map((given) => (given.choice === correct ? RIGHT + (QUICKEST[place++] ?? 0) : 0));
}

/** Everything that must be true of a room, whatever has just been done to it. */
function checkRoom(room, label) {
  assert.ok(PHASES.includes(room.phase), `${label}: phase ${room.phase}`);
  const ids = room.players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: no player twice`);
  assert.equal(new Set(room.players.map((p) => p.slot)).size, ids.length, `${label}: no place held twice`);
  assert.ok(ids.length >= 1 && ids.length <= game.MAX_PLAYERS, `${label}: ${ids.length} players`);
  assert.ok(game.isHuman(room.players.find((p) => p.id === room.hostId)), `${label}: the host is a person at the table`);
  assert.equal(new Set(room.players.map((p) => p.colour)).size, ids.length, `${label}: no two markers are the same colour`);
  assert.ok(Number.isInteger(room.rounds) && room.rounds >= game.ROUNDS.min && room.rounds <= game.ROUNDS.max, `${label}: ${room.rounds} rounds`);
  assert.ok(Number.isInteger(room.perRound) && room.perRound >= game.PER_ROUND.min && room.perRound <= game.PER_ROUND.max, `${label}: ${room.perRound} questions a round`);
  assert.ok(room.wheel.length >= 1, `${label}: there is a wheel to spin`);
  if (room.phase !== 'lobby') assert.ok(ids.length >= game.MIN_PLAYERS, `${label}: a quiz under way has enough players`);

  for (const p of room.players) {
    assert.ok(Number.isInteger(p.score) && p.score >= 0, `${label}: ${p.id} has a sound score (${p.score})`);
    // A question put to you was either answered or let go by, and you cannot be right more often than you answered.
    assert.equal(p.questionsFaced, p.answersGiven + p.questionsMissed, `${label}: ${p.id} faced what they answered and what they missed`);
    assert.ok(p.rightAnswers <= p.answersGiven, `${label}: ${p.id} was right no more often than they answered`);
    assert.ok(p.fastestRight <= p.rightAnswers, `${label}: ${p.id} was quickest no more often than they were right`);
  }

  // The answers to the question that is up: one each, from people at the table, for an answer that exists.
  const answered = room.answers.map((a) => a.id);
  assert.equal(new Set(answered).size, answered.length, `${label}: your first press is your answer, and there is only one`);
  if (room.phase === 'question') {
    assert.ok(room.question, `${label}: a question is up`);
    for (const given of room.answers) {
      assert.ok(ids.includes(given.id), `${label}: an answer from ${given.id}, who is not at the table`);
      assert.ok(Number.isInteger(given.choice) && given.choice >= 0 && given.choice < room.question.answers.length, `${label}: an answer that is one of the buttons`);
      assert.ok(given.x >= 0 && given.x <= 1 && given.y >= 0 && given.y <= 1, `${label}: a press that landed on the button`);
      assert.ok(given.at >= 0, `${label}: an answer given after the question went up`);
    }
    // The question closes when everybody has answered - a computer player sitting this one out is not waited for.
    const waitedFor = room.players.filter((p) => !answered.includes(p.id) && (game.isHuman(p) || p.plan));
    assert.ok(waitedFor.length > 0, `${label}: everybody has answered and the question is still up`);
    assert.ok(room.deadline >= room.askedAt, `${label}: the question has a time to close`);
  }

  if (room.phase === 'reveal') {
    const { entries, missed, correct } = room.result;
    assert.equal(correct, room.question?.correct ?? correct, `${label}: the answer revealed is the question's`);
    // Shown in the order they arrived, and scored by the table in rules.md.
    assert.ok(entries.every((e, i) => i === 0 || e.at >= entries[i - 1].at), `${label}: the answers are revealed in the order they arrived`);
    assert.deepEqual(entries.map((e) => e.points), expectedPoints(entries, correct), `${label}: each answer scored what the rules say`);
    assert.deepEqual(entries.map((e) => e.right), entries.map((e) => e.choice === correct), `${label}: right means the right button`);
    const everybody = [...entries.map((e) => e.id), ...missed].map(String).sort();
    assert.deepEqual(everybody, ids.map(String).sort(), `${label}: everybody either answered or missed it`);
  }

  // The scoreboard: a line a closed question, never more than the quiz has, and columns that add up to the scores.
  assert.ok(room.history.length <= room.rounds * room.perRound, `${label}: ${room.history.length} questions asked of ${room.rounds * room.perRound}`);
  for (const p of room.players) {
    assert.equal(sum(room.history.map((line) => line.deltas[p.slot] ?? 0)), p.score, `${label}: the scoreboard adds up to the score of ${p.id}`);
  }
  for (const line of room.history) {
    const awarded = Object.values(line.deltas);
    const right = awarded.filter((points) => points > 0).sort((a, b) => b - a);
    assert.deepEqual(right, right.map((unused, place) => RIGHT + (QUICKEST[place] ?? 0)), `${label}: a question paid out ${JSON.stringify(awarded)}`);
  }
  if (room.phase === 'abandoned') assert.equal(room.history.length, 0, `${label}: a quiz with scores on the board is finished, not abandoned`);

  // "A room is a plain object that can be saved as JSON": saved and loaded, it is the same room.  (A person who took
  // a computer player's place has no plan at all, which loading writes down as "no plan"; the two mean the same.)
  const withPlans = { ...room, players: room.players.map((p) => ({ ...p, plan: p.plan ?? null })) };
  assert.deepEqual(game.migrate(JSON.parse(JSON.stringify(room))), withPlans, `${label}: a saved room loads as it was`);
}

/** Nobody may be shown what they should not, whoever is looking. */
function checkViews(room, label, now) {
  const shown = ['reveal', 'finished'].includes(room.phase);
  for (const id of [...room.players.map((p) => p.id), STRANGER]) {
    const view = JSON.parse(JSON.stringify(game.viewFor(room, id, { now })));
    const text = JSON.stringify(view);
    const who = `${label}: ${id}`;
    const mine = room.answers.find((a) => a.id === id) ?? null;

    assert.equal(view.phase, room.phase, `${who} is told the phase`);
    assert.ok(!text.includes('"plan"'), `${who} was sent what a computer player means to answer`);
    assert.ok(!text.includes('"deck"'), `${who} was sent the questions still to come`);
    for (const waiting of room.deck) assert.ok(!text.includes(waiting.text), `${who} was sent a question that has not been asked yet`);

    if (!shown) {
      assert.equal(view.correct, null, `${who} was told the right answer in ${room.phase}`);
      assert.equal(view.result, null, `${who} was shown the answers in ${room.phase}`);
      assert.ok(!('correct' in (view.question ?? {})), `${who}: the question carries its own answer`);
      // The only answer anybody is sent while the question is open is their own.
      const others = JSON.stringify({ ...view, mine: null });
      assert.ok(!others.includes('"choice"'), `${who} was sent somebody else's answer before the question closed`);
    }
    assert.deepEqual(view.mine, mine ? { choice: mine.choice, x: mine.x, y: mine.y } : null, `${who}: their own answer, and where they pressed`);
    if (room.phase === 'reveal') {
      assert.equal(view.correct, room.result.correct, `${who} is shown the right answer at the reveal`);
      assert.equal(view.result.entries.length, room.result.entries.length, `${who} is shown every answer at the reveal`);
    }
    if (room.phase === 'lobby') assert.equal(view.question, null, `${who}: no question in the waiting room`);

    for (const p of view.players) {
      assert.equal(p.answered, room.phase === 'question' && room.answers.some((a) => a.id === p.id), `${who}: whether ${p.id} has answered`);
      assert.equal(sum(view.scoreboard.rounds.map((line) => line.deltas[p.id] ?? 0)), p.score, `${who}: the scoreboard adds up for ${p.id}`);
      if (!OVER.includes(room.phase)) assert.ok(p.placement === null && p.winner === false, `${who}: nobody has won a quiz that is not over`);
    }
    if (room.phase === 'finished') {
      // Highest total wins; equal totals share the win.
      const best = Math.max(...view.players.map((p) => p.score));
      for (const p of view.players) assert.equal(p.winner, p.score === best, `${who}: the winners are the ones with the most`);
    }
  }
}

const CHOICES = [0, 1, 2, 3, 4, -1, 99, 1.5, '1', null, undefined, NaN, {}, [0]];
const SPOTS = [0, 0.5, 1, 0.25, 0.999, -0.1, 1.1, NaN, Infinity, '0.5', null, undefined, {}];
const SETTINGS = [{ rounds: 1 }, { rounds: 2 }, { rounds: 0 }, { rounds: 99 }, { rounds: 1.5 }, { perRound: 1 }, { perRound: 3 }, { perRound: 0 }, { perRound: 'ten' }, { size: 3 }, { size: 99 }, {}];
const COLOURS = [...game.COLOURS.slice(0, 4), '#abcdef', 'not a colour', '', null, 7];
/** What a broken or hostile question source might hand over instead of a round of questions. */
const BAD_DEALS = [null, undefined, 'questions', [], [null], [{ question: 'no answers?' }], [{ question: 'one answer?', answers: ['only'], correct: 0 }], [{ question: 'which?', answers: ['a', 'b'], correct: 5 }], [{ question: 7, answers: ['a', 'b'], correct: 0 }]];

/**
 * One seeded quiz of anything at all, checked after every step.
 * @param {number} seed  the seed, which decides everything
 * @returns {object} the room as the quiz left it
 */
function playRandom(seed) {
  const rng = seeded(seed);
  let now = 1000;
  let serial = 0;
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds: 1 + Math.floor(rng() * 2), perRound: 1 + Math.floor(rng() * 3) }, counts: COUNTS, now, ...TIMING });
  const name = (id) => `Player ${id}`;
  for (const id of PEOPLE.slice(1)) if (rng() < 0.6) game.addHuman(room, id, name(id));
  if (rng() < 0.6) game.addBot(room, room.hostId);
  if (room.players.length < game.MIN_PLAYERS) game.addHuman(room, 2, name(2));

  const goodDeal = () => {
    const outcome = game.deal(room, questions(room.perRound, serial, rng));
    if (outcome.ok) serial += room.perRound;
    return outcome;
  };
  const actions = [
    (id) => game.setSettings(room, id, pick(rng, SETTINGS)),
    (id) => game.setColour(room, id, pick(rng, COLOURS), rng() < 0.2),
    () => game.setWheel(room, pick(rng, [COUNTS, {}, null, { history: -5 }, { nonsense: 3 }])),
    (id) => game.addBot(room, id),
    (id) => game.fillWithBots(room, id, pick(rng, [2, 4, 8, 99, 'x', undefined])),
    (id) => game.removeBot(room, id, pick(rng, ['s0', 's1', 's2', 's3', 's99', null])),
    (id) => game.start(room, id, rng, now),
    () => game.deal(room, pick(rng, BAD_DEALS)),
    goodDeal,
    () => game.askNext(room, rng, now),
    (id) => game.answer(room, id, pick(rng, CHOICES), pick(rng, SPOTS), pick(rng, SPOTS), now),
    (id) => game.answer(room, id, Math.floor(rng() * 4), rng(), rng(), now),
    () => game.timeUp(room, now),
    () => game.nextQuestion(room, rng, now),
    (id) => game.removeHuman(room, id, rng, now),
    (id) => game.addHuman(room, id, name(id)),
    (id) => game.kick(room, id, pick(rng, room.players).slot, rng, now),
    (id) => game.playAgain(room, id),
    () => game.pendingBotAction(room) && { ok: game.runBotAction(room, now) },
    () => (rng() < 0.03 ? game.giveUp(room) : null),
  ];

  for (let step = 0; step < 300 && !OVER.includes(room.phase); step++) {
    const label = `seed ${seed}, step ${step}`;
    now += Math.floor(rng() * 300);
    const id = pick(rng, [...PEOPLE, STRANGER]);
    let action = pick(rng, actions);
    // Often enough, what the quiz is waiting for happens, so that quizzes get somewhere.
    if (room.phase === 'lobby' && rng() < 0.3) action = () => game.start(room, room.hostId, rng, now);
    else if (room.phase === 'spin' && !room.deck.length && rng() < 0.5) action = goodDeal;
    else if (room.phase === 'spin' && rng() < 0.5) action = () => game.askNext(room, rng, now);
    else if (room.phase === 'question' && rng() < 0.4) action = (who) => game.answer(room, who, Math.floor(rng() * 4), rng(), rng(), now);
    else if (room.phase === 'reveal' && rng() < 0.5) action = () => game.nextQuestion(room, rng, now);

    const before = JSON.stringify(room);
    const scores = new Map(room.players.map((p) => [p.slot, p.score]));
    const result = action(id);
    if (result && result.ok === false) {
      assert.equal(typeof result.error, 'string', `${label}: a refusal says why`);
      assert.equal(JSON.stringify(room), before, `${label}: a refused action (${result.error}) changed the room`);
    }
    if (result?.empty) return room; // the last person left: the server throws the room away

    checkRoom(room, label);
    checkViews(room, label, now);
    for (const p of room.players) assert.ok(p.score >= (scores.get(p.slot) ?? 0), `${label}: the score of ${p.id} went down`);
  }
  return room;
}

test('random legal and illegal play, with people leaving and coming back, keeps every room and every view sound', () => {
  const phases = new Map();
  for (let seed = 1; seed <= 150; seed++) {
    const { phase } = playRandom(seed);
    phases.set(phase, (phases.get(phase) ?? 0) + 1);
  }
  assert.ok((phases.get('finished') ?? 0) >= 15, `a good many quizzes ran to their end (${JSON.stringify([...phases])})`);
});

test('quizzes run the way the server runs them always finish, and every point is one the rules awarded', () => {
  for (let seed = 7000; seed < 7100; seed++) {
    const rng = seeded(seed);
    let now = 1000;
    let serial = 0;
    const size = 2 + Math.floor(rng() * 3);
    const rounds = 1 + Math.floor(rng() * 3);
    const perRound = 1 + Math.floor(rng() * 4);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds, perRound }, counts: COUNTS, now, ...TIMING });
    for (let id = 2; id <= size; id++) assert.equal(game.addHuman(room, id, `Player ${id}`).ok, true);
    const bots = Math.floor(rng() * 4);
    for (let n = 0; n < bots; n++) assert.equal(game.addBot(room, 1).ok, true);
    assert.equal(game.start(room, 1, rng, now).ok, true);

    // This test's own book: what each place has earned, from nothing but who pressed what and in which order.
    const earned = new Map(room.players.map((p) => [p.slot, 0]));
    const right = new Map(room.players.map((p) => [p.slot, 0]));
    const spins = [];
    let closed = 0;
    for (let step = 0; step < 5000 && room.phase !== 'finished'; step++) {
      const label = `seed ${seed}, step ${step}`;
      if (room.phase === 'spin' && !room.deck.length) {
        assert.ok(room.wheel.some((wedge) => wedge.category === room.spin.category), `${label}: the wheel stopped on one of its own wedges`);
        spins.push(room.spin.category);
        assert.equal(game.deal(room, questions(perRound, serial, rng)).ok, true, label);
        assert.equal(game.deal(room, questions(perRound, serial, rng)).ok, false, `${label}: a round is dealt once`);
        serial += perRound;
      } else if (room.phase === 'spin') {
        now = Math.max(now, room.spinUntil);
        assert.equal(game.askNext(room, rng, now).ok, true, label);
      } else if (room.phase === 'question') {
        const waiting = room.players.filter((p) => game.isHuman(p) && !room.answers.some((a) => a.id === p.id));
        const bot = game.pendingBotAction(room);
        if (waiting.length && rng() < 0.7) {
          now += Math.floor(rng() * 80);
          const who = pick(rng, waiting);
          const choice = rng() < 0.55 ? room.question.correct : Math.floor(rng() * 4);
          assert.equal(game.answer(room, who.id, choice, rng(), rng(), now).ok, true, label);
          if (room.phase === 'question') assert.equal(game.answer(room, who.id, (choice + 1) % 4, 0.5, 0.5, now).error, 'alreadyAnswered', `${label}: there is no changing your mind`);
        } else if (bot && bot.at < room.deadline) {
          now = Math.max(now, bot.at);
          assert.equal(game.runBotAction(room, now, bot), true, `${label}: a computer player's answer is always taken`);
        } else {
          now = Math.max(now, room.deadline);
          assert.equal(game.timeUp(room, now).ok, true, label);
        }
        if (room.phase === 'reveal') {
          closed++;
          const points = expectedPoints(room.result.entries, room.result.correct);
          for (const [n, entry] of room.result.entries.entries()) {
            const { slot } = room.players.find((p) => p.id === entry.id);
            earned.set(slot, earned.get(slot) + points[n]);
            if (points[n]) right.set(slot, right.get(slot) + 1);
          }
        }
      } else if (room.phase === 'reveal') {
        now = Math.max(now, room.revealUntil);
        assert.equal(game.nextQuestion(room, rng, now).ok, true, label);
      }
      checkRoom(room, label);
      checkViews(room, label, now);
    }

    assert.equal(room.phase, 'finished', `seed ${seed}: the quiz finishes`);
    assert.equal(closed, rounds * perRound, `seed ${seed}: every question of every round was asked`);
    assert.equal(spins.length, rounds, `seed ${seed}: the wheel is spun once a round`);
    assert.equal(room.history.length, closed, `seed ${seed}: a scoreboard line for each question`);
    for (const p of room.players) {
      assert.equal(p.score, earned.get(p.slot), `seed ${seed}: ${p.id} has exactly what their answers earned`);
      assert.equal(p.rightAnswers, right.get(p.slot), `seed ${seed}: ${p.id} is counted right as often as they were`);
      assert.equal(p.questionsFaced, closed, `seed ${seed}: every question was put to ${p.id}`);
    }

    const rows = game.statsPlayers(room);
    assert.deepEqual(rows.map((r) => r.userId).sort(), room.players.filter(game.isHuman).map((p) => p.id).sort(), `seed ${seed}: only the people are recorded`);
    const best = Math.max(...room.players.map((p) => p.score));
    for (const row of rows) {
      const player = room.players.find((p) => p.id === row.userId);
      assert.equal(row.score, player.score, `seed ${seed}: ${row.userId} is recorded with their score`);
      assert.equal(row.outcome, player.score === best ? 'win' : 'loss', `seed ${seed}: the highest total wins, and equal totals share it`);
      for (const [key, value] of Object.entries(row.extras)) assert.ok(Number.isInteger(value) && value >= 0, `seed ${seed}: ${key} is a count (${value})`);
    }
  }
});

test('a quiz that is given up ends on the scores it has, or is abandoned when it has none', () => {
  for (let seed = 300; seed < 360; seed++) {
    const rng = seeded(seed);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds: 2, perRound: 2 }, counts: COUNTS, now: 1000, ...TIMING });
    assert.equal(game.addHuman(room, 2, 'Player 2').ok, true);
    assert.equal(game.giveUp(room).ok, false, `seed ${seed}: there is nothing to give up in the waiting room`);
    assert.equal(game.start(room, 1, rng, 1000).ok, true);
    // Somewhere between no questions closed and three of the four, the questions stop coming.
    const closeFirst = Math.floor(rng() * 4);
    let now = 1000;
    for (let closed = 0; closed < closeFirst; ) {
      now += 50;
      if (room.phase === 'spin' && !room.deck.length) assert.equal(game.deal(room, questions(2, closed * 10, rng)).ok, true);
      else if (room.phase === 'spin') assert.equal(game.askNext(room, rng, now).ok, true);
      else if (room.phase === 'question') {
        assert.equal(game.answer(room, 1, room.question.correct, 0.5, 0.5, now).ok, true);
        assert.equal(game.timeUp(room, now).ok, true);
        closed++;
      } else assert.equal(game.nextQuestion(room, rng, now).ok, true);
    }
    assert.equal(game.giveUp(room).ok, true, `seed ${seed}`);
    assert.equal(room.phase, closeFirst ? 'finished' : 'abandoned', `seed ${seed}: after ${closeFirst} questions`);
    checkRoom(room, `seed ${seed}, given up after ${closeFirst}`);
    checkViews(room, `seed ${seed}, given up after ${closeFirst}`, now);
    assert.equal(room.players.find((p) => p.id === 1).score, closeFirst * (RIGHT + QUICKEST[0]), `seed ${seed}: the scores stand as they were`);
    assert.equal(game.giveUp(room).ok, false, `seed ${seed}: and it cannot be given up twice`);
  }
});
