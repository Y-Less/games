import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as game from '../game.js';
import { chooseColumnFor, chooseMove } from '../bot.js';
import Azulejo from './Azulejo.vue';
import Lobby from './Lobby.vue';
import Table from './Table.vue';
import Workshop from './Workshop.vue';
import Board from './Board.vue';
import Tile from './Tile.vue';
import { boardCell, boardSize, plateLayout } from './layout.js';
import { leaveOffer, playBar } from '../../../src/playBar.js';
import TilingSummary from './TilingSummary.vue';

// (The shared test kit imports the database, which a browser-style test cannot load, so the few helpers are repeated.)
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function playingRoom(n, { seed = 1, free = false } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: n, settings: { freeWall: free } });
  for (let i = 2; i <= n; i++) expect(game.addHuman(room, i, `p${i}`).ok).toBe(true);
  expect(game.start(room, 1, rng).ok).toBe(true);
  return { room, rng };
}
function driveStep(room, rng) {
  if (room.phase === 'tiling') {
    const seat = room.pending.findIndex(Boolean);
    expect(game.chooseColumn(room, seat, { col: chooseColumnFor(room, seat, rng) }, rng).ok).toBe(true);
    return true;
  }
  if (room.phase !== 'playing') return false;
  expect(game.takeTiles(room, room.turn, chooseMove(room, room.turn, rng), rng).ok).toBe(true);
  return true;
}

// ---- helpers: real server views, so the tests follow the real state shape ----
const lobbyRoom = (size = 4, settings = {}) => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', size, settings });
const lobbyView = (room = lobbyRoom()) => game.viewFor(room, 1);
/** A playing view for seat 0 (user 1) with the turn forced to the given seat. */
function playView({ turn = 0, n = 2, free = false, extra = {} } = {}) {
  const { room } = playingRoom(n, { seed: 4, free });
  return { room, view: { ...game.viewFor(room, 1), turn, ...extra } };
}
function finishedView(n = 2) {
  const { room, rng } = playingRoom(n, { seed: 9 });
  for (let i = 0; i < 5000 && room.phase !== 'finished'; i++) if (!driveStep(room, rng)) break;
  expect(room.phase).toBe('finished');
  return game.viewFor(room, 1);
}
const makeSend = (reply = { ok: true }) => vi.fn(() => Promise.resolve(reply));
const mountTable = (state, send = makeSend(), attach = false) => ({ send, w: mount(Table, { props: { state, send }, attachTo: attach ? document.body : undefined }) });
const button = (w, text) => w.findAll('button').find((b) => b.text().includes(text));
const plateTile = (w, f, i = 0) => w.findAll('.plate')[f].findAll('button.pick')[i];
const lineButtons = (w) => w.find('[aria-label="Pattern lines"]').findAll('.line');
const floor = (w) => w.find('[aria-label="Floor line"]');

function fakeSocket(connected = false) {
  const handlers = {};
  return {
    connected,
    handlers,
    emit: vi.fn((event, payload, ack) => ack?.({ ok: true })),
    on: vi.fn((e, f) => (handlers[e] = f)),
    off: vi.fn((e) => delete handlers[e]),
  };
}

describe('Azulejo shell', () => {
  it('moves from loading to entry, lobby and table', async () => {
    const socket = fakeSocket();
    const setSearch = vi.fn();
    const w = mount(Azulejo, { props: { socket, setSearch } });
    expect(w.text()).toContain('Loading your game');
    socket.handlers.state(null);
    await flushPromises();
    await button(w, 'Start a new').trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('create', {}, expect.any(Function));
    socket.handlers.state(lobbyView());
    await flushPromises();
    expect(w.text()).toContain('Rules for this game');
    expect(setSearch).toHaveBeenLastCalledWith('a-b-c');
    socket.handlers.state(playView().view);
    await flushPromises();
    expect(w.find('.table-view').exists()).toBe(true);
    socket.handlers.state(null);
    await flushPromises();
    expect(setSearch).toHaveBeenLastCalledWith('');
  });

  it('resumes with the invite code, joins and reports errors', async () => {
    const socket = fakeSocket(true);
    const w = mount(Azulejo, { props: { socket, search: '?x-y-z' } });
    expect(socket.emit).toHaveBeenCalledWith('resume', { code: 'x-y-z' }, expect.any(Function));
    socket.handlers.state(null);
    await flushPromises();
    await w.find('input').setValue('boss-aware-you');
    await w.find('form').trigger('submit');
    expect(socket.emit).toHaveBeenCalledWith('join', { code: 'boss-aware-you' }, expect.any(Function));
    socket.emit = vi.fn((e, p, ack) => ack({ ok: false, error: 'No such game.' }));
    await button(w, 'Start a new').trigger('click');
    await flushPromises();
    expect(w.find('[role=alert]').text()).toBe('No such game.');
  });

  it('offers Leave game to the site header while in a room, confirming only mid-game', async () => {
    const socket = fakeSocket();
    const w = mount(Azulejo, { props: { socket } });
    expect(leaveOffer()).toBeNull();
    socket.handlers.state(null);
    await flushPromises();
    expect(leaveOffer()).toBeNull();
    socket.handlers.state(lobbyView());
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('');
    socket.handlers.state(playView().view);
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('A computer player takes your seat if you leave.');
    socket.emit.mockClear();
    await leaveOffer().leave();
    expect(socket.emit).toHaveBeenCalledWith('leave', {}, expect.any(Function));
    socket.handlers.state(finishedView());
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('');
    w.unmount();
    expect(playBar.leave).toBeNull();
  });

  it('unsubscribes on unmount', () => {
    const socket = fakeSocket();
    mount(Azulejo, { props: { socket } }).unmount();
    expect(socket.off).toHaveBeenCalledWith('state', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('connect', expect.any(Function));
  });
});

describe('Azulejo lobby', () => {
  it('lets the host change size, the free wall rule and seats', async () => {
    const send = makeSend();
    const w = mount(Lobby, { props: { state: lobbyView(), send } });
    expect(w.text()).toContain('a-b-c');
    expect(w.text()).toContain('9 display plates');
    await button(w, '3 players').trigger('click');
    expect(send).toHaveBeenCalledWith('size', { seats: 3 });
    await w.find('input[type=checkbox]').setValue(true);
    expect(send).toHaveBeenCalledWith('settings', { freeWall: true });
    await button(w, 'Add a computer player').trigger('click');
    expect(send).toHaveBeenCalledWith('addBot', { seat: 1 });
    expect(button(w, 'Leave game')).toBeUndefined(); // it is in the site's header now
  });

  it('disables settings for non-hosts and sizes below the seated count', () => {
    const room = lobbyRoom();
    game.addHuman(room, 2, 'bob');
    game.addHuman(room, 3, 'cat');
    const guest = mount(Lobby, { props: { state: game.viewFor(room, 2), send: makeSend() } });
    expect(guest.find('fieldset').attributes('disabled')).toBeDefined();
    expect(guest.find('input[type=checkbox]').attributes('disabled')).toBeDefined();
    expect(guest.text()).toContain('Only the host can change these');
    const host = mount(Lobby, { props: { state: game.viewFor(room, 1), send: makeSend() } });
    expect(button(host, '2 players').attributes('disabled')).toBeDefined();
    expect(button(host, '3 players').attributes('disabled')).toBeUndefined();
  });

  it('describes the free wall rule when on', () => {
    const w = mount(Lobby, { props: { state: lobbyView(lobbyRoom(4, { freeWall: true })), send: makeSend() } });
    expect(w.find('.rule-note').text()).toContain('wall starts blank');
    expect(w.find('input[type=checkbox]').element.checked).toBe(true);
  });
});

describe('Azulejo table: playing', () => {
  it('renders plates, centre, boards, lid, scoreboard and the log', () => {
    const { view } = playView({ n: 3 });
    const { w } = mountTable(view);
    expect(w.findAll('.plate')).toHaveLength(7);
    expect(w.findAll('.plate').every((p) => p.findAll('button.pick').length === 4)).toBe(true);
    expect(w.find('[aria-label="The centre"]').exists()).toBe(true);
    expect(w.findAll('section.board')).toHaveLength(1); // only yours: the others open from the score bar
    expect(w.findAll('.score-bar button.chip-button')).toHaveLength(3);
    expect(w.find('.others').exists()).toBe(false);
    expect(w.findAll('[aria-label="Pattern lines"] .line')).toHaveLength(5);
    expect(w.text()).toContain('Round 1');
    expect(w.find('.game-status').text()).toContain('First-player marker: in the centre');
    expect(w.findAll('.lid-count')).toHaveLength(5);
    expect(w.findComponent({ name: 'ScoreBoard' }).exists()).toBe(true);
    expect(w.find('[aria-label="Recent moves"]').exists()).toBe(true);
    expect(w.find('[aria-label="Status"]').exists()).toBe(true);
    expect(w.find('[data-fits-window]').exists()).toBe(true);
  });

  it('opens the other players boards from their score bar chips, one at a time; yours is one too', async () => {
    const { w } = mountTable(playView({ n: 3 }).view);
    const bars = w.findAll('.score-bar button.chip-button');
    expect(bars.map((b) => b.text())).toEqual([expect.stringContaining('p1'), expect.stringContaining('p2'), expect.stringContaining('p3')]);
    expect(bars.map((b) => b.attributes('aria-label'))).toEqual(["Show p1's details", "Show p2's details", "Show p3's details"]);
    expect(w.findAll('.popup')).toHaveLength(0);
    await bars[0].trigger('click'); // yours opens too
    expect(w.findAll('.popup section.board')).toHaveLength(1);
    expect(w.find('.popup').text()).toContain('p1');
    expect(w.find('.player-popup').text()).not.toContain('Remove');
    await bars[1].trigger('click');
    expect(w.findAll('.popup section.board')).toHaveLength(1);
    expect(w.find('.popup').text()).toContain('p2');
    expect(w.findAll('.score-bar button.chip-button')[1].attributes('aria-pressed')).toBe('true');
    await w.findAll('.score-bar button.chip-button')[2].trigger('click');
    expect(w.findAll('.popup')).toHaveLength(1);
    expect(w.find('.popup').text()).toContain('p3');
    await w.findAll('.score-bar button.chip-button')[2].trigger('click');
    expect(w.findAll('.popup')).toHaveLength(0);
    await w.findAll('.score-bar button.chip-button')[1].trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.findAll('.popup')).toHaveLength(0);
  });

  it('gives the host a Remove button for every other player in the pop-up, with an inline confirmation', async () => {
    const send = makeSend();
    const { w } = mountTable(playView({ n: 3 }).view, send);
    await w.findAll('.score-bar button.chip-button')[1].trigger('click');
    const remove = () => w.find('.player-popup').findAll('button').find((b) => /^Remove/.test(b.text()));
    expect(remove().text()).toBe('Remove player');
    await remove().trigger('click');
    expect(send).not.toHaveBeenCalledWith('kick', expect.anything());
    expect(w.find('.player-popup').text()).toContain('Yes, remove');
    await w.find('.player-popup [data-confirm]').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('kick', { seat: 1 });
    expect(w.findAll('.popup')).toHaveLength(0);
  });

  it('shows no Remove button to a player who is not the host', async () => {
    const view = { ...playView({ n: 3 }).view, hostSeat: 2 };
    const { w } = mountTable(view);
    await w.findAll('.score-bar button.chip-button')[1].trigger('click');
    expect(w.find('.player-popup').exists()).toBe(true);
    expect(w.find('.player-popup').text()).not.toContain('Remove');
  });

  it('shows whose turn it is and disables the plates when it is not yours', async () => {
    const mine = mountTable(playView({ turn: 0 }).view).w;
    expect(mine.find('.headline').text()).toContain('Your turn');
    expect(mine.find('.headline').classes('mine')).toBe(true);
    expect(plateTile(mine, 0).attributes('disabled')).toBeUndefined();
    const { view } = playView({ turn: 1 });
    const { w, send } = mountTable(view);
    expect(w.find('.headline').text()).toContain('Waiting for');
    expect(plateTile(w, 0).attributes('disabled')).toBeDefined();
    await plateTile(w, 0).trigger('click');
    expect(send).not.toHaveBeenCalled();
    expect(lineButtons(w).every((l) => l.element.tagName === 'DIV')).toBe(true);
  });

  it('selects a colour group, highlights it and the allowed lines', async () => {
    const { view } = playView();
    const { w } = mountTable(view);
    await plateTile(w, 0).trigger('click');
    expect(plateTile(w, 0).classes('sel')).toBe(true);
    expect(plateTile(w, 0).attributes('aria-pressed')).toBe('true');
    expect(w.find('.game-status').text()).toContain('from factory 1');
    expect(w.find('.headline').text()).toContain('Now choose where');
    expect(lineButtons(w).every((l) => l.element.tagName === 'BUTTON')).toBe(true);
    expect(lineButtons(w).every((l) => l.classes('ok'))).toBe(true);
    expect(floor(w).element.tagName).toBe('BUTTON');
    expect(w.findAll('.plate')[1].findAll('button.pick').every((b) => b.classes('dim'))).toBe(true);
  });

  it('deselects by clicking again or "Choose another colour"', async () => {
    const { w } = mountTable(playView().view);
    await plateTile(w, 0).trigger('click');
    await plateTile(w, 0).trigger('click');
    expect(w.find('.game-status').text()).not.toContain('from factory 1');
    await plateTile(w, 0).trigger('click');
    await button(w, 'Choose another colour').trigger('click');
    expect(w.find('.game-status').text()).not.toContain('from factory 1');
  });

  it('sends a move for a line and clears the selection', async () => {
    const { view } = playView();
    const colour = view.factories[0][0];
    const { w, send } = mountTable(view);
    await plateTile(w, 0).trigger('click');
    await lineButtons(w)[2].trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('move', { source: 0, colour, line: 2 });
    expect(w.find('.game-status').text()).not.toContain('from factory 1');
  });

  it('sends a move for the floor', async () => {
    const { view } = playView();
    const colour = view.factories[1][0];
    const { w, send } = mountTable(view);
    await plateTile(w, 1).trigger('click');
    await floor(w).trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('move', { source: 1, colour, line: 'floor' });
  });

  it('takes from the centre, including the marker', async () => {
    const { view } = playView({ extra: { centre: [2, 2, 3] } });
    const { w, send } = mountTable(view);
    const centre = w.find('[aria-label="The centre"]');
    expect(centre.findAll('button.pick')).toHaveLength(3);
    await centre.findAll('button.pick')[0].trigger('click');
    expect(w.find('.game-status').text()).toContain('2 Terracotta from the centre');
    expect(w.find('.game-status').text()).toContain('first-player marker');
    await lineButtons(w)[1].trigger('click');
    expect(send).toHaveBeenCalledWith('move', { source: 'centre', colour: 2, line: 1 });
  });

  it('keeps the selection and shows the error when the server refuses', async () => {
    const { w } = mountTable(playView().view, makeSend({ ok: false, error: 'Not allowed.' }));
    await plateTile(w, 0).trigger('click');
    await lineButtons(w)[0].trigger('click');
    await flushPromises();
    expect(w.find('.game-status .line.warn').text()).toBe('Not allowed.');
    expect(plateTile(w, 0).classes('sel')).toBe(true);
  });

  it('marks a line that cannot take the colour, and explains instead of sending', async () => {
    const { room } = playingRoom(2, { seed: 4 });
    const colour = room.factories[0][0];
    room.lines[0][1] = { colour: (colour + 1) % 5, count: 1 }; // line 2 holds another colour
    const view = { ...game.viewFor(room, 1), turn: 0 };
    const { w, send } = mountTable(view);
    await plateTile(w, 0).trigger('click');
    expect(lineButtons(w)[1].classes('no')).toBe(true);
    expect(lineButtons(w)[1].attributes('aria-disabled')).toBe('true');
    await lineButtons(w)[1].trigger('click');
    expect(w.find('.game-status .line.warn').text()).toContain('already holds');
    expect(send).not.toHaveBeenCalled();
  });

  it('previews what a line would do when pointed at', async () => {
    const { w } = mountTable(playView().view);
    await plateTile(w, 0).trigger('click');
    await lineButtons(w)[0].trigger('mouseenter');
    expect(w.find('.game-status').text()).toMatch(/go on line 1/);
    await floor(w).trigger('mouseenter');
    expect(w.find('.game-status').text()).toContain('go to the floor');
    await floor(w).trigger('mouseleave');
    expect(w.find('.game-status').text()).not.toContain('go to the floor');
  });

  it('drops the selection when the turn moves on', async () => {
    const { view } = playView();
    const { w } = mountTable(view);
    await plateTile(w, 0).trigger('click');
    await w.setProps({ state: { ...view, turn: 1 } });
    expect(w.find('.game-status').text()).not.toContain('from factory 1');
  });

  it('shows the wall-tiling choice and sends the chosen column', async () => {
    const { view } = playView();
    const state = { ...view, phase: 'tiling', turn: null, choosing: [0], choice: { row: 1, colour: 2, columns: [0, 3] } };
    const { w, send } = mountTable(state);
    expect(w.find('.headline').text()).toContain('choose the column for your Terracotta tile in row 2');
    const spots = w.findAll('button.spot.choice');
    expect(spots).toHaveLength(2);
    await spots[1].trigger('click');
    expect(send).toHaveBeenCalledWith('column', { col: 3 });
  });

  it('says who the tiling phase is waiting for', () => {
    const { view } = playView();
    const { w } = mountTable({ ...view, phase: 'tiling', turn: null, choosing: [1], choice: null });
    expect(w.find('.headline').text()).toContain('waiting for p2');
    expect(w.findAll('button.spot.choice')).toHaveLength(0);
  });

  it('shows the last wall-tiling in the round pop-up', async () => {
    const { view } = playView();
    const lastTiling = {
      round: 1,
      players: [
        { seat: 0, placed: [{ row: 0, colour: 1, points: 2 }], dropped: [], penalty: 1, lost: 1, before: 0, after: 1 },
        { seat: 1, placed: [], dropped: [{ row: 1 }], penalty: 0, lost: 0, before: 0, after: 0 },
      ],
    };
    const { w } = mountTable({ ...view, lastTiling }, makeSend(), true);
    w.findComponent({ name: 'ScoreBoard' }).vm.show();
    await flushPromises();
    const summary = document.body.querySelector('.summary').textContent;
    expect(summary).toContain('Wall-tiling, round 1');
    expect(summary).toContain('no line was full');
    expect(summary).toContain('found no place');
    w.unmount();
  });

  it('flags the free wall variant and the marker holder', async () => {
    const { room } = playingRoom(2, { seed: 4, free: true });
    room.markerInCentre = false;
    room.floors[1] = [-1];
    const { w } = mountTable({ ...game.viewFor(room, 1), turn: 0 });
    expect(w.text()).toContain('Free wall');
    expect(w.find('.game-status').text()).toContain('First-player marker: with p2');
    await w.findAll('.score-bar button.chip-button')[1].trigger('click'); // p2, the viewer, holds the marker
    expect(w.find('.popup .tag.first').exists()).toBe(true);
  });

  it('copes with a spectator view (you is -1)', () => {
    const { room } = playingRoom(2, { seed: 4 });
    const v = game.viewFor(room, 99);
    expect(v.you).toBe(-1);
    const { w } = mountTable(v);
    expect(w.find('.headline').text()).toContain('Waiting for');
    expect(w.findAll('.score-bar button.chip-button').length).toBeGreaterThan(0);
  });

  it('copes with empty plates', () => {
    const { view } = playView();
    const { w } = mountTable({ ...view, factories: view.factories.map(() => []), centre: [], markerInCentre: false });
    expect(w.findAll('.plate').every((p) => p.classes('empty'))).toBe(true);
    expect(w.find('[aria-label="The centre"]').classes('empty')).toBe(true);
  });
});

describe('Azulejo table: finished', () => {
  it('shows the final breakdown and hides the plates', async () => {
    const view = finishedView();
    const { w, send } = mountTable(view);
    expect(w.find('.headline').text()).toContain('game is over');
    expect(w.find('.final h3').text()).toBe('Final result');
    expect(w.findAll('.breakdown tbody tr')).toHaveLength(2);
    expect(w.findAll('.breakdown tbody tr').filter((r) => r.classes('win')).length).toBe(view.winners.length);
    expect(w.find('.workshop').exists()).toBe(false);
    expect(w.findComponent({ name: 'ScoreBoard' }).props('finished')).toBe(true);
    expect(button(w, 'Leave game')).toBeUndefined(); // it is in the site's header now
    await button(w, 'Play again').trigger('click');
    expect(send).toHaveBeenCalledWith('again');
  });

  it('hides Play again from non-hosts', () => {
    const { w } = mountTable({ ...finishedView(), hostSeat: 1 });
    expect(button(w, 'Play again')).toBeUndefined();
    expect(w.find('.final').text()).toContain('Waiting for the host');
  });

  it('describes a shared win', () => {
    const { w } = mountTable({ ...finishedView(), winners: [0, 1] });
    expect(w.find('.winner').text()).toContain('share the win');
  });

  it('tolerates a finished state without a final table', () => {
    const { w } = mountTable({ ...finishedView(), final: null });
    expect(w.find('.final').exists()).toBe(false);
  });

  it('finishes games of every size without trouble', () => {
    for (const n of [2, 3, 4]) {
      const { w } = mountTable(finishedView(n));
      expect(w.findAll('.breakdown tbody tr')).toHaveLength(n);
    }
  });
});

describe('Azulejo parts', () => {
  it('Workshop emits picks and honours the active flag', async () => {
    const props = { factories: [[0, 0, 1, 2], []], centre: [3, 1, 3], markerInCentre: true, selected: { source: 'centre', colour: 3 }, plate: 40 };
    const w = mount(Workshop, { props: { ...props, active: true } });
    await w.findAll('.plate')[0].findAll('button.pick')[2].trigger('click');
    expect(w.emitted('pick')[0]).toEqual([{ source: 0, colour: 1 }]);
    const centre = w.find('[aria-label="The centre"]').findAll('button.pick');
    expect(centre).toHaveLength(3);
    expect(centre.map((b) => b.classes('sel'))).toEqual([false, true, true]); // sorted: 1, 3, 3
    expect(w.find('.marker').exists()).toBe(true);
    expect(w.findAll('.plate')[1].classes('empty')).toBe(true);
    const idle = mount(Workshop, { props: { ...props, active: false } });
    expect(idle.findAll('button.pick').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });

  it('Board shows pattern lines, wall and floor, and emits clicks', async () => {
    const { room } = playingRoom(2, { seed: 4 });
    const seat = game.viewFor(room, 1).seats[0];
    const w = mount(Board, {
      props: {
        seat,
        isMe: true,
        current: true,
        lineHints: Array.from({ length: 5 }, (_, i) => ({ ok: i % 2 === 0, title: `line ${i}` })),
        floorOpen: true,
        choose: { row: 2, colour: 1, columns: [4] },
      },
    });
    expect(w.find('.tag.turn-tag').text()).toBe('to move');
    await lineButtons(w)[4].trigger('click');
    await w.find('.floor').trigger('click');
    await w.find('button.spot.choice').trigger('click');
    await lineButtons(w)[1].trigger('mouseenter');
    expect(w.emitted('line')).toEqual([[4]]);
    expect(w.emitted('floor')).toHaveLength(1);
    expect(w.emitted('column')).toEqual([[4]]);
    expect(w.emitted('hover')).toEqual([[1]]);
    expect(w.findAll('.wall .spot')).toHaveLength(25);
  });

  it('Board shows tiles placed on lines, wall and floor, and away or computer tags', () => {
    const { room } = playingRoom(2, { seed: 4 });
    room.lines[0][2] = { colour: 1, count: 2 };
    room.walls[0][0][0] = 3;
    room.floors[0] = [-1, 2];
    room.scores[0] = 7;
    const seat = { ...game.viewFor(room, 1).seats[0], online: false };
    const w = mount(Board, { props: { seat } });
    expect(w.find('.tag.away').exists()).toBe(true);
    expect(w.find('.score').text()).toBe('7');
    expect(w.findAll('.wall .spot.filled')).toHaveLength(1);
    expect(w.find('.floor-total').text()).toBe('-2');
    expect(w.findAll('.line')[2].findAll('svg.tile')).toHaveLength(2);
    const bot = mount(Board, { props: { seat: { ...seat, bot: true } } });
    expect(bot.find('.tag.bot').exists()).toBe(true);
    expect(bot.find('.tag.away').exists()).toBe(false);
  });

  it('Tile copes with every colour, the marker and an unknown colour', () => {
    for (const c of [-1, 0, 1, 2, 3, 4]) expect(mount(Tile, { props: { colour: c } }).find('svg').exists()).toBe(true);
    expect(mount(Tile, { props: { colour: -1 } }).attributes('aria-label')).toBe('First-player marker');
    expect(mount(Tile, { props: { colour: 2, ghost: true } }).attributes('aria-label')).toContain('place for');
    expect(() => mount(Tile, { props: { colour: 99 } })).not.toThrow();
  });

  it('TilingSummary lists each player, with the player marked', () => {
    const tiling = {
      round: 3,
      players: [{ seat: 0, placed: [{ row: 0, colour: 1, points: 1 }], dropped: [], penalty: 0, lost: 0, before: 4, after: 5 }],
    };
    const w = mount(TilingSummary, { props: { tiling, seats: [{ name: 'ann' }], you: 0 } });
    expect(w.text()).toContain('round 3');
    expect(w.find('li').classes('me')).toBe(true);
    expect(w.text()).toContain('4 → 5');
  });
});

describe('Azulejo robustness', () => {
  it('plays a whole computer-driven game through views without throwing', () => {
    const { room, rng } = playingRoom(3, { seed: 2 });
    const rng2 = seeded(11);
    for (let i = 0; i < 5000 && room.phase !== 'finished'; i++) {
      if (!driveStep(room, rng)) break;
      if (i % 7 === 0) expect(() => mount(Table, { props: { state: game.viewFor(room, 1), send: makeSend() } })).not.toThrow();
    }
    expect(rng2()).toBeGreaterThanOrEqual(0);
  });
});

describe('Azulejo layout sums', () => {
  it('sizes a board to the room it is given, within limits', () => {
    expect(boardCell(900, 330)).toBeLessThan(boardCell(900, 640));
    expect(boardCell(300, 900)).toBeLessThan(boardCell(900, 900));
    expect(boardCell(5000, 5000, { max: 60 })).toBe(60);
    expect(boardCell(10, 10, { min: 22 })).toBe(22);
    const { width, height } = boardSize(40);
    expect(width).toBeGreaterThan(400);
    expect(height).toBeGreaterThan(300);
  });

  it('fits every plate in the room in the best rows and columns', () => {
    for (const count of [5, 7, 9, 11]) {
      const { diameter, columns } = plateLayout(count, 700, 300, { gap: 10, max: 400 });
      const rows = Math.ceil(count / columns);
      expect(diameter * columns + 10 * (columns - 1)).toBeLessThanOrEqual(700);
      expect(diameter * rows + 10 * (rows - 1)).toBeLessThanOrEqual(300);
      expect(diameter).toBeGreaterThan(40);
    }
    expect(plateLayout(5, 700, 300, { max: 90 }).diameter).toBe(90);
  });
});
