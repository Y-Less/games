// Every view of whole seeded games (see ../views.js, which the server-side view test uses too) is drawn by the real
// table, start to finish, with every Vue warning and error collected: a state the table cannot draw is a crash a
// player would meet, and this finds it without a browser.
import { describe, expect, it } from 'vitest';
import Root from './index.js';
import { recordedViews } from '../views.js';
import { isMemberView, walkViews } from '../../../shared/renderWalk.js';
import { newEntries } from './moveLog.js';
import { statusFor } from './status.js';

describe('rendering every state of a whole game', () => {
  for (const [label, record] of [
  ['a game where everyone judges', () => recordedViews('everyone', 91)],
  ['a game of favourites', () => recordedViews('favourite', 93)],
  ['a game nobody chooses the word for', () => recordedViews('everyone', 94, { noChooser: true })],
  ['a game where the table votes for the best card', () => recordedViews('best', 95)],
  ['a game nobody chooses the word for, voting for the best card', () => recordedViews('best', 96, { noChooser: true })],
  ]) {
    it(`draws every view of ${label} without an error or a warning`, async () => {
      const { views, finished } = record();
      expect(finished).toBe(true);
      const { sent, problems } = await walkViews(Root, views, { decorate: (view) => ({ ...view, code: 'a-b-c' }) }); // the server stamps the code on each state
      expect(problems).toEqual([]);
      expect(sent).toBeGreaterThan(10);
    }, 120000); // a whole game is hundreds of views
  }

  // A table keyed by a player id has text keys while a person's id is their account number, so a lookup that matches
  // the two with === quietly draws "?" instead of a name.  Nothing above would fail for it, so it is checked here.
  it('never writes "?" where a player name belongs', () => {
    const seen = [];
    for (const [judging, noChooser] of [['everyone', false], ['chooser', false], ['favourite', false], ['best', false], ['everyone', true], ['best', true]]) {
      let previous = null;
      for (const raw of recordedViews(judging, 91, { noChooser }).views) {
        const next = JSON.parse(raw);
        if (!isMemberView(next)) continue;
        const status = statusFor(next, { isHost: true });
        seen.push(JSON.stringify([status.headline, ...status.lines, ...newEntries(previous, next)]));
        previous = next;
      }
    }
    expect(seen.length).toBeGreaterThan(100);
    expect(seen.filter((text) => text.includes('"?"'))).toEqual([]);
  }, 120000);
});
