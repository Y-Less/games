// The counters GTK keeps about each player (tally.js): what a scored question and a finished round add, and what is
// recorded at the end of a game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_SHARP_PICKS, newCounters, statsExtras, tallyQuestion, tallyRound } from './tally.js';

const player = () => newCounters();

test('a fresh player starts at zero', () => {
  assert.deepEqual(Object.values(player()).filter((n) => n !== 0), []);
});

test('a scored question counts the answers written, the right picks, and the people fooled', () => {
  const subject = player();
  const sharp = player();
  const fooled = player();
  const liar = player();
  tallyQuestion({
    subject,
    picks: [
      { player: sharp, right: true },
      { player: fooled, right: false },
      { player: liar, right: true },
      { player: null, right: true }, // somebody who has left
    ],
    fakes: [
      { player: sharp, fooled: 0, matched: false },
      { player: fooled, fooled: 0, matched: false },
      { player: liar, fooled: 1, matched: false },
    ],
  });
  assert.equal(subject.answersWritten, 1);
  assert.equal(subject.picksMade, 0, 'the subject does not pick in their own round');
  assert.equal(sharp.rightAnswers, 1);
  assert.equal(sharp.picksMade, 1);
  assert.equal(fooled.rightAnswers, 0);
  assert.equal(liar.peopleFooled, 1);
  assert.equal(liar.answersWritten, 1);
  assert.equal(liar.cleanSweeps, 0, 'one of four is not a clean sweep');
});

test('an answer everybody falls for is a clean sweep, and one that happens to be true is counted as such', () => {
  const sweeper = player();
  const twin = player();
  tallyQuestion({
    subject: null,
    picks: [{ player: null, right: false }, { player: twin, right: false }],
    fakes: [
      { player: sweeper, fooled: 2, matched: false },
      { player: twin, fooled: 0, matched: true },
    ],
  });
  assert.equal(sweeper.cleanSweeps, 1);
  assert.equal(sweeper.peopleFooled, 2);
  assert.equal(twin.matchedTruth, 1);
  assert.equal(twin.cleanSweeps, 0);
});

test('a single picker taken in is not a clean sweep', () => {
  const liar = player();
  tallyQuestion({ subject: null, picks: [{ player: null, right: false }], fakes: [{ player: liar, fooled: 1, matched: false }] });
  assert.equal(liar.cleanSweeps, 0, 'fooling the only other player is not a sweep');
  assert.equal(liar.peopleFooled, 1);
});

test('being named as the true answer is counted, and only for those named', () => {
  const named = player();
  const bystander = player();
  tallyQuestion({ subject: null, picks: [{ player: bystander, right: true }], fakes: [], named: [named, null] });
  assert.equal(named.namedAsTruth, 1);
  assert.equal(bystander.namedAsTruth, 0);
  tallyQuestion({ subject: null, picks: [], fakes: [] });
  assert.equal(named.namedAsTruth, 1, 'a question that named nobody leaves it alone');
});

test('a finished round counts the subject and whoever got every question of it right', () => {
  const subject = player();
  const perfect = player();
  const partial = player();
  tallyRound({
    subject,
    pickers: [
      { player: perfect, rights: 2, asked: 2 },
      { player: partial, rights: 1, asked: 2 },
      { player: null, rights: 2, asked: 2 },
      { player: player(), rights: 0, asked: 0 },
    ],
  });
  assert.equal(subject.roundsAsSubject, 1);
  assert.equal(perfect.perfectRounds, 1);
  assert.equal(partial.perfectRounds, 0);
});

test('what is recorded at the end of a game, and when "never fooled" counts', () => {
  const sharp = { ...player(), rightAnswers: MIN_SHARP_PICKS, picksMade: MIN_SHARP_PICKS, peopleFooled: 3, answersWritten: 8, matchedTruth: 1, namedAsTruth: 1, nobodyFoundMe: 2, cleanSweeps: 1, perfectRounds: 2 };
  assert.deepEqual(statsExtras(sharp), { rightAnswers: 4, peopleFooled: 3, answersWritten: 8, matchedTruth: 1, namedAsTruth: 1, nobodyFoundMe: 2, cleanSweeps: 1, perfectRounds: 2, neverFooled: 1 });
  assert.equal(statsExtras({ ...sharp, rightAnswers: MIN_SHARP_PICKS - 1 }).neverFooled, 0, 'one miss is enough to lose it');
  assert.equal(statsExtras({ ...player(), rightAnswers: 2, picksMade: 2 }).neverFooled, 0, 'a short game does not count');
  assert.deepEqual(statsExtras({}), { rightAnswers: 0, peopleFooled: 0, answersWritten: 0, matchedTruth: 0, namedAsTruth: 0, nobodyFoundMe: 0, cleanSweeps: 0, perfectRounds: 0, neverFooled: 0 }, 'a room saved before a counter existed reads as zero');
});
