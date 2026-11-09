// Every view of whole seeded games (../views.js), checked twice over: that a seed always sends the same views, and
// that no view ever tells a player something they are not allowed to know - the word, the words the drawer is
// choosing between, or what the people who already have the word are saying to each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedViews } from './views.js';
import { assertNoLeaks } from '../../shared/leaks.js';

const GAMES = [
  ['a four-player game of two rounds', 101, 4, 2, 0],
  ['a game for two', 102, 2, 1, 0],
  ['a six-player game', 103, 6, 2, 0],
  ['two people and two computer players', 104, 2, 2, 2],
];

for (const [label, seed, size, rounds, bots] of GAMES) {
  test(`${label} sends the same views every time`, () => {
    const first = recordedViews(seed, size, rounds, bots);
    const again = recordedViews(seed, size, rounds, bots);
    assert.equal(first.finished, true, 'the game ran to its end');
    assert.ok(first.views.length > 20);
    assert.deepEqual(again.views, first.views);
  });

  test(`${label} never shows anybody what they may not know`, () => {
    const { views } = recordedViews(seed, size, rounds, bots);
    const phases = new Set();
    for (const json of views) {
      const view = JSON.parse(json);
      phases.add(view.phase);
      const me = view.players.find((p) => p.id === view.you) ?? null;
      const guessing = view.phase === 'drawing' && me && !view.youDraw && !view.youGuessed;

      if (guessing) {
        assert.equal(view.word, null, 'a guesser saw the word');
        assert.ok(
          view.hints.some((hint) => hint.ch === null),
          'a guesser saw every letter',
        );
        assert.equal(view.feed.filter((line) => line.kind === 'chat').length, 0, 'a guesser saw the talk of the people who know the word');
      }
      if (view.phase === 'drawing' && (view.youDraw || view.youGuessed)) assert.ok(view.word, 'somebody who knows the word was not shown it');
      if (['between', 'scores', 'finished'].includes(view.phase)) {
        assert.ok(
          view.hints.every((hint) => hint.ch !== null),
          'the word is shown once the turn is over',
        );
      }
      // The words on offer are the drawer's business only.
      if (view.choices.length) {
        assert.equal(view.phase, 'choosing');
        assert.equal(view.youDraw, true);
      }
      // A right guess is never shown as text, and only its writer is told a guess was close.
      for (const line of view.feed) {
        if (line.kind === 'correct') assert.equal(line.text, '');
        if (line.kind === 'close') assert.equal(line.id, view.you);
      }
      // Whatever happens, a view is well formed.
      assert.ok(['lobby', 'choosing', 'drawing', 'between', 'scores', 'finished'].includes(view.phase), view.phase);
      assert.equal(view.players.length, size + bots);
      assert.equal(new Set(view.players.map((p) => p.id)).size, size + bots, 'no player twice');
      assert.equal(view.scoreboard.players.length, size + bots);
      for (const player of view.players) {
        if (!player.bot) assert.equal(player.ai, null, 'a person has no AI');
        else if (view.phase !== 'lobby') assert.deepEqual(Object.keys(player.ai).sort(), ['description', 'id', 'name'], 'a computer player shows only its AI name');
      }
      assert.ok(view.round >= 0 && view.round <= rounds);
      assert.ok(view.remaining === null || view.remaining >= 0);
      assert.ok(view.feed.length <= 60, 'the panel keeps only the recent lines');
    }
    // Everything above checks a field this test knows the name of.  This last pass is the backstop for the fields it
    // does not: take each turn's word from the views of the people allowed to know it, then make sure that word is
    // nowhere at all in the views of the people who are not.  The hints never spell it out (they are one letter to an
    // entry, so the word is never contiguous) and a right guess is sent without its text, so anything that matches
    // here is a genuine leak through some field that was added without this test being told.
    const wordOfTurn = new Map();
    for (const json of views) {
      const view = JSON.parse(json);
      if (view.word) wordOfTurn.set(`${view.round}:${view.turn}`, view.word);
    }
    for (const json of views) {
      const view = JSON.parse(json);
      const secret = wordOfTurn.get(`${view.round}:${view.turn}`);
      // The drawer is skipped: while they are choosing, `word` is still null because nothing is chosen yet, but the
      // words on offer are theirs to see and one of them is about to become the word.
      if (view.word !== null || view.youDraw || !secret) continue;
      assertNoLeaks(view, {
        forbidden: [{ text: secret, why: `the word "${secret}" reached somebody who may not know it` }],
        who: `player ${view.you} in ${view.phase}`,
      });
    }

    // A one-round game never shows the scores between rounds: it finishes instead.
    const expected = ['between', 'choosing', 'drawing', 'finished', 'lobby', ...(rounds > 1 ? ['scores'] : [])];
    assert.deepEqual([...phases].sort(), expected, 'every phase was played through');
  });
}

test('an outsider is sent a view they can draw, with no word in it', () => {
  const { views } = recordedViews(101, 4, 2);
  const outsiders = views.map((json) => JSON.parse(json)).filter((view) => !view.players.some((p) => p.id === view.you));
  assert.ok(outsiders.length > 10);
  for (const view of outsiders) {
    assert.equal(view.youDraw, false);
    assert.equal(view.youGuessed, false);
    assert.deepEqual(view.choices, []);
    if (view.phase === 'drawing') assert.equal(view.word, null);
  }
});

test('the scoreboard says who the game is waiting for', () => {
  const { views } = recordedViews(103, 6, 2);
  for (const json of views) {
    const view = JSON.parse(json);
    const current = view.scoreboard.players.filter((p) => p.current).map((p) => p.id);
    if (view.phase === 'choosing') assert.deepEqual(current, [view.drawer], 'the drawer is choosing');
    if (view.phase === 'drawing') assert.ok(current.includes(view.drawer), 'the drawer is still drawing');
    if (['lobby', 'between', 'scores', 'finished'].includes(view.phase)) assert.deepEqual(current, [], 'nobody is being waited for');
  }
});
