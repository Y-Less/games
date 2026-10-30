// The Cheat screen mounted with a fake socket: what the table shows, what the controls send, and the Recent moves list.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as game from '../game.js';
import Cheat from './Cheat.vue';
import Lobby from './Lobby.vue';
import { advanceLog } from './log.js';
import { rankWord } from './rank.js';

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
/** A real room: seat 0 is the person (account 1) and the rest are computers. */
function room({ seats = 4, started = true } = {}) {
  const r = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats } });
  game.fillWithBots(r, 1);
  if (started) expect(game.start(r, 1, seeded(3)).ok).toBe(true);
  return r;
}
const view = (r) => game.viewFor(r, 1);
/** Puts the person on turn with a chosen hand. */
function myTurn(r, hand = ['AS', 'AH', '5C', '9D', 'KD']) {
  r.hands[0] = [...hand];
  r.turn = 0;
  r.plays = 0;
  r.pile = ['2C', '3C'];
  r.last = null;
  return r;
}

function fakeSocket() {
  const handlers = {};
  return { connected: false, handlers, emit: vi.fn((event, payload, ack) => ack?.({ ok: true })), on: vi.fn((e, f) => (handlers[e] = f)), off: vi.fn((e) => delete handlers[e]) };
}
let wrapper;
async function mountGame(state) {
  const socket = fakeSocket();
  wrapper = mount(Cheat, { props: { socket, setSearch: vi.fn() }, attachTo: document.body });
  socket.handlers.state(state);
  await flushPromises();
  return { socket, show: async (next) => { socket.handlers.state(next); await flushPromises(); } };
}
const button = (text) => wrapper.findAll('button').find((b) => b.text().startsWith(text));
const sent = (socket, event) => socket.emit.mock.calls.filter((c) => c[0] === event).map((c) => c[1]);
const handCards = () => wrapper.findAll('.hand button');

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('the lobby', () => {
  it('lets the host pick the number of players and says how the cards are dealt', async () => {
    const r = room({ seats: 4, started: false });
    const send = vi.fn(() => Promise.resolve({ ok: true }));
    const lobby = mount(Lobby, { props: { state: view(r), send } });
    expect(lobby.text()).toContain('4 players: one pack, 13 cards each');
    await lobby.findAll('button').find((b) => b.text() === '6').trigger('click');
    expect(send).toHaveBeenCalledWith('settings', { seats: 6 });
    lobby.unmount();
  });

  it('describes two packs for six players', () => {
    const r = room({ seats: 6, started: false });
    const lobby = mount(Lobby, { props: { state: view(r), send: vi.fn() } });
    expect(lobby.text()).toContain('two packs, 17 cards each');
    lobby.unmount();
  });
});

describe('the table', () => {
  it('shows your hand, the rank to claim and the pile, and no popup for a turn', async () => {
    const r = myTurn(room());
    await mountGame(view(r));
    expect(handCards()).toHaveLength(5);
    expect(wrapper.find('.claim b').text()).toBe('A');
    expect(wrapper.text()).toContain('Your turn');
    expect(document.body.querySelectorAll('.your-turn')).toHaveLength(0);
  });

  it('plays the picked cards, at most four', async () => {
    const r = myTurn(room(), ['AS', 'AH', '5C', '9D', 'KD', 'QD']);
    const { socket } = await mountGame(view(r));
    expect(button('Play').attributes('disabled')).toBeDefined();
    for (const i of [0, 1, 2, 3, 4]) await handCards()[i].trigger('click');
    expect(wrapper.text()).toContain('at most 4 cards');
    await button('Play').trigger('click');
    await flushPromises();
    expect(sent(socket, 'play')).toEqual([{ cards: ['AS', 'AH', '5C', '9D'] }]);
  });

  it('a second click on a picked card puts it back', async () => {
    const r = myTurn(room());
    const { socket } = await mountGame(view(r));
    await handCards()[0].trigger('click');
    await handCards()[1].trigger('click');
    await handCards()[0].trigger('click');
    await button('Play').trigger('click');
    expect(sent(socket, 'play')).toEqual([{ cards: ['AH'] }]);
  });

  it('can call the last play, and the button is not offered for your own play', async () => {
    const r = room();
    r.turn = 1;
    game.playCards(r, 1, [r.hands[1][0]]);
    const { socket, show } = await mountGame(view(r));
    await button('Cheat!').trigger('click');
    expect(sent(socket, 'call')).toHaveLength(1);
    // Your own play: no one to call but others.
    const own = room();
    own.hands[0] = ['AS', '5C'];
    own.turn = 0;
    game.playCards(own, 0, ['AS']);
    await show(view(own));
    expect(button('Cheat!').classes()).toContain('hidden');
  });

  it('after a call it reveals the cards and says who picked up the pile', async () => {
    const r = room();
    r.turn = 1;
    r.hands[1] = ['5C', '5D'];
    game.playCards(r, 1, ['5C']);
    game.callCheat(r, 0);
    await mountGame(view(r));
    expect(wrapper.findAll('.shown button, .shown .playing-card')).toHaveLength(1);
    expect(wrapper.text()).toContain('called Cheat');
    expect(wrapper.text()).toContain('picked up');
  });

  it('in the final check you can call or say you believe them', async () => {
    const r = room({ seats: 3 });
    r.hands = [['2C', '3C'], ['5C'], ['4C', '6C']];
    r.turn = 1;
    r.plays = 0;
    game.playCards(r, 1, ['5C']);
    expect(r.phase).toBe('check');
    const { socket } = await mountGame(view(r));
    expect(wrapper.text()).toContain('last cards');
    await button('I believe you').trigger('click');
    expect(sent(socket, 'accept')).toHaveLength(1);
  });

  it('a finished game offers play again to the host only', async () => {
    const r = room({ seats: 3 });
    r.hands = [['5C'], ['2C'], ['3C']];
    r.turn = 0;
    r.plays = 4;
    game.playCards(r, 0, ['5C']);
    game.accept(r, 1);
    game.accept(r, 2);
    const { socket } = await mountGame(view(r));
    expect(wrapper.text()).toContain('wins');
    await button('Play again').trigger('click');
    expect(sent(socket, 'again')).toHaveLength(1);
  });

  it('fits a big hand without changing the size of the box', async () => {
    const r = myTurn(room(), game.deckFor(2).slice(0, 40));
    await mountGame(view(r));
    expect(handCards()).toHaveLength(40);
  });
});

describe('the recent moves', () => {
  it('speaks ranks naturally', () => {
    expect(rankWord('A', 2)).toBe('Aces');
    expect(rankWord('A', 1)).toBe('an Ace');
    expect(rankWord('8', 1)).toBe('an 8');
    expect(rankWord('K', 3)).toBe('Kings');
    expect(rankWord('7', 1)).toBe('a 7');
  });

  it('adds a line for each play, call and the end', () => {
    const r = room();
    const first = view(r);
    const seat = r.turn;
    game.playCards(r, seat, [r.hands[seat][0]]);
    const second = game.viewFor(r, 1);
    let log = advanceLog([], first, second);
    expect(log).toHaveLength(1);
    expect(log[0].text).toMatch(/plays 1 card, claiming an Ace/);
    const caller = (seat + 1) % 4;
    game.callCheat(r, caller);
    log = advanceLog(log, second, game.viewFor(r, 1));
    expect(log).toHaveLength(2);
    expect(log[1].text).toMatch(/calls Cheat on .*picks up/);
  });

  it('starts empty and clears in the lobby', () => {
    expect(advanceLog([{ text: 'x' }], null, null)).toEqual([]);
    const r = room();
    expect(advanceLog([], null, view(r))).toEqual([]);
  });
});
