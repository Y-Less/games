import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as game from '../game.js';
import { started } from '../kit.js';
import { leaveOffer, playBar } from '../../../src/playBar.js';
import Splendour from './Splendour.vue';
import { DESIGN, SPANS, fontSize } from './layout.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

// ---- helpers: real server views, so the tests follow the real state shape ----
const lobbyRoom = (seats = 4) => game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats } });
const lobbyView = (room = lobbyRoom()) => game.viewFor(room, 1);
const playView = (room = started(4)) => game.viewFor(room, 1);
const finishedView = (extra = {}) => {
  const v = playView();
  return { ...v, phase: 'finished', winners: [0], endReason: null, standings: v.standings.map((x, i) => ({ ...x, prestige: i === 0 ? 16 : 5 })), ...extra };
};
const makeSend = (reply = { ok: true }) => vi.fn(() => Promise.resolve(reply));
const mountTable = (state, send = makeSend()) => ({ send, w: mount(Table, { props: { state, send } }) });
const button = (w, text) => w.findAll('button').find((b) => b.text().includes(text));
const supplyButton = (w, c) => w.find('.supply').findAll('button.stack-btn')[c];
const cardButton = (w, row, slot) => w.findAll('.level-row')[row].findAll('button.dev-card')[slot]; // row 0 is level 3

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

describe('Splendour shell', () => {
  it('shows loading, then the entry screen when there is no game', async () => {
    const socket = fakeSocket();
    const w = mount(Splendour, { props: { socket } });
    expect(w.text()).toContain('Loading your game');
    socket.handlers.state(null);
    await flushPromises();
    expect(w.text()).toContain('Start a new game of Splendour');
  });

  it('resumes on mount when already connected, with the invite code', () => {
    const socket = fakeSocket(true);
    mount(Splendour, { props: { socket, search: '?a-b-c' } });
    expect(socket.emit).toHaveBeenCalledWith('resume', { code: 'a-b-c' }, expect.any(Function));
  });

  it('emits create and join from the entry screen', async () => {
    const socket = fakeSocket();
    const w = mount(Splendour, { props: { socket } });
    socket.handlers.state(null);
    await flushPromises();
    await button(w, 'Start a new').trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('create', {}, expect.any(Function));
    await w.find('input').setValue('boss-aware-you');
    await w.find('form').trigger('submit');
    expect(socket.emit).toHaveBeenCalledWith('join', { code: 'boss-aware-you' }, expect.any(Function));
  });

  it('shows the lobby, the table, and reports the code to setSearch', async () => {
    const socket = fakeSocket();
    const setSearch = vi.fn();
    const w = mount(Splendour, { props: { socket, setSearch } });
    socket.handlers.state(lobbyView());
    await flushPromises();
    expect(w.text()).toContain('Rules for this game');
    expect(setSearch).toHaveBeenLastCalledWith('a-b-c');
    socket.handlers.state(playView());
    await flushPromises();
    expect(w.find('.table-view').exists()).toBe(true);
    socket.handlers.state(null);
    await flushPromises();
    expect(setSearch).toHaveBeenLastCalledWith('');
  });

  it('shows a server error and tolerates a reply-less ack', async () => {
    const socket = fakeSocket();
    socket.emit = vi.fn((e, p, ack) => ack(undefined));
    const w = mount(Splendour, { props: { socket } });
    socket.handlers.state(lobbyView());
    await flushPromises();
    await leaveOffer().leave();
    await flushPromises();
    expect(w.find('[role=alert]').text()).toContain('did not answer');
    socket.emit = vi.fn((e, p, ack) => ack({ ok: false, error: 'Nope.' }));
    await leaveOffer().leave();
    await flushPromises();
    expect(w.find('[role=alert]').text()).toBe('Nope.');
  });

  it('offers Leave game to the site header while in a room, confirming only mid-game', async () => {
    const socket = fakeSocket();
    const w = mount(Splendour, { props: { socket } });
    expect(leaveOffer()).toBeNull();
    socket.handlers.state(null);
    await flushPromises();
    expect(leaveOffer()).toBeNull();
    socket.handlers.state(lobbyView());
    await flushPromises();
    expect(leaveOffer().confirmText).toBe('');
    expect(button(w, 'Leave game')).toBeUndefined();
    socket.handlers.state(playView());
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
    mount(Splendour, { props: { socket } }).unmount();
    expect(socket.off).toHaveBeenCalledWith('state', expect.any(Function));
  });
});

describe('Splendour lobby', () => {
  it('lets the host change settings and manage seats', async () => {
    const send = makeSend();
    const w = mount(Lobby, { props: { state: lobbyView(), send } });
    expect(w.text()).toContain('a-b-c');
    await button(w, '2 players').trigger('click');
    await button(w, '20').trigger('click');
    expect(send).toHaveBeenCalledWith('settings', { seats: 2 });
    expect(send).toHaveBeenCalledWith('settings', { target: 20 });
    await button(w, 'Add a computer player').trigger('click');
    expect(send).toHaveBeenCalledWith('addBot', { seat: 1 });
    expect(button(w, 'Leave game')).toBeUndefined(); // Leave game is in the site header
  });

  it('marks the current settings and disables them for non-hosts', () => {
    const room = lobbyRoom();
    game.addHuman(room, 2, 'bob');
    const w = mount(Lobby, { props: { state: game.viewFor(room, 2), send: makeSend() } });
    expect(w.find('fieldset').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('Only the host can change these');
    expect(button(w, '4 players').attributes('aria-pressed')).toBe('true');
    expect(button(w, '2 players').attributes('aria-pressed')).toBe('false');
  });

  it('disables a seat count smaller than the number of people seated', () => {
    const room = lobbyRoom();
    game.addHuman(room, 2, 'bob');
    game.addHuman(room, 3, 'cat');
    const w = mount(Lobby, { props: { state: game.viewFor(room, 1), send: makeSend() } });
    expect(button(w, '2 players').attributes('disabled')).toBeDefined();
    expect(button(w, '3 players').attributes('disabled')).toBeUndefined();
  });
});

describe('Splendour table: playing', () => {
  it('renders the board, nobles, supply, scoreboard and player boards', () => {
    const { w } = mountTable(playView());
    expect(w.findAll('.level-row')).toHaveLength(3);
    expect(w.findAll('.level-row').every((r) => r.findAll('button.dev-card').length === 4)).toBe(true);
    expect(w.findAll('.supply button.stack-btn')).toHaveLength(5);
    expect(w.findAll('section.board')).toHaveLength(1); // only yours: the others open from the score bar
    expect(w.find('section.board').classes('large')).toBe(true);
    expect(w.find('.game-status').text()).toContain('Round 1');
    expect(w.find('.game-status').text()).toContain('First to 15 prestige');
    expect(w.text()).toContain('Nothing has happened yet');
    expect(w.text()).toContain('ann');
  });

  it('shows whose turn it is', () => {
    const v = playView();
    const mine = mountTable({ ...v, turn: 0 }).w;
    expect(mine.find('.headline').text()).toContain('Your turn');
    const theirs = mountTable({ ...v, turn: 1 }).w;
    expect(theirs.find('.headline').text()).toContain('Waiting for');
    expect(theirs.find('.headline').classes('mine')).toBe(false);
  });

  it('selects gems, highlights them, and takes three different gems', async () => {
    const { w, send } = mountTable({ ...playView(), turn: 0 });
    expect(button(w, 'Take').attributes('disabled')).toBeDefined();
    for (const c of [0, 1, 2]) await supplyButton(w, c).trigger('click');
    expect(supplyButton(w, 1).classes('picked')).toBe(true);
    expect(supplyButton(w, 1).attributes('aria-pressed')).toBe('true');
    const take = button(w, 'Take 3 gems');
    expect(take.attributes('disabled')).toBeUndefined();
    await take.trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('take', { colours: [0, 1, 2] });
    expect(supplyButton(w, 0).classes('picked')).toBe(false);
  });

  it('takes two of one colour by clicking it twice', async () => {
    const { w, send } = mountTable({ ...playView(), turn: 0 });
    await supplyButton(w, 3).trigger('click');
    await supplyButton(w, 3).trigger('click');
    await button(w, 'Take 2 gems').trigger('click');
    expect(send).toHaveBeenCalledWith('takeTwo', { colour: 3 });
  });

  it('keeps the picks when the server refuses', async () => {
    const { w } = mountTable({ ...playView(), turn: 0 }, makeSend({ ok: false, error: 'no' }));
    for (const c of [0, 1, 2]) await supplyButton(w, c).trigger('click');
    await button(w, 'Take 3 gems').trigger('click');
    await flushPromises();
    expect(supplyButton(w, 0).classes('picked')).toBe(true);
  });

  it('refuses a fourth gem, and a pair when fewer than four are left', async () => {
    const v = playView();
    const { w } = mountTable({ ...v, turn: 0 });
    for (const c of [0, 1, 2, 3]) await supplyButton(w, c).trigger('click');
    expect(w.find('.game-status .warn').text()).toContain('at most three');
    const low = mountTable({ ...v, turn: 0, supply: [3, 3, 3, 3, 3, 5] }).w;
    await supplyButton(low, 0).trigger('click');
    await supplyButton(low, 0).trigger('click');
    expect(low.find('.game-status .warn').text()).toContain('at least four');
  });

  it("does not let you take gems on someone else's turn", async () => {
    const { w, send } = mountTable({ ...playView(), turn: 1 });
    await supplyButton(w, 0).trigger('click');
    expect(w.find('.game-status .warn').text()).toContain('not your turn');
    expect(supplyButton(w, 0).classes('picked')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('offers to pass only when the server says so', async () => {
    const v = { ...playView(), turn: 0 };
    expect(button(mountTable(v).w, 'Pass')).toBeUndefined();
    const { w, send } = mountTable({ ...v, canPass: true });
    await button(w, 'Pass').trigger('click');
    expect(send).toHaveBeenCalledWith('pass');
  });

  it('highlights affordable cards and buys one', async () => {
    const base = { ...playView(), turn: 0 };
    const id = base.board[1][0];
    const v = { ...base, afford: { [id]: { pay: [0, 0, 0, 0, 0, 0], minGold: 0, maxGold: 0 } } };
    const { w, send } = mountTable(v);
    expect(cardButton(w, 2, 0).classes('affordable')).toBe(true);
    expect(cardButton(w, 2, 1).classes('affordable')).toBe(false);
    await cardButton(w, 2, 0).trigger('click');
    expect(cardButton(w, 2, 0).classes('selected')).toBe(true);
    expect(w.find('.game-status').text()).toContain('You can afford it');
    await button(w, 'Buy this card').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('buy', { card: id });
    expect(w.find('.dev-card.selected').exists()).toBe(false);
  });

  it('explains what is missing for an unaffordable card and still lets you reserve it', async () => {
    const v = { ...playView(), turn: 0 };
    const id = v.board[1][0];
    const { w, send } = mountTable(v);
    await cardButton(w, 2, 0).trigger('click');
    expect(w.find('.game-status .warn').text()).toContain('cannot afford');
    expect(w.find('.cannot').exists()).toBe(true);
    expect(button(w, 'Buy this card').attributes('disabled')).toBeDefined();
    await button(w, 'Reserve').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('reserve', { card: id });
  });

  it('deselects a card by clicking it again or Cancel', async () => {
    const { w } = mountTable({ ...playView(), turn: 0 });
    await cardButton(w, 0, 0).trigger('click');
    await cardButton(w, 0, 0).trigger('click');
    expect(w.find('.dev-card.selected').exists()).toBe(false);
    await cardButton(w, 0, 0).trigger('click');
    await button(w, 'Cancel').trigger('click');
    expect(w.find('.dev-card.selected').exists()).toBe(false);
  });

  it('reserves blind from a pile', async () => {
    const { w, send } = mountTable({ ...playView(), turn: 0 });
    await w.findAll('.pile-button')[0].trigger('click'); // level 3
    expect(w.find('.game-status').text()).toContain('Reserve from the level 3 pile');
    await button(w, 'Reserve the top card').trigger('click');
    expect(send).toHaveBeenCalledWith('reserve', { level: 3 });
  });

  it('disables reserving when it is not your turn or three cards are held', async () => {
    const v = playView();
    const { w } = mountTable({ ...v, turn: 1 });
    await cardButton(w, 0, 0).trigger('click');
    expect(button(w, 'Reserve').attributes('disabled')).toBeDefined();
    const blind = () => ({ level: 1, card: null, blind: true });
    const full = { ...v, turn: 0, seats: v.seats.map((s, i) => (i === 0 ? { ...s, reserved: [blind(), blind(), blind()] } : s)) };
    const { w: w2 } = mountTable(full);
    await cardButton(w2, 0, 0).trigger('click');
    expect(button(w2, 'Reserve').attributes('disabled')).toBeDefined();
  });

  it('drops a selected card that has left the table', async () => {
    const v = { ...playView(), turn: 0 };
    const { w } = mountTable(v);
    await cardButton(w, 0, 0).trigger('click');
    const gone = v.board[3][0];
    await w.setProps({ state: { ...v, turn: 1, board: { ...v.board, 3: v.board[3].map((c) => (c === gone ? null : c)) } } });
    expect(w.find('.dev-card.selected').exists()).toBe(false);
  });

  it('returns tokens when asked to', async () => {
    const v = playView();
    const state = {
      ...v,
      turn: 0,
      pending: { seat: 0, type: 'return', count: 2 },
      seats: v.seats.map((s, i) => (i === 0 ? { ...s, tokens: [3, 3, 2, 2, 2, 0] } : s)),
    };
    const { w, send } = mountTable(state);
    expect(w.find('.headline').text()).toContain('return 2');
    expect(w.find('.game-status').text()).toContain('give back');
    const give = w.findAll('.give-row button');
    await give[0].trigger('click');
    expect(button(w, 'Return 1 of 2').attributes('disabled')).toBeDefined();
    await give[1].trigger('click');
    await give[2].trigger('click'); // over the limit: ignored
    const confirm = button(w, 'Return 2 of 2');
    expect(confirm.attributes('disabled')).toBeUndefined();
    await confirm.trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('giveBack', { tokens: [1, 1, 0, 0, 0, 0] });
  });

  it('chooses a noble when asked to', async () => {
    const v = playView();
    const options = v.nobles.slice(0, 2);
    const { w, send } = mountTable({ ...v, turn: 0, pending: { seat: 0, type: 'noble', options } });
    expect(w.find('.headline').text()).toContain('choose one');
    const choices = w.find('.action').findAll('button');
    expect(choices).toHaveLength(2);
    await choices[1].trigger('click');
    expect(send).toHaveBeenCalledWith('noble', { noble: options[1] });
  });

  it("shows others' pending choices without controls", () => {
    const v = playView();
    const { w } = mountTable({ ...v, turn: 1, pending: { seat: 1, type: 'return', count: 1 } });
    expect(w.find('.headline').text()).toContain('is returning tokens');
    expect(w.find('.action').text()).not.toContain('Return 1');
  });

  it('announces the last round', () => {
    const { w } = mountTable({ ...playView(), finalRound: true, triggeredBy: 1 });
    expect(w.find('.game-status').text()).toContain('last round');
  });

  it('shows the recent moves from the log', () => {
    const v = playView();
    const log = [
      { round: 1, seat: 0, kind: 'take', colours: [0, 1, 2] },
      { round: 1, seat: 1, kind: 'take2', colour: 3 },
      { round: 1, seat: 2, kind: 'pass' },
      { round: 1, seat: 3, kind: 'reserve', level: 2, card: null, gold: 1 },
      { round: 2, seat: 0, kind: 'buy', level: 1, card: v.board[1][0] },
      { round: 2, seat: 1, kind: 'return', give: [1, 1, 0, 0, 0, 0] },
    ];
    const { w } = mountTable({ ...v, log });
    const items = w.findAll('.box.log .game-log li');
    expect(items).toHaveLength(6);
    expect(items[0].text()).toContain('returned 2 tokens'); // newest first, like every game
    expect(items[5].find('.own').exists()).toBe(true);
    expect(w.find('.box.log').text()).toContain('the top card of pile 2');
  });

  it('keeps the recent moves in a fixed, scrolling box that follows the newest entry', async () => {
    const v = playView();
    const entry = (n) => ({ round: 1 + Math.floor(n / 4), seat: n % 4, kind: 'take', colours: [0, 1, 2] });
    const { w } = mountTable({ ...v, log: Array.from({ length: 3 }, (_, n) => entry(n)) });
    expect(w.find('.box.log .game-log').exists()).toBe(true);
    await w.setProps({ state: { ...v, log: Array.from({ length: 40 }, (_, n) => entry(n)) } });
    await flushPromises();
    expect(w.findAll('.box.log .game-log li')).toHaveLength(40);
    expect(w.find('.box.log .game-log').element.scrollTop).toBe(0); // the newest entry is at the top and stays in view
  });

  it('is sized to the window by its own font size and height, not by the game', () => {
    const { w } = mountTable(playView());
    expect(w.find('[data-fits-window]').exists()).toBe(true);
    expect(w.find('.table-view').attributes('style')).toMatch(/height: [0-9]+px/);
    expect(w.find('.arena').attributes('style')).toMatch(/font-size: [0-9.]+px/);
  });

  it('is built on the standard frame, with every word in the Status box', () => {
    const { w } = mountTable(playView());
    expect(w.find('.box.log h3').text()).toBe('Recent moves');
    expect(w.find('.box.status h3').text()).toBe('Status');
    expect(w.find('.others').exists()).toBe(false);
    expect(w.find('.arena .status').exists()).toBe(false);
    expect(w.find('.arena [role=alert]').exists()).toBe(false);
  });

  it("opens the other players' boards from their score bar names, one at a time; yours is not a button", async () => {
    const { w } = mountTable(playView());
    const chips = () => w.findAll('.score-bar button.chip-button');
    expect(chips()).toHaveLength(3);
    expect(chips().map((b) => b.attributes('aria-label'))).not.toContain("Show ann's details");
    expect(w.findAll('.popup')).toHaveLength(0);
    await chips()[0].trigger('click');
    expect(w.findAll('.popup section.board')).toHaveLength(1);
    expect(chips()[0].attributes('aria-pressed')).toBe('true');
    expect(w.findAll('section.board')).toHaveLength(2); // yours stays where it is
    await chips()[1].trigger('click');
    expect(w.findAll('.popup')).toHaveLength(1);
    expect(chips()[0].attributes('aria-pressed')).toBe('false');
    await chips()[1].trigger('click');
    expect(w.findAll('.popup')).toHaveLength(0);
    await chips()[2].trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.findAll('.popup')).toHaveLength(0);
  });

  it('never opens a pop-up between rounds, but does at the end', async () => {
    const v = playView();
    const { w } = mountTable({ ...v, scoreboard: { ...v.scoreboard, rounds: [] } });
    const board = w.findComponent({ name: 'ScoreBoard' });
    expect(board.props('roundPopups')).toBe(false);
    await w.setProps({ state: { ...v, scoreboard: { ...v.scoreboard, rounds: [{ label: 'Round 1', deltas: {}, notes: {} }] } } });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await w.setProps({ state: { ...v, phase: 'finished', winners: [0], scoreboard: { ...v.scoreboard, rounds: [{ label: 'Round 1', deltas: {}, notes: {} }] } } });
    await flushPromises();
    expect(document.body.textContent).toContain('Final scores');
  });

  it('shows the scoreboard from the state', () => {
    const { w } = mountTable(playView());
    expect(w.findComponent({ name: 'ScoreBoard' }).exists()).toBe(true);
  });

  it('has no Leave button of its own: the site header offers it', () => {
    const { w } = mountTable(playView());
    expect(button(w, 'Leave game')).toBeUndefined();
  });

  it('copes with a spectator view (you is -1)', () => {
    const v = game.viewFor(started(4), 999);
    expect(v.you).toBe(-1);
    const { w } = mountTable(v);
    expect(w.find('.headline').text()).toContain('Waiting for');
  });

  it('lays the nobles out two to a row (three nobles for two players, five for four)', () => {
    for (const seats of [2, 3, 4]) {
      const v = playView(started(seats));
      expect(v.nobles).toHaveLength(seats + 1);
      const { w } = mountTable(v);
      const grid = w.find('.nobles .noble-grid');
      expect(grid.attributes('style')).toContain('repeat(2,');
      expect(grid.findAll('.noble')).toHaveLength(seats + 1);
    }
  });

  it('copes with no nobles left and empty slots', () => {
    const v = playView();
    const { w } = mountTable({ ...v, nobles: [], board: { ...v.board, 1: [v.board[1][0], null, null, null] }, decks: { 1: 0, 2: 1, 3: 1 } });
    expect(w.text()).toContain('All the nobles have visited');
    expect(w.findAll('.empty-slot')).toHaveLength(3);
    expect(w.findAll('.pile-button')[2].attributes('disabled')).toBeDefined();
  });
});

describe('Splendour table: finished', () => {
  it('announces the winner and the standings, hiding the play controls', () => {
    const { w } = mountTable(finishedView());
    expect(w.find('.end h2').text()).toContain('wins with 16 prestige');
    expect(w.find('.end h2').text()).toContain('(you)');
    expect(w.text()).toContain('Well played');
    expect(w.findAll('.standings li')).toHaveLength(4);
    expect(w.find('.headline').text()).toContain('game is over');
    expect(w.find('.game-status').text()).toContain('See the scores');
    expect(button(w, 'Take')).toBeUndefined();
  });

  it('lets the host play again; leaving is in the header', async () => {
    const { w, send } = mountTable(finishedView());
    const end = w.find('.end');
    await end.findAll('button').find((b) => b.text() === 'Play again').trigger('click');
    expect(send).toHaveBeenCalledWith('again');
    expect(end.findAll('button').some((b) => /^Leave/.test(b.text()))).toBe(false);
  });

  it('shows waiting text instead of Play again to non-hosts', () => {
    const { w } = mountTable(finishedView({ hostSeat: 1 }));
    expect(w.find('.end').text()).toContain('Waiting for the host');
    expect(w.find('.end').findAll('button').some((b) => b.text() === 'Play again')).toBe(false);
  });

  it('describes a shared win and end reasons', () => {
    const v = finishedView({ winners: [0, 1], endReason: 'limit' });
    const w = mountTable({ ...v, standings: v.standings.map((x) => ({ ...x, prestige: 15, cards: 3 })) }).w;
    expect(w.find('.end h2').text()).toContain('A shared win');
    expect(w.text()).toContain('win is shared');
    expect(w.text()).toContain('round limit');
    expect(mountTable(finishedView({ endReason: 'stalled' })).w.text()).toContain('Nobody could do anything');
  });

  it('survives a missing winners list', () => {
    const w = mountTable({ ...finishedView(), winners: undefined }).w;
    expect(w.find('.end').exists()).toBe(true);
  });
});

describe('Splendour layout', () => {
  const area = (width, height) => ({ width, height, gap: 12, columns: 12, mainSpan: 6 });
  it('picks one font size from the room, and a bigger room gives a bigger one', () => {
    const small = fontSize(area(1334, 460));
    const big = fontSize(area(1760, 712));
    expect(small).toBeGreaterThan(9);
    expect(big).toBeGreaterThan(small);
    expect(fontSize(area(1334, 460))).toBe(small);
  });
  it('never lets the market, your board or the action panel outgrow their columns or the height', () => {
    for (const [w, h] of [[1334, 460], [1760, 712], [1000, 600]]) {
      const a = area(w, h);
      const f = fontSize(a);
      const unit = (w - 12 * 11) / 12;
      const span = (n) => unit * n + 12 * (n - 1);
      expect(f * DESIGN.height).toBeLessThanOrEqual(h + 0.5);
      expect(f * DESIGN.market).toBeLessThanOrEqual(span(SPANS.market) + 0.5);
      expect(f * DESIGN.mine).toBeLessThanOrEqual(span(SPANS.mine) + 0.5);
      expect(f * DESIGN.action).toBeLessThanOrEqual(span(SPANS.action) + 0.5);
    }
  });
  it('does not depend on the game', () => {
    expect(fontSize(area(1334, 460))).toBe(fontSize({ ...area(1334, 460), unrelated: 5 }));
  });
});
