// The turn timer a player watches while it is their go.  What is protected: it shows whole seconds, rounded up, and
// never below nought; a turn with no limit shows nothing at all; every new version from the server starts the count
// again from what the server says is left (so the two clocks need not agree); and the ticker goes away with the
// component rather than running on behind a closed game.
//
// Time is faked, so no test waits and none depends on how busy the machine is.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { mount } from '@vue/test-utils';
import { useTurnClock } from './useTurnClock.js';

let wrapper;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

/**
 * Mounts a component that runs the clock over a state the test can change, as a game's table would.
 * @param {{ version: number, remaining: number | null | undefined }} initial  the server's view
 * @returns {{ state: object, seconds: () => number | null }}
 */
function clock(initial) {
  const state = reactive(initial);
  let secondsLeft;
  wrapper = mount(
    defineComponent({
      setup() {
        ({ secondsLeft } = useTurnClock(() => state));
        return () => h('div', String(secondsLeft.value));
      },
    }),
  );
  return { state, seconds: () => secondsLeft.value };
}
/** Lets time pass, and the page catch up with it. */
const pass = async (ms) => {
  await vi.advanceTimersByTimeAsync(ms);
  await nextTick();
};

describe('useTurnClock', () => {
  it('shows nothing for a turn that is not timed', async () => {
    expect(clock({ version: 1, remaining: null }).seconds()).toBeNull();
    wrapper.unmount();
    const untimed = clock({ version: 1 });
    await pass(5000);
    expect(untimed.seconds()).toBeNull();
  });

  it('starts from what the server says is left, in whole seconds rounded up', () => {
    expect(clock({ version: 1, remaining: 30000 }).seconds()).toBe(30);
    wrapper.unmount();
    expect(clock({ version: 1, remaining: 29001 }).seconds()).toBe(30);
    wrapper.unmount();
    expect(clock({ version: 1, remaining: 500 }).seconds()).toBe(1);
  });

  it('counts down as time passes, and stops at nought', async () => {
    const { seconds } = clock({ version: 1, remaining: 3000 });
    await pass(1600);
    expect(seconds()).toBe(2);
    await pass(1000);
    expect(seconds()).toBe(1);
    await pass(1000);
    expect(seconds()).toBe(0);
    await pass(60000);
    expect(seconds()).toBe(0);
  });

  it('shows the count on the page as it changes', async () => {
    clock({ version: 1, remaining: 3000 });
    expect(wrapper.text()).toBe('3');
    await pass(1600);
    expect(wrapper.text()).toBe('2');
  });

  it('is nought, not less, for a turn that is already out of time', () => {
    expect(clock({ version: 1, remaining: 0 }).seconds()).toBe(0);
    wrapper.unmount();
    expect(clock({ version: 1, remaining: -4000 }).seconds()).toBe(0);
  });

  it('starts again from what the server says with each new version', async () => {
    const { state, seconds } = clock({ version: 1, remaining: 10000 });
    await pass(4000);
    expect(seconds()).toBe(6);
    Object.assign(state, { version: 2, remaining: 20000 });
    await nextTick();
    expect(seconds()).toBe(20);
    await pass(5000);
    expect(seconds()).toBe(15);
  });

  it('starts again for a new version even when the time left is the same number', async () => {
    const { state, seconds } = clock({ version: 1, remaining: 10000 });
    await pass(4000);
    state.version = 2; // the next player's turn: the same limit, a fresh count
    await nextTick();
    expect(seconds()).toBe(10);
  });

  it('goes by its own clock from the moment the version arrived, whatever the time of day is', async () => {
    vi.setSystemTime(new Date('2001-02-03T04:05:06Z'));
    const { seconds } = clock({ version: 1, remaining: 8000 });
    expect(seconds()).toBe(8);
    await pass(3000);
    expect(seconds()).toBe(5);
  });

  it('shows nothing once the turn stops being timed, and counts again when it is', async () => {
    const { state, seconds } = clock({ version: 1, remaining: 10000 });
    Object.assign(state, { version: 2, remaining: null });
    await nextTick();
    expect(seconds()).toBeNull();
    Object.assign(state, { version: 3, remaining: 7000 });
    await nextTick();
    expect(seconds()).toBe(7);
  });

  it('stops its ticker when the component goes away', async () => {
    clock({ version: 1, remaining: 10000 });
    await pass(1000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
