// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
import assert from 'node:assert/strict';
import { createRules } from './game.js';

export const cards = (n) => Array.from({ length: n }, (_, i) => i + 1);
export function seededRng(seed = 1) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Does whatever the host would do next, using their own view; returns false if there is nothing to do. */
function hostActs(game, room, hostId, rng) {
  const view = game.viewFor(room, hostId);
  if (room.phase === 'results') game.nextRound(room, hostId, rng);
  else if (room.phase === 'word' && view.me.isChooser) game.submitWord(room, hostId, 'a word', rng);
  else if (room.phase === 'picking' && !view.me.isChooser && view.me.myPick === null) game.playCard(room, hostId, view.me.hand[0], rng);
  else if (room.phase === 'voting' && view.voteTargets.length && view.me.myVote === null) game.vote(room, hostId, view.voteTargets[0]);
  else return false;
  return true;
}

/** Plays a whole game (the host acts for themselves, computers for the rest) and returns every view of every seat. */
export function recordedViews(judging, seed) {
  const rng = seededRng(seed);
  const game = createRules({ getCardIds: () => cards(400), hints: cards(30).map((n) => `hint ${n}`) });
  const hostId = 1;
  const room = game.createRoom({ code: 'seeded-game-here', hostId, hostName: 'Host', now: 0 });
  game.fillWithBots(room, hostId, 4);
  game.setSettings(room, hostId, { judging, roundsEach: 2, handSize: 4 });
  const views = [];
  const look = () => {
    for (const p of room.players) {
      views.push(JSON.stringify(game.viewFor(room, p.id)));
      views.push(JSON.stringify(game.viewFor(room, p.id, { online: (id) => id === p.id || id === hostId })));
    }
    views.push(JSON.stringify(game.viewFor(room, 'stranger')));
  };
  look();
  game.start(room, hostId, rng);
  look();
  for (let guard = 0; guard < 5000 && room.phase !== 'finished'; guard++) {
    if (!game.runBotAction(room, rng) && !hostActs(game, room, hostId, rng)) assert.fail(`stuck in ${room.phase}`);
    look();
  }
  return { views, finished: room.phase === 'finished' };
}
