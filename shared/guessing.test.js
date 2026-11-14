// What the games where people guess at a drawing share (shared/guessing.js), and the scheduler their servers pick
// the next clock with (shared/roomServer.js `soonest`).  Asserted against what each one's comment promises.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALWAYS_SHOWN, FEED_LENGTH, GUESS_LENGTH, TALK_BURST, TALK_WINDOW_MS, addFeed, botGuessText, botWordChoice, cleanGuess, nextGuesser, tooFast } from './guessing.js';
import { seeded } from './random.js';
import { soonest } from './roomServer.js';

test('a guess is tidied: one space between words, no ends, and no longer than a guess may be', () => {
  assert.equal(cleanGuess('  ice \t  cream \n'), 'ice cream');
  assert.equal(cleanGuess('x'.repeat(GUESS_LENGTH + 5)).length, GUESS_LENGTH);
  assert.equal(cleanGuess('   '), '');
  for (const garbage of [null, undefined, {}, [], 7]) assert.equal(typeof cleanGuess(garbage), 'string', `${JSON.stringify(garbage)} does not throw`);
});

test('a player may type a burst and no more, until the window has passed', () => {
  const player = {};
  for (let i = 0; i < TALK_BURST; i++) assert.equal(tooFast(player, 1000 + i), false, `guess ${i + 1} of the burst`);
  assert.equal(tooFast(player, 1000 + TALK_BURST), true, 'one more than the burst');
  assert.equal(tooFast(player, 1000 + TALK_WINDOW_MS), false, 'the first of the burst has fallen out of the window');
});

test('each kind of thing is counted on its own', () => {
  const player = {};
  for (let i = 0; i < TALK_BURST; i++) tooFast(player, 1000);
  assert.equal(tooFast(player, 1000), true);
  assert.equal(tooFast(player, 1000, 'rated'), false, 'typing has not used up the thumbs');
});

test('the feed numbers its lines in order and keeps only the newest', () => {
  const room = { feed: [], nextFeed: 1 };
  for (let i = 0; i < FEED_LENGTH + 3; i++) addFeed(room, { kind: 'guess', text: `g${i}` });
  assert.equal(room.feed.length, FEED_LENGTH);
  assert.equal(room.feed[0].text, 'g3', 'the oldest three have gone');
  assert.deepEqual(room.feed.map((line) => line.n), Array.from({ length: FEED_LENGTH }, (unused, i) => i + 4), 'a number is never used twice');
});

test('the characters that are never hidden are the ones that are not letters', () => {
  for (const ch of ALWAYS_SHOWN) assert.equal(/[\p{L}\p{N}]/u.test(ch), false, JSON.stringify(ch));
  assert.ok(ALWAYS_SHOWN.includes(' ') && ALWAYS_SHOWN.includes('-'), 'ice-cream and ice cream both show their join');
});

test('the computer player with the fewest guesses goes next, and the first of those who are level', () => {
  const [a, b, c] = [{ id: 'a', tries: 2 }, { id: 'b', tries: 1 }, { id: 'c', tries: 1 }];
  assert.equal(nextGuesser([a, b, c]).id, 'b');
  assert.equal(nextGuesser([{ id: 'x' }, { id: 'y', tries: 0 }]).id, 'x', 'no guesses yet counts as none');
  assert.equal(nextGuesser([]), undefined);
});

test('an AI chooses its word, and one that throws or answers out of range is given a legal one', () => {
  assert.equal(botWordChoice({ chooseWord: () => 2 }, {}, 3, seeded(1)), 2);
  const broken = [
    () => {
      throw new Error('a broken AI');
    },
    () => 3,
    () => -1,
    () => 1.5,
    () => 'one',
    () => undefined,
  ];
  for (const chooseWord of broken) {
    const n = botWordChoice({ chooseWord }, {}, 3, seeded(1));
    assert.ok(Number.isInteger(n) && n >= 0 && n < 3, `${chooseWord} gave ${n}`);
  }
});

test('an AI that answers in range costs the random source nothing, so a seeded game does not shift', () => {
  let calls = 0;
  const rng = () => {
    calls++;
    return 0.5;
  };
  botWordChoice({ chooseWord: () => 0 }, {}, 3, rng);
  botGuessText({ guess: () => 'cat' }, { words: ['dog'] }, rng);
  assert.equal(calls, 0);
});

test('an AI guesses, and one that throws or says nothing guesses a word of the list', () => {
  const context = { words: ['cat', 'dog'] };
  assert.equal(botGuessText({ guess: () => '  house ' }, context, seeded(1)), 'house');
  const broken = [
    () => {
      throw new Error('a broken AI');
    },
    () => '   ',
    () => 7,
    () => null,
  ];
  for (const guess of broken) assert.ok(context.words.includes(botGuessText({ guess }, context, seeded(1))), `${guess}`);
  assert.equal(typeof botGuessText({ guess: () => null }, { words: [] }, seeded(1)), 'string', 'even an empty list gives something to type');
});

test('the server does whichever of its clocks is due first, and never waits less than nothing', () => {
  const run = () => {};
  const due = [
    { key: 'deadline', at: 5000, run },
    { key: 'hint', at: 2000, run },
    { key: 'bot', at: 2000, run },
  ];
  assert.deepEqual(soonest(due, 1500), { key: 'hint', wait: 500, run }, 'the earliest listed, when two fall due together');
  assert.equal(soonest(due, 9000).wait, 0, 'something already overdue is done now');
  assert.equal(soonest([], 1500), null);
});
