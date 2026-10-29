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

    it('has columns of letters that stay put, with trails of several lengths and sizes', () => {
      const w = mount(BackgroundFx, { props: { effect: 'matrix', fixed: true } });
      const columns = w.findAll('.mx');
      const kinds = new Set(columns.flatMap((c) => c.classes().filter((k) => /^f[1-4]$/.test(k))));
      expect([...kinds].sort()).toEqual(['f1', 'f2', 'f3', 'f4']);
      const sizes = new Set(columns.map((c) => c.attributes('style').match(/--s: ([\d.]+)/)[1]));
      expect(sizes.size).toBeGreaterThan(20);
      for (const c of columns) {
        const letters = c.findAll('i');
        expect(letters.length).toBeGreaterThan(20);
        expect(letters[5].attributes('style')).toContain('--k: 5');
      }
    });

    it('multiplies the alpha of everything above 100% intensity', () => {
      const w = mount(BackgroundFx, { props: { effect: 'snow', intensity: 250 } });
      expect(w.find('feFuncA').attributes('slope')).toBe('2.5');
      expect(w.attributes('style')).toContain('#fx-gain-');
      expect(mount(BackgroundFx, { props: { effect: 'snow', intensity: 100 } }).find('feFuncA').exists()).toBe(false);
    });

    it('draws fewer columns at a lower intensity', () => {
      const count = (intensity) => mount(BackgroundFx, { props: { effect: 'matrix', intensity } }).findAll('.mx').length;
      expect(count(40)).toBeLessThan(count(100));
    });

    it('draws fewer columns in a preview, and none for other effects', () => {
      expect(mount(BackgroundFx, { props: { effect: 'matrix', demo: true } }).findAll('.mx').length).toBeLessThan(12);
      expect(mount(BackgroundFx, { props: { effect: 'snow' } }).findAll('.mx').length).toBe(0);
    });
  });

  it("takes the player's intensity and speed, but not in a preview", () => {
    const w = mount(BackgroundFx, { props: { effect: 'snow', intensity: 40, speed: 250 } });
    expect(w.attributes('style')).toContain('--fx-speed: 2.5');
    expect(w.attributes('style')).toContain('opacity: 0.4');
    const demo = mount(BackgroundFx, { props: { effect: 'snow', intensity: 40, speed: 250, demo: true } });
    expect(demo.attributes('style') ?? '').not.toContain('--fx-speed');
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
