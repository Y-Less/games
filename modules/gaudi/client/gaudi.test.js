import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as game from '../game.js';
import { cellProblem } from '../rules.js';
import { driveStep, playingRoom, seeded } from '../testing.js';
import Gaudi from './Gaudi.vue';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

// ---- helpers: real server views, so the tests follow the real state shape ----
const lobbyRoom = (size = 4) => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', size });
const lobbyView = (room = lobbyRoom()) => game.viewFor(room, 1);
function windowsRoom(n = 2) {
  const rng = seeded(3);
  const room = lobbyRoom(n);
  for (let i = 2; i <= n; i++) game.addHuman(room, i, `p${i}`);
  game.start(room, 1, rng);
  return room;
}
/** A playing view for seat 0, with the turn forced to the given seat and (optionally) particular tools. */
function playView({ turnSeat = 0, tools, n = 2 } = {}) {
  const { room } = playingRoom(n, { seed: 5 });
  if (tools) {
    room.tools = tools;
    room.spent = tools.map(() => 0);
  }
  const v = game.viewFor(room, 1);
  return { room, view: { ...v, turn: { ...v.turn, seat: turnSeat, placements: 0, toolUsed: false } } };
}
function finishedView() {
  const { room, rng } = playingRoom(2, { seed: 7 });
  for (let i = 0; i < 5000 && room.phase !== 'finished'; i++) if (!driveStep(room, rng)) break;
  expect(room.phase).toBe('finished');
  return game.viewFor(room, 1);
}
const makeSend = (reply = { ok: true }) => vi.fn(() => Promise.resolve(reply));
const mountTable = (state, send = makeSend()) => ({ send, w: mount(Table, { props: { state, send } }) });
const button = (w, text) => w.findAll('button').find((b) => b.text().includes(text));
const poolDice = (w) => w.findAll('.pool-die');
const spaces = (w) => w.find('[aria-label="Your window"]').findAll('.space');
/** An index in the viewer's own (empty) window where this die may legally go. */
function legalCell(view, die) {
  const me = view.seats[view.you];
  const pattern = { cells: me.window.rows.join('').split('') };
  for (let i = 0; i < 20; i++) if (cellProblem(me.window.grid, pattern, i, die, {}) === null) return i;
  return -1;
}
/** A pool die that has a legal place. */
function placeable(view) {
  for (const d of view.pool) if (legalCell(view, d) !== -1) return d;
  return null;
}

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

describe('Gaudi shell', () => {
  it('moves from loading to entry, lobby and table', async () => {
    const socket = fakeSocket();
    const setSearch = vi.fn();
    const w = mount(Gaudi, { props: { socket, setSearch } });
    expect(w.text()).toContain('Loading your game');
    socket.handlers.state(null);
    await flushPromises();
    expect(w.text()).toContain('Start a new');
    await button(w, 'Start a new').trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('create', {}, expect.any(Function));
    socket.handlers.state(lobbyView());
    await flushPromises();
    expect(w.text()).toContain('Rules for this game');
    expect(setSearch).toHaveBeenLastCalledWith('a-b-c');
    socket.handlers.state(playView().view);
    await flushPromises();
    expect(w.find('.table-view').exists()).toBe(true);
  });

  it('resumes with the invite code and reports errors', async () => {
    const socket = fakeSocket(true);
    socket.emit = vi.fn((e, p, ack) => ack({ ok: false, error: 'No such game.' }));
    const w = mount(Gaudi, { props: { socket, search: '?x-y-z' } });
    expect(socket.emit).toHaveBeenCalledWith('resume', { code: 'x-y-z' }, expect.any(Function));
    socket.handlers.state(null);
    await flushPromises();
    expect(w.find('[role=alert]').text()).toBe('No such game.');
  });

  it('unsubscribes on unmount', () => {
    const socket = fakeSocket();
    mount(Gaudi, { props: { socket } }).unmount();
    expect(socket.off).toHaveBeenCalledWith('state', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('connect', expect.any(Function));
  });
});

describe('Gaudi lobby', () => {
  it('lets the host change size, the private-scoring rule and seats', async () => {
    const send = makeSend();
    const w = mount(Lobby, { props: { state: lobbyView(), send } });
    expect(w.text()).toContain('a-b-c');
    expect(w.text()).toContain('dice in the bag');
    await button(w, '3 players').trigger('click');
    expect(send).toHaveBeenCalledWith('size', { seats: 3 });
    await w.find('input[type=checkbox]').setValue(true);
    expect(send).toHaveBeenCalledWith('settings', { badPrivate: true });
    await button(w, 'Add a computer player').trigger('click');
    expect(send).toHaveBeenCalledWith('addBot', { seat: 1 });
    await button(w, 'Leave game').trigger('click');
    expect(send).toHaveBeenCalledWith('leave');
  });

  it('disables the settings for non-hosts and sizes below the seated count', () => {
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
    expect(button(host, '4 players').attributes('aria-pressed')).toBe('true');
  });

  it('describes the bad private scoring rule when on', () => {
    const room = lobbyRoom();
    room.settings.badPrivate = true;
    const w = mount(Lobby, { props: { state: game.viewFor(room, 1), send: makeSend() } });
    expect(w.find('.rule-note').text()).toContain('flat 3');
  });
});

describe('Gaudi table: choosing windows', () => {
  it('shows the options, lets you pick one and confirm', async () => {
    const view = game.viewFor(windowsRoom(), 1);
    const { w, send } = mountTable(view);
    expect(w.text()).toContain('Choose your window');
    const options = w.findAll('.option');
    expect(options).toHaveLength(4);
    expect(button(w, 'Choose this window').attributes('disabled')).toBeDefined();
    await options[2].trigger('click');
    expect(options[2].classes('picked')).toBe(true);
    await button(w, 'Choose this window').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('window', { pid: view.options[2].pid });
    expect(w.findAll('.waiting li')).toHaveLength(2);
  });

  it('can be picked by keyboard and keeps the pick if the server refuses', async () => {
    const view = game.viewFor(windowsRoom(), 1);
    const { w } = mountTable(view, makeSend({ ok: false, error: 'no' }));
    await w.findAll('.option')[0].trigger('keydown.enter');
    expect(w.findAll('.option')[0].classes('picked')).toBe(true);
    await button(w, 'Choose this window').trigger('click');
    await flushPromises();
    expect(w.findAll('.option')[0].classes('picked')).toBe(true);
  });

  it('locks the choice once made and says who is still choosing', async () => {
    const room = windowsRoom(3);
    game.chooseWindow(room, 0, room.options[0][1]);
    const view = game.viewFor(room, 1);
    const { w } = mountTable(view);
    expect(w.findAll('.option').every((o) => o.classes('locked'))).toBe(true);
    expect(w.findAll('.option')[1].classes('picked')).toBe(true);
    expect(button(w, 'Choose this window')).toBeUndefined();
    expect(w.find('[role=status]').text()).toContain('Waiting for p2, p3');
    const done = w.findAll('.waiting li').filter((li) => li.classes('done'));
    expect(done).toHaveLength(1);
    await w.findAll('.option')[3].trigger('click');
    expect(w.findAll('.option')[3].classes('picked')).toBe(false);
  });

  it('copes with a spectator who has no options', () => {
    const view = game.viewFor(windowsRoom(), 99);
    const { w } = mountTable(view);
    expect(w.findAll('.option')).toHaveLength(0);
  });

  it('can leave from the window phase', async () => {
    const { w, send } = mountTable(game.viewFor(windowsRoom(), 1));
    await button(w, 'Leave game').trigger('click');
    expect(send).toHaveBeenCalledWith('leave');
  });
});

describe('Gaudi table: playing', () => {
  it('renders the pool, windows, track, tools, objectives and provisional scoreboard', () => {
    const { view } = playView();
    const { w } = mountTable(view);
    expect(poolDice(w)).toHaveLength(view.pool.length);
    expect(spaces(w)).toHaveLength(20);
    expect(w.findAll('.track .slot')).toHaveLength(10);
    expect(w.findAll('.tool')).toHaveLength(3);
    expect(w.findAll('.objective')).toHaveLength(3);
    expect(w.find('.provisional-bar').text()).toContain('provisional');
    expect(w.text()).toContain('Round 1 of 10');
    expect(w.findComponent({ name: 'ScoreBoard' }).exists()).toBe(true);
    expect(w.find('.private').exists()).toBe(true);
    expect(w.findAll('.order li')).toHaveLength(view.order.length);
  });

  it("shows the turn status and refuses actions on someone else's turn", async () => {
    const { view } = playView({ turnSeat: 1 });
    const { w, send } = mountTable(view);
    expect(w.find('.status').text()).toContain('Waiting for');
    expect(button(w, 'End turn').attributes('disabled')).toBeDefined();
    await poolDice(w)[0].trigger('click');
    expect(w.find('[role=alert]').text()).toContain("'s turn");
    expect(w.find('.pool-die.chosen').exists()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('selects a die, highlights the legal spaces and places it', async () => {
    const { view } = playView();
    const die = placeable(view);
    expect(die).not.toBeNull();
    const { w, send } = mountTable(view);
    expect(w.find('.status').text()).toContain('Your first turn');
    expect(spaces(w).some((s) => s.classes('legal'))).toBe(false);
    await poolDice(w)[view.pool.indexOf(die)].trigger('click');
    expect(poolDice(w)[view.pool.indexOf(die)].classes('chosen')).toBe(true);
    const legal = spaces(w).flatMap((s, i) => (s.classes('legal') ? [i] : []));
    expect(legal).toContain(legalCell(view, die));
    expect(legal.length).toBeLessThan(20);
    await spaces(w)[legalCell(view, die)].trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('place', { die: die.id, cell: legalCell(view, die) });
    expect(w.find('.pool-die.chosen').exists()).toBe(false);
  });

  it('deselects a die by clicking it again', async () => {
    const { view } = playView();
    const { w } = mountTable(view);
    await poolDice(w)[0].trigger('click');
    await poolDice(w)[0].trigger('click');
    expect(w.find('.pool-die.chosen').exists()).toBe(false);
  });

  it('explains an illegal space and does not send', async () => {
    const { view } = playView();
    const die = placeable(view);
    const bad = (() => {
      const me = view.seats[view.you];
      const pattern = { cells: me.window.rows.join('').split('') };
      for (let i = 0; i < 20; i++) if (cellProblem(me.window.grid, pattern, i, die, {}) !== null) return i;
      return -1;
    })();
    if (bad === -1) return; // every space is legal for this die: nothing to test
    const { w, send } = mountTable(view);
    await poolDice(w)[view.pool.indexOf(die)].trigger('click');
    await spaces(w)[bad].trigger('click');
    expect(w.find('[role=alert]').exists()).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('asks you to choose a die first when a space is clicked', async () => {
    const { w, send } = mountTable(playView().view);
    await spaces(w)[0].trigger('click');
    expect(w.find('[role=alert]').text()).toContain('Choose a die from the pool first');
    expect(send).not.toHaveBeenCalled();
  });

  it('shows the server error when placing fails', async () => {
    const { view } = playView();
    const die = placeable(view);
    const { w } = mountTable(view, makeSend({ ok: false, error: 'Server says no.' }));
    await poolDice(w)[view.pool.indexOf(die)].trigger('click');
    await spaces(w)[legalCell(view, die)].trigger('click');
    await flushPromises();
    expect(w.find('[role=alert]').text()).toBe('Server says no.');
  });

  it('blocks a second placement in the same turn', async () => {
    const { view } = playView();
    const done = { ...view, turn: { ...view.turn, placements: view.turn.allowed } };
    const { w } = mountTable(done);
    await poolDice(w)[0].trigger('click');
    expect(w.find('[role=alert]').text()).toContain('already placed');
  });

  it('ends the turn, with a hint when nothing has been placed', async () => {
    const { view } = playView();
    const { w, send } = mountTable(view);
    expect(w.find('.actions').text()).toContain('not placed a die yet');
    await button(w, 'End turn').trigger('click');
    expect(send).toHaveBeenCalledWith('end');
  });

  it('shows the error from a refused end of turn', async () => {
    const { w } = mountTable(playView().view, makeSend({ ok: false, error: 'Too soon.' }));
    await button(w, 'End turn').trigger('click');
    await flushPromises();
    expect(w.find('[role=alert]').text()).toBe('Too soon.');
  });

  it('marks a tool as usable or explains why not', async () => {
    const { view } = playView({ tools: ['lathe', 'kiln', 'slide'] });
    const { w } = mountTable(view);
    expect(w.findAll('.tool').every((t) => t.classes('usable'))).toBe(true);
    const poor = { ...view, seats: view.seats.map((s) => ({ ...s, tokens: 0 })) };
    const { w: w2 } = mountTable(poor);
    expect(w2.findAll('.tool').some((t) => t.classes('usable'))).toBe(false);
    await w2.findAll('.tool')[0].trigger('click');
    expect(w2.find('[role=alert]').text()).toContain('favour');
    expect(w2.find('.guide').exists()).toBe(false);
  });

  it('uses a pool-die tool: choose a die, then confirm', async () => {
    const { view } = playView({ tools: ['lathe', 'mirror', 'kiln'] });
    const { w, send } = mountTable(view);
    await w.findAll('.tool')[1].trigger('click'); // mirror
    expect(w.find('.guide').text()).toContain('Mirror');
    expect(w.findAll('.tool')[1].classes('active')).toBe(true);
    expect(button(w, 'Use Mirror').attributes('disabled')).toBeDefined();
    await poolDice(w)[0].trigger('click');
    await button(w, 'Use Mirror').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('tool', { tool: 'mirror', params: { die: view.pool[0].id } });
    expect(w.find('.guide').exists()).toBe(false);
  });

  it('uses a raise-or-lower tool', async () => {
    const { view } = playView({ tools: ['lathe', 'kiln', 'slide'] });
    const { w, send } = mountTable(view);
    await w.findAll('.tool')[0].trigger('click');
    expect(button(w, 'Raise by one').attributes('disabled')).toBeDefined();
    const die = view.pool.findIndex((d) => d.v < 6);
    await poolDice(w)[die].trigger('click');
    await button(w, 'Raise by one').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('tool', { tool: 'lathe', params: { die: view.pool[die].id, delta: 1 } });
  });

  it('uses a no-choice tool and can cancel a tool', async () => {
    const { view } = playView({ tools: ['kiln', 'lathe', 'slide'] });
    const { w, send } = mountTable(view);
    await w.findAll('.tool')[0].trigger('click');
    await button(w, 'Cancel').trigger('click');
    expect(w.find('.guide').exists()).toBe(false);
    await w.findAll('.tool')[0].trigger('click');
    await w.findAll('.tool')[0].trigger('click'); // clicking the active tool again turns it off
    expect(w.find('.guide').exists()).toBe(false);
    await w.findAll('.tool')[0].trigger('click');
    await button(w, 'Use ').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('tool', expect.objectContaining({ tool: view.tools[0].id }));
  });

  it('does not allow a tool after one has been used this turn', async () => {
    const { view } = playView({ tools: ['kiln', 'lathe', 'slide'] });
    const { w } = mountTable({ ...view, turn: { ...view.turn, toolUsed: true } });
    await w.findAll('.tool')[0].trigger('click');
    expect(w.find('[role=alert]').text()).toContain('already used a tool');
  });

  it('shows the cost of a used tool as two and its tokens', () => {
    const { view } = playView({ tools: ['kiln', 'lathe', 'slide'] });
    const used = { ...view, tools: view.tools.map((t, i) => (i === 0 ? { ...t, spent: 1, cost: 2 } : t)) };
    const { w } = mountTable(used);
    expect(w.findAll('.tool')[0].text()).toContain('costs 2');
    expect(w.findAll('.tool')[0].text()).toContain('1 token on this card');
  });

  it('lists the other players and the recent log', () => {
    const { view } = playView({ n: 3 });
    const { w } = mountTable({ ...view, log: [{ seat: 0, text: 'ann did a thing' }, { seat: 1, text: 'p2 did another' }] });
    expect(w.text()).toContain('p2');
    expect(w.text()).toContain('p3');
    const items = w.findAll('.log li');
    expect(items.map((i) => i.text())).toEqual(['p2 did another', 'ann did a thing']);
    expect(items[1].find('.mine').exists()).toBe(true);
    expect(items[0].find('.mine').exists()).toBe(false);
  });

  it('leaves the game', async () => {
    const { w, send } = mountTable(playView().view);
    await button(w, 'Leave game').trigger('click');
    expect(send).toHaveBeenCalledWith('leave');
  });

  it('copes with a spectator view and an empty pool', () => {
    const { room } = playingRoom(2, { seed: 5 });
    const v = game.viewFor(room, 99);
    const { w } = mountTable({ ...v, pool: [] });
    expect(w.text()).toContain('The pool is empty');
    expect(w.find('.status').text()).toContain('Waiting for');
  });

  it('drops a selection when the pool changes under it', async () => {
    const { view } = playView();
    const { w } = mountTable(view);
    await poolDice(w)[0].trigger('click');
    await w.setProps({ state: { ...view, pool: view.pool.slice(1) } });
    expect(w.find('.pool-die.chosen').exists()).toBe(false);
  });
});

describe('Gaudi table: finished', () => {
  it('shows the final breakdown and the end controls', async () => {
    const view = finishedView();
    const { w, send } = mountTable(view);
    expect(w.find('.status').text()).toContain('game is over');
    expect(w.find('.final h3').text()).toMatch(/winner|shared/i);
    expect(w.findAll('.breakdown tbody tr')).toHaveLength(2);
    expect(w.findAll('.breakdown tbody tr').filter((r) => r.classes('win')).length).toBe(view.winners.length);
    expect(w.text()).toContain('(you)');
    expect(button(w, 'End turn')).toBeUndefined();
    expect(w.find('.provisional-bar').exists()).toBe(false);
    expect(w.find('.private').exists()).toBe(false);
    await button(w, 'Play again').trigger('click');
    await button(w, 'Leave game').trigger('click');
    expect(send).toHaveBeenCalledWith('again');
    expect(send).toHaveBeenCalledWith('leave');
  });

  it('opens the final scoreboard and hides Play again from non-hosts', () => {
    const view = finishedView();
    const { w } = mountTable({ ...view, hostSeat: 1 });
    expect(button(w, 'Play again')).toBeUndefined();
    expect(w.text()).toContain('The host can start another game');
    expect(w.findComponent({ name: 'ScoreBoard' }).props('finished')).toBe(true);
  });

  it('describes a shared win', () => {
    const view = finishedView();
    const { w } = mountTable({ ...view, winners: [0, 1] });
    expect(w.find('.final h3').text()).toBe('A shared win');
    expect(w.find('.winner').text()).toContain(' and ');
  });

  it('tolerates a finished state without a final table', () => {
    const view = finishedView();
    const { w } = mountTable({ ...view, final: null });
    expect(w.find('.final').exists()).toBe(false);
  });
});
