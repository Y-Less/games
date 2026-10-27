// The Tints and Hints table on the standard layout: the layout sums, the move log, and the whole screen mounted with a
// fake socket (header Leave, the grid, the bars, the controls in their fixed blocks, no Leave button in the play area).
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import TintsAndHints from './TintsAndHints.vue';
import { barSpan, gridCell, gridSize, gridSpan } from './layout.js';
import { newEntries } from './moveLog.js';
import { leaveOffer, playBar } from '../../../src/playBar.js';

const player = (id, name, extra = {}) => ({ id, name, colour: '#ff0000', score: 0, online: true, guessed: false, placement: null, winner: false, ...extra });
function view(extra = {}) {
  const players = extra.players ?? [player(1, 'Ann'), player(2, 'Bob', { colour: '#0000ff' }), player(3, 'Cy', { colour: '#00ff00' })];
  return {
    code: 'a-b-c',
    phase: 'guessing1',
    you: 1,
    hostId: 1,
    turnsEach: 1,
    turn: 1,
    turnsTotal: 3,
    hinter: 2,
    tint: null,
    hints: { first: '', second: '' },
    guesses: [],
    result: null,
    players,
    scoreboard: { players: players.map((p) => ({ id: p.id, name: p.name, score: p.score, isMe: p.id === 1, away: false })), rounds: [], lowIsBetter: false },
    colours: ['#ff0000', '#0000ff', '#00ff00'],
    limits: { min: 2, max: 8, turns: { min: 1, max: 5 } },
    ...extra,
  };
}
const asHinter = (extra = {}) => view({ hinter: 1, tint: 'J6', ...extra });

function fakeSocket() {
  const handlers = {};
  return { connected: false, handlers, emit: vi.fn((event, payload, ack) => ack?.({ ok: true })), on: vi.fn((e, f) => (handlers[e] = f)), off: vi.fn((e) => delete handlers[e]) };
}
async function mountGame(state) {
  const socket = fakeSocket();
  const wrapper = mount(TintsAndHints, { props: { socket, setSearch: vi.fn() }, attachTo: document.body });
  socket.handlers.state(state);
  await flushPromises();
  return { wrapper, socket };
}
const button = (w, text) => w.findAll('button').find((b) => b.text().includes(text));

describe('Tints and Hints player pop-up', () => {
  it('opens from a score chip with the colour and state, and gives the host a Remove button that kicks', async () => {
    const { wrapper, socket } = await mountGame(view({ players: [player(1, 'Ann'), player(2, 'Bob', { colour: '#0000ff', online: false }), player(3, 'Cy', { guessed: true })] }));
    expect(wrapper.find('.bars .remove').exists()).toBe(false); // the slim bars no longer carry a Remove button
    expect(wrapper.findAll('.score-bar button.chip-button')).toHaveLength(3); // yours too
    await wrapper.findAll('.score-bar button.chip-button')[0].trigger('click');
    expect(wrapper.find('.player-popup').text()).toContain('Ann');
    expect(wrapper.find('.player-popup').text()).not.toContain('Remove'); // not even the host can remove themselves
    await wrapper.findAll('.score-bar button.chip-button')[1].trigger('click');
    const popup = wrapper.find('.player-popup');
    expect(popup.text()).toContain('Bob');
    expect(popup.find('.dot').attributes('style')).toContain('rgb(0, 0, 255)');
    await popup.findAll('button').find((b) => b.text() === 'Remove player').trigger('click');
    socket.emit.mockClear();
    await wrapper.find('.player-popup [data-confirm]').trigger('click');
    await flushPromises();
    expect(socket.emit).toHaveBeenCalledWith('kick', { userId: 2 }, expect.any(Function));
    wrapper.unmount();
  });

  it('shows a guesser who is not the host no Remove button', async () => {
    const { wrapper } = await mountGame(view({ you: 3, hostId: 1, scoreboard: { ...view().scoreboard, players: view().scoreboard.players.map((p) => ({ ...p, isMe: p.id === 3 })) } }));
    await wrapper.findAll('.score-bar button.chip-button')[0].trigger('click');
    expect(wrapper.find('.player-popup').text()).not.toContain('Remove');
    wrapper.unmount();
  });
});

describe('Tints and Hints layout sums', () => {
  it('makes square cells that fit the room, whichever way it is short', () => {
    const wide = gridCell(900, 2000);
    const { width } = gridSize(wide);
    expect(width).toBeLessThanOrEqual(900);
    const tall = gridCell(4000, 400);
    expect(gridSize(tall).height).toBeLessThanOrEqual(400);
    expect(gridCell(10, 10)).toBe(14); // never below the least
  });

  it('takes the fewest columns that let the grid be as big as the height allows', () => {
    const area = { width: 1334, height: 420, gap: 12, columns: 12 };
    expect(gridSpan(area)).toBeGreaterThanOrEqual(7);
    expect(gridSpan(area)).toBeLessThanOrEqual(9);
    expect(gridSpan({ ...area, height: 1000 })).toBe(9);
    expect(12 % barSpan(3)).toBe(0);
    expect(12 % barSpan(7)).toBe(0);
  });
});

describe('Tints and Hints move log', () => {
  it('notes the start of a turn, hints, guesses, the second round and the reveal', () => {
    const first = view();
    expect(newEntries(null, first)).toEqual(['Turn 1 of 3: Bob is the hinter.']);
    const hinted = view({ hints: { first: 'a warm evening', second: '' } });
    expect(newEntries(first, hinted)).toEqual(['Bob gave the hint “a warm evening”.']);
    const guessed = view({ hints: hinted.hints, players: first.players.map((p) => (p.id === 3 ? { ...p, guessed: true } : p)) });
    expect(newEntries(hinted, guessed)).toEqual(['Cy guessed.']);
    const second = view({ phase: 'guessing2', hints: hinted.hints });
    expect(newEntries(guessed, second)).toEqual(['Second round: guess again with the second hint.']);
    const reveal = view({
      phase: 'reveal',
      tint: 'J6',
      result: { tint: 'J6', hinterName: 'Bob', hinterPoints: 6, entries: [{ id: 1, name: 'Ann', round: 1, cell: 'J6', kind: 'exact', points: 5 }, { id: 3, name: 'Cy', round: 1, cell: 'A0', kind: 'miss', points: 0 }] },
    });
    const lines = newEntries(second, reveal);
    expect(lines.at(-1)).toBe('The tint was J6. Bob scores 6 for the hints.'); // the newest is last, and the list shows newest first
    expect(lines).toContain('Ann guessed J6 in round 1: exactly right (+5).');
  });

  it('notes the end of the game, and nothing for the lobby or an unchanged state', () => {
    const reveal = view({ phase: 'reveal' });
    const done = view({ phase: 'finished', players: reveal.players.map((p) => ({ ...p, winner: p.id === 3 })) });
    expect(newEntries(reveal, done)).toEqual(['The game is over: Cy wins.']);
    expect(newEntries(view({ phase: 'guessing1' }), view({ phase: 'abandoned' }))).toEqual(['The game was abandoned.']);
    expect(newEntries(reveal, reveal)).toEqual([]);
    expect(newEntries(null, view({ phase: 'lobby' }))).toEqual([]);
  });
});

describe('Tints and Hints screen', () => {
  it('offers Leave game to the header, confirming only mid-game, and has no Leave button in the play area', async () => {
    const { wrapper, socket } = await mountGame(view({ phase: 'lobby' }));
    expect(leaveOffer().confirmText).toBe('');
    expect(wrapper.findAll('button').filter((b) => /^Leave/.test(b.text()))).toEqual([]);
    socket.handlers.state(view());
    await flushPromises();
    expect(wrapper.find('.game-frame').exists()).toBe(true);
    expect(wrapper.findAll('button').filter((b) => /Leave|Back to the menu/.test(b.text()))).toEqual([]);
    expect(leaveOffer().confirmText).toBe('You will not be able to come back.');
    socket.handlers.state(view({ phase: 'finished', players: view().players.map((p, i) => ({ ...p, winner: i === 0, placement: i + 1 })) }));
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('');
    socket.emit.mockClear();
    await leaveOffer().leave();
    expect(socket.emit).toHaveBeenCalledWith('leave', {}, expect.any(Function));
    wrapper.unmount();
    expect(playBar.leave).toBeNull();
  });

  it('draws the grid, slim bars for the others, and the standard boxes with the turn, round and hint in Status', async () => {
    const { wrapper } = await mountGame(view({ hints: { first: 'a warm evening', second: '' } }));
    expect(wrapper.findAll('.board button.cell')).toHaveLength(240);
    expect(wrapper.findAll('ul[aria-label="Players"] li').map((li) => li.find('.who').text())).toEqual(['Bob', 'Cy']); // everyone but you
    expect(wrapper.find('ul[aria-label="Players"] li .hint-tag').text()).toBe('hinter');
    const status = wrapper.find('.box.status').text();
    expect(status).toContain('Turn 1 of 3');
    expect(status).toContain('Round 1 of 2');
    expect(status).toContain('Hinter: Bob');
    expect(wrapper.find('.box.status .hint-text').text()).toContain('a warm evening');
    expect(wrapper.find('.box.log').text()).toContain('Recent moves');
    wrapper.unmount();
  });

  it('lets a guesser pick a square and lock it in, and keeps the controls in the same blocks for the hinter', async () => {
    const { wrapper, socket } = await mountGame(view());
    const lock = button(wrapper, 'Lock in guess');
    expect(lock.attributes('disabled')).toBeDefined();
    await wrapper.findAll('.board button.cell')[40].trigger('click');
    expect(lock.attributes('disabled')).toBeUndefined();
    socket.emit.mockClear();
    await lock.trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('guess', { cell: expect.stringMatching(/^[A-X][0-9]$/) }, expect.any(Function));
    expect(wrapper.findAll('.side .block')).toHaveLength(3);

    socket.handlers.state(asHinter());
    await flushPromises();
    expect(wrapper.findAll('.side .block')).toHaveLength(3);
    expect(wrapper.find('form.hint input').exists()).toBe(true);
    expect(button(wrapper, 'Continue to the second round').attributes('disabled')).toBeDefined(); // nobody has guessed yet
    expect(wrapper.find('.swatch').text()).toBe('J6');
    wrapper.unmount();
  });

  it('shows the reveal and a next-turn button to the hinter and host', async () => {
    const result = { tint: 'J6', hinterName: 'Ann', hinterPoints: 6, entries: [] };
    const { wrapper, socket } = await mountGame(asHinter({ phase: 'reveal', result }));
    expect(wrapper.find('.box.status').text()).toContain('The tint was J6');
    socket.emit.mockClear();
    await button(wrapper, 'Next turn').trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('advance', {}, expect.any(Function));
    socket.handlers.state(view({ phase: 'reveal', tint: 'J6', hostId: 3, result }));
    await flushPromises();
    expect(button(wrapper, 'Next turn')).toBeUndefined();
    expect(wrapper.find('.box.status').text()).toContain('Waiting for Bob to continue.');
    wrapper.unmount();
  });
});
