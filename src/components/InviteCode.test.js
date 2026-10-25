import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import InviteCode from './InviteCode.vue';

let writeText;
let prompt;
let wrapper;

beforeEach(() => {
  vi.useFakeTimers();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null);
  window.history.replaceState({}, '', '/play/hearts?something=old');
});
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const make = (props = {}) => {
  wrapper = mount(InviteCode, { props: { code: 'boss-aware-you', ...props } });
  return wrapper;
};

describe('InviteCode', () => {
  it('shows the code and the default label', () => {
    const w = make();
    expect(w.find('.code').text()).toBe('boss-aware-you');
    expect(w.find('.hint').text()).toBe('Copy invite link');
  });

  it('uses a custom label', () => {
    expect(make({ label: 'Share' }).find('.hint').text()).toBe('Share');
  });

  it('copies origin + pathname + ?code, dropping any existing query', async () => {
    const w = make();
    await w.find('button').trigger('click');
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/play/hearts?boss-aware-you`);
  });

  it('shows "Link copied" and reverts after two seconds', async () => {
    const w = make();
    await w.find('button').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(w.find('.hint').text()).toBe('Link copied');
    await vi.advanceTimersByTimeAsync(1999);
    expect(w.find('.hint').text()).toBe('Link copied');
    await vi.advanceTimersByTimeAsync(1);
    expect(w.find('.hint').text()).toBe('Copy invite link');
  });

  it('restarts the timer when clicked again', async () => {
    const w = make();
    await w.find('button').trigger('click');
    await vi.advanceTimersByTimeAsync(1500);
    await w.find('button').trigger('click');
    await vi.advanceTimersByTimeAsync(1500);
    expect(w.find('.hint').text()).toBe('Link copied');
    await vi.advanceTimersByTimeAsync(500);
    expect(w.find('.hint').text()).toBe('Copy invite link');
  });

  it('falls back to a prompt with the link when the clipboard fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const w = make();
    await w.find('button').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(prompt).toHaveBeenCalledWith('Copy this invite link:', `${window.location.origin}/play/hearts?boss-aware-you`);
    expect(w.find('.hint').text()).toBe('Copy invite link');
  });

  it('falls back when there is no clipboard at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const w = make();
    await w.find('button').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('leaves no timer running after unmount', async () => {
    const w = make();
    await w.find('button').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    w.unmount();
    wrapper = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
