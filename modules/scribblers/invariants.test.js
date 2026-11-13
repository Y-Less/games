// Randomised play of the Scribblers rules: hundreds of seeded games in which people, computer players, and strangers
// try legal and illegal things in any order, leave, come back, and are removed, while the clock does its own work
// (a word chosen for a drawer who dithers, a letter shown, the end of a turn) the way the server's timer does it.
//
// After every single step the room must still be a game of Scribblers as rules.md describes one: everybody draws once
// a round, a guess is worth between 100 and 260, a drawing nobody guessed is worth nothing to anybody, the scores add
// up to the history, the room can be saved and loaded, and no view tells a guesser the word, the letters still
// hidden, the words the drawer is choosing between, or what the people who already know the word are saying.
//
// Every failure names its seed and step, so a game that goes wrong can be played again exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/testkit.js';

const PHASES = ['lobby', 'choosing', 'drawing', 'between', 'scores', 'finished'];
const IN_TURN = ['choosing', 'drawing', 'between'];
const WORD_SHOWN = ['between', 'scores', 'finished'];
/** What rules.md says a right guess is worth: 100, up to 100 more for being quick, and up to 60 for hidden letters. */
const GUESS_POINTS = { least: 100, most: 260 };
const PEOPLE = [1, 2, 3, 4, 5];
const STRANGER = 99;

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const sum = (numbers) => numbers.reduce((a, b) => a + b, 0);
const letters = (word) => [...word];

/**
 * The room as it would be saved, without the two lists that only remember when somebody last typed or pressed a
 * thumb: being refused for typing too fast tidies those lists, which is not a change to the game.
 */
const snapshot = (room) => JSON.stringify({ ...room, players: room.players.map(({ talk, rated, ...rest }) => rest) });

/** Everything that must be true of a room, whatever has just been done to it. */
function checkRoom(room, label) {
  assert.ok(PHASES.includes(room.phase), `${label}: phase ${room.phase}`);
  const ids = room.players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: no player twice`);
  assert.equal(new Set(room.players.map((p) => p.slot)).size, ids.length, `${label}: no place held twice`);
  assert.ok(ids.length >= 1 && ids.length <= game.MAX_PLAYERS, `${label}: ${ids.length} players`);
  assert.ok(ids.includes(room.hostId), `${label}: the host is at the table`);
  assert.ok(game.isHuman(room.players.find((p) => p.id === room.hostId)), `${label}: the host is a person`);
  for (const p of room.players) assert.ok(Number.isInteger(p.score) && p.score >= 0, `${label}: ${p.id} has a sound score (${p.score})`);

  for (const [key, bounds] of [['rounds', game.ROUNDS], ['drawTime', game.DRAW_TIME], ['wordChoices', game.WORD_CHOICES]]) {
    assert.ok(Number.isInteger(room[key]) && room[key] >= bounds.min && room[key] <= bounds.max, `${label}: ${key} is ${room[key]}`);
  }
  assert.equal(new Set(room.used).size, room.used.length, `${label}: no word is played twice in a game`);

  if (room.phase !== 'lobby') {
    // Somebody who leaves is replaced in their place, so a game never has fewer players than it started with, and
    // the drawing order is always exactly the people at the table.
    assert.ok(ids.length >= game.MIN_PLAYERS, `${label}: a game under way has enough players`);
    assert.deepEqual([...room.order].map(String).sort(), ids.map(String).sort(), `${label}: everybody draws once a round`);
    assert.ok(room.round >= 1 && room.round <= room.rounds, `${label}: round ${room.round} of ${room.rounds}`);
  }

  if (IN_TURN.includes(room.phase)) {
    assert.ok(ids.includes(room.drawer), `${label}: the drawer is at the table`);
    assert.equal(room.drawer, room.order[room.turn], `${label}: the drawer is the one whose turn it is`);
    assert.ok(Number.isFinite(room.deadline), `${label}: a turn is on the clock`);
  }

  if (room.phase === 'choosing') {
    assert.ok(room.choices.length >= 1 && room.choices.length <= room.wordChoices, `${label}: ${room.choices.length} words on offer`);
    assert.equal(new Set(room.choices).size, room.choices.length, `${label}: the same word offered twice`);
    for (const word of room.choices) assert.ok(!room.used.includes(word), `${label}: "${word}" has already been drawn in this game`);
    assert.equal(room.word, null, `${label}: no word until the drawer has chosen`);
    assert.deepEqual(room.guessed, [], `${label}: nobody has guessed a word that is not chosen`);
  }

  if (room.phase === 'drawing') {
    assert.equal(typeof room.word, 'string', `${label}: a word is being drawn`);
    assert.ok(room.used.includes(room.word), `${label}: the word counts as played`);
    assert.deepEqual(room.hints.map((h) => h.ch), letters(room.word), `${label}: one blank for every character of the word`);
    assert.ok(room.hints.some((h) => !h.shown), `${label}: there is still something to guess`);
    assert.ok(room.hintsLeft >= 0 && room.hintsLeft <= room.hintsTotal && room.hintsTotal <= 3, `${label}: at most three letters are ever given away`);
    assert.equal(room.hints.filter((h) => h.shown && !h.fixed).length, room.hintsTotal - room.hintsLeft, `${label}: the letters shown are the ones the clock has given`);
  }

  const guessedIds = room.guessed.map((g) => g.id);
  assert.equal(new Set(guessedIds).size, guessedIds.length, `${label}: nobody guesses the word twice`);
  for (const g of room.guessed) {
    assert.ok(ids.includes(g.id) && g.id !== room.drawer, `${label}: ${g.id} guessed, and is a guesser`);
    assert.ok(Number.isInteger(g.points) && g.points >= GUESS_POINTS.least && g.points <= GUESS_POINTS.most, `${label}: a guess worth ${g.points}`);
  }
  const voters = room.votes.map((v) => v.id);
  assert.equal(new Set(voters).size, voters.length, `${label}: one thumb each`);
  for (const v of room.votes) {
    assert.ok(ids.includes(v.id) && v.id !== room.drawer, `${label}: the drawer has no say, and nor has a stranger`);
    assert.ok(['up', 'down'].includes(v.vote), `${label}: a thumb is up or down`);
  }

  if (room.phase === 'between') {
    assert.ok(room.reveal, `${label}: the word is shown between turns`);
    assert.equal(room.reveal.word, room.word, `${label}: and it is the word that was drawn`);
    assert.ok(room.hints.every((h) => h.shown), `${label}: every letter is shown once the turn is over`);
    assert.deepEqual(room.reveal.guessed, guessedIds, `${label}: the reveal names the people who got it`);
  }
  if (room.phase === 'scores') {
    const people = room.players.filter(game.isHuman).map((p) => p.id);
    assert.ok(room.ready.every((id) => people.includes(id)), `${label}: only people at the table close the scores`);
  }

  // The scoreboard: one line a finished round, and a column that adds up to the score.
  const finishedRounds = room.phase === 'lobby' ? 0 : IN_TURN.includes(room.phase) ? room.round - 1 : room.round;
  assert.equal(room.history.length, finishedRounds, `${label}: one scoreboard line for every finished round`);
  if (room.phase === 'finished') assert.equal(room.history.length, room.rounds, `${label}: a finished game played all its rounds`);
  for (const p of room.players) {
    const column = sum(room.history.map((round) => round.deltas[p.slot] ?? 0));
    if (IN_TURN.includes(room.phase)) assert.ok(column <= p.score, `${label}: ${p.id} has ${p.score} but the scoreboard says ${column}`);
    else assert.equal(column, p.score, `${label}: the scoreboard adds up to the score of ${p.id}`);
  }

  // The panel of guesses: numbered in order, and never grown without limit.
  const numbers = room.feed.map((line) => line.n);
  assert.ok(numbers.every((n, i) => i === 0 || n > numbers[i - 1]), `${label}: the lines of the feed are in order`);
  assert.ok(room.feed.length <= 200, `${label}: the feed is kept short (${room.feed.length} lines)`);

  // "A room is a plain object that can be saved as JSON": saved and loaded, it is the same room.
  assert.deepEqual(game.migrate(JSON.parse(JSON.stringify(room))), room, `${label}: a saved room loads as it was`);
}

/** Nobody may be shown what they should not, whoever is looking. */
function checkViews(room, label, now) {
  const privateLines = new Set(room.feed.filter((line) => line.private).map((line) => line.n));
  for (const id of [...room.players.map((p) => p.id), STRANGER]) {
    const view = JSON.parse(JSON.stringify(game.viewFor(room, id, { now })));
    const who = `${label}: ${id}`;
    const member = room.players.some((p) => p.id === id);
    const drawing = room.phase === 'drawing';
    const knows = member && (id === room.drawer || room.guessed.some((g) => g.id === id));

    assert.equal(view.phase, room.phase, `${who} is told the phase`);
    if (drawing && !knows) {
      assert.equal(view.word, null, `${who} is still guessing and was sent the word`);
      for (const [n, hint] of view.hints.entries()) {
        assert.equal(hint.ch, room.hints[n].shown ? room.hints[n].ch : null, `${who} was sent a letter (${n}) that has not been shown`);
      }
      for (const line of view.feed) assert.ok(!privateLines.has(line.n), `${who} was sent what the people who know the word are saying`);
    }
    if (drawing && knows) assert.equal(view.word, room.word, `${who} knows the word and is shown it`);
    if (room.phase === 'choosing') assert.equal(view.word, null, `${who} was sent a word before one was chosen`);
    if (WORD_SHOWN.includes(room.phase)) assert.ok(view.hints.every((hint) => hint.ch !== null), `${who}: the word is shown once the turn is over`);

    // The words on offer are the drawer's business only.
    if (room.phase === 'choosing' && id === room.drawer) assert.deepEqual(view.choices, room.choices, `${who} is drawing and sees the words on offer`);
    else assert.deepEqual(view.choices, [], `${who} was sent the words the drawer is choosing between`);

    for (const line of view.feed) {
      if (line.kind === 'correct') assert.equal(line.text, '', `${who}: a right guess is never shown as text`);
      if (line.kind === 'close') assert.equal(line.id, id, `${who} was told somebody else was close`);
    }

    assert.equal(view.youDraw, member && IN_TURN.includes(room.phase) && id === room.drawer, `${who}: whether they are drawing`);
    assert.equal(view.votes.can, member && drawing && id !== room.drawer, `${who}: whether they may judge the drawing`);
    if (!member) {
      assert.equal(view.youGuessed, false, `${who} is a stranger and has guessed nothing`);
      assert.equal(view.votes.you, null, `${who} is a stranger and has no thumb`);
    }
    assert.equal(view.reveal === null, room.phase !== 'between', `${who}: the reveal is for between turns`);

    // The scoreboard lists everybody, and its columns never claim more than the score.
    assert.deepEqual(view.scoreboard.players.map((p) => p.id), room.players.map((p) => p.id), `${who}: everybody is on the scoreboard`);
    for (const p of view.players) {
      const column = sum(view.scoreboard.rounds.map((round) => round.deltas[p.id] ?? 0));
      assert.ok(column <= p.score, `${who}: the scoreboard gives ${p.id} more than their score`);
      if (room.phase !== 'finished') assert.ok(p.placement === null && p.winner === false, `${who}: nobody has won a game that is not over`);
    }
    if (room.phase === 'finished') {
      const best = Math.max(...view.players.map((p) => p.score));
      for (const p of view.players) assert.equal(p.winner, p.score === best, `${who}: the winners are the ones with the most`);
    }
  }
}

/**
 * Does what the server's timer would do by now: chooses for a drawer who has run out of time, shows a letter that is
 * due, ends a drawing whose time is up, and moves on from the word once it has been up long enough.
 */
function settleClock(room, rng, now) {
  for (let guard = 0; guard < 20; guard++) {
    if (room.phase === 'drawing' && room.nextHintAt !== null && room.nextHintAt <= now && room.nextHintAt <= room.deadline) {
      assert.equal(game.revealHint(room, rng, now).ok, true, 'a letter that is due is shown');
    } else if (IN_TURN.includes(room.phase) && room.deadline !== null && room.deadline <= now) {
      assert.equal(game.timeUp(room, rng, now).ok, true, 'the clock moves the turn on');
    } else return;
  }
}

const GUESSES = ['', '   ', 'nonsense', 'x', 'a'.repeat(500), 42, null, undefined, {}, ['house'], '\u0000', 'ünïcödé', '__proto__'];
const CHOICES = [0, 1, 2, 3, 4, 5, -1, 99, 0.5, '0', '1', null, undefined, NaN, {}, 'first'];
const THUMBS = ['up', 'down', 'up', 'down', 'sideways', '', null, undefined, 1, { dir: 'up' }];
const WORDS = ['teapot', 'Sea Horse', 'x', '', '   ', '!!!', 'a'.repeat(40), 'fart', 'teapot', 7, null, 'kettle drum'];
const SETTINGS = [{ rounds: 1 }, { rounds: 2 }, { rounds: 0 }, { rounds: 99 }, { rounds: 1.5 }, { drawTime: 30 }, { drawTime: 5 }, { drawTime: 'long' }, { wordChoices: 2 }, { wordChoices: 5 }, { wordChoices: 9 }, { size: 3 }, { size: 99 }, { size: 6 }, {}];

/**
 * One seeded game of anything at all, checked after every step.
 * @param {number} seed  the seed, which decides everything
 * @returns {object} the room as the game left it
 */
function playRandom(seed) {
  const rng = seeded(seed);
  let now = 1_000_000;
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds: 1 + Math.floor(rng() * 2), drawTime: 30 }, now, chooseMs: 1000, betweenMs: 500 });
  const name = (id) => `Player ${id}`;
  for (const id of PEOPLE.slice(1)) if (rng() < 0.6) game.addHuman(room, id, name(id));
  if (rng() < 0.5) game.addBot(room, room.hostId);
  if (room.players.length < game.MIN_PLAYERS) game.addHuman(room, 2, name(2));

  /** Somebody at the table who is still guessing, or anybody at all when nobody is. */
  const aGuesser = () => pick(rng, room.players.filter((p) => p.id !== room.drawer && !room.guessed.some((g) => g.id === p.id)).map((p) => p.id).concat(pick(rng, PEOPLE)));
  const actions = [
    (id) => game.setSettings(room, id, pick(rng, SETTINGS)),
    (id) => game.addWord(room, id, pick(rng, WORDS)),
    (id) => game.addBot(room, id),
    (id) => game.fillWithBots(room, id, pick(rng, [2, 4, 6, 99, 'x', undefined])),
    (id) => game.removeBot(room, id, pick(rng, ['s0', 's1', 's2', 's3', 's99', null])),
    (id) => game.start(room, id, rng, now),
    (id) => game.chooseWord(room, id, pick(rng, CHOICES), now),
    (id) => game.guess(room, id, pick(rng, GUESSES), now),
    (id) => game.guess(room, id, room.word ?? 'early', now),
    (id) => game.guess(room, id, `${room.word}s`, now),
    (id) => game.vote(room, id, pick(rng, THUMBS), now),
    (id) => game.ready(room, id, rng, now),
    (id) => game.removeHuman(room, id, rng, now),
    (id) => game.addHuman(room, id, name(id)),
    (id) => game.kick(room, id, pick(rng, room.players).slot, rng, now),
    (id) => game.playAgain(room, id),
    () => game.pendingBotAction(room) && { ok: game.runBotAction(room, rng, now) },
    () => (room.phase === 'scores' ? game.forceNextRound(room, rng, now) : null),
    // A drawer whose connection has gone has the turn given up, whether or not anybody had guessed the word by then.
    () => (['choosing', 'drawing'].includes(room.phase) && rng() < 0.3 ? game.skipTurn(room, now) : null),
  ];

  // The scores as the turn being played began, by place; null for a turn this test did not see the start of.
  let atTurnStart = null;
  let turnSeen = '';
  const noteTurn = () => {
    const turn = `${room.round}:${room.turn}`;
    if (turn === turnSeen) return;
    turnSeen = turn;
    atTurnStart = room.guessed.length ? null : new Map(room.players.map((p) => [p.slot, p.score]));
  };
  const highest = new Map();
  for (let step = 0; step < 400 && room.phase !== 'finished'; step++) {
    const label = `seed ${seed}, step ${step}`;
    // The clock runs on: usually a moment, sometimes right up to whatever is due next.
    now += Math.floor(rng() * 900);
    if (rng() < 0.12 && room.deadline !== null) now = Math.max(now, room.nextHintAt ?? room.deadline);
    settleClock(room, rng, now);
    noteTurn();

    const id = pick(rng, [...PEOPLE, STRANGER]);
    let action = pick(rng, actions);
    // Often enough, somebody does what the game is waiting for, so that games get somewhere.
    if (room.phase === 'lobby' && rng() < 0.3) action = () => game.start(room, room.hostId, rng, now);
    else if (room.phase === 'choosing' && rng() < 0.5) action = () => game.chooseWord(room, room.drawer, Math.floor(rng() * room.choices.length), now);
    else if (room.phase === 'drawing' && rng() < 0.35) action = () => game.guess(room, aGuesser(), room.word, now);
    else if (room.phase === 'scores' && rng() < 0.5) action = (who) => game.ready(room, who, rng, now);

    const before = snapshot(room);
    const turnWasOn = ['choosing', 'drawing'].includes(room.phase);
    const result = action(id);
    if (result && result.ok === false) {
      assert.equal(typeof result.error, 'string', `${label}: a refusal says why`);
      // Several settings at once are applied one at a time, which this test never asks for: one setting, one answer.
      assert.equal(snapshot(room), before, `${label}: a refused action (${result.error}) changed the room`);
    }
    if (result?.empty) return room; // the last person left: the server throws the room away

    checkRoom(room, label);
    checkViews(room, label, now);

    // Nobody's score ever goes down, whatever the table makes of their drawing; with the one exception the rules make,
    // which is a turn given up because its drawer has gone: "nobody scores", so what a quick guesser had been given
    // for that turn is taken back, and nobody comes out of it with anything.
    const givenUp = turnWasOn && room.phase === 'between' && room.reveal?.reason === 'drawerAway';
    if (givenUp) {
      assert.deepEqual(room.reveal.points, {}, `${label}: somebody scored on a turn that was given up`);
      for (const p of room.players) assert.equal(p.lastScore ?? 0, 0, `${label}: ${p.id} scored on a turn that was given up`);
    }
    for (const p of room.players) {
      if (givenUp) assert.ok(p.score >= 0 && p.score <= (highest.get(p.slot) ?? 0), `${label}: the score of ${p.id} is ${p.score} after a turn that was given up`);
      else assert.ok(p.score >= (highest.get(p.slot) ?? 0), `${label}: the score of ${p.id} went down`);
      highest.set(p.slot, p.score);
    }
    // A drawing nobody guessed is worth nothing to anybody.
    noteTurn();
    if (room.phase === 'between' && room.reveal.guessed.length === 0 && atTurnStart) {
      for (const p of room.players) assert.equal(p.score, atTurnStart.get(p.slot), `${label}: ${p.id} scored on a turn nobody guessed`);
    }
  }
  return room;
}

test('random legal and illegal play, with people leaving and coming back, keeps every room and every view sound', () => {
  const phases = new Map();
  for (let seed = 1; seed <= 120; seed++) {
    const { phase } = playRandom(seed);
    phases.set(phase, (phases.get(phase) ?? 0) + 1);
  }
  assert.ok((phases.get('finished') ?? 0) >= 10, `a good many games ran to their end (${JSON.stringify([...phases])})`);});

test('games played properly, with a table of people and computer players, always finish with scores that add up', () => {
  for (let seed = 5000; seed < 5045; seed++) {
    const rng = seeded(seed);
    let now = 1_000_000;
    const size = 2 + Math.floor(rng() * 4);
    const rounds = 1 + Math.floor(rng() * 3);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds, drawTime: 30 }, now, chooseMs: 1000, betweenMs: 500 });
    for (let id = 2; id <= size; id++) assert.equal(game.addHuman(room, id, `Player ${id}`).ok, true);
    const bots = Math.floor(rng() * 3);
    for (let n = 0; n < bots; n++) assert.equal(game.addBot(room, 1).ok, true);
    assert.equal(game.start(room, 1, rng, now).ok, true);

    const drawn = new Map(); // place -> how many turns they have drawn
    let turns = 0;
    for (let step = 0; step < 5000 && room.phase !== 'finished'; step++) {
      const label = `seed ${seed}, step ${step}`;
      now += 200 + Math.floor(rng() * 1500);
      const was = room.phase;
      settleClock(room, rng, now);
      if (room.phase === 'choosing' && game.isHuman(room.players.find((p) => p.id === room.drawer)) && rng() < 0.8) {
        assert.equal(game.chooseWord(room, room.drawer, Math.floor(rng() * room.choices.length), now).ok, true, label);
      } else if (game.pendingBotAction(room) && rng() < 0.5) {
        assert.equal(game.runBotAction(room, rng, now), true, `${label}: a computer player's move is always a legal one`);
      } else if (room.phase === 'drawing') {
        const waiting = room.players.filter((p) => game.isHuman(p) && p.id !== room.drawer && !room.guessed.some((g) => g.id === p.id));
        if (waiting.length && rng() < 0.6) {
          const who = pick(rng, waiting);
          const text = rng() < 0.5 ? room.word : pick(rng, ['nonsense', `${room.word}s`, 'is it a cat']);
          const outcome = game.guess(room, who.id, text, now);
          assert.ok(outcome.ok || outcome.error === 'tooFast', `${label}: a guess is taken (${outcome.error})`);
        } else if (waiting.length && rng() < 0.3) {
          assert.equal(game.vote(room, pick(rng, waiting).id, pick(rng, ['up', 'down']), now).ok, true, label);
        } else if (rng() < 0.1) now = room.deadline;
      } else if (room.phase === 'scores') {
        const person = pick(rng, room.players.filter(game.isHuman));
        assert.equal(game.ready(room, person.id, rng, now).ok, true, label);
      }
      if (room.phase === 'between' && was !== 'between') {
        turns++;
        const slot = room.players.find((p) => p.id === room.reveal.drawer).slot;
        drawn.set(slot, (drawn.get(slot) ?? 0) + 1);
      }
      checkRoom(room, label);
      checkViews(room, label, now);
    }

    assert.equal(room.phase, 'finished', `seed ${seed}: the game finishes`);
    assert.equal(turns, rounds * room.players.length, `seed ${seed}: a round is everybody drawing once`);
    for (const p of room.players) assert.equal(drawn.get(p.slot), rounds, `seed ${seed}: ${p.id} drew once a round`);
    assert.equal(room.used.length, turns, `seed ${seed}: a different word for every turn`);

    const rows = game.statsPlayers(room);
    assert.deepEqual(rows.map((r) => r.userId).sort(), room.players.filter(game.isHuman).map((p) => p.id).sort(), `seed ${seed}: only the people are recorded`);
    const best = Math.max(...room.players.map((p) => p.score));
    for (const row of rows) {
      const player = room.players.find((p) => p.id === row.userId);
      assert.equal(row.score, player.score, `seed ${seed}: ${row.userId} is recorded with their score`);
      assert.equal(row.outcome, player.score === best ? 'win' : 'loss', `seed ${seed}: ${row.userId} won only with the most points`);
      assert.ok(Number.isInteger(row.placement) && row.placement >= 1 && row.placement <= room.players.length, `seed ${seed}: a placement at the table`);
      for (const [key, value] of Object.entries(row.extras)) assert.ok(Number.isInteger(value) && value >= 0, `seed ${seed}: ${key} is a count (${value})`);
    }
  }
});

test('the drawer of a drawing somebody guessed scores the average of the guessers, moved by the thumbs and never below nothing', () => {
  for (let seed = 9000; seed < 9200; seed++) {
    const rng = seeded(seed);
    let now = 1_000_000;
    const size = 3 + Math.floor(rng() * 4);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds: 1, drawTime: 60 }, now, chooseMs: 1000, betweenMs: 500 });
    for (let id = 2; id <= size; id++) assert.equal(game.addHuman(room, id, `Player ${id}`).ok, true);
    assert.equal(game.start(room, 1, rng, now).ok, true);
    assert.equal(game.chooseWord(room, room.drawer, 0, now).ok, true);
    const drawer = room.players.find((p) => p.id === room.drawer);
    const guessers = room.players.filter((p) => p !== drawer);

    let thumbs = 0;
    const scored = [];
    for (const p of guessers) {
      now += Math.floor(rng() * 8000);
      const thumb = pick(rng, ['up', 'down', null]);
      if (thumb) {
        assert.equal(game.vote(room, p.id, thumb, now).ok, true, `seed ${seed}`);
        thumbs += thumb === 'up' ? 1 : -1;
      }
      if (rng() < 0.6) {
        assert.equal(game.guess(room, p.id, room.word, now).ok, true, `seed ${seed}`);
        scored.push(p.score);
      }
    }
    if (room.phase === 'drawing') assert.equal(game.timeUp(room, rng, room.deadline).ok, true);
    assert.equal(room.phase, 'between', `seed ${seed}: the turn is over`);

    // The average is over everybody who was guessing, the ones who never got it included; a twentieth more or less
    // for every thumb; and whole points, so the sum may be out by the rounding of the two steps (a point lost from
    // the average, itself moved by the thumbs, and half a point from the result).
    const average = sum(scored) / guessers.length;
    const expected = Math.max(0, average * (1 + game.VOTE_STEP * thumbs));
    assert.ok(Math.abs(drawer.score - expected) <= 1.5 + Math.abs(game.VOTE_STEP * thumbs), `seed ${seed}: the drawer scored ${drawer.score}, and the rules make it ${expected.toFixed(2)}`);
    if (!scored.length) assert.equal(drawer.score, 0, `seed ${seed}: a drawing nobody got is worth nothing, whatever the thumbs`);
    for (const points of scored) assert.ok(points >= GUESS_POINTS.least && points <= GUESS_POINTS.most, `seed ${seed}: a guess worth ${points}`);
    assert.deepEqual([...scored].sort((a, b) => b - a), scored, `seed ${seed}: a later guess is never worth more than an earlier one`);
  }
});

test('a turn given up because its drawer has gone scores for nobody, even when somebody had already guessed the word', () => {
  const rng = seeded(77);
  const now = 1_000_000;
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds: 1, drawTime: 60 }, now, chooseMs: 1000, betweenMs: 500 });
  for (const id of [2, 3]) assert.equal(game.addHuman(room, id, `Player ${id}`).ok, true);
  assert.equal(game.start(room, 1, rng, now).ok, true);
  assert.equal(game.chooseWord(room, room.drawer, 0, now).ok, true);
  const [first] = room.players.filter((p) => p.id !== room.drawer);
  assert.equal(game.guess(room, first.id, room.word, now + 1000).ok, true);
  assert.equal(room.phase, 'drawing', 'one of the two guessers has still to get it');

  assert.equal(game.skipTurn(room, now + 2000).ok, true);
  assert.equal(room.reveal.reason, 'drawerAway');
  assert.deepEqual(room.players.map((p) => p.score), [0, 0, 0], 'nobody scores on a turn that was given up');
});
