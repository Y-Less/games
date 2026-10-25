import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TrickCircle from './TrickCircle.vue';

const seats = [0, 1, 2, 3].map((key) => ({ key, name: `P${key}` }));
const make = (props = {}) => mount(TrickCircle, { props: { seats, ...props } });

describe('TrickCircle', () => {
  it('always has one slot per seat, with or without cards', () => {
    expect(make().findAll('.slot')).toHaveLength(4);
    expect(make().findAll('.slot .playing-card')).toHaveLength(0);
    const w = make({ plays: [{ key: 2, card: 'QS' }] });
    expect(w.findAll('.slot')).toHaveLength(4);
    expect(w.findAll('.slot .playing-card')).toHaveLength(1);
    expect(w.findAll('.slot')[2].find('.playing-card').attributes('aria-label')).toBe('queen of spades');
  });

  it('turns each card by an angle that is the same on every render, and stacks them in the order played', () => {
    const plays = [{ key: 1, card: 'AH' }, { key: 3, card: '2H' }];
    const a = make({ plays }).findAll('.slot').map((x) => x.attributes('style'));
    const b = make({ plays }).findAll('.slot').map((x) => x.attributes('style'));
    expect(a).toEqual(b);
    expect(a[1]).toMatch(/--turn: -?[0-9.]+deg/);
    expect(a[1]).toContain('z-index: 1');
    expect(a[3]).toContain('z-index: 2');
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
    expect(w.findAll('.who').map((x) => x.text())).toEqual(['P1', 'P3']);
  });

  it('shows the default slot in the middle', () => {
    expect(make({}).html()).toContain('middle');
    const w = mount(TrickCircle, { props: { seats }, slots: { default: '<p>Passing</p>' } });
    expect(w.find('.middle').text()).toBe('Passing');
  });
});
