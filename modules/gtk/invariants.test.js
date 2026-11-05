// Randomised play of the GTK rules: seeded games where people (and strangers) try legal and illegal actions in any
// order, leave, and come back.  After every action the room and every player's view must be sound, and nobody may see
// what they should not.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { QUESTIONS, normal } from './questions.js';
import { seeded } from '../../shared/testkit.js';

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const ANSWERS = [['Apples', 'Blue'], ['apple', 'blue'], ['Tea', 'Toast'], ['', 'x'], ['   ', '   '], ['x'.repeat(80), 'y'], ['One'], 'not a list', [7, null], [undefined, undefined], ['Pie', 'Pie'], ['!!', '??']];
const PICKS = [0, 1, 2, 3, -1, 9, '0', 0.5, null, undefined, NaN];

/** Everything that must always be true of a room, whatever has been done to it. */
function checkRoom(room, label) {
  const ids = room.players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: no player twice`);
  assert.ok(room.players.length <= game.MAX_PLAYERS, `${label}: not too many players`);
  for (const p of room.players) assert.ok(Number.isInteger(p.score) && p.score >= 0, `${label}: ${p.id} has a sound score`);
  assert.ok(['lobby', 'writing', 'picking', 'reveal', 'finished', 'abandoned'].includes(room.phase), `${label}: phase ${room.phase}`);
  assert.equal(new Set(room.answers.map((a) => a.id)).size, room.answers.length, `${label}: one set of answers each`);
  assert.ok(room.answers.every((a) => ids.includes(a.id) && a.texts.length === room.questionsPerRound), `${label}: the answers are from players in the room`);
  assert.ok(room.picks.every((k) => ids.includes(k.id) && k.id !== room.subject && k.n >= 0 && k.n < room.options.length), `${label}: the picks are of real answers by real pickers`);
  assert.equal(new Set(room.picks.map((k) => k.id)).size, room.picks.length, `${label}: one pick each`);
  assert.ok(room.options.every((o) => o.authors.every((id) => ids.includes(id) && id !== room.subject)), `${label}: answers are written by players who are not the subject`);
  assert.ok(room.options.filter((o) => o.truth).length <= 1, `${label}: there is at most one true answer`);
  assert.equal(new Set(room.options.map((o) => normal(o.text))).size, room.options.length, `${label}: no two options are the same answer`);
  assert.ok(room.ready.every((id) => ids.includes(id)), `${label}: ready is a subset of the players`);
  assert.ok(room.question >= 0 && room.question < room.questionsPerRound, `${label}: the question number is one of the round's`);
  assert.ok(Number.isInteger(room.questionsPerRound) && room.questionsPerRound >= game.QUESTIONS_EACH.min && room.questionsPerRound <= game.QUESTIONS_EACH.max, `${label}: questions a round`);
  assert.ok(Number.isInteger(room.seconds) && room.seconds >= game.SECONDS.min && room.seconds <= game.SECONDS.max, `${label}: the time to answer`);
  assert.ok(room.deadline === null || Number.isFinite(room.deadline), `${label}: the deadline is a time or nothing`);
  if (['reveal', 'finished', 'lobby'].includes(room.phase)) assert.equal(room.deadline, null, `${label}: nothing is timed in ${room.phase}`);
  if (['writing', 'picking'].includes(room.phase)) {
    assert.ok(ids.includes(room.subject), `${label}: the subject is in the room`);
    assert.equal(room.questions.length, room.questionsPerRound, `${label}: the round has its questions`);
    assert.ok(room.questions.every((q) => QUESTIONS.some((real) => real.id === q.id)), `${label}: real questions`);
  }
  if (room.phase === 'writing') assert.ok(!room.options.length && !room.picks.length, `${label}: nothing is on the table yet`);
  if (room.phase === 'picking') assert.ok(room.options.length >= 1 && room.options.some((o) => o.truth), `${label}: the true answer is among those on the table`);
  if (room.phase === 'reveal') assert.ok(room.result && room.result.question === room.question, `${label}: a result for the question just asked`);
  assert.doesNotThrow(() => JSON.stringify(room), `${label}: the room can be saved`);
  assert.deepEqual(game.migrate(JSON.parse(JSON.stringify(room))), room, `${label}: a saved room loads as it was`);
}

/** Nobody may see what they should not, whoever is looking. */
function checkViews(room, label, strangers = [99]) {
  const hidden = room.phase === 'picking' || room.phase === 'writing';
  const truth = room.options.find((o) => o.truth)?.text ?? null;
  for (const id of [...room.players.map((p) => p.id), ...strangers]) {
    const view = game.viewFor(room, id);
    const text = JSON.stringify(view);
    assert.doesNotThrow(() => JSON.parse(text), `${label}: a view is plain JSON`);
    const member = room.players.some((p) => p.id === id);
    if (!member) {
      assert.deepEqual(view.options, [], `${label}: a stranger sees no answers`);
      assert.deepEqual(view.prompts, [], `${label}: a stranger sees no questions`);
      assert.equal(view.truth, null, `${label}: a stranger is told nothing`);
    }
    if (hidden) {
      assert.equal(view.truth, null, `${label}: ${id} must not be told the true answer yet`);
      for (const option of view.options) assert.ok(!('authors' in option) && !('truth' in option), `${label}: ${id} sees no writers while picking`);
    }
    if (room.phase === 'writing') assert.deepEqual(view.options, [], `${label}: ${id} sees nothing while the answers are written`);
    if (room.phase === 'picking' && member) {
      const own = room.options.findIndex((o) => o.authors.includes(id));
      if (own !== -1) assert.equal(view.options[own].canPick, false, `${label}: ${id} cannot pick their own answer`);
      if (id === room.subject) assert.ok(view.options.every((o) => !o.canPick), `${label}: the subject picks nothing`);
    }
    if (room.phase === 'reveal' && member && truth !== null) assert.equal(view.truth, truth, `${label}: ${id} is shown the true answer`);
  }
}

function playRandom(seed) {
  const rng = seeded(seed);
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1 });
  const label = (n) => `seed ${seed}, step ${n}`;
  const people = [1, 2, 3, 4, 5];
  for (const id of people.slice(1)) if (rng() < 0.7) game.addHuman(room, id);
  for (const id of people) if (room.players.length < game.MIN_PLAYERS) game.addHuman(room, id); // at least three, whoever joined
  const actions = [
    (id) => game.setRoundsEach(room, id, pick(rng, [1, 2, 0, 9, '2'])),
    (id) => game.setQuestionsPerRound(room, id, pick(rng, [1, 2, 3, 4, 0, 9, '2'])),
    (id) => game.setSeconds(room, id, pick(rng, [15, 30, 60, 180, 7, 1000, '30'])),
    () => game.fillTimedOut(room, rng, String, 0),
    (id) => game.addBot(room, id),
    (id) => game.fillWithBots(room, id, pick(rng, [3, 5, 99, 'x'])),
    (id) => game.removeBot(room, id, pick(rng, ['bot:1', 'bot:2', id]), rng),
    (id) => game.start(room, id, rng),
    (id) => game.submitAnswers(room, id, pick(rng, ANSWERS), rng),
    (id) => game.choose(room, id, pick(rng, PICKS)),
    (id) => game.ready(room, id, rng),
    (id) => game.removeHuman(room, id, rng),
    (id) => game.addHuman(room, id),
    () => game.pendingBotAction(room) && game.runBotAction(room, rng),
    () => room.phase === 'reveal' && rng() < 0.2 && game.forceNext(room, rng),
  ];
  for (let n = 0; n < 500 && room.phase !== 'finished' && room.phase !== 'abandoned'; n++) {
    const id = pick(rng, [...people, 99]);
    let action = pick(rng, actions);
    if (room.phase === 'lobby' && rng() < 0.35) action = (who) => game.start(room, who, rng, 0);
    if (room.phase === 'writing' && rng() < 0.6) action = (who) => game.submitAnswers(room, who, room.questions.map((q, n) => `${who} says ${n}`), rng, String, 0);
    if (room.phase === 'picking' && rng() < 0.6) action = (who) => game.choose(room, who, Math.floor(rng() * room.options.length));
    if (room.phase === 'reveal' && rng() < 0.6) action = (who) => game.ready(room, who, rng, String, 0);
    const before = JSON.stringify(room);
    const result = action(id);
    if (result && result.ok === false) assert.equal(JSON.stringify(room), before, `${label(n)}: a refused action changed the room`);
    if (result?.empty) break; // the last person left: the server throws the room away
    checkRoom(room, label(n));
    checkViews(room, label(n));
  }
  return room;
}

test('random legal and illegal play keeps every room and view sound', () => {
  const phases = new Set();
  for (let seed = 1; seed <= 300; seed++) phases.add(playRandom(seed).phase);
  assert.ok(phases.has('finished'), 'some games were finished');
  assert.ok(phases.has('writing') || phases.has('lobby') || phases.has('picking') || phases.has('reveal'), 'and others stopped part way');
});

test('whatever the order of play, a finished game has a history that adds up and statistics for the people only', () => {
  for (let seed = 1000; seed < 1200; seed++) {
    const rng = seeded(seed);
    const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1 });
    game.addHuman(room, 2);
    game.addHuman(room, 3);
    if (rng() < 0.5) game.addBot(room, 1);
    game.setRoundsEach(room, 1, 1 + Math.floor(rng() * 2));
    game.start(room, 1, rng);
    for (let step = 0; step < 2000 && room.phase !== 'finished'; step++) {
      if (room.phase === 'writing') {
        const waiting = room.players.filter((p) => !room.answers.some((a) => a.id === p.id));
        const who = pick(rng, waiting);
        game.submitAnswers(room, who.id, rng() < 0.15 ? ['Apples', 'Blue'] : [`${who.id} says ${Math.floor(rng() * 3)}`, `${who.id} thinks ${Math.floor(rng() * 3)}`], rng);
      } else if (room.phase === 'picking') {
        const truth = room.options.findIndex((o) => o.truth);
        const waiting = room.players.filter((p) => p.id !== room.subject && !room.options[truth].authors.includes(p.id) && !room.picks.some((k) => k.id === p.id));
        if (!waiting.length) break; // openPicking scores such a question itself; this would be a bug
        const who = pick(rng, waiting);
        const allowed = room.options.map((o, n) => n).filter((n) => !room.options[n].authors.includes(who.id));
        game.choose(room, who.id, pick(rng, allowed));
      } else if (room.phase === 'reveal') {
        if (rng() < 0.3) game.forceNext(room, rng);
        else game.ready(room, pick(rng, room.players).id, rng);
      }
    }
    assert.equal(room.phase, 'finished', `seed ${seed} finishes`);
    assert.equal(room.history.length, room.roundsTotal * room.questionsPerRound, `seed ${seed}: one history entry a question`);
    for (const p of room.players) assert.equal(room.history.reduce((n, r) => n + (r.deltas[p.id] ?? 0), 0), p.score, `seed ${seed}: the history adds up for ${p.id}`);
    const stats = game.statsPlayers(room);
    assert.deepEqual(stats.map((s) => s.userId).sort(), room.players.filter((p) => p.kind === 'human').map((p) => p.id).sort(), 'only people are recorded');
    for (const s of stats) for (const key of ['rightAnswers', 'peopleFooled', 'answersWritten', 'matchedTruth']) assert.ok(Number.isInteger(s.extras[key]), `${key} is a number`);
    const total = room.players.reduce((n, p) => n + p.score, 0);
    const earned = room.players.reduce((n, p) => n + p.rightAnswers * game.POINTS.correct + p.peopleFooled * game.POINTS.fooled + p.matchedTruth * game.POINTS.matched, 0);
    assert.equal(total, earned, `seed ${seed}: points come only from right picks, fooling people, and writing the truth`);
    const asked = room.roundsTotal * room.questionsPerRound;
    for (const p of room.players) assert.equal(p.answersWritten, asked, `seed ${seed}: ${p.id} wrote an answer to every question`);
    for (const p of room.players) assert.equal(p.roundsAsSubject, room.roundsEach, `seed ${seed}: ${p.id} was the subject of their share of rounds`);
  }
});
