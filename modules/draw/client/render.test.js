// Every view of whole seeded games is drawn by the real client, start to finish, with every Vue warning and error
// collected: a state the table cannot draw is a crash a player would meet, and this finds it without a browser.
// Both seats are walked, because a drawer and a guesser see different screens.
import { describe, expect, it } from 'vitest';
import Root from './index.js';
import { walkViews } from '../../../shared/renderWalk.js';
import { seeded } from '../../../shared/random.js';
import * as game from '../game.js';

/** Plays a whole game of four and records the view every player was sent after every move. */
function recordedViews({ rounds = 1, guessRight = true } = {}) {
  const rng = seeded(11);
  const room = game.createRoom({ code: 'draw-test-game', hostId: 1, hostName: 'Ann', chooseMs: 5000, betweenMs: 4000, now: 0 });
  for (const [id, name] of [[2, 'Bob'], [3, 'Cat'], [4, 'Dan']]) game.addHuman(room, id, name);
  game.setSettings(room, 1, { rounds });
  const views = [];
  let clock = 0;
  const look = () => room.players.forEach((p) => views.push(game.viewFor(room, p.id, { online: () => true, now: clock })));
  look();
  game.start(room, 1, rng, clock);
  look();
  for (let guard = 0; guard < 400 && room.phase !== 'finished'; guard++) {
    clock += 1000;
    if (room.phase === 'choosing') {
      for (const drawer of game.drawersOf(room)) if (!room.words[drawer]) game.chooseWord(room, drawer, 0, clock);
    } else if (room.phase === 'drawing') {
      const guesser = room.players.find((p) => !game.isDrawer(room, p.id));
      // Guess one of the two words, so that a round that is won is drawn as well as one that is not.
      const word = guessRight ? room.words[game.drawersOf(room)[0]] : 'not it at all';
      game.guess(room, guesser.id, word, clock);
      if (room.phase === 'drawing') game.timeUp(room, rng, clock + room.drawTime * 1000);
    } else {
      game.nextTurn(room, rng, clock);
    }
    look();
  }
  return { views, finished: room.phase === 'finished' };
}

describe('rendering every state of a whole game', () => {
  for (const [label, options] of [
    ['a game somebody names every drawing in', { guessRight: true }],
    ['a game nobody names anything in', { guessRight: false }],
  ]) {
    it(`draws every view of ${label} without an error or a warning`, async () => {
      const { views, finished } = recordedViews(options);
      expect(finished).toBe(true);
      const { sent, problems } = await walkViews(Root, views);
      expect(problems).toEqual([]);
      expect(sent).toBeGreaterThan(20);
    }, 120000);
  }

  it('never shows a player a word they should not have', () => {
    const { views } = recordedViews();
    for (const view of views) {
      if (view.phase !== 'drawing') continue;
      for (const board of view.boards) {
        if (board.yours) continue;
        expect(board.word).toBeNull();
      }
    }
  });
});
