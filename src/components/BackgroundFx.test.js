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
});
