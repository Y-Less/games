import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import GameStatus from './GameStatus.vue';
import YourTurnPopup from './YourTurnPopup.vue';

let wrapper;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  wrapper?.unmount();
  vi.useRealTimers();
});
const popup = () => document.body.querySelector('.your-turn');
const make = (props = {}) => (wrapper = mount(YourTurnPopup, { props, attachTo: document.body }));
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('YourTurnPopup', () => {
  it('shows nothing while it is not your turn', async () => {
    make({ active: false });
    await settle();
    expect(popup()).toBeNull();
  });

  it('tells you it is your turn the moment it is, politely, with an OK button', async () => {
    make({ active: true });
    await settle();
    expect(popup().textContent).toContain("It's your turn");
    expect(popup().getAttribute('role')).toBe('status');
    expect(popup().getAttribute('aria-live')).toBe('polite');
    expect(popup().querySelector('button').textContent).toBe('OK');
  });

  it('closes itself after 3 seconds, and not before', async () => {
    make({ active: true });
    await settle();
    await vi.advanceTimersByTimeAsync(2900);
    expect(popup()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(popup()).toBeNull();
  });

  it('closes at once when OK is clicked, and stays closed', async () => {
    make({ active: true });
    await settle();
    popup().querySelector('button').click();
    await settle();
    expect(popup()).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(popup()).toBeNull();
  });

  it('closes when the turn ends, and appears again for the next turn', async () => {
    make({ active: true });
    await settle();
    await wrapper.setProps({ active: false });
    await settle();
    expect(popup()).toBeNull();
    await wrapper.setProps({ active: true });
    await settle();
    expect(popup()).not.toBeNull();
  });

  it('gives a second turn its own full 3 seconds', async () => {
    make({ active: true });
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    await wrapper.setProps({ active: false });
    await wrapper.setProps({ active: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(popup()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1100);
    expect(popup()).toBeNull();
  });

  it('can say something else and stay as long as it is told to', async () => {
    make({ active: true, message: 'Your move, Ann', duration: 8000 });
    await settle();
    expect(popup().textContent).toContain('Your move, Ann');
    await vi.advanceTimersByTimeAsync(7900);
    expect(popup()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(popup()).toBeNull();
  });

  it('leaves nothing behind, and no timer running, when it is taken away', async () => {
    make({ active: true });
    await settle();
    wrapper.unmount();
    wrapper = null;
    expect(popup()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('GameStatus turn pop-up', () => {
  it('shows the pop-up when the status becomes yours, in every game that sets `mine`', async () => {
    wrapper = mount(GameStatus, { props: { headline: 'Waiting for Bob…', mine: false }, attachTo: document.body });
    await settle();
    expect(popup()).toBeNull();
    await wrapper.setProps({ headline: 'Your turn: play a card.', mine: true });
    await settle();
    expect(popup().textContent).toContain("It's your turn");
  });

  it('can leave the pop-up out', async () => {
    wrapper = mount(GameStatus, { props: { headline: 'Your turn', mine: true, popup: false }, attachTo: document.body });
    await settle();
    expect(popup()).toBeNull();
  });
});
