import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as game from '../game.js';
import { leaveOffer, playBar } from '../../../src/playBar.js';
import Cribbage from './Cribbage.vue';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

function seeded(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A real room: seat 0 is the person (user 1), the others computer players. */
function room({ seats = 2, started = true } = {}) {
  const r = game.createRoom({ code: 'one-two-three', hostId: 1, name: 'Alex', target: 121, seats });
  expect(game.fillBots(r, 1).ok).toBe(true);
  if (started) expect(game.start(r, 1, seeded(5)).ok).toBe(true);
  return r;
}
const view = (r) => game.viewFor(r, 1);
/** Everyone has put their cards in the crib, so the pegging has begun. */
function pegging(seats = 2) {
  const r = room({ seats });
  const count = game.viewFor(r, 1).need;
  for (let seat = 0; seat < seats; seat++) expect(game.discard(r, seat, r.hands[seat].slice(0, count), seeded(2)).ok).toBe(true);
  expect(r.phase).toBe('play');
  return r;
}
const makeSend = () => vi.fn(() => Promise.resolve({ ok: true }));
function fakeSocket(connected = false) {
  const handlers = {};
  return { connected, handlers, emit: vi.fn((e, p, ack) => ack?.({ ok: true })), on: vi.fn((e, f) => (handlers[e] = f)), off: vi.fn((e) => delete handlers[e]) };
}
const noLeave = (w) => !w.findAll('button').some((b) => /^leave/i.test(b.text()));

describe('Cribbage table in the standard frame', () => {
  it('has the score bar, the board and the two bottom boxes, and no opponent bars or Leave button', () => {
    const w = mount(Table, { props: { state: view(room({ seats: 3 })), send: makeSend() } });
    expect(w.find('.game-frame[data-fits-window]').exists()).toBe(true);
    expect(w.find('.score-bar').exists()).toBe(true);
    expect(w.find('svg.board').exists()).toBe(true);
    expect(w.find('.bars').exists()).toBe(false);
    expect(w.classes()).toContain('no-others');
    expect(w.find('.box.log h3').text()).toBe('Recent moves');
    expect(w.find('.box.status h3').text()).toBe('Status');
    expect(noLeave(w)).toBe(true);
    expect(w.find('.panel').exists()).toBe(false);
  });

  it('keeps the instruction, hand number, dealer, target and deck and crib counts in Status', () => {
    const state = view(room());
    const w = mount(Table, { props: { state, send: makeSend() } });
    const status = w.find('.box.status').text();
    expect(status).toContain('Hand 1');
    expect(status).toContain('First to 121');
    expect(status).toMatch(/Deck: 40/);
    expect(status).toMatch(/crib: 0/);
    expect(status).toMatch(/deals|You deal/);
    expect(status).toMatch(/Choose 2 cards for (your|Robin's|\w+'s) crib\./);
    const table = w.find('.arena').text();
    expect(table).not.toMatch(/Choose|Hand \d|First to|Deck \(|crib \(|deals|Waiting|Your turn|to play/);
  });

  it('sends two chosen cards to the crib with the button in the play area', async () => {
    const send = makeSend();
    const state = view(room());
    const w = mount(Table, { props: { state, send } });
    const button = () => w.find('.zone button.primary');
    expect(button().element.disabled).toBe(true);
    const cards = w.findAll('.hand button.playing-card');
    for (const c of cards.slice(0, 2)) await c.trigger('click');
    expect(w.find('.box.status').text()).toContain('2 of 2 chosen');
    await button().trigger('click');
    expect(send).toHaveBeenCalledWith('discard', { cards: state.hand.slice(0, 2) });
  });

  it('shows the count and the turn while pegging: the count on the table, the words in Status', () => {
    const state = view(pegging());
    const w = mount(Table, { props: { state, send: makeSend() } });
    expect(w.find('.zone .count strong').text()).toBe('0');
    const status = w.find('.box.status').text();
    expect(status).toMatch(/Your turn|to play\./);
    expect(status).toContain('Nothing has been played yet.');
    expect(w.find('.zone').text()).not.toMatch(/turn|to play|Nothing/);
  });

  it('still draws the same areas in the show and at the end', () => {
    const r = pegging();
    for (const phase of ['show', 'finished']) {
      r.phase = phase;
      r.winner = 0;
      r.show = null;
      const w = mount(Table, { props: { state: view(r), send: makeSend() } });
      for (const sel of ['.zone', '.hand-area', '.board-box', '.piles', '.box.log', '.box.status']) expect(w.find(sel).exists(), `${phase}: ${sel}`).toBe(true);
    }
  });

  it('shows the result and the buttons in Status at the end', async () => {
    const r = pegging();
    r.phase = 'finished';
    r.winner = 0;
    r.seats[0].score = 121;
    const send = makeSend();
    const w = mount(Table, { props: { state: view(r), send } });
    const status = w.find('.box.status');
    expect(status.text()).toContain('Alex (you) wins!');
    expect(status.text()).toMatch(/1\. Alex \(you\): 121/);
    expect(status.findAll('.body button').map((b) => b.text())).toEqual(['Play again (back to the lobby)', 'See the scores']);
    await status.findAll('.body button')[0].trigger('click');
    expect(send).toHaveBeenCalledWith('rematch');
    expect(noLeave(w)).toBe(true);
  });
});

describe('Cribbage opponent details', () => {
  it('opens from the opponent chip, shows what they hold, and closes again', async () => {
    const w = mount(Table, { props: { state: view(room({ seats: 3 })), send: makeSend() }, attachTo: document.body });
    expect(w.find('.popup').exists()).toBe(false);
    const chips = w.findAll('.score-bar .chip-button');
    expect(chips).toHaveLength(2); // the other two players, not you
    await chips[0].trigger('click');
    const text = w.find('.popup').text();
    expect(text).toMatch(/5 cards in hand/);
    expect(text).toMatch(/Still choosing|Has put cards/);
    expect(text).toMatch(/Pegs: front on 0, back on 0/);
    await chips[0].trigger('click');
    expect(w.find('.popup').exists()).toBe(false);
    await chips[1].trigger('click');
    expect(w.find('.popup').exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('.popup').exists()).toBe(false);
    w.unmount();
  });
});

describe('Cribbage lobby', () => {
  it('shows the invite code and has no Leave button (the site header has it)', () => {
    const w = mount(Lobby, { props: { state: view(room({ started: false })), send: makeSend() } });
    expect(noLeave(w)).toBe(true);
    expect(w.find('.invite .code').text()).toBe('one-two-three');
  });
});

describe('Cribbage shell', () => {
  it('offers Leave game to the site header while in a room, confirming only mid-game', async () => {
    const socket = fakeSocket();
    const w = mount(Cribbage, { props: { socket } });
    expect(leaveOffer()).toBeNull();
    socket.handlers.state(null);
    await flushPromises();
    expect(leaveOffer()).toBeNull();
    socket.handlers.state(view(room({ started: false })));
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('');
    socket.handlers.state(view(room()));
    await flushPromises();
    expect(w.find('.table-view').exists()).toBe(true);
    expect(leaveOffer().confirmText).toBe('A computer player takes your seat if you leave.');
    socket.emit.mockClear();
    await leaveOffer().leave();
    expect(socket.emit).toHaveBeenCalledWith('leave', {}, expect.any(Function));
    const done = room();
    done.phase = 'finished';
    done.winner = 1;
    socket.handlers.state(view(done));
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('');
    w.unmount();
    expect(playBar.leave).toBeNull();
  });
});
