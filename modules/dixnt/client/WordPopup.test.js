import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import WordPopup from './components/WordPopup.vue';
import { DIXNT_KEY } from './useDixnt.js';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});

function open(wordPopup) {
  const store = reactive({ wordPopup });
  wrapper = mount(WordPopup, { global: { provide: { [DIXNT_KEY]: { store } }, stubs: { Transition: false } } });
  return store;
}

describe('Dixnt word popup', () => {
  it('shows the word that has just been chosen, and goes by itself after a few seconds', async () => {
    vi.useFakeTimers();
    open({ word: 'sunshine', key: '1:0', hidden: false, at: Date.now() });
    expect(wrapper.text()).toContain('sunshine');
    await vi.advanceTimersByTimeAsync(4100);
    expect(wrapper.find('.word-popup').exists()).toBe(false);
  });

  it('does not show a popup that has already come and gone, when it is mounted for a later game', () => {
    open({ word: 'old word', key: '1:0', hidden: false, at: Date.now() - 60_000 });
    expect(wrapper.find('.word-popup').exists()).toBe(false);
  });
});
