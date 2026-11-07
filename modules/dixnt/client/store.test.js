// The Dixnt store: the game's own view state (Recent moves, the word pop-up, the card lightbox) and the derived values
// its components read.  The socket plumbing under it is the site's (src/useGameSocket.js, tested there); what is
// checked here is what Dixnt adds, and that it is wired to that plumbing at all.  The store is built from a component's
// setup, as the root component builds it, so these tests mount one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
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
      if (ack) ack(reply);
    }),
    trigger: (event, ...args) => [...(handlers[event] ?? [])].forEach((fn) => fn(...args)),
  };
  return socket;
}

const user = { id: 1, displayName: 'Ann' };
let wrapper;
let setSearch;

/** Mounts a component that builds the store, and returns what it gave back. */
function make({ socket = fakeSocket(), search = '', leaveConfirm } = {}) {
  setSearch = vi.fn();
  let api;
  wrapper = mount(
    defineComponent({
      setup() {
        api = createStore({ socket, user, search, setSearch, leaveConfirm });
        return () => h('div');
      },
    }),
  );
  return { api, socket };
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('cardUrl()', () => {
  it('pads the card number to four digits and defaults to medium', () => {
    expect(cardUrl(7)).toBe('/assets/dixnt/cards/medium/card_0007.jpg');
    expect(cardUrl('123', 'small')).toBe('/assets/dixnt/cards/small/card_0123.jpg');
    expect(cardUrl(12345)).toBe('/assets/dixnt/cards/medium/card_12345.jpg');
  });
});

describe('createStore() initial state', () => {
  it('reads the code from an invite link and the connection from the socket', () => {
    const { api } = make({ socket: fakeSocket({ connected: true, replies: { resume: { ok: true } } }), search: '?boss-aware-you' });
    expect(api.initialCode).toBe('boss-aware-you');
    expect(api.store.connected).toBe(true);
    expect(api.store.state).toBeNull();
    expect(api.user).toBe(user);
  });

  it('registers its handlers and takes them off again when the component goes', () => {
    const { socket } = make();
    expect(Object.keys(socket.handlers).sort()).toEqual(['connect', 'disconnect', 'state']);
    wrapper.unmount();
    wrapper = null;
    for (const set of Object.values(socket.handlers)) expect(set.size).toBe(0);
  });
});

describe('the shared plumbing underneath', () => {
  it('asks to be put back in the room on every connection, with the invite code the first time', async () => {
    const socket = fakeSocket({ replies: { resume: { ok: true } } });
    make({ socket, search: '?boss-aware-you' });
    socket.trigger('connect');
    await flushPromises();
    expect(socket.emitted).toEqual([['resume', { code: 'boss-aware-you' }]]);
    socket.trigger('connect');
    await flushPromises();
    expect(socket.emitted[1]).toEqual(['resume', { code: '' }]);
  });

  it("keeps the server's refusal, in the player's language, for the start screen", async () => {
    const socket = fakeSocket({ replies: { resume: { ok: false, error: 'noGameWithCode' } } });
    const { api } = make({ socket, search: '?boss-aware-you' });
    socket.trigger('connect');
    await flushPromises();
    expect(api.store.notice).toBe('No game has that code.');
  });

  it('tracks the connection going and coming back', async () => {
    const socket = fakeSocket({ connected: true, replies: { resume: { ok: true } } });
    const { api } = make({ socket });
    expect(api.store.connected).toBe(true);
    socket.trigger('disconnect');
    await flushPromises();
    expect(api.store.connected).toBe(false);
    socket.trigger('connect');
    await flushPromises();
    expect(api.store.connected).toBe(true);
  });

  it("send resolves with the reply and shows a refusal, in the player's language", async () => {
    const replies = { play: { ok: false, error: 'notYourTurn' }, set: { ok: false, error: 'handSizeRange', params: { min: 3, max: 12 } }, ping: { ok: true } };
    const { api } = make({ socket: fakeSocket({ replies }) });
    expect(await api.send('play', { card: 1 })).toEqual({ ok: false, error: 'notYourTurn' });
    expect(api.store.notice).toBe('It is not your turn.');
    await api.send('set', { size: 99 });
    expect(api.store.notice).toBe('Hand size must be between 3 and 12.');
    await api.send('ping');
    expect(api.store.notice).toBe('');
  });
});

describe('state updates', () => {
  it('stores the state and puts its code in the address', async () => {
    const { api, socket } = make();
    const state = { code: 'cat-dog-fox', me: { id: 1 }, hostId: 1, players: [] };
    socket.trigger('state', state);
    await flushPromises();
    expect(api.store.state).toEqual(state);
    expect(api.store.loaded).toBe(true);
    expect(setSearch).toHaveBeenCalledWith('cat-dog-fox');
  });

  it('a null state clears the zoom, empties the address and asks the server for nothing more', async () => {
    const socket = fakeSocket();
    const { api } = make({ socket, search: '?cat-dog-fox' });
    api.store.zoom = { cardId: 3, actions: [] };
    socket.trigger('state', null);
    await flushPromises();
    expect(api.store.zoom).toBeNull();
    expect(setSearch).toHaveBeenCalledWith('');
    expect(socket.emitted).toEqual([]);
  });

  it('keeps the Recent moves of a round, and drops them in the lobby', async () => {
    const { api, socket } = make();
    const base = { code: 'a-b-c', round: 1, completedRounds: 0, totalRounds: 2, chooserId: 1, judging: 'everyone', me: { id: 1 }, players: [{ id: 1, name: 'Ann', isChooser: true }] };
    socket.trigger('state', { ...base, phase: 'word' });
    await flushPromises();
    expect(api.store.log.length).toBeGreaterThan(0);
    socket.trigger('state', { ...base, phase: 'lobby' });
    await flushPromises();
    expect(api.store.log).toEqual([]);
  });
});

describe('the word popup', () => {
  const picking = { code: 'a-b-c', phase: 'picking', round: 1, completedRounds: 0, word: 'sunshine', wordHidden: false, me: { id: 1 }, players: [] };

  it('is announced when the word is locked in', () => {
    const { api, socket } = make();
    socket.trigger('state', { ...picking, phase: 'word', word: null });
    socket.trigger('state', picking);
    expect(api.store.wordPopup).toMatchObject({ word: 'sunshine', key: '1:0', hidden: false });
  });

  it('does not outlive the game: back in the lobby it is gone, so the next game does not replay it', () => {
    const { api, socket } = make();
    socket.trigger('state', { ...picking, phase: 'word', word: null });
    socket.trigger('state', picking);
    api.store.zoom = { cardId: 3, actions: [] };
    socket.trigger('state', { ...picking, phase: 'finished' });
    socket.trigger('state', { ...picking, phase: 'lobby', word: null });
    expect(api.store.wordPopup).toBeNull();
    expect(api.store.zoom).toBeNull();
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

  it('follow the state, and name a player whose id arrived as text', () => {
    const { api, socket } = make();
    socket.trigger('state', state);
    expect(api.players.value).toHaveLength(2);
    expect(api.nameOf(1)).toBe('Ann');
    expect(api.nameOf('1')).toBe('Ann');
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
