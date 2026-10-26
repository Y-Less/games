import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CardFan from './CardFan.vue';

const make = (items) => mount(CardFan, { props: { items, step: 4 }, slots: { default: '<template #default="{ item }"><b>{{ item }}</b></template>' } });

describe('CardFan', () => {
  it('draws every item through the slot, turned evenly about the middle', () => {
    const w = make(['a', 'b', 'c']);
    expect(w.findAll('.fan-card b').map((b) => b.text())).toEqual(['a', 'b', 'c']);
    expect(w.findAll('.fan-card').map((c) => c.attributes('style'))).toEqual([expect.stringContaining('--angle: -4deg'), expect.stringContaining('--angle: 0deg'), expect.stringContaining('--angle: 4deg')]);
  });

  it('keeps the same box size however many cards are left', () => {
    const full = make(Array.from({ length: 13 }, (_, i) => i)).find('.fan').attributes('style');
    const few = make([1, 2]).find('.fan').attributes('style');
    expect(few).toBe(full);
  });
});
