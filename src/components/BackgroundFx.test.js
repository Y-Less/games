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
    const mount_ = (props = {}) => mount(BackgroundFx, { props: { effect: 'matrix', fixed: true, ...props } });
    const band = (c) => {
      const style = c.attributes('style');
      return Number(style.match(/top: ([\d.]+)%/)[1]) + Number((style.match(/height: ([\d.]+)%/) ?? [0, 0])[1]);
    };

    it('draws columns of letters that slide down the screen, the same ones every time', () => {
      const a = mount_();
      expect(a.attributes('data-fx')).toBe('matrix');
      expect(a.findAll('.ma').length).toBeGreaterThan(20);
      expect(a.findAll('.ma').some((c) => c.findAll('i').length > 10)).toBe(true);
      expect(a.html()).toBe(mount_().html());
    });

    it('has one letter per row with its own brightness, a bright head, and columns of many sizes', () => {
      const columns = mount_().findAll('.ma');
      for (const c of columns) {
        const letters = c.findAll('i');
        expect(letters.length).toBeGreaterThanOrEqual(3);
        expect(letters.at(-1).classes()).toContain('head');
        expect(c.attributes('style')).toContain(`--n: ${letters.length}`);
      }
      const sizes = new Set(columns.map((c) => c.attributes('style').match(/--s: ([\d.]+)/)[1]));
      expect(sizes.size).toBeGreaterThan(20);
      const lengths = new Set(columns.map((c) => c.findAll('i').length));
      expect(lengths.size).toBeGreaterThan(8);
    });

    it('draws fewer columns in a preview and at a lower intensity, and none for other effects', () => {
      expect(mount_({ demo: true }).findAll('.ma').length).toBeLessThan(12);
      expect(mount_({ intensity: 40 }).findAll('.ma').length).toBeLessThan(mount_().findAll('.ma').length);
      expect(mount(BackgroundFx, { props: { effect: 'snow' } }).findAll('.ma').length).toBe(0);
    });

    it('starts about half the columns at the very top, and the rest lower down', () => {
      const tops = mount_().findAll('.maw').map((c) => c.attributes('style').match(/top: ([\d.]+)%/)[1]);
      const atTop = tops.filter((t) => Number(t) === 0).length / tops.length;
      expect(atTop).toBeGreaterThan(0.35);
      expect(atTop).toBeLessThan(0.65);
      expect(new Set(tops).size).toBeGreaterThan(15);
    });

    it('has about half the columns reach the bottom of the screen', () => {
      const ends = mount_().findAll('.maw').map(band);
      const toBottom = ends.filter((end) => end > 99.5).length / ends.length;
      expect(toBottom).toBeGreaterThan(0.35);
      expect(toBottom).toBeLessThan(0.65);
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
