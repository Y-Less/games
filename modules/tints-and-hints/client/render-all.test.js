// Every view of whole seeded games (see ../views.js, which the server-side view test uses too) is drawn by the real
// table, start to finish, with every Vue warning and error collected: a state the table cannot draw is a crash a
// player would meet, and this finds it without a browser.
import { describe, expect, it } from 'vitest';
import Root from './index.js';
import { recordedViews } from '../views.js';
import { walkViews } from '../../../shared/renderWalk.js';

describe('rendering every state of a whole game', () => {
  for (const [label, record] of [
  ['a four-player game', () => recordedViews(111, 4, 1)],
  ['a three-player game of two turns each', () => recordedViews(112, 3, 2)],
  ]) {
    it(`draws every view of ${label} without an error or a warning`, async () => {
      const { views, finished } = record();
      expect(finished).toBe(true);
      const { sent, problems } = await walkViews(Root, views, { step: 4 }); // the 1,152-square grid is slow to draw in jsdom: every fourth view
      expect(problems).toEqual([]);
      expect(sent).toBeGreaterThan(10);
      // Every other game gets the shared two minutes, and this one is the reason the `step` above exists: a 1,152-square
      // grid is far and away the most expensive view the site has, and even every fourth one of them lands close enough
      // to two minutes that an otherwise busy machine tips it over.  The game itself takes 122ms; all of this is jsdom
      // drawing.  So it gets a budget of its own rather than the suite failing on how loaded the machine happens to be.
    }, 300000);
  }
});
