import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

const fake = { handlers: {}, on: vi.fn((event, handler) => (fake.handlers[event] = handler)), close: vi.fn() };
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fake) }));

const { session } = await import('./session.js');
const { useModuleSocket } = await import('./useModuleSocket.js');

/** Mounts a component that opens the module socket, and returns the wrapper and what the composable gave it. */
function open(options = {}) {
  const out = {};
  const wrapper = mount(
    defineComponent({
      setup() {
        Object.assign(out, useModuleSocket(() => 'hearts', { available: () => true, onSignedOut: vi.fn(), ...options }));
        return () => h('div');
      },
    }),
  );
  return { wrapper, ...out };
}

beforeEach(() => {
  fake.handlers = {};
  fake.on.mockClear();
  fake.close.mockClear();
  Object.assign(session, { user: { id: 1, displayName: 'Ann', avatar: {} }, shop: { balance: 50, items: [] } });
});
afterEach(() => Object.assign(session, { user: null, shop: null }));

describe('useModuleSocket', () => {
  it('connects on mount, tracks the connection and closes on unmount', () => {
    const { wrapper, connected, problem } = open();
    expect(connected.value).toBe(false);
    fake.handlers.connect();
    expect(connected.value).toBe(true);
    expect(problem.value).toBe('');
    fake.handlers.disconnect();
    expect(connected.value).toBe(false);
    wrapper.unmount();
    expect(fake.close).toHaveBeenCalled();
  });

  it('signs the user out through setUser when the server says they are not signed in, so the shop and look go too', () => {
    const onSignedOut = vi.fn();
    const { wrapper } = open({ onSignedOut });
    fake.handlers.connect_error(new Error('Please sign in.'));
    expect(onSignedOut).toHaveBeenCalled();
    expect(session.user).toBeNull();
    expect(session.shop).toBeNull();
    wrapper.unmount();
  });

  it('reports other connection problems without signing out', () => {
    const { wrapper, problem } = open();
    fake.handlers.connect_error(new Error('xhr poll error'));
    expect(problem.value).toMatch(/Could not reach the game/);
    expect(session.user).not.toBeNull();
    wrapper.unmount();
  });

  it('does not connect to a game that is not available', () => {
    const { wrapper, socket, problem } = open({ available: () => false });
    expect(socket.value).toBeNull();
    expect(problem.value).toBe('That game is not available.');
    wrapper.unmount();
  });
});
