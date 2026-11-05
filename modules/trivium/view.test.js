// What viewFor sends (see game.js) to each person and to a stranger along whole seeded games with computer players:
// the same views every time for a seed, a scoreboard that lists everybody and marks only those the game is waiting
// for, a fixed set of parts, and never a word about the right answer before it has been given.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { recordedViews } from './views.js';

const WAITING_PHASES = ['question'];

for (const [label, args] of [
  ['three-player game', [31, 3, 2, 2]],
  ['bigger, longer game', [32, 6, 2, 3]],
]) {
  test(`the views of a ${label} are the same every time for a seed, and say whom the game waits for`, () => {
    const first = recordedViews(...args);
    assert.equal(first.finished, true);
    assert.deepEqual(recordedViews(...args).views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 30, 'the game was long enough to look at');
    for (const text of first.views) {
      const view = JSON.parse(text);
      if (view === null || view.you === undefined) continue;
      assert.equal(view.scoreboard.players.length, view.players.length, 'every player is on the scoreboard');
      const current = view.scoreboard.players.filter((p) => p.current);
      if (!WAITING_PHASES.includes(view.phase)) assert.deepEqual(current, [], `nobody is to act in ${view.phase}`);
      else assert.ok(current.length >= 1, 'somebody is to act while a question is up');
      assert.ok(['lobby', 'spin', 'question', 'reveal', 'finished', 'abandoned'].includes(view.phase), `phase ${view.phase}`);
    }
  });
}

test('a view never gives the answer away before the question has closed', () => {
  const { views } = recordedViews(33, 4, 2, 3);
  for (const text of views) {
    const view = JSON.parse(text);
    if (!view || view.you === undefined) continue;
    if (['reveal', 'finished', 'abandoned'].includes(view.phase)) continue;
    assert.equal(view.correct, null, `the answer was shown in ${view.phase}`);
    assert.equal(view.result, null, `the answers were shown in ${view.phase}`);
    assert.ok(!text.includes('"plan"'), 'a computer player kept its intentions to itself');
    assert.ok(!text.includes('"deck"'), 'the rest of the round was kept back');
  }
});

test('a marker colour is unique, and the wheel is the same for everybody', () => {
  const { views } = recordedViews(34, 5, 1, 2);
  for (const text of views) {
    const view = JSON.parse(text);
    if (!view || view.you === undefined) continue;
    const colours = view.players.map((p) => p.colour);
    assert.equal(new Set(colours).size, colours.length, 'no two players share a colour');
    assert.ok(view.wheel.length >= 1);
    assert.ok(view.wheel.every((slice) => typeof slice.category === 'string' && slice.weight > 0));
  }
});

test('a countdown is always within what it was given', () => {
  const { views } = recordedViews(35, 3, 1, 3);
  for (const text of views) {
    const view = JSON.parse(text);
    if (!view || view.you === undefined) continue;
    if (view.phase === 'question') assert.ok(view.remaining >= 0 && view.remaining <= 1000, `remaining ${view.remaining}`);
    else assert.equal(view.remaining, null);
    if (view.phase === 'spin') assert.ok(view.spinLeft >= 0 && view.spinLeft <= 100, `spinLeft ${view.spinLeft}`);
    else assert.equal(view.spinLeft, null);
    if (view.phase === 'reveal') assert.ok(view.reveal.since >= 0 && view.reveal.step > 0);
    else assert.equal(view.reveal, null);
  }
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), [
    'code',
    'phase',
    'you',
    'hostId',
    'rounds',
    'perRound',
    'round',
    'ask',
    'wheel',
    'spin',
    'spinLeft',
    'question',
    'correct',
    'mine',
    'result',
    'reveal',
    'remaining',
    'version',
    'players',
    'scoreboard',
    'colours',
    'canCustomColour',
    'limits',
  ]);
});
