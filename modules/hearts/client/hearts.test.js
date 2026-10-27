import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as game from '../game.js';
import { leaveOffer, playBar } from '../../../src/playBar.js';
import Hearts from './Hearts.vue';
import Lobby from './Lobby.vue';
import Table from './Table.vue';
import { advanceLog } from './log.js';

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
/** A real room: seat 0 is the person (user 1), the rest are computers. */
function room({ started = true, settings = {} } = {}) {
  const r = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings });
  game.fillWithBots(r, 1);
  if (started) expect(game.start(r, 1, seeded(3)).ok).toBe(true);
  return r;
}
const view = (r) => game.viewFor(r, 1);
/** A room in the first hand with no passing, so that play starts at once. */
function playing() {
  const r = room({ started: false });
  r.handNumber = 3; // the fourth hand is a hold hand: no passing
  expect(game.start(r, 1, seeded(3)).ok).toBe(true);
  r.handNumber = 3;
  game.deal(r, seeded(5));
  expect(r.phase).toBe('playing');
  return r;
}
const makeSend = () => vi.fn(() => Promise.resolve({ ok: true }));
function fakeSocket(connected = false) {
  const handlers = {};
  return { connected, handlers, emit: vi.fn((e, p, ack) => ack?.({ ok: true })), on: vi.fn((e, f) => (handlers[e] = f)), off: vi.fn((e) => delete handlers[e]) };
}

describe('Hearts player pop-up', () => {
  it('opens from a chip with the facts, and the host removes a computer player through removeBot; a guest has no Remove button', async () => {
    const send = makeSend();
    const w = mount(Table, { props: { state: view(room()), send } });
    const chips = w.findAll('.score-bar button.chip-button');
    expect(chips).toHaveLength(3);
    await chips[0].trigger('click');
    const popup = w.find('.player-popup');
    expect(popup.text()).toContain('Cards in hand');
    expect(popup.text()).toContain('Remove');
    await popup.findAll('button').find((b) => /^Remove/.test(b.text())).trigger('click');
    await w.find('.player-popup [data-confirm]').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('removeBot', { seat: expect.any(Number) });
    const guest = mount(Table, { props: { state: { ...view(room()), hostSeat: 2 }, send: makeSend() } });
    await guest.findAll('.score-bar button.chip-button')[0].trigger('click');
    expect(guest.find('.player-popup').exists()).toBe(true);
    expect(guest.find('.player-popup').text()).not.toContain('Remove');
  });
});

describe('Hearts received cards', () => {
  it('are outlined until the first card of the hand is played, and not after', () => {
    const state = { ...view(playing()), received: [] };
    state.received = [state.hand[0]];
    const before = mount(Table, { props: { state, send: makeSend() } });
    expect(before.findAll('.slot.received')).toHaveLength(1);
    expect(before.find('.box.status').text()).toContain('outlined in green');
    const after = mount(Table, { props: { state: { ...state, trick: [{ seat: 1, card: '2C' }] }, send: makeSend() } });
    expect(after.findAll('.slot.received')).toHaveLength(0);
    expect(after.find('.box.status').text()).not.toContain('outlined in green');
    const later = mount(Table, { props: { state: { ...state, trickNumber: 2 }, send: makeSend() } });
    expect(later.findAll('.slot.received')).toHaveLength(0);
  });
});

describe('Hearts table in the standard frame', () => {
  it('has the score bar, the table and the two bottom boxes, and no Leave button', () => {
    const w = mount(Table, { props: { state: view(room()), send: makeSend() } });
    expect(w.find('.game-frame[data-fits-window]').exists()).toBe(true);
    expect(w.find('.score-bar').exists()).toBe(true);
    expect(w.find('.felt').exists()).toBe(true);
    expect(w.find('.box.log h3').text()).toBe('Recent moves');
    expect(w.find('.box.status h3').text()).toBe('Status');
    expect(w.findAll('button').some((b) => /leave/i.test(b.text()))).toBe(false);
    expect(w.find('.panel').exists()).toBe(false);
  });

  it('keeps every instruction, number and fact in Status, and only cards, names and scores on the table', () => {
    const w = mount(Table, { props: { state: view(room()), send: makeSend() } });
    const status = w.find('.box.status').text();
    expect(status).toContain('Hand 1');
    expect(status).toContain('Passing to the left');
    expect(status).toContain('Play to 100');
    expect(status).toMatch(/Choose 3 cards to pass to the left/);
    const felt = w.find('.felt').text();
    expect(felt).not.toMatch(/Choose|Hand \d|Trick|Play to|Passing|Hearts (are|not)|Your turn|Waiting/);
    expect(felt).toContain('Hazel'); // each opponent's name sits by their cards
    expect(w.findAll('.opp [aria-label="13 cards"]')).toHaveLength(3);
  });

  it('shows the turn, the trick number and the hearts state in Status while playing', () => {
    const state = view(playing());
    const w = mount(Table, { props: { state, send: makeSend() } });
    const status = w.find('.box.status').text();
    expect(status).toContain('Trick 1 of 13');
    expect(status).toContain('Hearts not broken yet');
    expect(status).toMatch(/2 of clubs|Waiting for/);
    expect(w.find('.felt').text()).not.toMatch(/Waiting for|Trick/);
  });

  it('passes three chosen cards with the button on the table', async () => {
    const send = makeSend();
    const state = view(room());
    const w = mount(Table, { props: { state, send } });
    const button = () => w.find('.confirm button');
    expect(button().element.disabled).toBe(true);
    const cards = w.findAll('.hand button.playing-card');
    for (const c of cards.slice(0, 3)) await c.trigger('click');
    expect(button().text()).toContain('Pass these 3 of 3 cards');
    await button().trigger('click');
    expect(send).toHaveBeenCalledWith('pass', { cards: state.hand.slice(0, 3) });
  });

  it('draws the recent moves it is given, newest first', () => {
    const w = mount(Table, { props: { state: view(room()), send: makeSend(), log: [{ text: 'Hand 1 is dealt.' }, { text: 'Hazel played the two of clubs.' }] } });
    const rows = w.findAll('.box.log li').map((li) => li.text());
    expect(rows).toEqual(['Hazel played the two of clubs.', 'Hand 1 is dealt.']);
  });

  it('shows the result and the buttons in Status once the game is over', async () => {
    const r = playing();
    r.phase = 'finished';
    r.winners = [2];
    r.scores = [60, 70, 20, 90];
    const send = makeSend();
    const w = mount(Table, { props: { state: view(r), send } });
    const status = w.find('.box.status');
    expect(status.text()).toContain('wins with 20 points');
    expect(status.findAll('.body button').map((b) => b.text())).toEqual(['Play again', 'See the scores']);
    await status.findAll('.body button')[0].trigger('click');
    expect(send).toHaveBeenCalledWith('again');
    expect(w.findAll('button').some((b) => /^leave/i.test(b.text()))).toBe(false);
  });
});

describe('Hearts lobby', () => {
  it('has no Leave button (the site header has it)', () => {
    const w = mount(Lobby, { props: { state: view(room({ started: false })), send: makeSend() } });
    expect(w.findAll('button').some((b) => /leave/i.test(b.text()))).toBe(false);
    expect(w.text()).toContain('Rules for this game');
  });
});

describe('Hearts shell', () => {
  it('offers Leave game to the site header while in a room, confirming only mid-game', async () => {
    const socket = fakeSocket();
    const w = mount(Hearts, { props: { socket } });
    expect(leaveOffer()).toBeNull();
    socket.handlers.state(null);
    await flushPromises();
    expect(leaveOffer()).toBeNull();
    socket.handlers.state(view(room({ started: false })));
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('');
    socket.handlers.state(view(room()));
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('A computer player takes your seat if you leave.');
    socket.emit.mockClear();
    await leaveOffer().leave();
    expect(socket.emit).toHaveBeenCalledWith('leave', {}, expect.any(Function));
    w.unmount();
    expect(playBar.leave).toBeNull();
  });

  it('builds Recent moves from the states as they arrive', async () => {
    const socket = fakeSocket();
    const w = mount(Hearts, { props: { socket } });
    const r = room({ started: false });
    socket.handlers.state(view(r));
    await flushPromises();
    game.start(r, 1, seeded(3));
    socket.handlers.state(view(r));
    await flushPromises();
    expect(w.find('.box.log').text()).toContain('Hand 1 is dealt.');
  });
});

describe('advanceLog', () => {
  const seats = ['Ann', 'Bo', 'Cy', 'Di'].map((name) => ({ name }));
  const at = (extra) => ({ code: 'a-b-c', phase: 'playing', handNumber: 1, seats, trick: [], trickWinner: null, ...extra });

  it('starts empty, and clears outside a game', () => {
    expect(advanceLog([{ text: 'x' }], at(), null)).toEqual([]);
    expect(advanceLog([{ text: 'x' }], at(), at({ phase: 'lobby' }))).toEqual([]);
    expect(advanceLog([], null, at())).toEqual([]);
  });

  it('notes each card played and the trick taken', () => {
    let log = advanceLog([], at(), at({ trick: [{ seat: 0, card: '2C' }] }));
    expect(log.map((l) => l.text)).toEqual(['Ann played the 2 of clubs.']);
    const full = [{ seat: 0, card: '2C' }, { seat: 1, card: '5C' }, { seat: 2, card: 'KC' }, { seat: 3, card: 'AC' }];
    log = advanceLog(log, at({ trick: [{ seat: 0, card: '2C' }] }), at({ trick: full, trickWinner: 3 }));
    expect(log.map((l) => l.text).slice(1)).toEqual(['Bo played the 5 of clubs.', 'Cy played the king of clubs.', 'Di played the ace of clubs.', 'Di takes the trick.']);
    log = advanceLog(log, at({ trick: full, trickWinner: 3 }), at({ trick: [{ seat: 3, card: '9D' }] }));
    expect(log.at(-1).text).toBe('Di played the 9 of diamonds.');
  });

  it('notes new hands, passing and the end of the game, and keeps a limited list', () => {
    expect(advanceLog([], at({ phase: 'passing' }), at({ phase: 'playing' })).map((l) => l.text)).toEqual(['The cards have been passed.']);
    expect(advanceLog([], at({ handNumber: 1 }), at({ handNumber: 2 })).map((l) => l.text)).toEqual(['Hand 2 is dealt.']);
    expect(advanceLog([], at(), at({ phase: 'finished', winners: [1, 2] })).map((l) => l.text)).toEqual(['The game is over: Bo and Cy win.']);
    const long = Array.from({ length: 200 }, (_, i) => ({ text: String(i) }));
    expect(advanceLog(long, at(), at({ handNumber: 2 })).length).toBe(120);
  });
});
