// The word shown large to the whole table: it says what it is given, goes by itself, and is not shown again by a
// table mounted after it has come and gone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import WordPopup from './WordPopup.vue';

let wrapper;
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});
const show = (popup, props = {}) => (wrapper = mount(WordPopup, { props: { popup, ...props }, global: { stubs: { Transition: false } } }));

describe('the word pop-up', () => {
  it('shows the line and the word it is given, and goes by itself after its time', async () => {
    vi.useFakeTimers();
    show({ label: 'The hint is', word: 'warm', at: Date.now() });
    expect(wrapper.find('.label').text()).toBe('The hint is');
    expect(wrapper.find('.word').text()).toBe('warm');
    await vi.advanceTimersByTimeAsync(4100);
    expect(wrapper.find('.word-popup').exists()).toBe(false);
  });

  it('stays up for as long as it is told to', async () => {
    vi.useFakeTimers();
    show({ label: 'The hint is', word: 'warm', at: Date.now() }, { duration: 1000 });
    await vi.advanceTimersByTimeAsync(900);
    expect(wrapper.find('.word-popup').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(wrapper.find('.word-popup').exists()).toBe(false);
  });

  it('goes at once when it is clicked', async () => {
    show({ label: 'The word is', word: 'anchor', at: Date.now() });
    await wrapper.find('.word-popup').trigger('click');
    expect(wrapper.find('.word-popup').exists()).toBe(false);
  });

  it('is drawn dark for the player who is kept from the word', () => {
    show({ label: 'There is a word', word: '???', dark: true, at: Date.now() });
    expect(wrapper.find('.word-popup').classes()).toContain('dark');
  });

  it('shows the next word when one replaces the last, and nothing when there is none', async () => {
    show({ label: 'The hint is', word: 'warm', at: Date.now() });
    await wrapper.setProps({ popup: { label: 'The second hint is', word: 'brick', at: Date.now() } });
    expect(wrapper.find('.word').text()).toBe('brick');
    await wrapper.setProps({ popup: null });
    expect(wrapper.find('.word-popup').exists()).toBe(false);
  });

  it('does not show a word that has already come and gone, when it is mounted later', () => {
    show({ label: 'The word is', word: 'old word', at: Date.now() - 60_000 });
    expect(wrapper.find('.word-popup').exists()).toBe(false);
  });
});
