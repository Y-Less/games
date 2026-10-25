import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TrickCircle from './TrickCircle.vue';

const seats = [0, 1, 2, 3].map((key) => ({ key, name: `P${key}` }));
const make = (props = {}) => mount(TrickCircle, { props: { seats, ...props } });

describe('TrickCircle', () => {
  it('always has one slot per seat, empty or not', () => {
    expect(make().findAll('.slot')).toHaveLength(4);
    expect(make().findAll('.slot .empty')).toHaveLength(4);
    const w = make({ plays: [{ key: 2, card: 'QS' }] });
    expect(w.findAll('.slot')).toHaveLength(4);
    expect(w.findAll('.slot .empty')).toHaveLength(3);
    expect(w.findAll('.slot')[2].find('.playing-card').attributes('aria-label')).toBe('queen of spades');
  });

  it('puts the viewer at the bottom and the next seat on the left', () => {
    const styles = make().findAll('.slot').map((s) => s.attributes('style'));
    expect(styles[0]).toContain('--sy: 1');
    expect(styles[1]).toContain('--sx: -1');
    expect(styles[2]).toContain('--sy: -1');
    expect(styles[3]).toContain('--sx: 1');
  });

  it('marks the winning card and can label the seats', () => {
    const w = make({ plays: [{ key: 1, card: 'AH' }, { key: 3, card: '2H' }], winnerKey: 1, labels: true });
    expect(w.findAll('.slot').map((s) => s.classes('won'))).toEqual([false, true, false, false]);
    expect(w.findAll('.who').map((x) => x.text())).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('shows the default slot in the middle', () => {
    expect(make({}).html()).toContain('middle');
    const w = mount(TrickCircle, { props: { seats }, slots: { default: '<p>Passing</p>' } });
    expect(w.find('.middle').text()).toBe('Passing');
  });
});
