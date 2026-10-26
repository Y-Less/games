import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import GameStatus from './GameStatus.vue';

describe('GameStatus', () => {
  it('shows the headline, marking it as yours when asked', async () => {
    const w = mount(GameStatus, { props: { headline: 'Your turn: click a tile.', mine: true } });
    const h = w.find('.headline');
    expect(h.text()).toBe('Your turn: click a tile.');
    expect(h.attributes('role')).toBe('status');
    expect(h.classes('mine')).toBe(true);
    await w.setProps({ mine: false });
    expect(h.classes('mine')).toBe(false);
  });

  it('draws lines given as strings or with a tone, in order', () => {
    const w = mount(GameStatus, { props: { lines: ['plain', { text: 'yours', tone: 'mine' }, { text: 'careful', tone: 'warn' }, { text: 'quiet', tone: 'muted' }] } });
    const lines = w.findAll('.line');
    expect(lines.map((l) => l.text())).toEqual(['plain', 'yours', 'careful', 'quiet']);
    expect(lines.map((l) => l.classes().filter((c) => c !== 'line')[0] ?? '')).toEqual(['', 'mine', 'warn', 'muted']);
  });

  it('has no headline element without one, and offers facts and default slots', () => {
    const empty = mount(GameStatus);
    expect(empty.find('.headline').exists()).toBe(false);
    expect(empty.find('.facts').exists()).toBe(false);
    const w = mount(GameStatus, { props: { headline: 'Go' }, slots: { facts: 'Round 2 · 28 in the bag', default: '<button>Undo</button>' } });
    expect(w.find('.facts').text()).toContain('Round 2');
    expect(w.find('button').text()).toBe('Undo');
    expect(w.element.firstElementChild.className).toContain('facts'); // facts come first
  });

  it('is a box that fills its parent and scrolls inside itself', () => {
    const w = mount(GameStatus, { props: { headline: 'x' } });
    expect(w.classes()).toContain('game-status');
  });
});
