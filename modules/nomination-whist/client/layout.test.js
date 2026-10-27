// The standard layout of Nomination Whist: the frame, the words in Status, the log built from state changes, and the
// header's Leave game.
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as game from '../game.js';
import { leaveOffer } from '../../../src/playBar.js';
import { movesBetween } from './log.js';
import NominationWhist from './NominationWhist.vue';
import Table from './Table.vue';

window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

/** A started 4-seat game (user 1 is seat 0), with `turn` to nominate. */
function started(turn = 0) {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
  game.fillWithBots(room, 1);
  expect(game.start(room, 1, () => 0.3).ok).toBe(true);
  room.turn = turn;
  return room;
}
const copy = (value) => JSON.parse(JSON.stringify(value));
const mountTable = (state, send = vi.fn(() => Promise.resolve({ ok: true }))) => ({ send, w: mount(Table, { props: { state, send } }) });

describe('the table in the standard frame', () => {
  it('has the score bar, the trick, the nomination zone, the hand and the two bottom boxes', () => {
    const { w } = mountTable(game.viewFor(started(), 1));
    expect(w.find('.game-frame .scorebar .score-bar').exists()).toBe(true);
    expect(w.find('.seats').exists()).toBe(false); // no row of seats: the players are the chips in the score bar
    expect(w.find('.main .centre .trick-circle').exists()).toBe(true);
    expect(w.find('.main .nominate .numbers').exists()).toBe(true);
    expect(w.findAll('.main .hand .playing-card')).toHaveLength(7);
    expect(w.find('.box.log h3').text()).toBe('Recent moves');
    expect(w.find('.box.status h3').text()).toBe('Status');
  });

  it('always shows every opponent face down with their name and a short note, whose turn it is marked', () => {
    const { w } = mountTable(game.viewFor(started(2), 1));
    const opps = w.findAll('.main .opponent-hands .opp');
    expect(opps).toHaveLength(3);
    expect(opps.map((o) => o.classes().find((c) => ['left', 'top', 'right'].includes(c)))).toEqual(['left', 'top', 'right']);
    expect(opps.every((o) => o.findAll('.playing-card').length === 7)).toBe(true);
    expect(opps[1].find('.who').text()).toBeTruthy();
    expect(opps[1].classes()).toContain('current');
    expect(opps[1].find('.tag').text()).toBe('nominating…');
    expect(opps[0].find('.tag').text()).toBe('not yet nominated');
  });

  it('keeps the round, dealer, trumps and every instruction in Status, not in the play area', () => {
    const { w } = mountTable(game.viewFor(started(), 1));
    const status = w.find('.box.status').text();
    expect(status).toContain('Round 1 of 14');
    expect(status).toContain('7 cards each');
    expect(status).toContain('Dealer:');
    expect(status).toContain('Trumps:');
    expect(status).toContain('Your turn: nominate');
    const play = w.find('.main').text();
    for (const text of ['Round 1', 'Dealer:', 'Trumps', 'Your turn', 'Waiting for', 'cards each']) expect(play).not.toContain(text);
  });

  it('has no Leave button (the header has it) and no old banner or status line', () => {
    const { w } = mountTable(game.viewFor(started(), 1));
    expect(w.findAll('button').some((b) => /Leave/.test(b.text()))).toBe(false);
    expect(w.find('.banner').exists()).toBe(false);
    expect(w.find('p.status').exists()).toBe(false);
  });

  it('always draws the nomination zone with room for 0 to 7, enabled only on your nomination turn', () => {
    const mine = mountTable(game.viewFor(started(0), 1)).w;
    expect(mine.findAll('.nominate .numbers > *')).toHaveLength(8);
    expect(mine.findAll('.nominate button.number').filter((b) => b.attributes('disabled') === undefined).length).toBeGreaterThan(0);
    const theirs = mountTable(game.viewFor(started(2), 1)).w;
    expect(theirs.findAll('.nominate .numbers > *')).toHaveLength(8);
    expect(theirs.findAll('.nominate button.number').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });

  it('sends a nomination when its button is clicked on your turn', async () => {
    const { w, send } = mountTable(game.viewFor(started(0), 1));
    await w.findAll('.nominate button.number').find((b) => b.attributes('disabled') === undefined).trigger('click');
    expect(send).toHaveBeenCalledWith('nominate', { number: expect.any(Number) });
  });

  it('opens the details (cards, nomination, dealer) from their chip, and closes them again', async () => {
    const state = copy(game.viewFor(started(2), 1));
    state.seats[1].bid = 3;
    const w = mount(Table, { props: { state, send: vi.fn() }, attachTo: document.body });
    expect(w.find('.popup').exists()).toBe(false);
    expect(w.findAll('.score-bar .chip-button')).toHaveLength(4); // yours too
    const others = () => w.findAll('.score-bar .chip-button').filter((c) => !c.text().includes('(you)'));
    await others()[0].trigger('click');
    const popup = w.find('.popup');
    expect(popup.text()).toContain(state.seats[1].name);
    expect(popup.text()).toContain('Cards in hand');
    expect(popup.text()).toContain('nominated 3');
    expect(popup.text()).toContain('Score');
    await others()[0].trigger('click'); // the same chip again
    expect(w.find('.popup').exists()).toBe(false);
    await others()[1].trigger('click');
    expect(w.find('.popup').exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(w.find('.popup').exists()).toBe(false);
    await others()[1].trigger('click');
    document.body.click(); // outside
    await w.vm.$nextTick();
    expect(w.find('.popup').exists()).toBe(false);
    w.unmount();
  });
});

describe('Recent moves', () => {
  const base = () => game.viewFor(started(), 1);

  it('starts with the round and adds a line for each nomination, card and trick', () => {
    const before = base();
    expect(movesBetween(null, before)).toEqual([{ text: expect.stringMatching(/^Round 1: 7 cards each, .* are trumps\.$/) }]);
    const nominated = copy(before);
    nominated.seats[1].bid = 2;
    expect(movesBetween(before, nominated)).toEqual([{ text: `${nominated.seats[1].name} nominated 2.` }]);
    const one = copy(before);
    one.trick = [{ seat: 2, card: 'QS' }];
    expect(movesBetween(before, one)).toEqual([{ text: `${one.seats[2].name} played Q♠.` }]);
    const full = copy(one);
    full.trick = [0, 1, 2, 3].map((seat) => ({ seat, card: 'QS' }));
    full.trickWinner = 1;
    expect(movesBetween(one, full).map((l) => l.text).at(-1)).toBe(`${full.seats[1].name} won the trick.`);
  });

  it('says nothing when nothing changed, and starts afresh with a new round', () => {
    const state = base();
    expect(movesBetween(state, copy(state))).toEqual([]);
    const later = copy(state);
    later.round.number = 2;
    later.round.cards = 6;
    expect(movesBetween(state, later)[0].text).toMatch(/^Round 2: 6 cards each/);
    expect(movesBetween(null, { ...state, phase: 'lobby' })).toEqual([]);
  });

  it('is shown in the log box', () => {
    const { w } = mountTable(base());
    expect(w.find('.box.log').text()).toContain('Round 1: 7 cards each');
  });
});

describe('the site header', () => {
  function fakeSocket() {
    const socket = { connected: false, handlers: {}, emit: vi.fn((e, p, ack) => ack?.({ ok: true })), off: vi.fn() };
    socket.on = vi.fn((e, f) => (socket.handlers[e] = f));
    return socket;
  }

  it('offers Leave game without asking in the lobby, and asks first (a computer takes your seat) during play', async () => {
    const socket = fakeSocket();
    const w = mount(NominationWhist, { props: { socket } });
    socket.handlers.state(null);
    await flushPromises();
    expect(leaveOffer()).toBeNull();
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann' });
    socket.handlers.state(game.viewFor(room, 1));
    await flushPromises();
    expect(w.findAll('button').some((b) => b.text() === 'Leave game')).toBe(false);
    expect(leaveOffer()).toMatchObject({ confirmText: '' });
    game.fillWithBots(room, 1);
    game.start(room, 1, () => 0.3);
    socket.handlers.state(game.viewFor(room, 1));
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('A computer player takes your seat if you leave.');
    await leaveOffer().leave();
    expect(socket.emit).toHaveBeenCalledWith('leave', {}, expect.any(Function));
    w.unmount();
    expect(leaveOffer()).toBeNull();
  });
});
