// The screen every room-based game draws inside the play field.  Fourteen games hand their lobby and table to this one
// component, so a mistake here is a mistake in all of them.  What is protected is the shape its header describes: a game
// is loading, or not in a game (so the player is offered a new room or an invite code), or in one (the lobby before it
// starts, the table after); the slots are given the state and `send`; a refusal is shown where the player is looking;
// and leaving mid-game asks first when the game says it should.
//
// The socket is a stand-in that records what was sent and answers as the test says, so nothing waits on a server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { i18n } from '../i18n.js';
import { leaveOffer, playBar } from '../playBar.js';
import ErrorToast from './ErrorToast.vue';
import GameShell from './GameShell.vue';
import RoomEntry from './RoomEntry.vue';
import TournamentBar from './TournamentBar.vue';
import TournamentBoard from './TournamentBoard.vue';
import TournamentLobby from './TournamentLobby.vue';
import TournamentSetup from './TournamentSetup.vue';

/** A stand-in socket: records listeners and what was sent, and answers each request with `reply`. */
function fakeSocket({ connected = false, reply = { ok: true } } = {}) {
  const handlers = {};
  return {
    connected,
    sent: [],
    reply,
    on: (event, handler) => (handlers[event] = [...(handlers[event] ?? []), handler]),
    off: (event, handler) => (handlers[event] = (handlers[event] ?? []).filter((other) => other !== handler)),
    emit(event, payload, ack) {
      this.sent.push([event, payload]);
      ack?.(this.reply);
    },
    /** The server says something (or the connection changes). */
    say: (event, ...args) => (handlers[event] ?? []).forEach((handler) => handler(...args)),
    listening: () => Object.values(handlers).flat().length,
  };
}

let wrapper;
let socket;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  playBar.leave = null;
});

/**
 * Mounts the shell as a game would, with a lobby, a table, and an overlay that say what they were given.
 * @param {object} [props]  the shell's props (a socket is made when none is given)
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function shell(props = {}) {
  socket = props.socket ?? fakeSocket();
  wrapper = mount(GameShell, {
    props: { socket, ...props },
    slots: {
      lobby: ({ state, send }) => h('button', { class: 'lobby', onClick: () => send('start', { fast: true }) }, `lobby of ${state.code}`),
      table: ({ state, send }) => h('button', { class: 'table', onClick: () => send('play', { card: 'QS' }) }, `table of ${state.code} in ${state.phase}`),
      overlay: ({ connected }) => h('i', { class: 'overlay' }, connected ? 'online' : 'offline'),
    },
  });
  return wrapper;
}
/** The server sends a new view of the room. */
const state = async (next) => {
  socket.say('state', next);
  await nextTick();
};

describe('GameShell', () => {
  it('says the game is loading until the server has said whether the player is in one', () => {
    shell();
    expect(wrapper.text()).toBe(i18n.global.t('play.loading'));
    expect(wrapper.findComponent(RoomEntry).exists()).toBe(false);
  });

  it("offers a new room or an invite code, in the game's own words, when the player is not in a game", async () => {
    shell({ noun: 'hand of Hearts', intro: 'Avoid the hearts.' });
    await state(null);
    const entry = wrapper.findComponent(RoomEntry);
    expect(entry.exists()).toBe(true);
    expect(entry.props()).toMatchObject({ noun: 'hand of Hearts', intro: 'Avoid the hearts.', busy: false, error: '' });
    expect(wrapper.find('.lobby').exists()).toBe(false);
    expect(wrapper.find('.table').exists()).toBe(false);
    expect(wrapper.find('.overlay').exists()).toBe(false);
  });

  it('picks the invite code up from the address, ready to join', async () => {
    shell({ search: '?boss-aware-you' });
    await state(null);
    expect(wrapper.findComponent(RoomEntry).props('initialCode')).toBe('boss-aware-you');
  });

  it('asks the server for a new room, or to join the one named, when the player chooses', async () => {
    shell();
    await state(null);
    const entry = wrapper.findComponent(RoomEntry);
    entry.vm.$emit('create');
    entry.vm.$emit('join', 'boss-aware-you');
    await flushPromises();
    expect(socket.sent).toEqual([
      ['create', {}],
      ['join', { code: 'boss-aware-you' }],
    ]);
  });

  it('shows a refusal on the entry screen, where the player is looking', async () => {
    shell();
    await state(null);
    socket.reply = { ok: false, error: 'There is no such room.' };
    wrapper.findComponent(RoomEntry).vm.$emit('join', 'boss-aware-you');
    await flushPromises();
    expect(wrapper.findComponent(RoomEntry).props('error')).toBe('There is no such room.');
    expect(wrapper.find('[role="alert"]').text()).toBe('There is no such room.');
  });

  it('draws the lobby before the game starts and the table after, each with the state', async () => {
    shell();
    await state({ code: 'a-b-c', phase: 'lobby' });
    expect(wrapper.find('.lobby').text()).toBe('lobby of a-b-c');
    expect(wrapper.find('.table').exists()).toBe(false);
    expect(wrapper.findComponent(RoomEntry).exists()).toBe(false);
    await state({ code: 'a-b-c', phase: 'playing' });
    expect(wrapper.find('.table').text()).toBe('table of a-b-c in playing');
    expect(wrapper.find('.lobby').exists()).toBe(false);
    await state({ code: 'a-b-c', phase: 'finished' });
    expect(wrapper.find('.table').text()).toBe('table of a-b-c in finished');
  });

  it('lets a game say which phase means "not started yet"', async () => {
    shell({ lobbyPhase: 'waiting' });
    await state({ code: 'a-b-c', phase: 'waiting' });
    expect(wrapper.find('.lobby').exists()).toBe(true);
    await state({ code: 'a-b-c', phase: 'lobby' });
    expect(wrapper.find('.table').exists()).toBe(true);
  });

  it("gives the slots a `send` that reaches the game's socket", async () => {
    shell();
    await state({ code: 'a-b-c', phase: 'lobby' });
    await wrapper.find('.lobby').trigger('click');
    await state({ code: 'a-b-c', phase: 'playing' });
    await wrapper.find('.table').trigger('click');
    expect(socket.sent).toEqual([
      ['start', { fast: true }],
      ['play', { card: 'QS' }],
    ]);
  });

  it('shows a refusal as a toast over the table, and leaves the table where it is', async () => {
    shell();
    await state({ code: 'a-b-c', phase: 'playing' });
    expect(wrapper.findComponent(ErrorToast).exists()).toBe(false);
    socket.reply = { ok: false, error: 'It is not your turn yet.' };
    await wrapper.find('.table').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(ErrorToast).props('text')).toBe('It is not your turn yet.');
    expect(wrapper.find('.table').exists()).toBe(true);
    socket.reply = { ok: true };
    await wrapper.find('.table').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(ErrorToast).exists()).toBe(false); // the next request that works takes it away
  });

  it('tells the overlay whether the server is there, while in a game', async () => {
    shell({ socket: fakeSocket({ connected: true }) });
    await state({ code: 'a-b-c', phase: 'playing' });
    expect(wrapper.find('.overlay').text()).toBe('online');
    socket.say('disconnect');
    await nextTick();
    expect(wrapper.find('.overlay').text()).toBe('offline');
    expect(wrapper.find('.table').exists()).toBe(true); // the table stays on screen while the server is away
    socket.say('connect');
    await nextTick();
    expect(wrapper.find('.overlay').text()).toBe('online');
  });

  it('goes back to the entry screen when the player is no longer in a game', async () => {
    shell();
    await state({ code: 'a-b-c', phase: 'playing' });
    await state(null);
    expect(wrapper.findComponent(RoomEntry).exists()).toBe(true);
    expect(wrapper.find('.table').exists()).toBe(false);
  });

  it('hands each state to the game, with the one it replaces, before the slots are redrawn', async () => {
    const drawn = [];
    const onState = vi.fn(() => drawn.push(wrapper.find('.table').exists() ? wrapper.find('.table').text() : null));
    shell({ onState });
    const first = { code: 'a-b-c', phase: 'playing' };
    const second = { code: 'a-b-c', phase: 'scoring' };
    await state(first);
    await state(second);
    expect(onState.mock.calls).toEqual([
      [first, null],
      [second, first],
    ]);
    expect(drawn).toEqual([null, 'table of a-b-c in playing']); // each time, the page still showed what came before
  });

  it('keeps the room code in the address bar, and takes it out again', async () => {
    const setSearch = vi.fn();
    shell({ setSearch });
    await state({ code: 'a-b-c', phase: 'lobby' });
    expect(setSearch).toHaveBeenLastCalledWith('a-b-c');
    await state(null);
    expect(setSearch).toHaveBeenLastCalledWith('');
  });

  it('offers "Leave game" only while in a game, asking first when the game says leaving is worth a warning', async () => {
    const leaveConfirm = vi.fn((current) => (current.phase === 'playing' ? 'The others will have to stop too.' : ''));
    shell({ leaveConfirm });
    await state(null);
    expect(leaveOffer()).toBeNull();
    await state({ code: 'a-b-c', phase: 'lobby' });
    expect(leaveOffer().confirmText).toBe('');
    const playing = { code: 'a-b-c', phase: 'playing' };
    await state(playing);
    expect(leaveOffer().confirmText).toBe('The others will have to stop too.');
    expect(leaveConfirm).toHaveBeenLastCalledWith(playing);
    await leaveOffer().leave();
    expect(socket.sent.at(-1)).toEqual(['leave', {}]);
  });

  it('follows a leave warning that changes after the game has been drawn', async () => {
    shell({ leaveConfirm: () => 'First warning.' });
    await state({ code: 'a-b-c', phase: 'playing' });
    expect(leaveOffer().confirmText).toBe('First warning.');
    await wrapper.setProps({ leaveConfirm: () => 'Second warning.' });
    await state({ code: 'a-b-c', phase: 'scoring' });
    expect(leaveOffer().confirmText).toBe('Second warning.');
  });

  it('lets the game that draws it read the state and send for itself', async () => {
    shell();
    await state({ code: 'a-b-c', phase: 'playing' });
    expect(wrapper.vm.state).toEqual({ code: 'a-b-c', phase: 'playing' });
    await wrapper.vm.send('undo');
    expect(socket.sent.at(-1)).toEqual(['undo', {}]);
  });

  // ---- tournaments ----
  //
  // A room whose tournament is being set up or played is not a table of the game, and holds more people than the game
  // has seats for, so the site draws it rather than the game: see shared/tournamentRoom.js.  A table *of* a
  // tournament is an ordinary game, with a bar above it saying where the evening has got to.

  const tournament = (extra = {}) => ({ on: true, humans: 2, bots: 2, size: 4, phase: 'lobby', parent: 'a-b-c', here: null, round: 1, rounds: 3, entrants: [], standings: [], tables: [], last: [], yourTable: null, tablesInAll: 1, limits: { min: 3, max: 7, maxEntrants: 16 }, ...extra });

  it('offers the host a tournament under the lobby the game drew', async () => {
    shell();
    await state({ code: 'a-b-c', phase: 'lobby', you: 1, hostId: 1, tournament: tournament({ on: false }) });
    expect(wrapper.find('.lobby').exists()).toBe(true);
    expect(wrapper.findComponent(TournamentSetup).props('isHost')).toBe(true);
    // A game says who its host is in one of three ways, and a view that says none of them is nobody's.
    await state({ code: 'a-b-c', phase: 'lobby', you: 2, hostSeat: 0, tournament: tournament({ on: false }) });
    expect(wrapper.findComponent(TournamentSetup).props('isHost')).toBe(false);
    await state({ code: 'a-b-c', phase: 'lobby', tournament: tournament({ on: false }) });
    expect(wrapper.findComponent(TournamentSetup).props('isHost')).toBe(false);
    await state({ code: 'a-b-c', phase: 'lobby', you: 1, hostId: 1, tournament: tournament({ on: false }) });
    wrapper.findComponent(TournamentSetup).vm.$emit('change', { on: true });
    await flushPromises();
    expect(socket.sent.at(-1)).toEqual(['settings', { tournament: { on: true } }]);
  });

  it("draws the tournament itself instead of the game's screens, in its lobby and while it runs", async () => {
    shell();
    await state({ code: 'a-b-c', phase: 'lobby', you: 1, isHost: true, tournament: tournament() });
    expect(wrapper.find('.lobby').exists()).toBe(false);
    expect(wrapper.findComponent(TournamentLobby).exists()).toBe(true);
    await state({ code: 'a-b-c', phase: 'tournament', you: 1, isHost: true, tournament: tournament({ phase: 'tournament' }) });
    expect(wrapper.find('.table').exists()).toBe(false);
    expect(wrapper.findComponent(TournamentBoard).exists()).toBe(true);
    wrapper.findComponent(TournamentBoard).vm.$emit('go', 'd-e-f');
    await flushPromises();
    expect(socket.sent.at(-1)).toEqual(['join', { code: 'd-e-f' }]);
  });

  it("draws the game as usual at a tournament's table, with the bar above it", async () => {
    shell();
    await state({ code: 'd-e-f', phase: 'playing', you: 1, tournament: tournament({ phase: 'tournament', here: 'd-e-f', yourTable: 'd-e-f' }) });
    expect(wrapper.find('.table').text()).toBe('table of d-e-f in playing');
    expect(wrapper.findComponent(TournamentBar).exists()).toBe(true);
    expect(wrapper.findComponent(TournamentLobby).exists()).toBe(false);
  });

  it('keeps a tournament out of the hands of the game that is drawing it', async () => {
    // A game works something out from each state as it arrives (its log of recent moves), and a tournament's state is
    // not one it could read.  Nor is the state of the room before this one, once somebody has walked between the two.
    const onState = vi.fn();
    shell({ onState });
    const lobby = { code: 'a-b-c', phase: 'lobby', you: 1, isHost: true, tournament: tournament({ on: false }) };
    await state(lobby);
    expect(onState).toHaveBeenLastCalledWith(lobby, null);
    const running = { code: 'a-b-c', phase: 'tournament', you: 1, isHost: true, tournament: tournament({ phase: 'tournament' }) };
    await state(running);
    expect(onState).toHaveBeenLastCalledWith(null, lobby); // the tournament is kept from it; the lobby it replaces is its own
    // Walking into a table is a different room, so the state before it is not one this game may be shown either.
    const table = { code: 'd-e-f', phase: 'playing', you: 1, tournament: tournament({ phase: 'tournament', here: 'd-e-f' }) };
    await state(table);
    expect(onState).toHaveBeenLastCalledWith(table, null);
  });

  it('never warns about leaving a tournament: nothing is being played in it', async () => {
    shell({ leaveConfirm: () => 'The others will have to stop too.' });
    await state({ code: 'a-b-c', phase: 'tournament', you: 1, isHost: true, tournament: tournament({ phase: 'tournament' }) });
    expect(leaveOffer().confirmText).toBe('');
  });

  it('stops listening to the socket and takes "Leave game" away when it goes', async () => {
    shell();
    await state({ code: 'a-b-c', phase: 'playing' });
    expect(socket.listening()).toBeGreaterThan(0);
    wrapper.unmount();
    wrapper = null;
    expect(socket.listening()).toBe(0);
    expect(leaveOffer()).toBeNull();
  });
});
