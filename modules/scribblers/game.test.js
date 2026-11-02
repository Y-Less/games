// The rules of Scribblers, without sockets: the lobby, a turn from the word to the scores, the scoring, the letters,
// the clock, and what happens when somebody leaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import * as game from './game.js';

const NOW = 1_000_000;

/**
 * A room in the lobby with `size` people in it (ids 1..size), and the waits made short.
 * @param {number} [size]  how many people
 * @param {object} [settings]  what the host chose
 * @returns {object} the room
 */
function lobby(size = 3, settings = {}) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings, now: NOW, chooseMs: 1000, betweenMs: 500 });
  for (let id = 2; id <= size; id++) assert.equal(game.addHuman(room, id, `Player ${id}`).ok, true);
  return room;
}

/** A room where the first drawer has chosen a word, with the clock and the random source used to get there. */
function drawing(size = 3, settings = {}) {
  const room = lobby(size, settings);
  const rng = seeded(11);
  assert.equal(game.start(room, 1, rng, NOW).ok, true);
  assert.equal(game.chooseWord(room, room.drawer, 0, NOW).ok, true);
  return { room, rng, word: room.word, guessers: room.players.filter((p) => p.id !== room.drawer).map((p) => p.id) };
}

test('a new room is in the lobby with the host in it and the usual options', () => {
  const room = lobby(1);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.length, 1);
  assert.equal(room.rounds, game.ROUNDS.default);
  assert.equal(room.drawTime, game.DRAW_TIME.default);
  assert.equal(room.wordChoices, game.WORD_CHOICES.default);
  assert.equal(room.hostId, 1);
});

test('the host sets the options, nobody else does, and an impossible one is refused', () => {
  const room = lobby(2);
  assert.equal(game.setSettings(room, 1, { rounds: 5, drawTime: 60, wordChoices: 4 }).ok, true);
  assert.deepEqual([room.rounds, room.drawTime, room.wordChoices], [5, 60, 4]);
  assert.equal(game.setSettings(room, 2, { rounds: 2 }).ok, false, 'only the host');
  assert.equal(room.rounds, 5);
  for (const bad of [{ rounds: 0 }, { rounds: 99 }, { drawTime: 5 }, { drawTime: 1000 }, { wordChoices: 1 }, { wordChoices: 9 }, { rounds: 2.5 }, { rounds: 'lots' }]) {
    const refused = game.setSettings(room, 1, bad);
    assert.equal(refused.ok, false, JSON.stringify(bad));
    assert.ok(refused.error);
  }
  assert.deepEqual([room.rounds, room.drawTime, room.wordChoices], [5, 60, 4], 'a refused option changes nothing');
});

test('a room is made with the options the host chose, and keeps its defaults for the ones they got wrong', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, settings: { rounds: 7, drawTime: 1 }, now: NOW });
  assert.equal(room.rounds, 7);
  assert.equal(room.drawTime, game.DRAW_TIME.default);
});

test('only the host starts, and only with enough players', () => {
  const room = lobby(1);
  const rng = seeded(1);
  assert.equal(game.start(room, 1, rng, NOW).ok, false, 'one player is not a game');
  assert.equal(game.addHuman(room, 2, 'Player 2').ok, true);
  assert.equal(game.start(room, 2, rng, NOW).ok, false, 'only the host');
  assert.equal(game.start(room, 1, rng, NOW).ok, true);
  assert.equal(game.start(room, 1, rng, NOW).ok, false, 'not twice');
});

test('starting puts everybody in the drawing order and offers the first drawer some words', () => {
  const room = lobby(4);
  assert.equal(game.start(room, 1, seeded(3), NOW).ok, true);
  assert.equal(room.phase, 'choosing');
  assert.equal(room.round, 1);
  assert.deepEqual([...room.order].sort(), [1, 2, 3, 4]);
  assert.equal(room.drawer, room.order[0]);
  assert.equal(room.choices.length, room.wordChoices);
  assert.equal(room.deadline, NOW + 1000);
});

test('the drawer chooses one of the words they were offered, and nobody else does', () => {
  const room = lobby(3);
  assert.equal(game.start(room, 1, seeded(4), NOW).ok, true);
  const other = room.players.find((p) => p.id !== room.drawer).id;
  assert.equal(game.chooseWord(room, other, 0, NOW).ok, false, 'only the drawer');
  for (const bad of [-1, 99, 0.5, 'two', null]) assert.equal(game.chooseWord(room, room.drawer, bad, NOW).ok, false, String(bad));
  const offered = [...room.choices];
  assert.equal(game.chooseWord(room, room.drawer, 1, NOW).ok, true);
  assert.equal(room.word, offered[1]);
  assert.deepEqual(room.used, [offered[1]]);
  assert.equal(room.phase, 'drawing');
  assert.equal(room.deadline, NOW + room.drawTime * 1000);
  assert.equal(game.chooseWord(room, room.drawer, 0, NOW).ok, false, 'the word is chosen');
});

test('a word that is not chosen in time is chosen for the drawer', () => {
  const room = lobby(3);
  assert.equal(game.start(room, 1, seeded(4), NOW).ok, true);
  const expected = room.choices[room.preChoice];
  assert.equal(game.timeUp(room, seeded(4), room.deadline, String).ok, true);
  assert.equal(room.phase, 'drawing');
  assert.equal(room.word, expected);
});

test('the word is shown as blanks, with the spaces and hyphens there from the start', () => {
  const room = lobby(2);
  assert.equal(game.start(room, 1, seeded(9), NOW).ok, true);
  room.choices = ['pac-man'];
  assert.equal(game.chooseWord(room, room.drawer, 0, NOW).ok, true);
  const guesser = room.players.find((p) => p.id !== room.drawer).id;
  const hints = game.viewFor(room, guesser, { now: NOW }).hints;
  assert.deepEqual(hints.map((h) => h.ch), [null, null, null, '-', null, null, null]);
  assert.deepEqual(hints.map((h) => h.fixed), [false, false, false, true, false, false, false]);
  assert.deepEqual(game.viewFor(room, room.drawer, { now: NOW }).hints.map((h) => h.ch).join(''), 'pac-man');
});

test('letters are shown as the time runs down, and a word is given the right number of them', () => {
  for (const [word, letters] of [
    ['go', 0],
    ['cat', 1],
    ['house', 2],
    ['william shakespeare', 3],
  ]) {
    const room = lobby(2);
    assert.equal(game.start(room, 1, seeded(2), NOW).ok, true);
    room.choices = [word];
    assert.equal(game.chooseWord(room, room.drawer, 0, NOW).ok, true);
    assert.equal(room.hintsTotal, letters, word);
    const rng = seeded(2);
    for (let n = 0; n < letters; n++) assert.equal(game.revealHint(room, rng, NOW).ok, true, `${word}: letter ${n + 1}`);
    assert.equal(game.revealHint(room, rng, NOW).ok, false, 'no more letters');
    const guesser = room.players.find((p) => p.id !== room.drawer).id;
    const shown = game.viewFor(room, guesser, { now: NOW }).hints.filter((h) => h.ch !== null && !h.fixed).length;
    assert.equal(shown, letters, word);
  }
});

test('a wrong guess is shown to everybody, a close one is marked for its writer alone, a right one scores', () => {
  const { room, word, guessers } = drawing(3);
  assert.equal(game.guess(room, guessers[0], 'nonsense', NOW).quality, 'wrong');
  assert.equal(game.guess(room, guessers[0], `${word}s`, NOW).quality, 'close');
  const mine = game.viewFor(room, guessers[0], { now: NOW }).feed;
  const theirs = game.viewFor(room, guessers[1], { now: NOW }).feed;
  assert.deepEqual(mine.map((line) => line.kind), ['guess', 'close']);
  assert.deepEqual(theirs.map((line) => line.kind), ['guess', 'guess'], 'the others are not told it was close');
  assert.deepEqual(theirs.map((line) => line.text), ['nonsense', `${word}s`], 'but they see what was typed');

  assert.equal(game.guess(room, guessers[0], word.toUpperCase(), NOW).quality, 'exact');
  const player = room.players.find((p) => p.id === guessers[0]);
  assert.ok(player.score > 0);
  assert.equal(game.viewFor(room, guessers[1], { now: NOW }).feed.at(-1).text, '', 'a right guess is never shown');
  assert.equal(game.viewFor(room, guessers[1], { now: NOW }).feed.at(-1).kind, 'correct');
});

test('guessing sooner scores more, and a hidden letter is worth something too', () => {
  const quick = drawing(3);
  assert.equal(game.guess(quick.room, quick.guessers[0], quick.word, NOW).ok, true);
  const early = quick.room.players.find((p) => p.id === quick.guessers[0]).score;

  const slow = drawing(3);
  assert.equal(game.guess(slow.room, slow.guessers[0], slow.word, NOW + 60_000).ok, true);
  const late = slow.room.players.find((p) => p.id === slow.guessers[0]).score;
  assert.ok(early > late, `${early} should beat ${late}`);
  assert.ok(late >= 100, 'getting it at all is worth something');
});

test('the drawer does not guess, an outsider does not guess, and nobody guesses twice', () => {
  const { room, word, guessers } = drawing(3);
  assert.equal(game.guess(room, room.drawer, word, NOW).quality, 'chat', 'the drawer can only talk');
  assert.equal(game.guess(room, 99, word, NOW).ok, false, 'not in the game');
  assert.equal(game.guess(room, guessers[0], word, NOW).quality, 'exact');
  assert.equal(game.guess(room, guessers[0], 'anything', NOW + 2000).quality, 'chat', 'once you have it you are talking');
  assert.equal(room.guessed.filter((g) => g.id === guessers[0]).length, 1);
});

test('what the drawer and the people who have guessed say is kept from the ones still guessing', () => {
  const { room, word, guessers } = drawing(3);
  assert.equal(game.guess(room, guessers[0], word, NOW).ok, true);
  assert.equal(game.guess(room, guessers[0], 'it is a big one', NOW + 2000).quality, 'chat');
  assert.equal(game.guess(room, room.drawer, 'you got it', NOW).quality, 'chat');
  assert.equal(game.viewFor(room, guessers[1], { now: NOW }).feed.filter((l) => l.kind === 'chat').length, 0);
  assert.equal(game.viewFor(room, guessers[0], { now: NOW }).feed.filter((l) => l.kind === 'chat').length, 2);
  assert.equal(game.viewFor(room, room.drawer, { now: NOW }).feed.filter((l) => l.kind === 'chat').length, 2);
});

test('somebody typing too fast is refused, and may carry on a moment later', () => {
  const { room, guessers } = drawing(3);
  for (let n = 0; n < 5; n++) assert.equal(game.guess(room, guessers[0], `try ${n}`, NOW).ok, true);
  assert.equal(game.guess(room, guessers[0], 'again', NOW).error, 'tooFast');
  assert.equal(game.guess(room, guessers[1], 'me too', NOW).ok, true, 'one player being refused does not stop another');
  assert.equal(game.guess(room, guessers[0], 'later', NOW + 4000).ok, true);
});

test('the turn ends when everybody has the word, and the drawer scores the average of the guessers', () => {
  const { room, word, guessers } = drawing(4);
  for (const [n, id] of guessers.entries()) assert.equal(game.guess(room, id, word, NOW + n * 2000).ok, true);
  assert.equal(room.phase, 'between');
  const drawer = room.players.find((p) => p.id === room.drawer);
  const scores = guessers.map((id) => room.players.find((p) => p.id === id).lastScore);
  assert.equal(drawer.lastScore, Math.floor(scores.reduce((a, b) => a + b, 0) / scores.length));
  assert.equal(room.reveal.reason, 'allGuessed');
  assert.equal(room.reveal.word, word);
  assert.deepEqual(room.reveal.guessed, guessers);
});

test('a turn nobody guesses ends when the time is up and is worth nothing to anybody', () => {
  const { room, rng, word } = drawing(3);
  const scoresBefore = room.players.map((p) => p.score);
  assert.equal(game.timeUp(room, rng, room.deadline, String).ok, true);
  assert.equal(room.phase, 'between');
  assert.equal(room.reveal.reason, 'timeUp');
  assert.deepEqual(room.players.map((p) => p.score), scoresBefore);
  assert.equal(room.reveal.word, word);
  assert.deepEqual(room.players.map((p) => p.lastScore), [0, 0, 0]);
});

test('everybody draws once a round, then the scores go up and the next round needs everybody to close them', () => {
  const room = lobby(3, { rounds: 2 });
  const rng = seeded(21);
  let now = NOW;
  assert.equal(game.start(room, 1, rng, now).ok, true);
  const seen = [];
  for (let turn = 0; turn < 3; turn++) {
    seen.push(room.drawer);
    assert.equal(game.chooseWord(room, room.drawer, 0, now).ok, true);
    now += 1000;
    assert.equal(game.timeUp(room, rng, (now += room.drawTime * 1000), String).ok, true); // nobody guesses
    if (turn < 2) {
      assert.equal(room.phase, 'between');
      assert.equal(game.nextTurn(room, rng, (now += 500), String).ok, true);
      assert.equal(room.phase, 'choosing');
    }
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3], 'everybody drew once');
  assert.equal(game.nextTurn(room, rng, (now += 500), String).ok, true);
  assert.equal(room.phase, 'scores', 'the round is over');
  assert.equal(room.history.length, 1);
  assert.deepEqual(Object.keys(room.history[0].deltas).sort(), ['1', '2', '3']);
  assert.equal(game.ready(room, 1, rng, now).ok, true);
  assert.equal(room.phase, 'scores', 'still waiting for the others');
  assert.equal(game.ready(room, 2, rng, now).ok, true);
  assert.equal(game.ready(room, 3, rng, now).ok, true);
  assert.equal(room.phase, 'choosing');
  assert.equal(room.round, 2);
});

test('the scores can be moved on from without everybody, and the last round ends the game', () => {
  const room = lobby(2, { rounds: 1 });
  const rng = seeded(22);
  let now = NOW;
  assert.equal(game.start(room, 1, rng, now).ok, true);
  for (let turn = 0; turn < 2; turn++) {
    assert.equal(game.chooseWord(room, room.drawer, 0, now).ok, true);
    assert.equal(game.timeUp(room, rng, (now += room.drawTime * 1000), String).ok, true);
    assert.equal(game.nextTurn(room, rng, (now += 500), String).finished, turn === 1);
  }
  assert.equal(room.phase, 'finished');
  assert.equal(room.history.length, 1);
  assert.equal(game.forceNextRound(room, rng, now).ok, false, 'nothing to move on from');
  assert.equal(game.ready(room, 1, rng, now).ok, false);
  assert.equal(game.isLive(room), false);
});

test('a round can be forced on when somebody never closes the scores', () => {
  const room = lobby(2, { rounds: 2 });
  const rng = seeded(23);
  let now = NOW;
  assert.equal(game.start(room, 1, rng, now).ok, true);
  for (let turn = 0; turn < 2; turn++) {
    assert.equal(game.chooseWord(room, room.drawer, 0, now).ok, true);
    assert.equal(game.timeUp(room, rng, (now += room.drawTime * 1000), String).ok, true);
    assert.equal(game.nextTurn(room, rng, (now += 500), String).ok, true);
  }
  assert.equal(room.phase, 'scores');
  assert.equal(game.forceNextRound(room, rng, now).ok, true);
  assert.equal(room.round, 2);
  assert.equal(room.phase, 'choosing');
});

test('a turn whose drawer cannot draw it is given up, and nobody scores', () => {
  const { room } = drawing(3);
  const before = room.players.map((p) => p.score);
  assert.equal(game.skipTurn(room, NOW).ok, true);
  assert.equal(room.phase, 'between');
  assert.equal(room.reveal.reason, 'drawerAway');
  assert.deepEqual(room.players.map((p) => p.score), before);
  assert.equal(game.skipTurn(room, NOW).ok, false, 'there is no turn to give up now');
});

test('somebody who leaves a game under way is replaced by a computer player that can play on', () => {
  const { room, rng } = drawing(3);
  const leaving = room.drawer;
  const outcome = game.removeHuman(room, leaving, rng, NOW);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.replaced, true);
  assert.equal(room.players.length, 3, 'the table is as big as it was');
  assert.equal(game.hasPlayer(room, leaving), false);
  assert.ok(room.order.includes(room.drawer), 'the stand-in took their place in the order');
  const standIn = room.players.find((p) => p.id === room.drawer);
  assert.equal(standIn.kind, 'bot');
  assert.ok(standIn.ai, 'and was given an AI to play with');
});

test('somebody who leaves the lobby simply goes', () => {
  const room = lobby(3);
  assert.equal(game.removeHuman(room, 2, seeded(1), NOW).ok, true);
  assert.equal(room.players.length, 2);
  assert.equal(game.hasPlayer(room, 2), false);
});

test('a guess once the game is over is refused', () => {
  const room = lobby(2, { rounds: 1 });
  const rng = seeded(24);
  let now = NOW;
  assert.equal(game.start(room, 1, rng, now).ok, true);
  for (let turn = 0; turn < 2; turn++) {
    assert.equal(game.chooseWord(room, room.drawer, 0, now).ok, true);
    assert.equal(game.timeUp(room, rng, (now += room.drawTime * 1000), String).ok, true);
    game.nextTurn(room, rng, (now += 500), String);
  }
  assert.equal(game.guess(room, 1, 'anything', now).ok, false);
  assert.equal(game.canDraw(room, 1), false);
});

test('only the drawer may draw, and only while a word is being drawn', () => {
  const { room, guessers } = drawing(3);
  assert.equal(game.canDraw(room, room.drawer), true);
  assert.equal(game.canDraw(room, guessers[0]), false);
  game.skipTurn(room, NOW);
  assert.equal(game.canDraw(room, room.drawer), false, 'not between turns');
});

test('the statistics count the people only, with what each of them did', () => {
  const { room, word, guessers } = drawing(3);
  assert.equal(game.addBot(room, 1).ok, false, 'no computer players once the game has started');
  for (const id of guessers) assert.equal(game.guess(room, id, word, NOW).ok, true);
  room.phase = 'finished';
  const rows = game.statsPlayers(room);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.userId).sort(),
    [1, 2, 3],
  );
  // Everybody guessed at the same moment, so all three scored the same and all three share the win.
  const best = Math.max(...rows.map((r) => r.score));
  for (const row of rows) assert.equal(row.outcome, row.score === best ? 'win' : 'loss', `player ${row.userId}`);
  assert.ok(rows.some((r) => r.placement === 1));
  const drawerRow = rows.find((r) => r.userId === room.drawer);
  assert.equal(drawerRow.extras.wordsDrawn, 1);
  assert.equal(drawerRow.extras.everyoneGot, 1);
  for (const id of guessers) assert.equal(rows.find((r) => r.userId === id).extras.wordsGuessed, 1);
});

test('a room saved before a change still loads', () => {
  const old = {
    code: 'a-b-c',
    hostId: 1,
    phase: 'drawing',
    players: [
      { id: 1, name: 'Ann', score: 10, bot: false },
      { id: 'bot:1', name: 'Hazel', score: 0, bot: true },
    ],
    round: 1,
    rounds: 3,
    turn: 0,
    drawer: 1,
    word: 'house',
    history: null,
  };
  const room = game.migrate(old, () => 'Someone');
  assert.equal(room.players[0].kind, 'human');
  assert.equal(room.players[1].kind, 'bot');
  assert.deepEqual(room.history, []);
  assert.deepEqual(room.feed, []);
  assert.equal(room.language, 'en');
  assert.ok(room.chooseMs > 0);
  assert.doesNotThrow(() => game.viewFor(room, 1, { now: NOW }));
});

// ---- words the players add themselves ----

test('anybody at the table may add a word, and it is counted for them', () => {
  const room = lobby(3);
  assert.equal(game.addWord(room, 2, 'Space Hopper').ok, true);
  assert.deepEqual(room.customWords, ['space hopper'], 'kept as it is compared: lower case');
  assert.equal(room.players.find((p) => p.id === 2).wordsAdded, 1);
  assert.equal(room.players.find((p) => p.id === 1).wordsAdded, 0, 'and only for them');
  assert.equal(game.addWord(room, 99, 'intruder').ok, false, 'but not by somebody who is not in the game');
});

test('the same word twice is accepted quietly, and counted once', () => {
  const room = lobby(2);
  assert.equal(game.addWord(room, 1, 'kettle').ok, true);
  const again = game.addWord(room, 1, 'KETTLE');
  assert.equal(again.ok, true, 'nobody has to remember what they typed');
  assert.equal(again.word, undefined, 'but nothing was added');
  assert.deepEqual(room.customWords, ['kettle']);
  assert.equal(room.players[0].wordsAdded, 1);
});

test('a word that cannot be drawn or typed is refused', () => {
  const room = lobby(2);
  for (const [text, error] of [
    ['', 'typeWord'],
    ['   ', 'typeWord'],
    ['x'.repeat(30), 'wordTooLong'],
    ['<script>', 'wordLetters'],
    ['-start', 'wordLetters'],
    ['ok!', 'wordLetters'],
  ]) {
    const refused = game.addWord(room, 1, text);
    assert.equal(refused.ok, false, text);
    assert.equal(refused.error, error, text);
  }
  assert.deepEqual(room.customWords, []);
  assert.equal(game.addWord(room, 1, "Anne's hat").ok, true, 'an apostrophe is a word');
  assert.equal(game.addWord(room, 1, 'ice cream').ok, true, 'and so is a space');
});

test('a game takes only so many words, and only before it starts', () => {
  const room = lobby(2);
  const max = game.viewFor(room, 1, { now: NOW }).limits.customWords;
  assert.ok(max >= 10, 'a game holds a sensible number of them');
  for (let n = 0; n < max; n++) assert.equal(game.addWord(room, 1, `word${n}`).ok, true, `word ${n}`);
  const full = game.addWord(room, 1, 'one too many');
  assert.equal(full.ok, false);
  assert.equal(full.error, 'wordsFull');
  assert.equal(game.start(room, 1, seeded(1), NOW).ok, true);
  assert.equal(game.addWord(room, 1, 'late').error, 'wordsBeforeStart');
});

test('a word somebody added is one of the words offered, until it has been played', () => {
  const room = lobby(2);
  assert.equal(game.addWord(room, 1, 'space hopper').ok, true);
  const rng = seeded(7);
  assert.equal(game.start(room, 1, rng, NOW).ok, true);
  assert.ok(room.choices.includes('space hopper'), `offered ${JSON.stringify(room.choices)}`);
  const n = room.choices.indexOf('space hopper');
  assert.equal(game.chooseWord(room, room.drawer, n, NOW).ok, true);
  assert.equal(game.timeUp(room, rng, room.deadline, String).ok, true);
  assert.equal(game.nextTurn(room, rng, NOW, String).ok, true);
  assert.ok(!room.choices.includes('space hopper'), 'and not again, now it has been drawn');
});

test('words saved from earlier games are offered too', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds: 1 }, added: ['space hopper', 'space hopper', ''], now: NOW });
  assert.deepEqual(room.added, ['space hopper'], 'tidied as they are taken in');
  assert.equal(game.addHuman(room, 2, 'Player 2').ok, true);
  assert.equal(game.start(room, 1, seeded(8), NOW).ok, true);
  assert.ok(room.choices.includes('space hopper'));
});

test('choosing one of the rude words counts, but having it chosen for you does not', () => {
  const room = lobby(2);
  const rng = seeded(9);
  assert.equal(game.start(room, 1, rng, NOW).ok, true);
  const drawer = () => room.players.find((p) => p.id === room.drawer);
  room.choices = ['boobs', 'kettle'];
  assert.equal(game.chooseWord(room, room.drawer, 0, NOW).ok, true);
  assert.equal(drawer().juvenilePicks, 1, 'they went for it');

  assert.equal(game.timeUp(room, rng, room.deadline, String).ok, true);
  assert.equal(game.nextTurn(room, rng, NOW, String).ok, true);
  const next = room.players.find((p) => p.id === room.drawer);
  room.choices = ['penis', 'kettle'];
  room.preChoice = 0;
  assert.equal(game.timeUp(room, rng, room.deadline, String).ok, true, 'the clock chooses');
  assert.equal(room.word, 'penis');
  assert.equal(next.juvenilePicks ?? 0, 0, 'which is not a choice at all');
});

test('every guess is counted, right or wrong, and talk is not', () => {
  const { room, word, guessers } = drawing(3);
  const guesser = room.players.find((p) => p.id === guessers[0]);
  assert.equal(game.guess(room, guessers[0], 'nonsense', NOW).ok, true);
  assert.equal(game.guess(room, guessers[0], `${word}s`, NOW).ok, true);
  assert.equal(guesser.guesses, 2);
  assert.equal(game.guess(room, guessers[0], word, NOW).quality, 'exact');
  assert.equal(guesser.guesses, 3, 'the right one counts too');
  assert.equal(game.guess(room, guessers[0], 'that was easy', NOW + 4000).quality, 'chat');
  assert.equal(guesser.guesses, 3, 'but talking afterwards is not guessing');
  const drawerPlayer = room.players.find((p) => p.id === room.drawer);
  assert.equal(game.guess(room, room.drawer, 'you got it', NOW).quality, 'chat');
  assert.equal(drawerPlayer.guesses ?? 0, 0, 'and nor is the drawer talking');
});

test('playing again is not offered: a new game is started from the menu', () => {
  assert.equal(game.playAgain().ok, false);
});
