import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { leaveOffer, playBar, useLeave } from './playBar.js';

const host = (options) => defineComponent({ setup: () => (useLeave(options), () => null) });

describe('playBar', () => {
  it('offers nothing until a game registers, and nothing after it unmounts', () => {
    expect(leaveOffer()).toBeNull();
    const w = mount(host({ leave: () => {} }));
    expect(leaveOffer()).not.toBeNull();
    w.unmount();
    expect(leaveOffer()).toBeNull();
    expect(playBar.leave).toBeNull();
  });

  it('follows refs and functions for canLeave and confirmText', () => {
    const can = ref(false);
    const text = ref('');
    const w = mount(host({ canLeave: can, confirmText: () => text.value, leave: () => {} }));
    expect(leaveOffer()).toBeNull();
    can.value = true;
    expect(leaveOffer().confirmText).toBe('');
    text.value = 'Sure?';
    expect(leaveOffer().confirmText).toBe('Sure?');
    w.unmount();
  });

  it('calls the game\'s own leave function', async () => {
    const leave = vi.fn(() => Promise.resolve());
    const w = mount(host({ leave }));
    await leaveOffer().leave();
    expect(leave).toHaveBeenCalledOnce();
    w.unmount();
  });

  it('keeps a newer registration when an older component unmounts later', () => {
    const a = mount(host({ leave: () => {} }));
    const b = mount(host({ leave: () => {} }));
    a.unmount();
    expect(leaveOffer()).not.toBeNull();
    b.unmount();
    expect(leaveOffer()).toBeNull();
  });
});
