// The suggested nomination is highlighted on the number row, and only while it is the player's turn to nominate.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import * as game from '../game.js';
import Table from './Table.vue';

const send = () => vi.fn(() => Promise.resolve({ ok: true }));

/** User 1 (seat 0) in a started 4-seat game, brought to their turn to nominate. */
function annsTurn(seed = 3) {
  let s = seed;
  const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats: 4 } });
  game.fillWithBots(room, 1);
  game.start(room, 1, rng);
  while (room.phase === 'nominating' && room.turn !== 0) game.runPending(room, rng);
  return room;
}

describe('the suggested nomination', () => {
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const numbers = (w) => w.findAll('button.number');

  it('highlights exactly the suggested number on your turn and says so in the status', () => {
    const room = annsTurn();
    const state = game.viewFor(room, 1);
    const w = mount(Table, { props: { state, send: send() }, attachTo: document.body });
    const marked = numbers(w).filter((b) => b.classes('suggested'));
    expect(marked).toHaveLength(1);
    expect(marked[0].text()).toBe(String(state.suggestion));
    expect(marked[0].attributes('title')).toBe('Suggested for your hand');
    expect(document.body.textContent).toContain(`Suggested nomination for your hand: ${state.suggestion}`);
    w.unmount();
  });

  it('highlights nothing when there is no suggestion', () => {
    const state = { ...game.viewFor(annsTurn(), 1), suggestion: null };
    const w = mount(Table, { props: { state, send: send() }, attachTo: document.body });
    expect(numbers(w).some((b) => b.classes('suggested'))).toBe(false);
    w.unmount();
  });

  it('is not shown once nominating is over', () => {
    const room = annsTurn();
    const state = { ...game.viewFor(room, 1), phase: 'playing', suggestion: null };
    const w = mount(Table, { props: { state, send: send() }, attachTo: document.body });
    expect(numbers(w).some((b) => b.classes('suggested'))).toBe(false);
    w.unmount();
  });
});
