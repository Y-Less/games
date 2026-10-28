// The last chance as the player sees it: the status says an instant win is their only way to win, and 7 is highlighted.
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

describe('the last chance', () => {
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  it('tells a player who cannot win on points to go for 7, and highlights a high suggestion', () => {
    const state = lastRound([0, 100, 90]);
    const w = mount(Table, { props: { state, send: send() }, attachTo: document.body });
    const marked = w.findAll('button.number').filter((b) => b.classes('suggested'));
    expect(state.suggestion).toBeGreaterThanOrEqual(6); // every card's weight is turned up, so the suggestion is high
    expect(marked.map((b) => b.text())).toEqual([String(state.suggestion)]);
    expect(document.body.textContent).toContain('You can no longer win on points');
    expect(document.body.textContent).toContain('nominate 7');
    expect(document.body.textContent).not.toContain('Suggested nomination for your hand');
    w.unmount();
  });

  it('says nothing of it to a player who can still win', () => {
    const state = lastRound([90, 100, 90]);
    expect(state.lastChance).toBe(false);
    const w = mount(Table, { props: { state, send: send() }, attachTo: document.body });
    expect(document.body.textContent).not.toContain('You can no longer win on points');
    expect(document.body.textContent).toContain('Suggested nomination for your hand');
    w.unmount();
  });
});
