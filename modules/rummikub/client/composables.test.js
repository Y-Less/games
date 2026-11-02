// Tests for the Rummikub table's composables, on real server views of hand-built positions.
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import * as game from '../game.js';
import { i18n } from '../../../src/i18n.js';
import { keyFor, listText, messageText } from '../../../src/messageText.js';
import { useRoundView } from './useRoundView.js';
import { useStatusText } from './useStatusText.js';
import { useTileDrag } from './useTileDrag.js';
import { useTurnActions } from './useTurnActions.js';
import { useWorkingCopy } from './useWorkingCopy.js';

const STD = { numbers: 13, colours: 4, wildcards: 2, rounds: 1, meld: 30, timer: 0 };
const t = (c, n, copy = 0) => copy * STD.colours * STD.numbers + c * STD.numbers + n - 1;

/**
 * A real server view for seat 0 (the host) of a hand-built position.
 *
 * @param {object} position  racks, table, melded and turn
 * @returns {object} the view
 */
function view({ racks, table = [], melded = [false, false], turn = 0 }) {
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: 2, settings: {} });
  game.addHuman(room, 2, 'p2');
  game.start(room, 1, () => 0.5);
  const used = new Set([...racks.flat(), ...table.flat()]);
  room.racks = racks;
  room.table = table;
  room.pool = Array.from({ length: 13 * 4 * 2 + 2 }, (_, i) => i).filter((id) => !used.has(id));
  room.melded = melded;
  room.turn = turn;
  return game.viewFor(room, 1);
}
// The text helpers a component gets from useGameText(), built here because these composables are tested outside one.
const words = {
  t: (key, ...args) => i18n.global.t(keyFor(key, 'rummikub'), ...args),
  text: (value) => messageText(value, 'rummikub'),
  list: listText,
};
const setup = (state, send = vi.fn(() => Promise.resolve({ ok: true }))) => {
  const holder = reactive({ state });
  const v = reactive(useRoundView(() => holder.state));
  const copy = reactive(useWorkingCopy(v));
  return { holder, v, copy, send };
};
const meldRack = [t(0, 10), t(1, 10), t(2, 10), t(3, 3), t(0, 5)];

describe('useRoundView', () => {
  it('knows whose turn it is and the names', () => {
    const { v } = setup(view({ racks: [meldRack, [t(0, 1)]] }));
    expect(v.myTurn).toBe(true);
    expect(v.melded).toBe(false);
    expect(v.nameOf(1)).toBe('p2');
    expect(v.nameOf(7)).toEqual({ key: 'common.someone' }); // an empty seat is named by the site's message
    expect(words.text(v.nameOf(7))).toBe('Someone');
  });

  it('is not your turn when the other seat is playing', () => {
    const { v } = setup(view({ racks: [meldRack, [t(0, 1)]], turn: 1 }));
    expect(v.myTurn).toBe(false);
  });
});

describe('useWorkingCopy', () => {
  it('builds a new set by selecting tiles and dropping them, then undoes it', () => {
    const { copy } = setup(view({ racks: [meldRack, [t(0, 1)]] }));
    [t(0, 10), t(1, 10), t(2, 10)].forEach((id) => copy.pick(id));
    expect(copy.selected).toHaveLength(3);
    copy.dropSelected({ type: 'new' });
    expect(copy.arr.sets).toHaveLength(1);
    expect(copy.arr.rack).toHaveLength(2);
    expect(copy.changed).toBe(true);
    expect(copy.status.ok).toBe(true);
    expect(copy.status.points).toBe(30);
    copy.undo();
    expect(copy.arr.sets).toHaveLength(0);
    expect(copy.changed).toBe(false);
  });

  it('freezes the old sets before the first meld and says why', () => {
    const state = view({ racks: [meldRack, [t(0, 1)]], table: [[t(0, 1, 1), t(0, 2, 1), t(0, 3, 1)]] });
    const { copy } = setup(state);
    expect(copy.lockedTile(t(0, 1, 1))).toBe(true);
    copy.pick(t(0, 1, 1));
    expect(copy.selected).toEqual([]);
    expect(copy.hint).toEqual({ key: 'hints.frozen' });
    expect(words.text(copy.hint)).toContain('first meld');
    expect(copy.shownSets[0].frozen).toBe(true);
  });

  it('does nothing when it is not your turn', () => {
    const { copy } = setup(view({ racks: [meldRack, [t(0, 1)]], turn: 1 }));
    copy.pick(t(0, 10));
    expect(copy.selected).toEqual([]);
  });

  it('starts again when the server sends a new version', async () => {
    const { holder, copy } = setup(view({ racks: [meldRack, [t(0, 1)]] }));
    copy.pick(t(0, 10));
    copy.pick(t(1, 10));
    copy.pick(t(2, 10));
    copy.dropSelected({ type: 'new' });
    holder.state = { ...holder.state, version: holder.state.version + 1 };
    await Promise.resolve();
    expect(copy.arr.sets).toHaveLength(0);
  });

  it('keeps the half-built layout when the server re-sends the same table (someone connected or disconnected)', async () => {
    const { holder, copy } = setup(view({ racks: [meldRack, [t(0, 1)]] }));
    copy.pick(t(0, 10));
    copy.pick(t(1, 10));
    copy.pick(t(2, 10));
    copy.dropSelected({ type: 'new' });
    expect(copy.arr.sets).toHaveLength(1);
    holder.state = { ...holder.state, seats: holder.state.seats.map((seat) => ({ ...seat })) }; // a new view object, same version
    await Promise.resolve();
    expect(copy.arr.sets).toHaveLength(1);
  });
});

describe('useTileDrag', () => {
  it('drags the whole selection and drops it as a new set', () => {
    const { v, copy } = setup(view({ racks: [meldRack, [t(0, 1)]] }));
    const drag = reactive(useTileDrag(v, copy));
    [t(0, 10), t(1, 10), t(2, 10)].forEach((id) => copy.pick(id));
    const event = { preventDefault: vi.fn(), dataTransfer: { setData: vi.fn() } };
    drag.dragStart(event, t(0, 10));
    expect(drag.dragging).toHaveLength(3);
    drag.drop({ type: 'new' });
    expect(copy.arr.sets).toHaveLength(1);
    expect(drag.dragging).toEqual([]);
  });

  it('refuses to start a drag when it is not your turn', () => {
    const { v, copy } = setup(view({ racks: [meldRack, [t(0, 1)]], turn: 1 }));
    const drag = reactive(useTileDrag(v, copy));
    const event = { preventDefault: vi.fn() };
    drag.dragStart(event, t(0, 10));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(drag.dragging).toEqual([]);
  });
});

describe('useTurnActions', () => {
  it('only ends the turn with a valid layout, and sends the sets', async () => {
    const { v, copy, send } = setup(view({ racks: [meldRack, [t(0, 1)]] }));
    const actions = reactive(useTurnActions(v, copy, send));
    expect(actions.canEnd).toBe(false);
    [t(0, 10), t(1, 10), t(2, 10)].forEach((id) => copy.pick(id));
    copy.dropSelected({ type: 'new' });
    expect(actions.canEnd).toBe(true);
    await actions.endTurn();
    expect(send).toHaveBeenCalledWith('play', { table: [[t(0, 10), t(1, 10), t(2, 10)]] });
    expect(actions.busy).toBe(false);
  });

  it('draws a tile on your turn only', async () => {
    const mine = setup(view({ racks: [meldRack, [t(0, 1)]] }));
    await reactive(useTurnActions(mine.v, mine.copy, mine.send)).drawTile();
    expect(mine.send).toHaveBeenCalledWith('draw');
    const theirs = setup(view({ racks: [meldRack, [t(0, 1)]], turn: 1 }));
    await reactive(useTurnActions(theirs.v, theirs.copy, theirs.send)).drawTile();
    expect(theirs.send).not.toHaveBeenCalled();
  });
});

describe('useStatusText', () => {
  it('says what to do, then that the layout is ready', () => {
    const { v, copy } = setup(view({ racks: [meldRack, [t(0, 1)]] }));
    const text = useStatusText(v, copy, words);
    expect(text.headline.value).toBe("It's your turn");
    expect(text.lines.value[0].text).toContain('first meld of 30');
    [t(0, 10), t(1, 10), t(2, 10)].forEach((id) => copy.pick(id));
    copy.dropSelected({ type: 'new' });
    expect(text.lines.value[0]).toEqual({ text: 'Ready: first meld worth 30 points.', tone: 'mine' });
  });

  it('names who is playing when it is not your turn', () => {
    const { v, copy } = setup(view({ racks: [meldRack, [t(0, 1)]], turn: 1 }));
    const text = useStatusText(v, copy, words);
    expect(text.headline.value).toBe('p2 is playing');
    expect(text.lines.value[0].tone).toBe('muted');
  });
});
