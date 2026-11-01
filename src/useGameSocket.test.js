import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { leaveOffer, playBar } from './playBar.js';
import { ACK_TIMEOUT_MS, inviteFrom, useGameSocket } from './useGameSocket.js';

/** A stand-in socket: records listeners and emitted events, and answers with `reply` (nothing when undefined). */
function fakeSocket({ connected = true, reply = { ok: true } } = {}) {
  const handlers = {};
  return {
    connected,
    emitted: [],
    reply,
    on: vi.fn((e, f) => (handlers[e] = [...(handlers[e] ?? []), f])),
    off: vi.fn((e, f) => (handlers[e] = (handlers[e] ?? []).filter((x) => x !== f))),
    emit(event, payload, ack) {
      this.emitted.push([event, payload]);
      if (this.reply !== undefined) ack?.(this.reply);
    },
    fire: (e, ...args) => (handlers[e] ?? []).forEach((f) => f(...args)),
    handlers,
  };
}

/** Mounts a component that uses the composable and returns what it gave back. */
function mountWith(socket, options = {}) {
  let api;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useGameSocket({ socket, ...options });
        return () => h('div');
      },
    }),
  );
  return { api, wrapper };
}

describe('inviteFrom', () => {
  it('takes the leading question mark off', () => {
    expect(inviteFrom('?boss-aware-you')).toBe('boss-aware-you');
    expect(inviteFrom('')).toBe('');
    expect(inviteFrom(undefined)).toBe('');
  });
});

describe('useGameSocket', () => {
  it('resumes on mount when already connected, using the invite once', () => {
    const socket = fakeSocket();
    const { api } = mountWith(socket, { search: '?boss-aware-you' });
    expect(api.initialCode).toBe('boss-aware-you');
    expect(socket.emitted).toEqual([['resume', { code: 'boss-aware-you' }]]);
    socket.fire('connect');
    expect(socket.emitted[1]).toEqual(['resume', { code: '' }]);
  });

  it('waits for the connection when not yet connected, then resumes with the room code once in a room', () => {
    const socket = fakeSocket({ connected: false });
    const { api } = mountWith(socket);
    expect(socket.emitted).toEqual([]);
    socket.fire('connect');
    expect(socket.emitted).toEqual([['resume', { code: '' }]]);
    socket.fire('state', { code: 'a-b-c', phase: 'lobby' });
    socket.fire('connect');
    expect(socket.emitted[1]).toEqual(['resume', { code: 'a-b-c' }]);
    expect(api.state.value.code).toBe('a-b-c');
  });

  it('shows states, marks them loaded and keeps the address bar in step', () => {
    const socket = fakeSocket({ connected: false });
    const setSearch = vi.fn();
    const { api } = mountWith(socket, { setSearch });
    expect(api.loaded.value).toBe(false);
    socket.fire('state', null);
    expect(api.loaded.value).toBe(true);
    expect(api.state.value).toBe(null);
    expect(setSearch).toHaveBeenLastCalledWith('');
    socket.fire('state', { code: 'x-y-z' });
    expect(setSearch).toHaveBeenLastCalledWith('x-y-z');
  });

  it('calls onState with the new and previous states before replacing', () => {
    const socket = fakeSocket({ connected: false });
    const seen = [];
    mountWith(socket, { onState: (next, previous) => seen.push([next?.n, previous?.n]) });
    socket.fire('state', { n: 1 });
    socket.fire('state', { n: 2 });
    socket.fire('state', null);
    expect(seen).toEqual([
      [1, undefined],
      [2, 1],
      [undefined, 2],
    ]);
  });

  it('send resolves with the reply, sets the notice on a refusal and clears it on the next request', async () => {
    const socket = fakeSocket({ connected: false });
    const { api } = mountWith(socket);
    socket.reply = { ok: false, error: 'No such game' };
    expect(await api.send('join', { code: 'q' })).toEqual({ ok: false, error: 'No such game' });
    expect(api.notice.value).toBe('No such game');
    socket.reply = { ok: true };
    await api.send('create');
    expect(api.notice.value).toBe('');
    expect(api.busy.value).toBe(false);
  });

  it('send reports a silent server as a failure', async () => {
    const socket = fakeSocket({ connected: false, reply: null });
    const { api } = mountWith(socket);
    expect(await api.send('create')).toEqual({ ok: false });
    expect(api.notice.value).toBe('The server did not answer.');
  });

  it('gives up on a request the server never answers, so busy cannot stick', async () => {
    vi.useFakeTimers();
    try {
      const socket = fakeSocket({ connected: false });
      socket.emit = () => {}; // emits, but no ack ever comes
      const { api } = mountWith(socket);
      const pending = api.send('create');
      expect(api.busy.value).toBe(true);
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + 1);
      expect(await pending).toEqual({ ok: false });
      expect(api.busy.value).toBe(false);
      expect(api.notice.value).toBe('The server did not answer.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is busy while waiting for an answer', async () => {
    const socket = fakeSocket({ connected: false });
    const { api } = mountWith(socket);
    let ack;
    socket.emit = (e, p, a) => (ack = a);
    const pending = api.send('create');
    expect(api.busy.value).toBe(true);
    ack({ ok: true });
    await pending;
    expect(api.busy.value).toBe(false);
  });

  it('offers Leave only in a room, with the game\'s confirmation text, and leaving sends leave', async () => {
    const socket = fakeSocket({ connected: false });
    mountWith(socket, { leaveConfirm: (s) => (s.phase === 'playing' ? 'Sure?' : '') });
    expect(leaveOffer()).toBe(null);
    socket.fire('state', { code: 'a', phase: 'lobby' });
    expect(leaveOffer().confirmText).toBe('');
    socket.fire('state', { code: 'a', phase: 'playing' });
    const offer = leaveOffer();
    expect(offer.confirmText).toBe('Sure?');
    await offer.leave();
    expect(socket.emitted.at(-1)).toEqual(['leave', {}]);
  });

  it('removes its listeners and the Leave button on unmount', () => {
    const socket = fakeSocket({ connected: false });
    const { wrapper } = mountWith(socket);
    expect(playBar.leave).not.toBe(null);
    wrapper.unmount();
    expect(socket.handlers.state).toEqual([]);
    expect(socket.handlers.connect).toEqual([]);
    expect(playBar.leave).toBe(null);
  });
});
