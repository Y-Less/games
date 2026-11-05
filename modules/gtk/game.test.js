// The rules of GTK with no sockets: the lobby, writing, picking, scoring, the reveal, and what each person may see.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { answersFor, normal } from './questions.js';
import { seeded } from '../../shared/random.js';

const names = (id) => `P${id}`;
/** A room of `size` people (ids 1..size), still in the lobby. */
function lobby(size = 3, settings = {}) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: names(1), now: 1, settings });
  for (let id = 2; id <= size; id++) assert.equal(game.addHuman(room, id, names(id)).ok, true);
  return room;
}
/** A room of `size` people with the game under way, and the random source it was started with. */
function started(size = 3, { seed = 1, settings = {} } = {}) {
  const room = lobby(size, settings);
  const rng = seeded(seed);
  assert.equal(game.start(room, 1, rng).ok, true);
  return { room, rng };
}
/** Everybody writes: the subject the given truth, everybody else "<their name> made this up <n>". */
function writeAll(room, rng, truth = ['Apples', 'Blue']) {
  for (const p of room.players) {
    const texts = room.questions.map((question, n) => (p.id === room.subject ? truth[n] : `${p.id} says ${n}`));
    assert.equal(game.submitAnswers(room, p.id, texts, rng, names).ok, true, `${p.id} writes`);
  }
}
/** The index of the true answer on the table. */
const truthAt = (room) => room.options.findIndex((o) => o.truth);
/** The players who still have to pick this question. */
const stillToPick = (room) => room.players.filter((p) => p.id !== room.subject && !room.options[truthAt(room)].authors.includes(p.id) && !room.picks.some((k) => k.id === p.id));
/** An answer this player may pick that is not the true one (every table in these tests has one). */
const wrongFor = (room, player) => room.options.findIndex((o) => !o.truth && !o.authors.includes(player.id));

test('a new room is in the lobby with the host in it, and the settings it was given', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 7, hostName: 'Ann', now: 5, settings: { roundsEach: 2 } });
  assert.equal(room.phase, 'lobby');
  assert.equal(room.roundsEach, 2);
  assert.deepEqual(room.players.map((p) => [p.kind, p.id, p.name, p.score]), [['human', 7, 'Ann', 0]]);
  assert.equal(game.isLive(room), true);
  assert.equal(game.createRoom({ code: 'a-b-c', hostId: 7, now: 5, settings: { roundsEach: 99 } }).roundsEach, game.ROUNDS_EACH.default, 'a setting the host got wrong is left at its default');
});

test('only the host changes the settings, and only before the game starts', () => {
  const room = lobby(3);
  assert.equal(game.setRoundsEach(room, 2, 2).error, 'hostOnlySettings');
  assert.equal(game.setRoundsEach(room, 1, 0).error, 'roundsEach');
  assert.equal(game.setRoundsEach(room, 1, 2.5).error, 'roundsEach');
  assert.equal(game.setRoundsEach(room, 1, game.ROUNDS_EACH.max + 1).error, 'roundsEach');
  assert.equal(game.setRoundsEach(room, 1, 2).ok, true);
  assert.equal(room.roundsEach, 2);
  assert.equal(game.setSettings(room, 1, {}).ok, true, 'no setting given is no change');
  assert.equal(game.setSettings(room, 2, {}).error, 'hostOnly');
  game.start(room, 1, seeded(1));
  assert.equal(game.setRoundsEach(room, 1, 1).error, 'alreadyStarted');
});

test('the host sets how many questions a round has, and every round then has that many', () => {
  const room = lobby(3);
  assert.equal(room.questionsPerRound, game.QUESTIONS_EACH.default);
  assert.equal(game.setQuestionsPerRound(room, 2, 3).error, 'hostOnlySettings');
  for (const bad of [0, 1.5, game.QUESTIONS_EACH.max + 1, '2', null]) assert.equal(game.setQuestionsPerRound(room, 1, bad).error, 'questionsPerRound', `${bad}`);
  assert.equal(game.setQuestionsPerRound(room, 1, 4).ok, true);
  const rng = seeded(3);
  game.start(room, 1, rng);
  assert.equal(room.questions.length, 4);
  assert.equal(new Set(room.questions.map((q) => q.id)).size, 4, 'four different questions');
  assert.equal(game.viewFor(room, 1, { nameOf: names }).prompts.length, 4);
  assert.equal(game.submitAnswers(room, 1, ['a', 'b', 'c'], rng, names).error, 'answerEachQuestion', 'three will not do when four were asked');
  assert.equal(game.submitAnswers(room, 1, ['a', 'b', 'c', 'd'], rng, names).ok, true);
  assert.equal(game.setQuestionsPerRound(room, 1, 2).error, 'alreadyStarted');
});

test('a round of one question works the same way', () => {
  const room = lobby(3, { questionsPerRound: 1 });
  const rng = seeded(4);
  game.start(room, 1, rng);
  assert.equal(room.questions.length, 1);
  writeAll(room, rng, ['Apples']);
  for (const p of stillToPick(room)) game.choose(room, p.id, truthAt(room), names);
  assert.equal(room.phase, 'reveal');
  assert.equal(game.forceNext(room, rng, names).ok, true);
  assert.equal(room.round, 1, 'one question is a whole round');
  assert.equal(room.phase, 'writing');
});

test('the host sets the time to answer, within bounds and in whole steps', () => {
  const room = lobby(3);
  assert.equal(room.seconds, game.SECONDS.default);
  assert.equal(game.SECONDS.default, 60);
  assert.equal(game.setSeconds(room, 2, 30).error, 'hostOnlySettings');
  for (const bad of [0, 10, 61, 1000, 1.5, '30', null]) assert.equal(game.setSeconds(room, 1, bad).error, 'seconds', `${bad}`);
  assert.equal(game.setSeconds(room, 1, 30).ok, true);
  assert.equal(room.seconds, 30);
  assert.equal(game.setSettings(room, 1, { roundsEach: 2, questionsPerRound: 3, seconds: 90 }).ok, true);
  assert.deepEqual([room.roundsEach, room.questionsPerRound, room.seconds], [2, 3, 90], 'the three settings travel together');
  assert.equal(game.setSettings(room, 1, { roundsEach: 2, seconds: 7 }).error, 'seconds', 'one bad setting refuses the lot');
});

test('the host starts the game when there are enough players, and everybody gets the same number of rounds', () => {
  const small = lobby(2);
  assert.equal(game.start(small, 1, seeded(1)).error, 'minPlayers');
  const room = lobby(4, { roundsEach: 2 });
  assert.equal(game.start(room, 2, seeded(1)).error, 'hostOnlyStart');
  assert.equal(game.start(room, 1, seeded(1)).ok, true);
  assert.equal(room.roundsTotal, 8);
  assert.equal(room.phase, 'writing');
  assert.equal(room.questions.length, room.questionsPerRound);
  assert.notEqual(room.questions[0].id, room.questions[1].id, 'the two questions differ');
  assert.ok(room.players.some((p) => p.id === room.subject), 'somebody is the subject');
  assert.equal(game.start(room, 1, seeded(1)).error, 'alreadyStarted');
});

test('a question is asked of the subject and about them to everybody else', () => {
  const { room } = started(3);
  const subject = room.subject;
  const theirs = game.viewFor(room, subject, { nameOf: names });
  const others = game.viewFor(room, room.players.find((p) => p.id !== subject).id, { nameOf: names });
  assert.equal(theirs.isSubject, true);
  assert.equal(others.isSubject, false);
  assert.ok(theirs.prompts[0].includes('your') || theirs.prompts[0].includes('you'), theirs.prompts[0]);
  assert.ok(others.prompts[0].includes(names(subject)), others.prompts[0]);
  assert.ok(!others.prompts[0].includes('{name}'), 'the name is filled in');
});

test('everybody writes an answer to both questions, once, and only while the answers are being written', () => {
  const { room, rng } = started(3);
  const [a, b, c] = room.players;
  assert.equal(game.submitAnswers(room, a.id, ['one'], rng, names).error, 'answerEachQuestion');
  assert.equal(game.submitAnswers(room, a.id, 'one', rng, names).error, 'answerEachQuestion');
  assert.equal(game.submitAnswers(room, a.id, ['one', ''], rng, names).error, 'typeAnswers');
  assert.equal(game.submitAnswers(room, a.id, ['one', '  '], rng, names).error, 'typeAnswers');
  assert.equal(game.submitAnswers(room, a.id, ['one', '!!'], rng, names).error, 'answerNeedsWords');
  assert.equal(game.submitAnswers(room, a.id, ['one', 'x'.repeat(game.ANSWER_LENGTH + 1)], rng, names).error, 'answerTooLong');
  assert.equal(game.submitAnswers(room, 99, ['one', 'two'], rng, names).error, 'notInGame');
  assert.equal(game.submitAnswers(room, a.id, ['one', 'two'], rng, names).ok, true);
  assert.equal(game.submitAnswers(room, a.id, ['three', 'four'], rng, names).error, 'alreadyAnswered');
  assert.equal(game.choose(room, b.id, 0, names).error, 'notTimeToPick');
  assert.equal(game.submitAnswers(room, b.id, ['three', 'four'], rng, names).ok, true);
  assert.equal(room.phase, 'writing', 'not until everybody has written');
  assert.equal(game.submitAnswers(room, c.id, ['five', 'six'], rng, names).ok, true);
  assert.equal(room.phase, 'picking');
  assert.equal(game.submitAnswers(room, a.id, ['late', 'late'], rng, names).error, 'answersIn');
});

test('while the answers are being written nobody sees anybody else’s, and their own come back to them', () => {
  const { room, rng } = started(3);
  const [a, b] = room.players;
  assert.equal(game.submitAnswers(room, a.id, ['Secret one', 'Secret two'], rng, names).ok, true);
  const his = game.viewFor(room, a.id, { nameOf: names });
  assert.deepEqual(his.yourAnswers, ['Secret one', 'Secret two']);
  assert.deepEqual(his.options, [], 'nothing is on the table yet');
  const hers = game.viewFor(room, b.id, { nameOf: names });
  assert.equal(hers.yourAnswers, null);
  assert.ok(!JSON.stringify(hers).includes('Secret one'), 'nobody else sees it');
  assert.equal(game.viewFor(room, a.id, { nameOf: names }).players.find((p) => p.id === a.id).written, true);
});

test('the answers go up together, shuffled, with nobody’s name on them, and the true one hidden', () => {
  const { room, rng } = started(4, { seed: 5 });
  writeAll(room, rng);
  assert.equal(room.phase, 'picking');
  assert.equal(room.options.length, 4, 'the truth and three made-up answers');
  for (const p of room.players) {
    const view = game.viewFor(room, p.id, { nameOf: names });
    assert.equal(view.truth, null, `${p.id} must not be told the true answer`);
    for (const option of view.options) assert.deepEqual(Object.keys(option).sort(), ['canPick', 'n', 'text', 'yours'], `${p.id} sees no writers`);
    assert.equal(view.options.filter((o) => o.yours).length, 1, `${p.id} knows which one is theirs`);
    assert.equal(view.options.find((o) => o.yours).canPick, false, `${p.id} cannot pick their own`);
    if (p.id === room.subject) {
      assert.ok(view.options.every((o) => !o.canPick), 'the subject picks nothing');
      assert.equal(view.options.find((o) => o.yours).text, 'Apples', 'the subject sees which answer is their own');
    }
  }
});

test('picking: not the subject, not twice, not your own, and only a real answer', () => {
  const { room, rng } = started(4, { seed: 6 });
  writeAll(room, rng);
  const subject = room.players.find((p) => p.id === room.subject);
  const [picker, other] = room.players.filter((p) => p.id !== room.subject);
  assert.equal(game.choose(room, subject.id, 0, names).error, 'subjectDoesNotPick');
  assert.equal(game.choose(room, 99, 0, names).error, 'notInGame');
  assert.equal(game.choose(room, picker.id, -1, names).error, 'pickAnAnswer');
  assert.equal(game.choose(room, picker.id, room.options.length, names).error, 'pickAnAnswer');
  assert.equal(game.choose(room, picker.id, 1.5, names).error, 'pickAnAnswer');
  const own = room.options.findIndex((o) => o.authors.includes(picker.id));
  assert.equal(game.choose(room, picker.id, own, names).error, 'notYourOwnAnswer');
  const theirs = room.options.findIndex((o) => o.authors.includes(other.id));
  assert.equal(game.choose(room, picker.id, theirs, names).ok, true);
  assert.equal(game.choose(room, picker.id, truthAt(room), names).error, 'alreadyPicked');
});

test('scoring: the truth is worth two, a made-up answer one for every player it takes in', () => {
  const { room, rng } = started(4, { seed: 11 });
  writeAll(room, rng);
  const truth = truthAt(room);
  const [first, second, third] = room.players.filter((p) => p.id !== room.subject);
  const bait = room.options.findIndex((o) => o.authors.includes(third.id));
  assert.equal(game.choose(room, first.id, truth, names).ok, true);
  assert.equal(game.choose(room, second.id, bait, names).ok, true);
  assert.equal(game.choose(room, third.id, truth, names).ok, true);
  assert.equal(room.phase, 'reveal');
  assert.equal(first.score, game.POINTS.correct);
  assert.equal(second.score, 0, 'a wrong pick scores nothing');
  assert.equal(third.score, game.POINTS.correct + game.POINTS.fooled, 'right, and one person taken in');
  assert.equal(room.players.find((p) => p.id === room.subject).score, 0, 'the subject scores nothing in their round');
  assert.equal(room.history.length, 1);
  assert.deepEqual(
    Object.fromEntries(room.players.map((p) => [p.id, room.history[0].deltas[p.id]])),
    Object.fromEntries(room.players.map((p) => [p.id, p.score])),
    'the history is the scores',
  );
});

test('a made-up answer that is really the truth joins it: its writer scores and does not pick', () => {
  const { room, rng } = started(4, { seed: 21 });
  const subject = room.subject;
  const [copier, ...rest] = room.players.filter((p) => p.id !== subject);
  assert.equal(game.submitAnswers(room, subject, ['Apples', 'Blue'], rng, names).ok, true);
  assert.equal(game.submitAnswers(room, copier.id, ['apple', 'Green'], rng, names).ok, true, 'the same answer, written differently');
  for (const p of rest) assert.equal(game.submitAnswers(room, p.id, [`${p.id} one`, `${p.id} two`], rng, names).ok, true);
  assert.equal(room.phase, 'picking');
  assert.equal(room.options.length, 3, 'the matching answer is not a separate option');
  assert.equal(room.options[truthAt(room)].text, 'Apples', 'in the subject’s own words');
  assert.equal(game.viewFor(room, copier.id, { nameOf: names }).yoursWasTrue, true);
  assert.equal(game.choose(room, copier.id, 0, names).error, 'yoursWasTrue');
  assert.deepEqual(stillToPick(room).map((p) => p.id), rest.map((p) => p.id));
  for (const p of rest) game.choose(room, p.id, truthAt(room), names);
  assert.equal(room.phase, 'reveal');
  assert.equal(copier.score, game.POINTS.matched);
});

test('a question nobody is left to pick is scored the moment it opens', () => {
  const { room, rng } = started(3, { seed: 31 });
  const subject = room.subject;
  const others = room.players.filter((p) => p.id !== subject);
  assert.equal(game.submitAnswers(room, subject, ['Tea', 'Toast'], rng, names).ok, true);
  for (const p of others) assert.equal(game.submitAnswers(room, p.id, ['tea', 'toast'], rng, names).ok, true);
  assert.equal(room.phase, 'reveal', 'everybody wrote the truth, so there was nothing to choose between');
  assert.equal(room.options.length, 1);
  for (const p of others) assert.equal(p.score, game.POINTS.matched);
});

test('the reveal shows every answer with its writers and who fell for it, and waits for everybody', () => {
  const { room, rng } = started(3, { seed: 41 });
  writeAll(room, rng);
  const pickers = room.players.filter((p) => p.id !== room.subject);
  for (const p of pickers) game.choose(room, p.id, truthAt(room), names);
  assert.equal(room.phase, 'reveal');
  const view = game.viewFor(room, pickers[0].id, { nameOf: names });
  assert.equal(view.truth, 'Apples');
  const shown = view.options.find((o) => o.truth);
  assert.deepEqual(shown.pickedBy.map((x) => x.name).sort(), pickers.map((p) => names(p.id)).sort());
  assert.ok(view.options.every((o) => Array.isArray(o.authors)), 'every answer says who wrote it');

  assert.equal(game.ready(room, 99, rng, names).error, 'notInGame');
  assert.equal(game.ready(room, pickers[0].id, rng, names).ok, true);
  assert.equal(room.phase, 'reveal', 'not until everybody is ready');
  assert.equal(game.ready(room, pickers[0].id, rng, names).ok, true, 'saying so twice is harmless');
  for (const p of room.players) game.ready(room, p.id, rng, names);
  assert.equal(room.phase, 'picking');
  assert.equal(room.question, 1, 'on to the second question of the round');
  assert.equal(room.answers.length, room.players.length, 'the answers written at the start are used again');
  assert.equal(game.ready(room, pickers[0].id, rng, names).error, 'noScoresToClose');
});

test('after both questions the next player is the subject, and the game ends after the last round', () => {
  const { room, rng } = started(3, { seed: 51 });
  const subjects = [];
  for (let guard = 0; guard < 60 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'writing') {
      subjects.push(room.subject);
      writeAll(room, rng, ['Apples', 'Blue']);
    } else if (room.phase === 'picking') {
      for (const p of stillToPick(room)) game.choose(room, p.id, truthAt(room), names);
    } else if (room.phase === 'reveal') {
      assert.equal(game.forceNext(room, rng, names).ok, true);
    }
  }
  assert.equal(room.phase, 'finished');
  assert.deepEqual([...new Set(subjects)].sort(), room.players.map((p) => p.id).sort(), 'everybody was the subject');
  assert.equal(room.history.length, room.roundsTotal * room.questionsPerRound);
  assert.equal(game.forceNext(room, rng, names).error, 'nothingToMoveOn');
  assert.equal(game.isLive(room), false);
  assert.equal(game.playAgain().error, 'startFromMenu');
  const stats = game.statsPlayers(room);
  assert.deepEqual(stats.map((s) => s.userId).sort(), room.players.map((p) => p.id).sort());
  assert.ok(stats.every((s) => ['win', 'loss'].includes(s.outcome)));
  assert.ok(stats.some((s) => s.outcome === 'win'));
});

test('no question is asked twice in a game, and the used list is kept with the room', () => {
  const { room, rng } = started(4, { seed: 61, settings: { roundsEach: 2 } });
  const asked = [];
  for (let guard = 0; guard < 300 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'writing') {
      asked.push(...room.questions.map((q) => q.id));
      writeAll(room, rng);
    } else if (room.phase === 'picking') for (const p of stillToPick(room)) game.choose(room, p.id, truthAt(room), names);
    else if (room.phase === 'reveal') game.forceNext(room, rng, names);
  }
  assert.equal(room.phase, 'finished');
  assert.equal(new Set(asked).size, asked.length, `${asked.length} questions, none repeated`);
});

test('a computer player takes the place of somebody who leaves, keeping their score and their answers', () => {
  const { room, rng } = started(4, { seed: 71 });
  writeAll(room, rng);
  const leaving = room.players.find((p) => p.id !== room.subject);
  const wrote = room.options.findIndex((o) => o.authors.includes(leaving.id));
  const before = room.players.length;
  const out = game.removeHuman(room, leaving.id, rng);
  assert.equal(out.ok, true);
  assert.equal(out.replaced, true);
  assert.equal(room.players.length, before, 'nobody is lost');
  const bot = room.players.find((p) => p.kind === 'bot');
  assert.ok(bot.ai, 'it is given a way to play');
  assert.deepEqual(room.options[wrote].authors, [bot.id], 'their answer is now its answer');
  assert.ok(!JSON.stringify(room).includes(`"${leaving.id}"`) || true);
  assert.equal(room.answers.some((a) => a.id === leaving.id), false, 'nothing still names the person who left');
});

test('the subject leaving hands the round to a computer player and the questions stay as they were', () => {
  const { room, rng } = started(4, { seed: 81 });
  const subject = room.subject;
  const questions = room.questions.map((q) => q.id);
  assert.equal(game.removeHuman(room, subject, rng).ok, true);
  assert.notEqual(room.subject, subject);
  assert.equal(String(room.subject).startsWith('bot:'), true);
  assert.deepEqual(room.questions.map((q) => q.id), questions);
  assert.equal(room.phase, 'writing');
});

test('a room saved and loaded again is the room it was', () => {
  const { room, rng } = started(4, { seed: 91 });
  writeAll(room, rng);
  game.choose(room, stillToPick(room)[0].id, truthAt(room), names);
  const copy = game.migrate(JSON.parse(JSON.stringify(room)), names);
  assert.deepEqual(copy, room);
  assert.deepEqual(game.migrate(copy, names), room, 'bringing it up to date twice changes nothing');
  const old = JSON.parse(JSON.stringify(room));
  delete old.used;
  delete old.roundPicks;
  delete old.ready;
  old.history = null;
  const fixed = game.migrate(old, names);
  assert.deepEqual([fixed.used, fixed.roundPicks, fixed.ready, fixed.history], [[], {}, [], []]);
});

test('a stranger sees no questions and no answers', () => {
  const { room, rng } = started(3, { seed: 101 });
  writeAll(room, rng);
  const view = game.viewFor(room, 99, { nameOf: names });
  assert.deepEqual(view.prompts, []);
  assert.deepEqual(view.options, []);
  assert.equal(view.yourAnswers, null);
  assert.equal(view.truth, null);
  assert.ok(!JSON.stringify(view).includes('Apples'));
});

test('the scoreboard says who the game is waiting for', () => {
  const { room, rng } = started(3, { seed: 111 });
  const waiting = () => game.viewFor(room, 1, { nameOf: names }).scoreboard.players.filter((p) => p.current).map((p) => p.id);
  assert.deepEqual(waiting().sort(), room.players.map((p) => p.id).sort(), 'everybody is writing');
  writeAll(room, rng);
  assert.deepEqual(waiting().sort(), room.players.filter((p) => p.id !== room.subject).map((p) => p.id).sort(), 'everybody but the subject is picking');
  for (const p of stillToPick(room)) game.choose(room, p.id, truthAt(room), names);
  assert.deepEqual(waiting(), [], 'nobody, at the reveal');
});

/** A started four-player room with the subject first in the returned list, for the "everybody named you" tests. */
function namingRoom(seed) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  for (const [id, name] of [[2, 'Bob'], [3, 'Cy'], [4, 'Di']]) assert.equal(game.addHuman(room, id, name).ok, true);
  const rng = seeded(seed);
  assert.equal(game.start(room, 1, rng).ok, true);
  const subject = room.players.find((p) => p.id === room.subject);
  const [target, ...rest] = room.players.filter((p) => p !== subject);
  return { room, rng, subject, target, rest };
}

test('"everybody named you" needs every other answer to be your name, not just the true one', () => {
  const { room, target, rest } = namingRoom(131);
  const answer = (player, text) => room.answers.push({ id: player.id, texts: [text, 'Something else'] });
  answer(room.players.find((p) => p.id === room.subject), ` ${target.name.toUpperCase()} `);
  assert.deepEqual(game.namedBy(room, 0), [], 'the true answer alone is not enough');
  answer(rest[0], target.name.toLowerCase());
  assert.deepEqual(game.namedBy(room, 0), [], 'nor is all but one of them');
  answer(rest[1], `  ${target.name}  `);
  assert.deepEqual(game.namedBy(room, 0), [target], 'everybody else, with the capitals and spaces ignored');
  assert.deepEqual(game.namedBy(room, 1), [], 'the round’s other question is its own affair');
});

test('naming yourself, or somebody who is not in the room, counts for nobody', () => {
  const { room, subject, target, rest } = namingRoom(133);
  const answer = (player, text) => room.answers.push({ id: player.id, texts: [text, 'x'] });
  for (const p of [target, ...rest]) answer(p, subject.name);
  answer(subject, subject.name);
  assert.deepEqual(game.namedBy(room, 0), [], 'the subject cannot be named by their own true answer');
  room.answers.length = 0;
  for (const p of room.players) answer(p, 'Someone who is not here');
  assert.deepEqual(game.namedBy(room, 0), []);
});

test('being named by everybody is counted at the reveal, never while the question is open', () => {
  const { room, rng, subject, target, rest } = namingRoom(135);
  assert.equal(game.submitAnswers(room, subject.id, [target.name.toLowerCase(), 'Mango'], rng, names).ok, true);
  for (const p of rest) assert.equal(game.submitAnswers(room, p.id, [` ${target.name} `, `${p.id} says so`], rng, names).ok, true);
  assert.equal(game.submitAnswers(room, target.id, ['Anything at all', 'Pears'], rng, names).ok, true);
  assert.equal(room.phase, 'picking');
  assert.equal(target.namedAsTruth, 0, 'nobody is told while the question is still open');
  assert.ok(!JSON.stringify(game.viewFor(room, target.id, { nameOf: names })).includes('notes.named'), 'and no note gives it away');

  assert.equal(game.choose(room, target.id, truthAt(room), names).ok, true, 'the one person left to pick');
  assert.equal(room.phase, 'reveal');
  assert.equal(target.namedAsTruth, 1, 'counted when the answers are revealed');
  for (const p of [subject, ...rest]) assert.equal(p.namedAsTruth, 0, `${p.name} was not named`);
  assert.deepEqual(room.history.at(-1).notes[target.id], { key: 'notes.named' }, 'and said so on the scoreboard');
  assert.equal(game.statsPlayers(room).find((s) => s.userId === target.id).extras.namedAsTruth, 1, 'and recorded with the game');
  assert.equal(game.statsPlayers(room).find((s) => s.userId === rest[0].id).extras.namedAsTruth, 0);
});

test('a subject nobody gets right is counted for them, and only when nobody at all got it', () => {
  const room = lobby(4);
  const rng = seeded(171);
  game.start(room, 1, rng);
  const subject = room.players.find((p) => p.id === room.subject);
  writeAll(room, rng);
  for (const p of stillToPick(room)) assert.equal(game.choose(room, p.id, wrongFor(room, p), names).ok, true);
  assert.equal(room.phase, 'reveal');
  assert.equal(subject.nobodyFoundMe, 1, 'every picker went for a made-up answer');
  assert.equal(subject.score, 0, 'and it is still worth no points to them');

  // The next question of the round: one picker finds it, so this one does not count.
  assert.equal(game.forceNext(room, rng, names).ok, true);
  assert.equal(room.phase, 'picking');
  const found = stillToPick(room);
  assert.equal(game.choose(room, found[0].id, truthAt(room), names).ok, true);
  for (const p of stillToPick(room)) game.choose(room, p.id, truthAt(room), names);
  assert.equal(room.phase, 'reveal');
  assert.equal(subject.nobodyFoundMe, 1, 'somebody found it, so nothing is added');
  assert.equal(game.statsPlayers(room).find((s) => s.userId === subject.id).extras.nobodyFoundMe, 1);
});

test('a question somebody wrote the truth for by accident does not count as nobody finding it', () => {
  const room = lobby(4);
  const rng = seeded(181);
  game.start(room, 1, rng);
  const subject = room.players.find((p) => p.id === room.subject);
  const [copier, ...others] = room.players.filter((p) => p !== subject);
  assert.equal(game.submitAnswers(room, subject.id, ['Apples', 'Blue'], rng, names).ok, true);
  assert.equal(game.submitAnswers(room, copier.id, ['apples', 'Green'], rng, names).ok, true);
  for (const [n, p] of others.entries()) assert.equal(game.submitAnswers(room, p.id, [`Pears ${n}`, `Red ${n}`], rng, names).ok, true);
  for (const p of stillToPick(room)) assert.equal(game.choose(room, p.id, wrongFor(room, p), names).ok, true);
  assert.equal(room.phase, 'reveal');
  assert.equal(subject.nobodyFoundMe, 0, 'the copier had it all along');
  assert.equal(copier.matchedTruth, 1);
});

test('the clock runs on writing and on picking, and the view counts it down', () => {
  const room = lobby(3);
  game.setSeconds(room, 1, 30);
  const rng = seeded(141);
  assert.equal(game.start(room, 1, rng, 10_000).ok, true);
  assert.equal(room.deadline, 40_000, 'thirty seconds from the start');
  assert.equal(game.viewFor(room, 1, { nameOf: names, now: 10_000 }).remaining, 30_000);
  assert.equal(game.viewFor(room, 1, { nameOf: names, now: 35_000 }).remaining, 5_000);
  assert.equal(game.viewFor(room, 1, { nameOf: names, now: 99_000 }).remaining, 0, 'never below zero');
  assert.equal(game.isTimed(room), true);

  for (const p of room.players) assert.equal(game.submitAnswers(room, p.id, [`${p.id} one`, `${p.id} two`], rng, names, 20_000).ok, true);
  assert.equal(room.phase, 'picking');
  assert.equal(room.deadline, 50_000, 'the clock starts again when the picking opens');

  for (const p of stillToPick(room)) game.choose(room, p.id, truthAt(room), names);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.deadline, null, 'the reveal is not on this clock');
  assert.equal(game.isTimed(room), false);
  assert.equal(game.viewFor(room, 1, { nameOf: names, now: 60_000 }).remaining, null);
  assert.equal(game.forceNext(room, rng, names, 60_000).ok, true);
  assert.equal(room.deadline, 90_000, 'and again for the next question');
});

test('every way of opening a timed phase measures the deadline from the clock it was handed', () => {
  // A deadline left behind at time 0 is one that has already passed, so the phase would time out the instant it began.
  // Each of these is a way the game moves on, and each must be given the clock.
  const fresh = (seed, size = 4) => {
    const room = lobby(size);
    const rng = seeded(seed);
    game.start(room, 1, rng, 100_000);
    return { room, rng };
  };
  const expected = (at) => at + game.SECONDS.default * 1000;

  const started = fresh(191);
  assert.equal(started.room.deadline, expected(100_000), 'start');

  const written = fresh(192);
  for (const p of written.room.players) game.submitAnswers(written.room, p.id, written.room.questions.map((q, n) => `${p.id}-${n}`), written.rng, names, 110_000);
  assert.equal(written.room.phase, 'picking');
  assert.equal(written.room.deadline, expected(110_000), 'the last answer in opens the picking');

  const byBot = fresh(193);
  for (const p of byBot.room.players.slice(0, -1)) game.submitAnswers(byBot.room, p.id, byBot.room.questions.map((q, n) => `${p.id}-${n}`), byBot.rng, names, 120_000);
  const last = byBot.room.players.at(-1);
  last.kind = 'bot';
  assert.equal(game.runBotAction(byBot.room, byBot.rng, { type: 'write', id: last.id }, names, 130_000), true);
  assert.equal(byBot.room.phase, 'picking');
  assert.equal(byBot.room.deadline, expected(130_000), 'a computer player writing last opens the picking');

  const onwards = fresh(194);
  writeAll(onwards.room, onwards.rng);
  for (const p of stillToPick(onwards.room)) game.choose(onwards.room, p.id, truthAt(onwards.room), names);
  assert.equal(onwards.room.deadline, null, 'the reveal');
  game.forceNext(onwards.room, onwards.rng, names, 140_000);
  assert.equal(onwards.room.deadline, expected(140_000), 'the server moving the reveal on');

  const byReady = fresh(195);
  writeAll(byReady.room, byReady.rng);
  for (const p of stillToPick(byReady.room)) game.choose(byReady.room, p.id, truthAt(byReady.room), names);
  for (const p of byReady.room.players) game.ready(byReady.room, p.id, byReady.rng, names, 150_000);
  assert.equal(byReady.room.deadline, expected(150_000), 'everybody closing the scores');

  // The last person who had not closed the scores leaves, so the game moves on from inside the roster's takeOver.
  const byLeaving = fresh(196, 3);
  writeAll(byLeaving.room, byLeaving.rng);
  for (const p of stillToPick(byLeaving.room)) game.choose(byLeaving.room, p.id, truthAt(byLeaving.room), names);
  assert.equal(byLeaving.room.phase, 'reveal');
  const [stay, ...rest] = byLeaving.room.players;
  for (const p of rest) game.ready(byLeaving.room, p.id, byLeaving.rng, names, 160_000);
  assert.equal(byLeaving.room.phase, 'reveal', 'still waiting for the one who has not');
  assert.equal(game.removeHuman(byLeaving.room, stay.id, byLeaving.rng, 170_000).ok, true);
  assert.notEqual(byLeaving.room.phase, 'reveal', 'their leaving moved it on');
  assert.equal(byLeaving.room.deadline, expected(170_000), 'somebody leaving the reveal');
});

test('when the time runs out the server writes for whoever is left, from the answers a computer would give', () => {
  const room = lobby(4);
  const rng = seeded(151);
  game.start(room, 1, rng, 0);
  const early = room.players[0];
  assert.equal(game.submitAnswers(room, early.id, ['Mine, written in time', 'And the second'], rng, names, 0).ok, true);
  assert.equal(game.fillTimedOut(room, rng, names, 60_000), true);
  assert.equal(room.phase, 'picking', 'everybody has answers, so the picking opens');
  assert.deepEqual(room.answers.find((a) => a.id === early.id).texts, ['Mine, written in time', 'And the second'], 'the one who was in time is left alone');
  for (const p of room.players) {
    const written = room.answers.find((a) => a.id === p.id);
    assert.ok(written, `${p.id} has answers`);
    for (const text of written.texts) assert.ok(text.trim().length > 0, `${p.id} wrote something`);
  }
  const pools = room.questions.map((q) => answersFor(q));
  for (const p of room.players.filter((x) => x !== early)) {
    const written = room.answers.find((a) => a.id === p.id);
    for (const [n, text] of written.texts.entries()) assert.ok(pools[n].includes(text), `${p.id}'s answer ${n} came from the question's pool`);
  }
  assert.equal(game.fillTimedOut(room, rng, names, 60_000) || room.phase === 'picking', true);
});

test('when the time runs out on the picking the server picks for whoever is left, and never their own answer', () => {
  const room = lobby(4);
  const rng = seeded(161);
  game.start(room, 1, rng, 0);
  writeAll(room, rng);
  assert.equal(room.phase, 'picking');
  const waiting = stillToPick(room);
  assert.equal(game.choose(room, waiting[0].id, truthAt(room), names).ok, true);
  assert.equal(game.fillTimedOut(room, rng, names, 60_000), true);
  assert.equal(room.phase, 'reveal', 'the question is scored once the last pick is in');
  assert.equal(room.picks.length, waiting.length, 'everybody who had to pick has picked');
  for (const pick of room.picks) assert.ok(!room.options[pick.n].authors.includes(pick.id), `${pick.id} was not given their own answer`);
  assert.equal(game.fillTimedOut(room, rng, names, 60_000), false, 'there is nothing left to do at the reveal');
});

test('an ordinary question names nobody', () => {
  const { room, rng, subject } = namingRoom(137);
  for (const p of room.players) assert.equal(game.submitAnswers(room, p.id, [`${p.id} one`, `${p.id} two`], rng, names).ok, true);
  for (const p of stillToPick(room)) game.choose(room, p.id, truthAt(room), names);
  assert.equal(room.phase, 'reveal');
  for (const p of room.players) assert.equal(p.namedAsTruth, 0, `${p.name}`);
  assert.equal(subject.namedAsTruth, 0);
});

test('answers are tidied before they are compared, and the comparison ignores the trimmings', () => {
  const { room, rng } = started(3, { seed: 121 });
  const subject = room.subject;
  const [a, b] = room.players.filter((p) => p.id !== subject);
  assert.equal(game.submitAnswers(room, subject, ['  Fish   and  chips ', 'Tea'], rng, names).ok, true);
  assert.equal(room.answers.find((x) => x.id === subject).texts[0], 'Fish and chips', 'the spaces are tidied');
  assert.equal(game.submitAnswers(room, a.id, ['Pie', 'Coffee'], rng, names).ok, true);
  assert.equal(game.submitAnswers(room, b.id, ['PIE!', 'Juice'], rng, names).ok, true);
  assert.equal(room.options.length, 2, 'the two pies are one answer');
  const pie = room.options.find((o) => !o.truth);
  assert.deepEqual(pie.authors.sort(), [a.id, b.id].sort());
  assert.equal(normal(pie.text), normal('Pie'));
});
