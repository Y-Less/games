import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardUrl, createStore } from './store.js';

/** A minimal fake of the socket.io client: records handlers and emits, and lets a test trigger events. */
function fakeSocket({ connected = false, replies = {} } = {}) {
  const handlers = {};
  const socket = {
    connected,
    handlers,
    emitted: [],
    on: vi.fn((event, fn) => ((handlers[event] ??= new Set()).add(fn), socket)),
    off: vi.fn((event, fn) => (handlers[event]?.delete(fn), socket)),
    emit: vi.fn((event, payload, ack) => {
      socket.emitted.push([event, payload]);
      const reply = typeof replies[event] === 'function' ? replies[event](payload) : replies[event];
      if (ack) queueMicrotask(() => ack(reply));
    }),
    trigger: (event, ...args) => [...(handlers[event] ?? [])].forEach((fn) => fn(...args)),
  };
  return socket;
}

const user = { id: 1, name: 'Ann' };
let setSearch;
let created;

function make({ socket = fakeSocket(), search = '' } = {}) {
  setSearch = vi.fn();
  const api = createStore({ socket, user, search, setSearch });
  created = api;
  return { api, socket };
}
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  created?.dispose();
  created = null;
  vi.useRealTimers();
});

describe('cardUrl()', () => {
  it('pads the card number to four digits and defaults to medium', () => {
    expect(cardUrl(7)).toBe('/assets/dixnt/cards/medium/card_0007.jpg');
    expect(cardUrl('123', 'small')).toBe('/assets/dixnt/cards/small/card_0123.jpg');
    expect(cardUrl(12345)).toBe('/assets/dixnt/cards/medium/card_12345.jpg');
  });
});

describe('createStore() initial state', () => {
  it('reads the code from an invite link and the connection state from the socket', () => {
    const { api } = make({ socket: fakeSocket({ connected: true, replies: { resume: { ok: true } } }), search: '?Boss-Aware-You' });
    expect(api.store.code).toBe('boss-aware-you');
    expect(api.store.connected).toBe(true);
    expect(api.store.state).toBeNull();
    expect(api.user).toBe(user);
  });

  it('ignores a search string that is not a code', () => {
    expect(make({ search: '?nonsense' }).api.store.code).toBe('');
  });

  it('registers its handlers and removes them on dispose', () => {
    const { api, socket } = make();
    expect(Object.keys(socket.handlers).sort()).toEqual(['connect', 'disconnect', 'state']);
    api.dispose();
    for (const set of Object.values(socket.handlers)) expect(set.size).toBe(0);
  });
});

describe('connection handling', () => {
  it('on connect it resumes with the current code and marks the session checked', async () => {
    const { api, socket } = make({ socket: fakeSocket({ replies: { resume: { ok: true } } }), search: '?boss-aware-you' });
    expect(api.store.checkedSession).toBe(false);
    socket.trigger('connect');
    await settle();
    expect(api.store.connected).toBe(true);
    expect(socket.emitted).toEqual([['resume', { code: 'boss-aware-you' }]]);
    expect(api.store.checkedSession).toBe(true);
    expect(api.store.toast).toBe('');
  });

  it('looks the code up when resuming fails, quietly', async () => {
    const socket = fakeSocket({ replies: { resume: { ok: false, error: 'No game.' }, lookup: { exists: true } } });
    const { api } = make({ socket, search: '?boss-aware-you' });
    socket.trigger('connect');
    await settle();
    expect(socket.emitted.map((e) => e[0])).toEqual(['resume', 'lookup']);
    expect(socket.emitted[1][1]).toEqual({ code: 'boss-aware-you' });
    expect(api.store.codeExists).toBe(true);
    expect(api.store.toast).toBe('');
  });

  it('records that a game does not exist', async () => {
    const socket = fakeSocket({ replies: { resume: { ok: false }, lookup: { exists: false } } });
    const { api } = make({ socket, search: '?boss-aware-you' });
    socket.trigger('connect');
    await settle();
    expect(api.store.codeExists).toBe(false);
  });

  it('does not look anything up when there is no code', async () => {
    const socket = fakeSocket({ replies: { resume: { ok: false } } });
    const { api } = make({ socket });
    socket.trigger('connect');
    await settle();
    expect(socket.emitted.map((e) => e[0])).toEqual(['resume']);
    expect(api.store.codeExists).toBeNull();
    expect(api.store.checkedSession).toBe(true);
  });

  it('resumes straight away when the socket is already connected', async () => {
    const socket = fakeSocket({ connected: true, replies: { resume: { ok: true } } });
    const { api } = make({ socket });
    await settle();
    expect(socket.emitted[0][0]).toBe('resume');
    expect(api.store.checkedSession).toBe(true);
  });

  it('tracks disconnection', () => {
    const { api, socket } = make({ socket: fakeSocket({ connected: true }) });
    socket.trigger('disconnect');
    expect(api.store.connected).toBe(false);
  });

  it('discards a stale lookup answer if the code changed meanwhile', async () => {
    let answer;
    const socket = fakeSocket();
    socket.emit = vi.fn((event, payload, ack) => {
      if (event === 'lookup') answer = () => ack({ exists: true });
      else ack({ ok: false });
    });
    const { api } = make({ socket, search: '?boss-aware-you' });
    socket.trigger('connect');
    await settle();
    api.goHome();
    answer();
    await settle();
    expect(api.store.codeExists).toBeNull();
  });
});

describe('state updates', () => {
  it('stores the state, adopts its code and updates the address', () => {
    const { api, socket } = make();
    const state = { code: 'cat-dog-fox', me: { id: 1 }, hostId: 1, players: [] };
    socket.trigger('state', state);
    expect(api.store.state).toEqual(state);
    expect(api.store.code).toBe('cat-dog-fox');
    expect(setSearch).toHaveBeenCalledWith('cat-dog-fox');
  });

  it('a null state clears the zoom and looks the code up again', async () => {
    const socket = fakeSocket({ replies: { lookup: { exists: false } } });
    const { api } = make({ socket, search: '?cat-dog-fox' });
    api.store.zoom = { cardId: 3, actions: [] };
    socket.trigger('state', null);
    await settle();
    expect(api.store.zoom).toBeNull();
    expect(socket.emitted).toEqual([['lookup', { code: 'cat-dog-fox' }]]);
    expect(api.store.codeExists).toBe(false);
  });
});

describe('actions', () => {
  it('createGame and join send the right events', async () => {
    const socket = fakeSocket({ replies: { create: { ok: true }, join: { ok: true } } });
    const { api } = make({ socket, search: '?cat-dog-fox' });
    expect(await api.createGame()).toEqual({ ok: true });
    await api.join();
    await api.join('new-code-here');
    expect(socket.emitted).toEqual([
      ['create', {}],
      ['join', { code: 'cat-dog-fox' }],
      ['join', { code: 'new-code-here' }],
    ]);
  });

  it('send resolves with the reply and toasts an error', async () => {
    const socket = fakeSocket({ replies: { play: { ok: false, error: 'Not your turn.' } } });
    const { api } = make({ socket });
    expect(await api.send('play', { card: 1 })).toEqual({ ok: false, error: 'Not your turn.' });
    expect(api.store.toast).toBe('Not your turn.');
  });

  it('send stays quiet when asked to, and treats a missing reply as a failure', async () => {
    const socket = fakeSocket({ replies: { play: { ok: false, error: 'No.' } } });
    const { api } = make({ socket });
    await api.send('play', {}, { quiet: true });
    expect(api.store.toast).toBe('');
    expect(await api.send('silent')).toEqual({ ok: false });
    expect(api.store.toast).toBe('');
  });

  it('a successful reply shows no toast', async () => {
    const { api } = make({ socket: fakeSocket({ replies: { ping: { ok: true } } }) });
    await api.send('ping');
    expect(api.store.toast).toBe('');
  });

  it('a toast disappears after four seconds, and a newer one restarts the clock', () => {
    const { api } = make();
    api.showToast('First');
    vi.advanceTimersByTime(3000);
    api.showToast('Second');
    vi.advanceTimersByTime(3999);
    expect(api.store.toast).toBe('Second');
    vi.advanceTimersByTime(1);
    expect(api.store.toast).toBe('');
  });

  it('dispose cancels a pending toast timer', () => {
    const { api } = make();
    api.showToast('Hi');
    api.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('goHome forgets the code and clears the address', () => {
    const { api } = make({ search: '?cat-dog-fox' });
    api.store.codeExists = true;
    api.goHome();
    expect(api.store.code).toBe('');
    expect(api.store.codeExists).toBeNull();
    expect(setSearch).toHaveBeenCalledWith('');
  });
});

describe('derived values', () => {
  const state = {
    code: 'cat-dog-fox',
    hostId: 2,
    me: { id: 2 },
    players: [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bob', isChooser: true }],
  };

  it('are empty without a state', () => {
    const { api } = make();
    expect(api.players.value).toEqual([]);
    expect(api.chooser.value).toBeNull();
    expect(api.nameOf(1)).toBe('?');
    expect(api.isHost.value).toBe(false);
  });

  it('follow the state', () => {
    const { api, socket } = make();
    socket.trigger('state', state);
    expect(api.players.value).toHaveLength(2);
    expect(api.nameOf(1)).toBe('Ann');
    expect(api.nameOf(99)).toBe('?');
    expect(api.chooser.value.name).toBe('Bob');
    expect(api.isHost.value).toBe(true);
  });

  it('says I am not the host when someone else is', () => {
    const { api, socket } = make();
    socket.trigger('state', { ...state, hostId: 1 });
    expect(api.isHost.value).toBe(false);
  });

  it('has no chooser when nobody is marked', () => {
    const { api, socket } = make();
    socket.trigger('state', { ...state, players: [{ id: 1, name: 'Ann' }] });
    expect(api.chooser.value).toBeNull();
  });

  it('exposes cardUrl', () => {
    expect(make().api.cardUrl(5, 'small')).toBe('/assets/dixnt/cards/small/card_0005.jpg');
  });
});
