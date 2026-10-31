// A snapshot of what Game.viewFor sends: every view, for each seat and for a stranger, along whole seeded games with
// computer players. The digest was taken before viewFor was split into smaller builders, so splitting it further must not
// change a byte of what is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const digest = (views) => createHash('sha1').update(views.join('\n')).digest('hex');

test('the views of a game where everyone judges are exactly as they were', () => {
  const { views, finished } = recordedViews('everyone', 91);
  assert.equal(finished, true);
  assert.equal(digest(views), '5df086dc9871d13a686a3bd55114098adb3b5102');
});

test('the views of a game where the chooser judges are exactly as they were', () => {
  const { views, finished } = recordedViews('chooser', 92);
  assert.equal(finished, true);
  assert.equal(digest(views), 'e7b586c9c379cf82e5b90bf3e24ac8e28d3cf603');
});

test('the views of a game of favourites are exactly as they were', () => {
  const { views, finished } = recordedViews('favourite', 93);
  assert.equal(finished, true);
  assert.equal(digest(views), '28fd368153f592f853c946bdabc0dcf0d1a42ed4');
});

test('a view lists its parts in a fixed order', () => {
  const game = new Game({ getCardIds: () => cards(400), hints: [], rng: seededRng(1) });
  const host = game.addPlayer('Host', 'user:1');
  assert.deepEqual(Object.keys(game.viewFor(host.id)), ['phase', 'round', 'roundsEach', 'completedRounds', 'totalRounds', 'winners', 'handSize', 'chooserId', 'hostId', 'minPlayers', 'maxPlayers', 'pointsPerVote', 'pointsChooserCorrect', 'pointsFooledChooser', 'pointsFavourite', 'judging', 'categories', 'availableCards', 'drawCount', 'discardCount', 'word', 'wordHidden', 'me', 'players', 'scoreboard', 'table', 'voteTargets', 'results']);
  assert.equal(game.viewFor('stranger'), null);
});
