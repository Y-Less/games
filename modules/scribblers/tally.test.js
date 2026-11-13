// The counters Scribblers keeps about each player (tally.js), and what is recorded for the statistics and the
// achievements when a game ends (module.json "stats" and "achievements").
//
// Three things are protected.  That the counters and module.json name the same statistics, so none is recorded that
// the site does not know and none is promised that is never counted.  That a scored turn counts what tally.js says it
// counts.  And that whole games, played through the rules, record for each person exactly what they did - worked out
// here from a separate book of who drew, who guessed, and in what order, never from the counters themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as game from './game.js';
import { STAT_KEYS, newCounters, statsExtras, tallyGuess, tallyTurn, tallyWord } from './tally.js';
import { seeded } from '../../shared/testkit.js';

const manifest = JSON.parse(fs.readFileSync(new URL('./module.json', import.meta.url), 'utf8'));
const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/** A player as the game keeps one, for the counters to live on. */
const player = (extra = {}) => ({ ...newCounters(), ...extra });

test('the statistics a game records are exactly the ones module.json declares, and every achievement counts one of them', () => {
  const declared = manifest.stats.map((stat) => stat.key).sort();
  const recorded = Object.keys(statsExtras(player())).sort();
  assert.deepEqual(recorded, declared, 'the counters and module.json name the same statistics');
  assert.equal(new Set(declared).size, declared.length, 'no statistic is declared twice');
  for (const key of STAT_KEYS) assert.ok(declared.includes(key), `${key} is counted, so it is declared`);
  for (const achievement of manifest.achievements) {
    if (achievement.stat !== undefined) assert.ok(declared.includes(achievement.stat), `"${achievement.name}" counts ${achievement.stat}, which nothing records`);
  }
});

test('a fresh player starts at zero, and has not guessed every word of a game they never guessed in', () => {
  const extras = statsExtras(player());
  assert.deepEqual(Object.values(extras).filter((n) => n !== 0), []);
  assert.equal(extras.cleanSweep, 0, 'a clean sweep needs at least one turn spent guessing');
});

test('a player saved before a counter existed is recorded with nothing for it', () => {
  const extras = statsExtras({ wordsDrawn: 3 });
  assert.equal(extras.wordsDrawn, 3);
  for (const key of STAT_KEYS.filter((k) => k !== 'wordsDrawn')) assert.equal(extras[key], 0, key);
  assert.equal(extras.cleanSweep, 0);
});

test('a scored turn counts the word for the drawer, the turn for every guesser, and the word for those who found it', () => {
  const drawer = player();
  const first = player({ lastScore: 240 });
  const second = player({ lastScore: 150 });
  const never = player({ lastScore: 0 });
  tallyTurn({ drawer, guessed: [first, second], guessing: [first, second, never], reason: 'timeUp', average: 130 });

  assert.equal(drawer.wordsDrawn, 1);
  assert.equal(drawer.bestTurn, 130, 'what the drawer scored is their turn');
  assert.equal(drawer.nobodyGot, 0);
  assert.equal(drawer.everyoneGot, 0, 'one of them never got it');
  assert.equal(drawer.turnsGuessing, 0, 'the drawer was not guessing');

  assert.deepEqual([first.wordsGuessed, first.firstGuesses, first.turnsGuessing, first.bestTurn], [1, 1, 1, 240]);
  assert.deepEqual([second.wordsGuessed, second.firstGuesses, second.turnsGuessing, second.bestTurn], [1, 0, 1, 150], 'only the first to find it was first');
  assert.deepEqual([never.wordsGuessed, never.firstGuesses, never.turnsGuessing, never.bestTurn], [0, 0, 1, 0], 'a turn spent guessing counts whether or not the word was found');
});

test('a drawing nobody guessed, one everybody guessed, and one the whole table applauded are each counted for the drawer', () => {
  const drawer = player();
  const a = player();
  const b = player();
  tallyTurn({ drawer, guessed: [], guessing: [a, b], reason: 'timeUp', average: 0 });
  assert.deepEqual([drawer.wordsDrawn, drawer.nobodyGot, drawer.everyoneGot, drawer.ovations], [1, 1, 0, 0]);
  tallyTurn({ drawer, guessed: [a, b], guessing: [a, b], reason: 'allGuessed', average: 200, everyone: true });
  assert.deepEqual([drawer.wordsDrawn, drawer.nobodyGot, drawer.everyoneGot, drawer.ovations], [2, 1, 1, 0]);
  tallyTurn({ drawer, guessed: [a], guessing: [a, b], reason: 'timeUp', average: 90, ovation: true });
  assert.deepEqual([drawer.wordsDrawn, drawer.nobodyGot, drawer.everyoneGot, drawer.ovations], [3, 1, 1, 1]);
  assert.equal(drawer.bestTurn, 200, 'the best single turn is the best of them, not the last');
});

test('a turn nobody could draw counts for nobody', () => {
  const drawer = player();
  const guesser = player({ lastScore: 200 });
  tallyTurn({ drawer, guessed: [guesser], guessing: [guesser], reason: 'drawerAway', average: 100, everyone: true, ovation: true });
  assert.deepEqual(statsExtras(drawer), statsExtras(player()));
  assert.deepEqual(statsExtras(guesser), statsExtras(player()));
});

test('a turn whose drawer has left still counts for the people who were guessing', () => {
  const guesser = player({ lastScore: 180 });
  assert.doesNotThrow(() => tallyTurn({ drawer: null, guessed: [guesser], guessing: [guesser], reason: 'timeUp', average: 0 }));
  assert.deepEqual([guesser.wordsGuessed, guesser.firstGuesses, guesser.turnsGuessing], [1, 1, 1]);
});

test('guesses, words added, and rude words chosen each have their own counter', () => {
  const p = player();
  tallyGuess(p);
  tallyGuess(p);
  tallyWord(p, 'added');
  tallyWord(p, 'juvenile');
  tallyWord(p, 'juvenile');
  assert.deepEqual([p.guesses, p.wordsAdded, p.juvenilePicks], [2, 1, 2]);
});

test('finding the word on every turn you spent guessing is a clean sweep, and missing one is not', () => {
  assert.equal(statsExtras(player({ turnsGuessing: 4, wordsGuessed: 4 })).cleanSweep, 1);
  assert.equal(statsExtras(player({ turnsGuessing: 4, wordsGuessed: 3 })).cleanSweep, 0);
  assert.equal(statsExtras(player({ turnsGuessing: 0, wordsGuessed: 0 })).cleanSweep, 0);
});

/**
 * Plays a whole seeded game through the rules with a table of people (and sometimes computer players), keeping a
 * separate book of what each person did, and returns both.
 */
function playedGame(seed) {
  const rng = seeded(seed);
  let now = 1_000_000;
  const size = 2 + Math.floor(rng() * 4);
  const rounds = 1 + Math.floor(rng() * 2);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Player 1', settings: { rounds, drawTime: 30 }, now, chooseMs: 1000, betweenMs: 500 });
  for (let id = 2; id <= size; id++) assert.equal(game.addHuman(room, id, `Player ${id}`).ok, true);
  if (rng() < 0.4) assert.equal(game.addBot(room, 1).ok, true);
  assert.equal(game.start(room, 1, rng, now).ok, true);

  const people = room.players.filter(game.isHuman).map((p) => p.id);
  const book = new Map(people.map((id) => [id, { wordsDrawn: 0, wordsGuessed: 0, firstGuesses: 0, guesses: 0, turnsGuessing: 0, nobodyGot: 0, everyoneGot: 0, ovations: 0, bestTurn: 0 }]));
  const scoreOf = (id) => room.players.find((p) => p.id === id).score;

  for (let turn = 0; turn < 200 && room.phase !== 'finished'; turn++) {
    const label = `seed ${seed}, turn ${turn}`;
    // The word: chosen by the drawer, or by a computer player for itself.
    if (game.pendingBotAction(room)) assert.equal(game.runBotAction(room, rng, now), true, label);
    else assert.equal(game.chooseWord(room, room.drawer, Math.floor(rng() * room.choices.length), now).ok, true, label);
    const drawer = room.drawer;
    const guessing = people.filter((id) => id !== drawer);
    const before = new Map(people.map((id) => [id, scoreOf(id)]));
    const found = []; // everybody who found the word, people and computer players, in the order they found it
    const thumbsUp = new Set();

    // The drawing: people guess wrong and right in a random order, press thumbs, and a computer player has its goes.
    const moves = 3 + Math.floor(rng() * 8);
    for (let move = 0; move < moves && room.phase === 'drawing'; move++) {
      now += 700; // five guesses in three seconds is too fast; one every 700 ms from a table of several never is
      const waiting = guessing.filter((id) => !found.includes(id));
      const roll = rng();
      if (roll < 0.15 && game.pendingBotAction(room)) {
        const bot = game.pendingBotAction(room).id;
        assert.equal(game.runBotAction(room, rng, now), true, label);
        if (room.guessed.some((g) => g.id === bot)) found.push(bot);
      } else if (roll < 0.35 && guessing.length) {
        const who = pick(rng, guessing);
        const direction = pick(rng, ['up', 'up', 'down']);
        const outcome = game.vote(room, who, direction, now);
        assert.equal(outcome.ok, true, `${label}: ${outcome.error}`);
        if (outcome.vote === 'up') thumbsUp.add(who);
        else thumbsUp.delete(who);
      } else if (waiting.length) {
        const who = pick(rng, waiting);
        const right = rng() < 0.45;
        const outcome = game.guess(room, who, right ? room.word : pick(rng, ['nonsense', `${room.word}s`, 'a cat?']), now);
        assert.equal(outcome.ok, true, `${label}: ${outcome.error}`);
        book.get(who).guesses++;
        if (right) found.push(who);
      }
    }
    if (room.phase === 'drawing') {
      now = Math.max(now, room.deadline);
      assert.equal(game.timeUp(room, rng, now).ok, true, label);
    }
    assert.equal(room.phase, 'between', label);

    // The turn is over: write it up in the book.
    if (book.has(drawer)) {
      const mine = book.get(drawer);
      mine.wordsDrawn++;
      if (!found.length) mine.nobodyGot++;
      if (guessing.length && guessing.every((id) => found.includes(id))) mine.everyoneGot++;
      if (guessing.length > 1 && guessing.every((id) => thumbsUp.has(id))) mine.ovations++;
    }
    for (const id of guessing) {
      const mine = book.get(id);
      mine.turnsGuessing++;
      if (found.includes(id)) mine.wordsGuessed++;
      if (found[0] === id) mine.firstGuesses++;
    }
    for (const id of people) book.get(id).bestTurn = Math.max(book.get(id).bestTurn, scoreOf(id) - before.get(id));

    now = Math.max(now, room.deadline);
    assert.equal(game.timeUp(room, rng, now).ok, true, label);
    if (room.phase === 'scores') for (const id of people) if (room.phase === 'scores') assert.equal(game.ready(room, id, rng, now).ok, true, label);
  }
  assert.equal(room.phase, 'finished', `seed ${seed}: the game finishes`);
  return { room, book, people };
}

test('whole games record for each person exactly what they drew, guessed, and were first to, and nothing for a computer player', () => {
  const seen = { ovations: 0, everyoneGot: 0, nobodyGot: 0, cleanSweep: 0 };
  for (let seed = 1; seed <= 150; seed++) {
    const { room, book, people } = playedGame(seed);
    const rows = game.statsPlayers(room);
    assert.deepEqual(rows.map((row) => row.userId).sort(), [...people].sort(), `seed ${seed}: one row a person, none for a computer player`);
    for (const row of rows) {
      const mine = book.get(row.userId);
      const who = `seed ${seed}, player ${row.userId}`;
      for (const [key, value] of Object.entries(mine)) assert.equal(row.extras[key], value, `${who}: ${key}`);
      assert.equal(row.extras.cleanSweep, mine.turnsGuessing > 0 && mine.wordsGuessed === mine.turnsGuessing ? 1 : 0, `${who}: cleanSweep`);
      assert.equal(row.extras.wordsAdded, 0, `${who}: nobody added a word`);
      assert.equal(row.score, room.players.find((p) => p.id === row.userId).score, `${who}: their score`);
      seen.ovations += mine.ovations;
      seen.everyoneGot += mine.everyoneGot;
      seen.nobodyGot += mine.nobodyGot;
      seen.cleanSweep += row.extras.cleanSweep;
    }
    // Everybody draws once a round, so the words drawn by the people are their share of the turns.
    for (const id of people) assert.equal(book.get(id).wordsDrawn, room.rounds, `seed ${seed}: ${id} drew once a round`);
  }
  // The games were varied enough to have reached every counter that depends on how a turn went.
  for (const [key, count] of Object.entries(seen)) assert.ok(count > 0, `no game had a turn that counted towards ${key}`);
});
