import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import OpponentHands from './OpponentHands.vue';
import { OPPONENT_LAYOUTS } from '../opponentLayouts.js';

const opponents = (n) => Array.from({ length: n }, (_, i) => ({ key: i, name: `Opp ${i}`, cards: 7 - i, note: i === 0 ? 'passed' : '' }));
const sides = (w) => w.findAll('.opp').map((o) => o.classes().find((c) => ['left', 'top', 'right'].includes(c)));

describe('OpponentHands', () => {
  it('lays opponents out as 1: top; 2: left, right; 3: left, top, right; 4: 2 left, 2 right; 5: 2, 1, 2; 6: 2, 2, 2', () => {
    const counts = (n) => {
      const found = sides(mount(OpponentHands, { props: { opponents: opponents(n) } }));
      return ['left', 'top', 'right'].map((side) => found.filter((x) => x === side).length);
    };
    expect([1, 2, 3, 4, 5, 6].map(counts)).toEqual([[0, 1, 0], [1, 0, 1], [1, 1, 1], [2, 0, 2], [2, 1, 2], [2, 2, 2]]);
    for (const [n, layout] of Object.entries(OPPONENT_LAYOUTS)) {
      expect([...layout.left, ...layout.top, ...layout.right].sort()).toEqual(Array.from({ length: Number(n) }, (_, i) => i));
    }
  });

  it('shows every opponent by name, with their cards face down and a note under the name', () => {
    const w = mount(OpponentHands, { props: { opponents: opponents(3) } });
    expect(w.findAll('.who').map((e) => e.text())).toEqual(['Opp 0', 'Opp 1', 'Opp 2']);
    expect(w.find('.opp .tag').text()).toBe('passed');
    expect(w.findAll('.opp').map((o) => o.findAll('.playing-card').length)).toEqual([7, 6, 5]);
    expect(w.findAll('.opp .playing-card.face')).toHaveLength(0);
    expect(w.find('[aria-label="Opp 0: 7 cards"]').exists()).toBe(true);
  });

  it('marks whose turn it is and who is away', () => {
    const list = opponents(2);
    list[0].current = true;
    list[1].away = true;
    const w = mount(OpponentHands, { props: { opponents: list } });
    expect(w.findAll('.opp')[0].classes()).toContain('current');
    expect(w.findAll('.opp')[1].classes()).toContain('away');
  });
});
