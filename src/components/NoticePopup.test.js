import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import NoticePopup from './NoticePopup.vue';

let wrapper;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});
const box = () => document.body.querySelector('.notice');
const make = (props = {}, text = 'Hello there') => (wrapper = mount(NoticePopup, { props, slots: { default: text }, attachTo: document.body }));
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('NoticePopup', () => {
  it('is hidden until active, then shows its slot politely with an OK button', async () => {
    make({ active: false });
    await settle();
    expect(box()).toBeNull();
    await wrapper.setProps({ active: true });
    await settle();
    expect(box().textContent).toContain('Hello there');
    expect(box().getAttribute('role')).toBe('status');
    expect(box().getAttribute('aria-live')).toBe('polite');
    expect(box().querySelector('button').textContent).toBe('OK');
  });

  it('closes after its duration, announcing it, and at once with OK', async () => {
    make({ active: true, duration: 1000 });
    await settle();
    await vi.advanceTimersByTimeAsync(900);
    expect(box()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(box()).toBeNull();
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.setProps({ active: false });
    await wrapper.setProps({ active: true });
    await settle();
    box().querySelector('button').click();
    await settle();
    expect(box()).toBeNull();
    expect(wrapper.emitted('close')).toHaveLength(2);
  });

  it('does not announce a close that the parent asked for by turning active off', async () => {
    make({ active: true });
    await settle();
    await wrapper.setProps({ active: false });
    await settle();
    expect(box()).toBeNull();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('takes a style class and a row, so that two pop-ups can sit one above the other', async () => {
    make({ active: true, name: 'special', row: 2 });
    await settle();
    expect(box().classList.contains('special')).toBe(true);
    expect(box().getAttribute('style')).toContain('--row: 2');
  });
});
