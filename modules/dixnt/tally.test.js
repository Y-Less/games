import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_SPYMASTER_ROUNDS, newTally, statsExtras, tallyRound } from './tally.js';

const IDS = ['ann', 'bob', 'cat', 'dan', 'eve'];

function table() {
  const tallies = Object.fromEntries(IDS.map((id) => [id, newTally()]));
  return { tallies, tallyFor: (id) => tallies[id] ?? null }; // anybody else is a computer player
}

const everyone = (imposterId, votes, groupCorrect) => ({ judging: 'everyone', imposterId, groupCorrect, votes });

test('a round counts the cards, the imposter, who fooled the group and who voted right', () => {
  const { tallies, tallyFor } = table();
  tallyRound(tallyFor, { pickers: ['ann', 'bob', 'cat'], results: everyone('bob', { ann: 'bob', cat: 'ann', dan: 'bob', bob: 'ann' }, true) });
  assert.equal(tallies.ann.cardsPlayed, 1);
  assert.deepEqual([tallies.bob.roundsAsImposter, tallies.bob.timesFooledGroup], [1, 0]);
  assert.deepEqual([tallies.ann.correctGuesses, tallies.dan.correctGuesses, tallies.cat.correctGuesses], [1, 1, 0]);
  assert.equal(tallies.bob.votesCast, 0, 'the imposter does not guess');
  assert.equal(tallies.cat.votesCast, 1);
  assert.equal(tallies.dan.soleCorrect, 0, 'the group found them');
});

test('being the only one to vote for an imposter nobody found counts, but not when two did or when they were found', () => {
  const { tallies, tallyFor } = table();
  tallyRound(tallyFor, { pickers: [], results: everyone('bob', { ann: 'bob', cat: 'dan', dan: 'cat', eve: 'cat' }, false) });
  assert.equal(tallies.ann.soleCorrect, 1);
  assert.equal(tallies.bob.timesFooledGroup, 1);
  tallyRound(tallyFor, { pickers: [], results: everyone('bob', { ann: 'bob', cat: 'bob', dan: 'cat', eve: 'cat' }, false) });
  assert.equal(tallies.ann.soleCorrect, 1, 'two people spotted them');
  assert.equal(tallies.cat.soleCorrect, 0);
  tallyRound(tallyFor, { pickers: [], results: { judging: 'chooser', imposterId: 'bob', groupCorrect: false, votes: { ann: 'cat' } } });
  tallyRound(tallyFor, { pickers: [], results: { judging: 'chooser', imposterId: 'bob', groupCorrect: true, votes: { ann: 'bob' } } });
  assert.equal(tallies.ann.soleCorrect, 1, 'only in the style where everybody votes');
});

test('the card picked as the favourite is counted, and computer players are left out', () => {
  const { tallies, tallyFor } = table();
  tallyRound(tallyFor, { pickers: ['ann', 'robot'], results: { judging: 'favourite', imposterId: null, winnerId: 'robot' } });
  tallyRound(tallyFor, { pickers: ['ann', 'bob'], results: { judging: 'favourite', imposterId: null, winnerId: 'bob' } });
  assert.equal(tallies.bob.favouritePicks, 1);
  assert.equal(tallies.ann.cardsPlayed, 2);
});

test('the Spymaster needs every vote right over enough rounds, and the most fooled in a game is recorded', () => {
  const { tallies, tallyFor } = table();
  for (let round = 0; round < MIN_SPYMASTER_ROUNDS; round++) tallyRound(tallyFor, { pickers: [], results: everyone('bob', { ann: 'bob', cat: 'bob' }, true) });
  assert.equal(statsExtras(tallies.ann).spymaster, 1);
  tallyRound(tallyFor, { pickers: [], results: everyone('bob', { ann: 'cat', cat: 'bob' }, true) });
  assert.equal(statsExtras(tallies.ann).spymaster, 0, 'one wrong vote');
  assert.equal(statsExtras(tallies.cat).spymaster, 1);
  const short = table();
  tallyRound(short.tallyFor, { pickers: [], results: everyone('bob', { ann: 'bob' }, true) });
  assert.equal(statsExtras(short.tallies.ann).spymaster, 0, 'too few rounds to mean anything');
  for (let i = 0; i < 5; i++) tallyRound(short.tallyFor, { pickers: [], results: everyone('bob', { ann: 'cat' }, false) });
  assert.equal(statsExtras(short.tallies.bob).mostFooled, 5);
  assert.deepEqual(Object.keys(statsExtras(newTally())).sort(), ['cardsPlayed', 'correctGuesses', 'favouritePicks', 'mostFooled', 'roundsAsImposter', 'soleCorrect', 'spymaster', 'timesFooledGroup']);
});
