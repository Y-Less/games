import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as game from '../game.js';
import { numberedCount } from '../rules.js';
import { TILE_COLOURS, SHAPES } from './colours.js';
import { canMove, moveTiles, placedThisTurn, sortRack, startArrangement, turnStatus } from './layout.js';
import Lobby from './Lobby.vue';
import Rummikub from './Rummikub.vue';
import Table from './Table.vue';

const STD = { numbers: 13, colours: 4, wildcards: 2, rounds: 1, meld: 30, timer: 0 };
const tile = (s, colour, number, copy = 0) => copy * s.colours * s.numbers + colour * s.numbers + number - 1;
const joker = (s, i = 0) => numberedCount(s) + i;
const t = (c, n, copy = 0) => tile(STD, c, n, copy);

/** A started game of two people (ids 1 and 2) with a fixed shuffle. */
function playingRoom(n, { settings = {} } = {}) {
  let a = 7;
  const rng = () => {
    a = (a * 1103515245 + 12345) % 2147483648;
    return a / 2147483648;
  };
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: n, settings });
  for (let i = 2; i <= n; i++) game.addHuman(room, i, `p${i}`);
  game.start(room, 1, rng);
  return { room };
}

/** A real server view of a hand-built position, for seat 0 (the host, id 1). */
function view({ racks, table = [], melded = [false, false], turn = 0, settings = {} }) {
  const { room } = playingRoom(2, { seed: 1, settings });
  const used = new Set([...racks.flat(), ...table.flat()]);
  room.racks = racks;
  room.table = table;
  room.pool = Array.from({ length: room.settings.numbers * room.settings.colours * 2 + room.settings.wildcards }, (_, i) => i).filter((id) => !used.has(id));
  room.melded = melded;
  room.turn = turn;
  return game.viewFor(room, 1);
}
const mountTable = (state, send = vi.fn(() => Promise.resolve({ ok: true }))) => ({ send, w: mount(Table, { props: { state, send } }) });
const button = (w, text) => w.findAll('button').find((b) => b.text().trim() === text);
const rackTile = (w, id) => w.find('[data-rack]').find(`[data-id="${id}"]`);
const setTile = (w, id) => w.find('.sets').find(`[data-id="${id}"]`);

describe('colours', () => {
  it('has eight distinct hues and eight distinct shapes', () => {
    expect(TILE_COLOURS).toHaveLength(8);
    expect(new Set(TILE_COLOURS.map((c) => c.hue)).size).toBe(8);
    expect(new Set(TILE_COLOURS.map((c) => c.shape)).size).toBe(8);
    for (const c of TILE_COLOURS) expect(SHAPES[c.shape]).toBeTruthy();
  });
});

describe('layout helpers', () => {
  const table = [[t(0, 3), t(0, 4), t(0, 5)]];
  const rack = [t(1, 9), t(2, 9), t(3, 9), t(0, 6)];

  it('moves tiles between rack, sets and new sets, dropping empty sets', () => {
    const arr = startArrangement(table, rack);
    const a = moveTiles(arr, [t(1, 9), t(2, 9)], { type: 'new' });
    expect(a.sets).toHaveLength(2);
    expect(a.rack).toEqual([t(3, 9), t(0, 6)]);
    const b = moveTiles(a, [t(3, 9)], { type: 'set', index: 1 });
    expect(b.sets[1]).toEqual([t(1, 9), t(2, 9), t(3, 9)]);
    const c = moveTiles(b, [t(1, 9), t(2, 9), t(3, 9)], { type: 'rack' });
    expect(c.sets).toEqual(table);
    expect(arr.rack).toEqual(rack);
  });

  it('keeps a tile in its set when it is moved onto the same set', () => {
    const arr = startArrangement(table, rack);
    const b = moveTiles(arr, [t(0, 3)], { type: 'set', index: 0 });
    expect([...b.sets[0]].sort()).toEqual([...table[0]].sort());
  });

  it('forbids sending table tiles back to the rack, and touching old sets before the first meld', () => {
    const arr = startArrangement(table, rack);
    expect(canMove(arr, [t(0, 3)], { type: 'rack' }, { before: table, melded: true })).toMatch(/stay on it/);
    expect(canMove(arr, [t(0, 3)], { type: 'new' }, { before: table, melded: false })).toMatch(/first meld/);
    expect(canMove(arr, [t(0, 6)], { type: 'set', index: 0 }, { before: table, melded: false })).toMatch(/first meld/);
    expect(canMove(arr, [t(0, 6)], { type: 'set', index: 0 }, { before: table, melded: true })).toBeNull();
    expect(canMove(arr, [t(0, 6)], { type: 'new' }, { before: table, melded: false })).toBeNull();
  });

  it('sorts the rack for runs (colour, number) or groups (number, colour) with jokers last', () => {
    const mixed = [joker(STD), t(1, 2), t(0, 9), t(0, 2), t(1, 9)];
    expect(sortRack(STD, mixed, 'run')).toEqual([t(0, 2), t(0, 9), t(1, 2), t(1, 9), joker(STD)]);
    expect(sortRack(STD, mixed, 'group')).toEqual([t(0, 2), t(1, 2), t(0, 9), t(1, 9), joker(STD)]);
  });

  it('works out what has been placed this turn and whether the turn would be accepted', () => {
    let arr = startArrangement(table, rack);
    arr = moveTiles(arr, [t(1, 9), t(2, 9), t(3, 9)], { type: 'new' });
    expect(placedThisTurn(arr, table)).toEqual(new Set([t(1, 9), t(2, 9), t(3, 9)]));
    const status = turnStatus(STD, { arr, before: table, rack, melded: false, meld: 30 });
    expect(status.ok).toBe(false);
    expect(status.error).toMatch(/at least 30/);
    expect(status.points).toBe(27);
    const ok = turnStatus(STD, { arr, before: table, rack, melded: true, meld: 30 });
    expect(ok.ok).toBe(true);
    expect(ok.placed).toBe(3);
    const half = moveTiles(startArrangement(table, rack), [t(1, 9)], { type: 'new' });
    expect(turnStatus(STD, { arr: half, before: table, rack, melded: true, meld: 30 }).badSets).toBe(1);
  });
});

describe('the play field', () => {
  const state = () => view({ racks: [[t(0, 10), t(0, 11), t(0, 12), t(1, 1), joker(STD)], [t(2, 2), t(2, 3)]] });

  it('shows the pool count and whose turn it is (tile counts are in the player popups)', () => {
    const { w } = mountTable(state());
    expect(w.text()).toContain('in the pool');
    expect(w.text()).toContain('Your turn');
    expect(w.text()).not.toContain('2 tiles');
    expect(w.findAll('[data-rack] .tile')).toHaveLength(5);
  });

  it('highlights the tile you drew in the rack, and nothing when none is marked', async () => {
    const plain = mountTable(state());
    expect(plain.w.findAll('[data-rack] .tile.drawn')).toHaveLength(0);
    const marked = { ...state(), turn: 1, drawn: t(0, 12) };
    const { w } = mountTable(marked);
    const drawn = w.findAll('[data-rack] .tile.drawn');
    expect(drawn).toHaveLength(1);
    expect(drawn[0].attributes('data-id')).toBe(String(t(0, 12)));
    expect(w.findAll('.sets .tile.drawn')).toHaveLength(0);
    await w.setProps({ state: { ...marked, drawn: null } });
    expect(w.findAll('.tile.drawn')).toHaveLength(0);
    await w.setProps({ state: { ...marked, phase: 'between' } });
    expect(w.findAll('.tile.drawn')).toHaveLength(0);
  });

  it('click-to-move: select tiles, click New set, End turn sends the whole table', async () => {
    const { w, send } = mountTable(state());
    expect(button(w, 'End turn').attributes('disabled')).toBeDefined();
    for (const id of [t(0, 10), t(0, 11), t(0, 12)]) await rackTile(w, id).trigger('click');
    await w.find('.set.new').trigger('click');
    expect(w.findAll('.sets .set:not(.new)')).toHaveLength(1);
    expect(w.findAll('[data-rack] .tile')).toHaveLength(2);
    expect(w.find('.sets .tile.fresh').exists()).toBe(true);
    expect(w.text()).toContain('Run, 33');
    const end = button(w, 'End turn');
    expect(end.attributes('disabled')).toBeUndefined();
    await end.trigger('click');
    expect(send).toHaveBeenCalledWith('play', { table: [[t(0, 10), t(0, 11), t(0, 12)]] });
  });

  it('Undo and Reset turn put things back', async () => {
    const { w } = mountTable(state());
    await rackTile(w, t(1, 1)).trigger('click');
    await w.find('.set.new').trigger('click');
    expect(w.findAll('[data-rack] .tile')).toHaveLength(4);
    await button(w, 'Undo').trigger('click');
    expect(w.findAll('[data-rack] .tile')).toHaveLength(5);
    await rackTile(w, t(1, 1)).trigger('click');
    await w.find('.set.new').trigger('click');
    await rackTile(w, t(0, 10)).trigger('click');
    await w.find('.set.new').trigger('click');
    expect(w.findAll('.sets .set:not(.new)')).toHaveLength(2);
    await button(w, 'Reset turn').trigger('click');
    expect(w.findAll('.sets .set:not(.new)')).toHaveLength(0);
    expect(w.findAll('[data-rack] .tile')).toHaveLength(5);
  });

  it('shows a set that is not valid with a reason, and blocks End turn', async () => {
    const { w } = mountTable(state());
    await rackTile(w, t(0, 10)).trigger('click');
    await rackTile(w, t(1, 1)).trigger('click');
    await w.find('.set.new').trigger('click');
    expect(w.find('.set.bad').exists()).toBe(true);
    expect(button(w, 'End turn').attributes('disabled')).toBeDefined();
  });

  it('drag and drop moves a tile from the rack to the new-set area and back', async () => {
    const { w } = mountTable(state());
    await rackTile(w, t(0, 10)).trigger('dragstart');
    await w.find('.set.new').trigger('drop');
    expect(w.findAll('.sets .set:not(.new)')).toHaveLength(1);
    await setTile(w, t(0, 10)).trigger('dragstart');
    await w.find('[data-rack]').trigger('drop');
    expect(w.findAll('.sets .set:not(.new)')).toHaveLength(0);
  });

  it('a set has the same parts on every turn, so the boxes never change size or move', async () => {
    const table = [[t(0, 1), t(0, 2), t(0, 3)], [t(1, 5), t(2, 5), t(3, 5)]];
    const racks = [[t(0, 4), t(1, 9)], [t(2, 2)]];
    const mine = mountTable(view({ racks, table, melded: [true, true], turn: 0 })).w;
    const theirs = mountTable(view({ racks, table, melded: [true, true], turn: 1 })).w;
    const unmelded = mountTable(view({ racks, table, melded: [false, true], turn: 0 })).w;
    for (const w of [mine, theirs, unmelded]) {
      expect(w.findAll('.sets .set:not(.new)')).toHaveLength(2);
      expect(w.findAll('.sets .set:not(.new) .add')).toHaveLength(2); // drawn in every case
      expect(w.findAll('.sets .add.ready')).toHaveLength(0); // and hidden until it can take the selected tiles
    }
    await rackTile(mine, t(0, 4)).trigger('click');
    expect(mine.findAll('.sets .add.ready')).toHaveLength(2);
    expect(unmelded.findAll('.sets .add')[0].attributes('aria-hidden')).toBe('true');
  });

  it('tiles are draggable spans with the button role (Firefox will not drag a <button>), and work from the keyboard', async () => {
    const { w } = mountTable(state());
    const tileEl = rackTile(w, t(0, 10));
    expect(tileEl.element.tagName).toBe('SPAN');
    expect(w.findAll('[data-rack] button')).toHaveLength(0);
    expect(tileEl.attributes('role')).toBe('button');
    expect(tileEl.attributes('tabindex')).toBe('0');
    expect(tileEl.attributes('draggable')).toBe('true');
    await tileEl.trigger('keydown', { key: 'Enter' });
    expect(tileEl.attributes('aria-pressed')).toBe('true');
    await tileEl.trigger('keydown', { key: ' ' });
    expect(tileEl.attributes('aria-pressed')).toBe('false');
    const idle = mountTable({ ...state(), turn: 1 }).w;
    expect(rackTile(idle, t(0, 10)).attributes('role')).toBeUndefined();
    expect(rackTile(idle, t(0, 10)).attributes('draggable')).toBe('false');
  });

  it('the whole table is a new-set target: select a few tiles and drag them anywhere on it', async () => {
    const { w } = mountTable(state());
    expect(w.find('.felt').classes()).not.toContain('dropping');
    for (const id of [t(0, 10), t(0, 11), t(0, 12)]) await rackTile(w, id).trigger('click');
    await rackTile(w, t(0, 11)).trigger('dragstart'); // dragging one of the selected tiles takes them all
    expect(w.find('.felt').classes()).not.toContain('dropping'); // not inside dragstart itself: that can cancel the drag
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(w.find('.felt').classes()).toContain('dropping');
    await w.find('.felt').trigger('drop'); // not on the New set area
    expect(w.find('.felt').classes()).not.toContain('dropping');
    expect(w.findAll('.sets .set:not(.new)')).toHaveLength(1);
    expect(w.findAll('.sets .set:not(.new) .tile')).toHaveLength(3);
    expect(w.findAll('[data-rack] .tile')).toHaveLength(2);
    // a drop on an existing set still adds to that set, and does not also start another
    await rackTile(w, t(1, 1)).trigger('dragstart');
    await w.find('.sets .set:not(.new)').trigger('drop');
    expect(w.findAll('.sets .set:not(.new)')).toHaveLength(1);
    expect(w.findAll('.sets .set:not(.new) .tile')).toHaveLength(4);
    // and another tile dragged onto the bare table starts a set of its own
    await rackTile(w, joker(STD)).trigger('dragstart');
    await w.find('.felt').trigger('drop');
    expect(w.findAll('.sets .set:not(.new)')).toHaveLength(2);
  });

  it('draws when asked, and the sort toggle changes the rack order', async () => {
    const { w, send } = mountTable(state());
    await button(w, 'Draw a tile').trigger('click');
    expect(send).toHaveBeenCalledWith('draw');
    const order = () => w.findAll('[data-rack] .tile').map((x) => Number(x.attributes('data-id')));
    expect(order()).toEqual([t(0, 10), t(0, 11), t(0, 12), t(1, 1), joker(STD)]);
    await button(w, 'Groups').trigger('click');
    expect(order()).toEqual([t(1, 1), t(0, 10), t(0, 11), t(0, 12), joker(STD)]);
  });

  it('before the first meld the old sets are locked; after it they can be extended', async () => {
    const table = [[t(1, 4), t(1, 5), t(1, 6)]];
    const racks = [[t(1, 7), t(0, 10)], [t(2, 2), t(2, 3)]];
    const locked = mountTable(view({ racks, table }));
    await rackTile(locked.w, t(1, 7)).trigger('click');
    expect(locked.w.find('.set.frozen').exists()).toBe(true);
    await locked.w.find('.set.frozen').trigger('click');
    expect(locked.w.find('[data-rack]').find(`[data-id="${t(1, 7)}"]`).exists()).toBe(true);
    expect(locked.w.text()).toContain('first meld');
    const free = mountTable(view({ racks, table, melded: [true, false] }));
    await rackTile(free.w, t(1, 7)).trigger('click');
    await free.w.find('.set:not(.new)').trigger('click');
    expect(setTile(free.w, t(1, 7)).exists()).toBe(true);
    expect(free.w.text()).toContain('Run, 22');
    expect(button(free.w, 'End turn').attributes('disabled')).toBeUndefined();
  });

  it('keeps the same elements (and so the same layout) when a tile is selected or dragged', async () => {
    const table = [[t(1, 4), t(1, 5), t(1, 6)], [t(2, 7), t(3, 7), t(0, 7)]];
    const { w } = mountTable(view({ racks: [[t(1, 7), t(0, 10)], [t(2, 2), t(2, 3)]], table, melded: [true, false] }));
    const shape = () => w.findAll('.felt .set, .felt .set *, [data-rack], [data-rack] *').map((e) => `${e.element.tagName}.${e.classes().filter((c) => !['selected', 'ready', 'target'].includes(c)).join('.')}`);
    const before = shape();
    expect(w.findAll('.set.new')).toHaveLength(1);
    await rackTile(w, t(1, 7)).trigger('click');
    expect(shape()).toEqual(before);
    await rackTile(w, t(1, 7)).trigger('dragstart');
    expect(shape()).toEqual(before);
    await rackTile(w, t(1, 7)).trigger('dragend');
    expect(shape()).toEqual(before);
    expect(w.findAll('.add')).toHaveLength(2);
  });

  it('is read-only when it is not your turn', async () => {
    const { w } = mountTable(view({ racks: [[t(0, 1), t(0, 2)], [t(2, 2)]], turn: 1 }));
    expect(w.text()).toContain('is playing');
    expect(w.find('[data-rack] button.tile').exists()).toBe(false);
    expect(button(w, 'Draw a tile').attributes('disabled')).toBeDefined();
    expect(button(w, 'End turn').attributes('disabled')).toBeDefined();
    expect(w.find('.set.new').classes()).toContain('idle'); // the area is always there, but does nothing
    expect(w.findAll('.add')).toHaveLength(0);
  });

  it('has the standard layout: scores on top, the table, your rack, Recent moves and Status', () => {
    const { w } = mountTable(state());
    expect(w.find('.game-frame .scorebar .score-bar').exists()).toBe(true);
    expect(w.find('.main .felt').exists()).toBe(true);
    expect(w.find('.main .rack-panel [data-rack]').exists()).toBe(true);
    expect(w.findAll('.actions button').map((b) => b.text())).toEqual(['Undo', 'Reset turn', 'Draw a tile', 'End turn']);
    expect(w.find('.others').exists()).toBe(false); // no bars: the players are the chips in the score bar
    expect(w.find('.box.log h3').text()).toBe('Recent moves');
    expect(w.find('.box.status h3').text()).toBe('Status');
    expect(w.findAll('button').some((b) => b.text() === 'Leave game')).toBe(false); // that is in the site header
  });

  it('keeps the round, the pool, the first-meld target and the live check in Status, not in the play area', async () => {
    const { w } = mountTable(state());
    const status = w.find('.box.status').text();
    expect(status).toContain('Round 1');
    expect(status).toContain('in the pool');
    expect(status).toContain('First meld: 30 points');
    expect(status).toContain('Your turn');
    for (const text of ['in the pool', 'Your turn', 'First meld']) expect(w.find('.main').text()).not.toContain(text);
    for (const id of [t(0, 10), t(0, 11)]) await rackTile(w, id).trigger('click');
    await w.find('.set.new').trigger('click');
    expect(w.find('.box.status').text()).toMatch(/needs|least|three|3/i); // the live message about the layout
  });

  it('shows the opponent tile count, meld and score in a popup from their chip, which closes again', async () => {
    const { room } = playingRoom(3);
    room.seats[1] = { ...room.seats[1], kind: 'bot' };
    const w = mount(Table, { props: { state: game.viewFor(room, 1), send: vi.fn() }, attachTo: document.body });
    expect(w.find('.popup').exists()).toBe(false);
    const all = w.findAll('.score-bar .chip-button');
    expect(all).toHaveLength(3); // every player, you included
    const chips = all.filter((c) => !c.text().includes('(you)'));
    expect(chips).toHaveLength(2);
    await chips[0].trigger('click');
    expect(w.find('.popup').text()).toMatch(/Tiles in rack\s*14/);
    expect(w.find('.popup').text()).toContain('not yet');
    await chips[0].trigger('click');
    expect(w.find('.popup').exists()).toBe(false);
    await chips[1].trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(w.find('.popup').exists()).toBe(false);
    w.unmount();
  });
});

describe('lobby', () => {
  const lobby = (extra = {}) => {
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', size: 4, ...extra });
    return game.viewFor(room, 1);
  };

  it('shows the tile arithmetic and the options, and sends changes', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true }));
    const w = mount(Lobby, { props: { state: lobby(), send } });
    expect(w.text()).toContain('106 tiles');
    expect(w.text()).toContain('Each player gets 14');
    await w.find('#opt-colours').setValue('6');
    await w.find('#opt-colours').trigger('change');
    expect(send).toHaveBeenCalledWith('settings', { colours: 6 });
    await w.findAll('button').find((b) => b.text() === '5 players').trigger('click');
    expect(send).toHaveBeenCalledWith('size', { seats: 5 });
    await w.find('#opt-timer').setValue('60');
    expect(send).toHaveBeenCalledWith('settings', { timer: 60 });
    expect(w.findAll('.colours .tile')).toHaveLength(4);
  });

  it('warns when the tile set is too small for the players', () => {
    const w = mount(Lobby, { props: { state: lobby({ size: 6, settings: { numbers: 3, colours: 2, wildcards: 0 } }), send: vi.fn() } });
    expect(w.find('[role="alert"]').text()).toMatch(/too few/);
  });

  it('is read-only for a guest', () => {
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', size: 3 });
    game.addHuman(room, 2, 'bob');
    const w = mount(Lobby, { props: { state: game.viewFor(room, 2), send: vi.fn() } });
    expect(w.find('#opt-numbers').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('Only the host can change these');
  });
});

describe('the site header', () => {
  it('offers Leave game once there is a room, and leaves through the game', async () => {
    const { leaveOffer } = await import('../../../src/playBar.js');
    const socket = { connected: false, emit: vi.fn((e, p, ack) => ack?.({ ok: true })), on: vi.fn((e, f) => (socket.handlers[e] = f)), off: vi.fn(), handlers: {} };
    const w = mount(Rummikub, { props: { socket } });
    socket.handlers.state(null);
    await flushPromises();
    expect(leaveOffer()).toBeNull();
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', size: 2 });
    socket.handlers.state(game.viewFor(room, 1));
    await flushPromises();
    expect(w.findAll('button').some((b) => b.text() === 'Leave game')).toBe(false); // the lobby has none of its own
    const offer = leaveOffer();
    expect(offer).not.toBeNull();
    await offer.leave();
    expect(socket.emit).toHaveBeenCalledWith('leave', {}, expect.any(Function));
    w.unmount();
    expect(leaveOffer()).toBeNull();
  });
});

describe('the shell', () => {
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

  it('shows loading, then the entry screen, and creates a game', async () => {
    const socket = fakeSocket();
    const w = mount(Rummikub, { props: { socket } });
    expect(w.text()).toContain('Loading your game');
    socket.handlers.state(null);
    await flushPromises();
    expect(w.text()).toContain('Start a new game of Rummikub');
    await w.find('button.primary').trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('create', {}, expect.any(Function));
  });

  it('resumes with the invite code and shows server errors', async () => {
    const socket = fakeSocket(true);
    socket.emit = vi.fn((event, payload, ack) => ack?.({ ok: false, error: 'No game has that code.' }));
    const w = mount(Rummikub, { props: { socket, search: '?a-b-c' } });
    expect(socket.emit).toHaveBeenCalledWith('resume', { code: 'a-b-c' }, expect.any(Function));
    socket.handlers.state(null);
    await flushPromises();
    expect(w.text()).toContain('No game has that code.');
  });
});
