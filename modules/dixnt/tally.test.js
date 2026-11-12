import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_SPYMASTER_TURNS, MIN_UNACCUSED_IMPOSTER_TURNS, MIN_UNACCUSED_PLAYERS, newCounters, statsExtras, tallyTurn } from './tally.js';

const IDS = ['ann', 'bob', 'cat', 'dan', 'eve'];

function table() {
  const tallies = Object.fromEntries(IDS.map((id) => [id, newCounters()]));
  return { tallies, counterOf: (id) => tallies[id] ?? null }; // anybody else is a computer player
}

const everyone = (imposterId, votes, groupCorrect) => ({ judging: 'everyone', imposterId, groupCorrect, votes });
// A round as tallyTurn takes it: every vote comes as a [voter, target] pair, because a table keyed by player id has
// text keys while a person's id is a number.
const round = (pickers, results) => ({ pickers, votes: Object.entries(results.votes ?? {}), results });

test('a round counts the cards, the imposter, who fooled the group and who voted right', () => {
  const { tallies, counterOf } = table();
  tallyTurn(counterOf, round(['ann', 'bob', 'cat'], everyone('bob', { ann: 'bob', cat: 'ann', dan: 'bob', bob: 'ann' }, true)));
  assert.equal(tallies.ann.cardsPlayed, 1);
  assert.deepEqual([tallies.bob.roundsAsImposter, tallies.bob.timesFooledGroup], [1, 0]);
  assert.deepEqual([tallies.ann.correctGuesses, tallies.dan.correctGuesses, tallies.cat.correctGuesses], [1, 1, 0]);
  assert.equal(tallies.bob.votesCast, 0, 'the imposter does not guess');
  assert.equal(tallies.cat.votesCast, 1);
  assert.equal(tallies.dan.soleCorrect, 0, 'the group found them');
});

test('being the only one to vote for an imposter nobody found counts, but not when two did or when they were found', () => {
  const { tallies, counterOf } = table();
  tallyTurn(counterOf, round([], everyone('bob', { ann: 'bob', cat: 'dan', dan: 'cat', eve: 'cat' }, false)));
  assert.equal(tallies.ann.soleCorrect, 1);
  assert.equal(tallies.bob.timesFooledGroup, 1);
  tallyTurn(counterOf, round([], everyone('bob', { ann: 'bob', cat: 'bob', dan: 'cat', eve: 'cat' }, false)));
  assert.equal(tallies.ann.soleCorrect, 1, 'two people spotted them');
  assert.equal(tallies.cat.soleCorrect, 0);
  tallyTurn(counterOf, round([], { judging: 'chooser', imposterId: 'bob', groupCorrect: false, votes: { ann: 'cat' } }));
  tallyTurn(counterOf, round([], { judging: 'chooser', imposterId: 'bob', groupCorrect: true, votes: { ann: 'bob' } }));
  assert.equal(tallies.ann.soleCorrect, 1, 'only in the style where everybody votes');
});

test('the card picked as the favourite is counted, and computer players are left out', () => {
  const { tallies, counterOf } = table();
  tallyTurn(counterOf, round(['ann', 'robot'], { judging: 'favourite', imposterId: null, winnerId: 'robot' }));
  tallyTurn(counterOf, round(['ann', 'bob'], { judging: 'favourite', imposterId: null, winnerId: 'bob' }));
  assert.equal(tallies.bob.favouritePicks, 1);
  assert.equal(tallies.ann.cardsPlayed, 2);
});

test('the Spymaster needs every vote right over enough rounds, and the most fooled in a game is recorded', () => {
  const { tallies, counterOf } = table();
  for (let n = 0; n < MIN_SPYMASTER_TURNS; n++) tallyTurn(counterOf, round([], everyone('bob', { ann: 'bob', cat: 'bob' }, true)));
  assert.equal(statsExtras(tallies.ann).spymaster, 1);
  tallyTurn(counterOf, round([], everyone('bob', { ann: 'cat', cat: 'bob' }, true)));
  assert.equal(statsExtras(tallies.ann).spymaster, 0, 'one wrong vote');
  assert.equal(statsExtras(tallies.cat).spymaster, 1);
  const short = table();
  tallyTurn(short.counterOf, round([], everyone('bob', { ann: 'bob' }, true)));
  assert.equal(statsExtras(short.tallies.ann).spymaster, 0, 'too few rounds to mean anything');
  for (let i = 0; i < 5; i++) tallyTurn(short.counterOf, round([], everyone('bob', { ann: 'cat' }, false)));
  assert.equal(statsExtras(short.tallies.bob).mostFooled, 5);
  assert.deepEqual(Object.keys(statsExtras(newCounters())).sort(), ['cardsPlayed', 'correctGuesses', 'favouritePicks', 'loneDissent', 'mostFooled', 'neverAccused', 'roundsAsImposter', 'scorelessGames', 'soleCorrect', 'spymaster', 'timesFooledGroup']);
});

test('standing alone against the card the group settled on, and never against your own', () => {
  const { tallies, counterOf } = table();
  // ann, dan and eve point at bob; cat alone points elsewhere.  bob cannot vote for himself, so his vote is not dissent.
  tallyTurn(counterOf, round(['ann', 'bob', 'cat'], everyone('ann', { ann: 'bob', dan: 'bob', eve: 'bob', cat: 'dan', bob: 'cat' }, false)));
  assert.equal(tallies.cat.loneDissent, 1, 'cat alone stood against the group');
  assert.equal(tallies.bob.loneDissent, 0, 'being the accused is not dissent: nobody may vote for their own card');
  assert.equal(tallies.ann.loneDissent, 0);
});

test('a lone dissenter needs a real crowd to stand against, and a tie leaves nothing to stand against', () => {
  const small = table();
  // Only ann agrees, so there is no crowd: bob's vote is the accused's own and cat's is the lone one.
  tallyTurn(small.counterOf, round([], everyone('ann', { ann: 'bob', cat: 'dan', bob: 'cat' }, false)));
  assert.equal(small.tallies.cat.loneDissent, 0, 'one voter agreeing is not a group');
  const tied = table();
  tallyTurn(tied.counterOf, round([], everyone('ann', { ann: 'cat', dan: 'cat', eve: 'bob', bob: 'bob' }, false)));
  assert.equal(tied.tallies.eve.loneDissent, 0, 'a tie for the most votes settles on no card at all');
  const many = table();
  tallyTurn(many.counterOf, round([], everyone('ann', { ann: 'cat', dan: 'cat', eve: 'bob' }, false)));
  assert.equal(many.tallies.eve.loneDissent, 1, 'two agreeing is a crowd enough');
});

test('above suspicion: no vote all game, over enough rounds as the imposter and enough players', () => {
  const { tallies, counterOf } = table();
  const game = { players: MIN_UNACCUSED_PLAYERS, score: 3 };
  for (let i = 0; i < MIN_UNACCUSED_IMPOSTER_TURNS; i++) {
    tallyTurn(counterOf, round(['ann', 'bob'], everyone('ann', { bob: 'cat', cat: 'bob', ann: 'bob' }, false)));
  }
  assert.equal(statsExtras(tallies.ann, game).neverAccused, 1, 'the imposter twice, and nobody ever pointed at her');
  assert.equal(statsExtras(tallies.bob, game).neverAccused, 0, 'bob was voted for, and was never the imposter');
  assert.equal(statsExtras(tallies.ann, { ...game, players: MIN_UNACCUSED_PLAYERS - 1 }).neverAccused, 0, 'too few players');
  const once = table();
  tallyTurn(once.counterOf, round(['ann'], everyone('ann', { bob: 'cat', cat: 'bob' }, false)));
  assert.equal(statsExtras(once.tallies.ann, game).neverAccused, 0, 'the imposter only once');
});

test('nul points: finishing on nothing, having actually played', () => {
  const { tallies, counterOf } = table();
  tallyTurn(counterOf, round(['ann'], everyone('bob', { ann: 'bob', cat: 'bob' }, true)));
  assert.equal(statsExtras(tallies.ann, { players: 3, score: 0 }).scorelessGames, 1);
  assert.equal(statsExtras(tallies.ann, { players: 3, score: 1 }).scorelessGames, 0);
  assert.equal(statsExtras(tallies.cat, { players: 3, score: 0 }).scorelessGames, 0, 'cat never played a card');
  assert.equal(statsExtras(tallies.ann).scorelessGames, 0, 'no score given, nothing claimed');
});
