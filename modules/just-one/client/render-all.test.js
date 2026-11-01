// Every view of whole seeded games (see ../views.js, which the server-side view test uses too) is drawn by the real
// table, start to finish, with every Vue warning and error collected: a state the table cannot draw is a crash a
// player would meet, and this finds it without a browser.
import { describe, expect, it } from 'vitest';
import Root from './index.js';
import { recordedViews } from '../views.js';
import { walkViews } from '../../../shared/renderWalk.js';

describe('rendering every state of a whole game', () => {
  for (const [label, record] of [
  ['a four-player game', () => recordedViews(101, 4, 1)],
  ['a three-player game of two turns each', () => recordedViews(102, 3, 2)],
  ]) {
    it(`draws every view of ${label} without an error or a warning`, async () => {
      const { views, finished } = record();
      expect(finished).toBe(true);
      const { sent, problems } = await walkViews(Root, views);
      expect(problems).toEqual([]);
      expect(sent).toBeGreaterThan(10);
    }, 120000); // a whole game is hundreds of views
  }
});
