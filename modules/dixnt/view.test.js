// What Game.viewFor sends, for each seat and for a stranger, along whole seeded games with computer players: the same
// views every time for a seed, nothing for a stranger, and a fixed set of parts. (These used to pin a SHA-1 of every view,
// which also pinned every computer decision and every field, so a legitimate change broke them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from './game.js';

const cards = (n) => Array.from({ length: n }, (_, i) => i + 1);
function seededRng(seed = 1) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Does whatever the host would do next, using their own view; returns false if there is nothing to do. */
function hostActs(game, person) {
  const s = game.s;
  const view = game.viewFor(person.id);
  if (s.phase === 'results') game.nextRound(person.id);
  else if (s.phase === 'word' && view.me.isChooser) game.submitWord(person.id, 'a word');
  else if (s.phase === 'picking' && !view.me.isChooser && !view.me.waiting && view.me.myPick === null) game.playCard(person.id, view.me.hand[0]);
  else if (s.phase === 'voting' && view.voteTargets.length && view.me.myVote === null) game.vote(person.id, view.voteTargets[0]);
  else return false;
  return true;
}

/** Plays a whole game (the host acts for themselves, computers for the rest) and returns every view of every seat. */
function recordedViews(judging, seed) {
  const game = new Game({ getCardIds: () => cards(400), hints: cards(30).map((n) => `hint ${n}`), rng: seededRng(seed) });
  const host = game.addPlayer('Host', 'user:1');
  game.fillWithBots(host.id, 4);
  game.setJudging(host.id, judging);
  game.setRounds(host.id, 2);
  game.setHandSize(host.id, 4);
  const views = [];
  const look = () => {
    for (const p of game.s.players) views.push(JSON.stringify(game.viewFor(p.id)), JSON.stringify(game.viewFor(p.id, new Set([p.id, host.id]))));
    views.push(JSON.stringify(game.viewFor('stranger')));
  };
  look();
  game.start(host.id);
  look();
  for (let guard = 0; guard < 5000 && game.s.phase !== 'finished'; guard++) {
    if (!game.runBotAction() && !hostActs(game, host)) assert.fail(`stuck in ${game.s.phase}`);
    look();
  }
  return { views, finished: game.s.phase === 'finished' };
}

const describeJudging = { everyone: 'everyone judges', chooser: 'the chooser judges', favourite: 'favourites are picked' };

for (const [judging, seed] of [
  ['everyone', 91],
  ['chooser', 92],
  ['favourite', 93],
]) {
  test(`the views of a game where ${describeJudging[judging]} are the same every time for a seed, and say who is an account`, () => {
    const first = recordedViews(judging, seed);
    assert.equal(first.finished, true);
    assert.deepEqual(recordedViews(judging, seed).views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 50, 'the game was long enough to look at');
    for (const text of first.views) {
      const view = JSON.parse(text);
      if (view === null) continue; // a stranger is sent nothing
      assert.equal(typeof view.phase, 'string');
      for (const p of view.scoreboard.players) assert.ok(p.bot ? p.userId === undefined : Number.isInteger(p.userId), 'people carry their account id, computers none');
    }
  });
}

test('a view lists its parts in a fixed order', () => {
  const game = new Game({ getCardIds: () => cards(400), hints: [], rng: seededRng(1) });
  const host = game.addPlayer('Host', 'user:1');
  assert.deepEqual(Object.keys(game.viewFor(host.id)), ['phase', 'round', 'roundsEach', 'completedRounds', 'totalRounds', 'winners', 'handSize', 'chooserId', 'hostId', 'minPlayers', 'maxPlayers', 'pointsPerVote', 'pointsChooserCorrect', 'pointsFooledChooser', 'pointsFavourite', 'judging', 'categories', 'availableCards', 'drawCount', 'discardCount', 'word', 'wordHidden', 'me', 'players', 'scoreboard', 'table', 'voteTargets', 'results']);
  assert.equal(game.viewFor('stranger'), null);
});
