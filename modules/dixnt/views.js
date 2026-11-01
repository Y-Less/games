// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
import assert from 'node:assert/strict';
import { Game } from './game.js';


export const cards = (n) => Array.from({ length: n }, (_, i) => i + 1);
export function seededRng(seed = 1) {
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
export function recordedViews(judging, seed) {
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
