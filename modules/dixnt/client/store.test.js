// The Dixnt store: the game's own view state (Recent moves, the word pop-up, the card lightbox) and the derived values
// its components read.  The room's state and the socket under it are the shared screen's (src/components/GameShell.vue
// over src/useGameSocket.js, both tested there); what is checked here is what Dixnt adds, and that it reads the state
// from that screen and sends through it.
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { cardUrl, createStore } from './store.js';

const user = { id: 1, displayName: 'Ann' };

/**
 * A store over a stand-in for the mounted shell, and `show(next)` to hand it a state as the shell does: the store is
 * told of the state first, with the one it replaces, and then the shell holds it.
 * @param {object | null} [mounted]  false for a shell that is not mounted yet
 * @returns {{ api: object, shell: import('vue').Ref<object | null>, show: (next: object | null) => void }}
 */
function make({ mounted = true } = {}) {
  const shell = ref(mounted ? { state: null, send: vi.fn(async () => ({ ok: true })) } : null);
  const api = createStore({ shell, user });
  const show = (next) => {
    api.onState(next, shell.value.state);
    shell.value.state = next;
  };
  return { api, shell, show };
}

describe('cardUrl()', () => {
  it('pads the card number to four digits and defaults to medium', () => {
    expect(cardUrl(7)).toBe('/assets/dixnt/cards/medium/card_0007.jpg');
    expect(cardUrl('123', 'small')).toBe('/assets/dixnt/cards/small/card_0123.jpg');
    expect(cardUrl(12345)).toBe('/assets/dixnt/cards/medium/card_12345.jpg');
  });
});

describe('the shared screen underneath', () => {
  it('has no state before the shell is mounted, nor before it has been sent one', () => {
    expect(make({ mounted: false }).api.store.state).toBeNull();
    const { api } = make();
    expect(api.store.state).toBeNull();
    expect(api.user).toBe(user);
  });

  it('reads the state the shell holds', () => {
    const { api, show } = make();
    const state = { code: 'cat-dog-fox', you: 1, hostId: 1, players: [] };
    show(state);
    expect(api.store.state).toEqual(state);
    show(null);
    expect(api.store.state).toBeNull();
  });

  it('sends through the shell, and gives back its reply', async () => {
    const { api, shell } = make();
    shell.value.send.mockResolvedValueOnce({ ok: false, error: 'notInHand' });
    expect(await api.send('playCard', { cardId: 4 })).toEqual({ ok: false, error: 'notInHand' });
    expect(shell.value.send).toHaveBeenCalledWith('playCard', { cardId: 4 });
  });
});

describe('state updates', () => {
  it('a null state clears the zoom', () => {
    const { api, show } = make();
    api.store.zoom = { cardId: 3, actions: [] };
    show(null);
    expect(api.store.zoom).toBeNull();
  });

  it('keeps the Recent moves of a round, and drops them in the lobby', () => {
    const { api, show } = make();
    const base = { code: 'a-b-c', turn: 1, completedTurns: 0, totalTurns: 2, chooserId: 1, judging: 'everyone', you: 1, players: [{ id: 1, name: 'Ann', isChooser: true }] };
    show({ ...base, phase: 'word' });
    expect(api.store.log.length).toBeGreaterThan(0);
    show({ ...base, phase: 'lobby' });
    expect(api.store.log).toEqual([]);
  });
});

describe('the word popup', () => {
  const picking = { code: 'a-b-c', phase: 'picking', turn: 1, completedTurns: 0, word: 'sunshine', wordHidden: false, you: 1, players: [] };

  it('is announced when the word is locked in', () => {
    const { api, show } = make();
    show({ ...picking, phase: 'word', word: null });
    show(picking);
    expect(api.store.wordPopup).toMatchObject({ word: 'sunshine', key: '1:0', hidden: false });
  });

  it('is announced to the player kept in the dark without the word, who is told it as the voting opens', () => {
    const { api, show } = make();
    show({ ...picking, phase: 'word', word: null });
    show({ ...picking, word: null, wordHidden: true });
    expect(api.store.wordPopup).toMatchObject({ word: null, hidden: true });
    expect(api.store.imposterWord).toBeNull();
    show({ ...picking, phase: 'voting' });
    expect(api.store.imposterWord).toEqual({ word: 'sunshine', key: '1:0' });
    show({ ...picking, phase: 'word', word: null, turn: 2 });
    expect(api.store.imposterWord).toBeNull();
  });

  it('is not announced by the first state of a game joined or reloaded in the middle of a turn', () => {
    const { api, show } = make();
    show(picking);
    expect(api.store.wordPopup).toBeNull();
  });

  it('does not outlive the game: back in the lobby it is gone, so the next game does not replay it', () => {
    const { api, show } = make();
    show({ ...picking, phase: 'word', word: null });
    show(picking);
    api.store.zoom = { cardId: 3, actions: [] };
    show({ ...picking, phase: 'finished' });
    show({ ...picking, phase: 'lobby', word: null });
    expect(api.store.wordPopup).toBeNull();
    expect(api.store.zoom).toBeNull();
  });
});

describe('derived values', () => {
  const state = {
    code: 'cat-dog-fox',
    hostId: 2,
    you: 2,
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
    const { api, show } = make();
    show(state);
    expect(api.players.value).toHaveLength(2);
    expect(api.nameOf(1)).toBe('Ann');
    expect(api.nameOf('1')).toBe('Ann');
    expect(api.nameOf(99)).toBe('?');
    expect(api.chooser.value.name).toBe('Bob');
    expect(api.isHost.value).toBe(true);
  });

  it('says I am not the host when someone else is', () => {
    const { api, show } = make();
    show({ ...state, hostId: 1 });
    expect(api.isHost.value).toBe(false);
  });

  it('has no chooser when nobody is marked', () => {
    const { api, show } = make();
    show({ ...state, players: [{ id: 1, name: 'Ann' }] });
    expect(api.chooser.value).toBeNull();
  });

  it('exposes cardUrl', () => {
    expect(make().api.cardUrl(5, 'small')).toBe('/assets/dixnt/cards/small/card_0005.jpg');
  });
});
