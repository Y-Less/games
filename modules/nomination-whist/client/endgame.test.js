// A player who cannot win on points is not nudged towards 7: no notice, and the usual suggestion for their hand.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import * as game from '../game.js';
import Table from './Table.vue';

const send = () => vi.fn(() => Promise.resolve({ ok: true }));

/** User 1 (Ann, seat 0) in the last round, first to nominate, with the given scores. */
function lastRound(scores) {
  let s = 8;
  const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 3 } });
  game.fillWithBots(room, 1);
  game.start(room, 1, rng);
  room.roundIndex = 13;
  room.dealer = 2;
  room.scores = scores;
  game.dealRound(room, rng);
  return game.viewFor(room, 1);
}

describe('a player who cannot win on points', () => {
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  it('is told nothing about nominating 7, and gets the ordinary suggestion', () => {
    const state = lastRound([0, 100, 90]);
    const w = mount(Table, { props: { state, send: send() }, attachTo: document.body });
    expect(document.body.textContent).not.toContain('You can no longer win on points');
    expect(document.body.textContent).toContain('Suggested nomination for your hand');
    expect(state.suggestion).toBe(lastRound([90, 100, 90]).suggestion);
    w.unmount();
  });
});
