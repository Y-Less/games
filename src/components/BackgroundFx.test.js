import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import BackgroundFx from './BackgroundFx.vue';

describe('BackgroundFx', () => {
  it('draws nothing for no effect, a still one or an unset one', () => {
    for (const effect of [undefined, 'none', '']) expect(mount(BackgroundFx, { props: { effect } }).find('.bg-fx').exists()).toBe(false);
  });

  it('draws the chosen effect, hidden from screen readers, and behind the whole site when fixed', () => {
    const w = mount(BackgroundFx, { props: { effect: 'snow', fixed: true } });
    expect(w.attributes('data-fx')).toBe('snow');
    expect(w.attributes('aria-hidden')).toBe('true');
    expect(w.classes()).toContain('fixed');
  });

  describe('the Matrix rain', () => {
    it('draws columns of characters, the same ones every time', () => {
      const a = mount(BackgroundFx, { props: { effect: 'matrix', fixed: true } });
      const b = mount(BackgroundFx, { props: { effect: 'matrix', fixed: true } });
      expect(a.findAll('.mx').length).toBeGreaterThan(20);
      expect(a.findAll('.mx').some((c) => c.text().length > 10)).toBe(true);
      expect(a.html()).toBe(b.html());
    });

    it('has columns that vanish at many different points of their fall, and trails of many different lengths', () => {
      const w = mount(BackgroundFx, { props: { effect: 'matrix', fixed: true } });
      const columns = w.findAll('.mx');
      const kinds = new Set(columns.flatMap((c) => c.classes().filter((k) => /^v[1-6]$/.test(k))));
      expect([...kinds].sort()).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
      const lengths = columns.map((c) => c.findAll('i').length);
      expect(Math.min(...lengths)).toBeLessThanOrEqual(6);
      expect(Math.max(...lengths)).toBeGreaterThanOrEqual(25);
      expect(new Set(lengths).size).toBeGreaterThan(12);
    });

    it('draws fewer columns in a preview, and none for other effects', () => {
      expect(mount(BackgroundFx, { props: { effect: 'matrix', demo: true } }).findAll('.mx').length).toBeLessThan(12);
      expect(mount(BackgroundFx, { props: { effect: 'snow' } }).findAll('.mx').length).toBe(0);
    });
  });

  describe('the moving gradient', () => {
    const gradient = { type: 'gradient', from: '#112233', to: '#445566', angle: 45 };

    it('slides the gradient you chose, along its own angle', () => {
      const w = mount(BackgroundFx, { props: { effect: 'gradient', background: gradient } });
      expect(w.attributes('data-fx')).toBe('gradient');
      expect(w.attributes('style')).toContain('--fx-a: #112233');
      expect(w.attributes('style')).toContain('--fx-b: #445566');
      expect(w.attributes('style')).toContain('--fx-angle: 45deg');
    });

    it('does nothing when your background is not a gradient, except in a preview, which uses a sample', () => {
      const preset = { type: 'preset', value: 'night' };
      expect(mount(BackgroundFx, { props: { effect: 'gradient', background: preset } }).find('.bg-fx').exists()).toBe(false);
      expect(mount(BackgroundFx, { props: { effect: 'gradient', background: preset, demo: true } }).find('.bg-fx').exists()).toBe(true);
    });
  });
});
