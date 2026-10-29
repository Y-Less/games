// The Just One screen mounted with a fake socket: what each player sees in each phase, and what the controls send.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import JustOne from './JustOne.vue';
import Lobby from './Lobby.vue';
import { newEntries } from './moveLog.js';

const player = (id, name, extra = {}) => ({ id, name, score: 0, online: true, bot: false, written: false, ready: false, placement: null, winner: false, ai: null, ...extra });
function view(extra = {}) {
  const players = extra.players ?? [player(1, 'Ann'), player(2, 'Bob'), player(3, 'Cy'), player(4, 'Di')];
  return {
    code: 'a-b-c',
    phase: 'clues',
    you: 1,
    hostId: 1,
    turnsEach: 1,
    turn: 1,
    turnsTotal: 4,
    guesser: 2,
    word: 'apple',
    clues: [],
    guess: null,
    result: null,
    points: { guesser: 2, bestHint: 1 },
    players,
    scoreboard: { players: players.map((p) => ({ id: p.id, name: p.name, score: p.score, isMe: p.id === 1, away: false })), rounds: [], lowIsBetter: false },
    limits: { min: 3, max: 7, turns: { min: 1, max: 5 } },
    ...extra,
  };
}
/** The same game seen by the guesser (you are player 1). */
const asGuesser = (extra = {}) => view({ guesser: 1, word: null, ...extra });

function fakeSocket() {
  const handlers = {};
  return { connected: false, handlers, emit: vi.fn((event, payload, ack) => ack?.({ ok: true })), on: vi.fn((e, f) => (handlers[e] = f)), off: vi.fn((e) => delete handlers[e]) };
}
let wrapper;
async function mountGame(state) {
  const socket = fakeSocket();
  wrapper = mount(JustOne, { props: { socket, setSearch: vi.fn() }, attachTo: document.body });
  socket.handlers.state(state);
  await flushPromises();
  return { socket, show: async (next) => { socket.handlers.state(next); await flushPromises(); } };
}
const button = (text) => wrapper.findAll('button').find((b) => b.text() === text);
const popups = () => document.body.querySelectorAll('.your-turn').length;
const sent = (socket, event) => socket.emit.mock.calls.filter((c) => c[0] === event).map((c) => c[1]);

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

const clueCards = () => wrapper.findAll('.cards .card').map((c) => c.find('.text').exists() ? c.find('.text').text() : c.text());

describe('Just One screen: writing the clues', () => {
  it('shows a writer the word and a form that sends one clue', async () => {
    const { socket } = await mountGame(view());
    expect(wrapper.find('.word').text()).toBe('apple');
    expect(button('Send clue').attributes('disabled')).toBeDefined();
    await wrapper.find('input[aria-label="Your clue"]').setValue('fruit');
    await wrapper.find('form.clue-form').trigger('submit');
    expect(socket.emit).toHaveBeenCalledWith('clue', { text: 'fruit' }, expect.any(Function));
    expect(wrapper.text()).toContain('Write a one-word clue for “apple”');
  });

  it('shows a writer who has sent theirs a wait, and who has written', async () => {
    await mountGame(view({ clues: [{ id: 1, name: 'Ann', text: 'fruit', own: true }], players: [player(1, 'Ann', { written: true }), player(2, 'Bob'), player(3, 'Cy', { written: true }), player(4, 'Di')] }));
    expect(wrapper.find('form.clue-form').exists()).toBe(false);
    expect(wrapper.text()).toContain('Clue sent. Waiting for the others (2 of 3).');
    expect(wrapper.findAll('.who-wrote li.done').map((l) => l.text().replace('✓', '').trim())).toEqual(['Ann', 'Cy']);
  });

  it('hides the word from the guesser, who has nothing to write', async () => {
    await mountGame(asGuesser());
    expect(wrapper.find('.word').text()).toBe('???');
    expect(wrapper.find('.word').classes()).toContain('hidden');
    expect(wrapper.find('form.clue-form').exists()).toBe(false);
    expect(wrapper.text()).toContain('You are the guesser');
  });

  it('gives nobody a turn pop-up while the clues are written, not even the guesser', async () => {
    await mountGame(asGuesser());
    expect(popups()).toBe(0);
    wrapper.unmount();
    await mountGame(view());
    expect(popups()).toBe(0);
  });
});

describe('Just One screen: guessing', () => {
  const clues = [{ n: 0, text: 'red' }, { n: 1, text: 'tree' }];

  it('shows the guesser only the clues that are left, with no writers, and a guess form with a pass', async () => {
    const { socket } = await mountGame(asGuesser({ phase: 'guessing', clues }));
    expect(clueCards()).toEqual(['red', 'tree']);
    expect(wrapper.find('.cards').text()).not.toMatch(/Bob|Cy|Di/);
    expect(button('Guess').attributes('disabled')).toBeDefined();
    await wrapper.find('input[aria-label="Your guess"]').setValue('apple');
    await wrapper.find('form.guess-form').trigger('submit');
    expect(socket.emit).toHaveBeenCalledWith('guess', { text: 'apple' }, expect.any(Function));
    await button('Pass').trigger('click');
    expect(sent(socket, 'pass')).toHaveLength(1);
  });

  it('tells the guesser it is their turn, and nobody else', async () => {
    await mountGame(asGuesser({ phase: 'guessing', clues }));
    expect(popups()).toBe(1);
    wrapper.unmount();
    document.body.innerHTML = '';
    await mountGame(view({ phase: 'guessing', clues: [{ id: 3, name: 'Cy', text: 'red', cancelled: false }] }));
    expect(wrapper.text()).toContain('Bob is guessing.');
    expect(popups()).toBe(0);
  });

  it('shows the others every clue with its writer, and marks the cancelled ones', async () => {
    await mountGame(view({
      phase: 'guessing',
      clues: [{ id: 3, name: 'Cy', text: 'tree', cancelled: false }, { id: 1, name: 'Ann', text: 'red', cancelled: true }, { id: 4, name: 'Di', text: 'red', cancelled: true }],
    }));
    expect(wrapper.findAll('.card').map((c) => c.classes('cancelled'))).toEqual([false, true, true]);
    expect(wrapper.text()).toContain('Cy');
    expect(wrapper.text()).toContain('cancelled');
    expect(wrapper.text()).toContain('Your clue was cancelled');
    expect(wrapper.find('form.guess-form').exists()).toBe(false);
  });

  it('says so when every clue was cancelled', async () => {
    await mountGame(asGuesser({ phase: 'guessing', clues: [] }));
    expect(wrapper.text()).toContain('Every clue was cancelled.');
  });
});

describe('Just One screen: picking the best hint', () => {
  const guess = { text: 'apple', correct: true, passed: false };

  it('makes each clue a button for the guesser, which sends its place', async () => {
    const { socket } = await mountGame(asGuesser({ phase: 'choosing', guess, clues: [{ n: 0, text: 'red' }, { n: 1, text: 'tree' }] }));
    const buttons = wrapper.findAll('button.card.pick');
    expect(buttons.map((b) => b.text())).toEqual(['red', 'tree']);
    await buttons[1].trigger('click');
    expect(socket.emit).toHaveBeenCalledWith('best', { n: 1 }, expect.any(Function));
    expect(wrapper.text()).toContain('Right! Now pick the best hint.');
  });

  it('shows the others who is picking, with nothing to click', async () => {
    await mountGame(view({ phase: 'choosing', guess, clues: [{ id: 3, name: 'Cy', text: 'tree', cancelled: false }] }));
    expect(wrapper.findAll('button.card').length).toBe(0);
    expect(wrapper.text()).toContain('Bob found the word, and is picking the best hint.');
  });
});

describe('Just One screen: the reveal and the end', () => {
  const result = (extra = {}) => ({
    word: 'apple', guesser: 2, guesserName: 'Bob', correct: true, guess: { text: 'apple', correct: true, passed: false }, best: 3, bestName: 'Cy', guesserPoints: 2, bestPoints: 1,
    clues: [{ id: 3, text: 'tree', cancelled: false, best: true }, { id: 1, text: 'red', cancelled: true, best: false }], ...extra,
  });

  it('shows the word and every clue with its writer, the best hint marked', async () => {
    await mountGame(view({ phase: 'reveal', result: result(), clues: [{ id: 3, name: 'Cy', text: 'tree', cancelled: false, best: true }, { id: 1, name: 'Ann', text: 'red', cancelled: true, best: false }] }));
    expect(wrapper.find('.word').text()).toBe('apple');
    expect(wrapper.text()).toContain('Bob got it! Cy\'s hint was the best.');
    expect(wrapper.find('.card.best').text()).toContain('Cy');
    expect(popups()).toBe(0);
  });

  it('says how a wrong guess or a pass went', async () => {
    const { show } = await mountGame(view({ phase: 'reveal', result: result({ correct: false, best: null, bestName: null, guess: { text: 'pear', correct: false, passed: false } }) }));
    expect(wrapper.text()).toContain('Bob guessed “pear”. The word was apple.');
    await show(view({ phase: 'reveal', result: result({ correct: false, best: null, bestName: null, guess: { text: '', correct: false, passed: true } }) }));
    expect(wrapper.text()).toContain('Bob passed. The word was apple.');
  });

  it('names the winner at the end', async () => {
    await mountGame(view({ phase: 'finished', turn: 4, players: [player(1, 'Ann', { score: 5, placement: 1, winner: true }), player(2, 'Bob', { score: 2, placement: 2 }), player(3, 'Cy', { score: 2, placement: 2 }), player(4, 'Di', { score: 0, placement: 4 })] }));
    expect(wrapper.text()).toContain('Ann wins with 5 points.');
  });
});

describe('Just One lobby and recent moves', () => {
  const make = (you, hostId = 1) => {
    const send = vi.fn();
    const players = [player(1, 'Ann'), player(2, 'Bob')];
    const state = { code: 'a-b-c', phase: 'lobby', you, hostId, turnsEach: 2, players, limits: { min: 3, max: 7, turns: { min: 1, max: 5 } } };
    return { w: mount(Lobby, { props: { state, send } }), send };
  };

  it('lets the host add computers and start only with three players', async () => {
    const { w, send } = make(1);
    expect(w.text()).toContain('You need at least 3 players.');
    expect(w.find('button.primary').attributes('disabled')).toBeDefined();
    await w.findAll('button').find((b) => b.text().includes('Fill up to 3')).trigger('click');
    expect(send).toHaveBeenLastCalledWith('fillBots', { count: 3 });
    await w.find('button[aria-label="More turns"]').trigger('click');
    expect(send).toHaveBeenLastCalledWith('settings', { turnsEach: 3 });
  });

  it('shows others only that they are waiting for the host', () => {
    const { w } = make(2);
    expect(w.text()).toContain('Waiting for the host to start.');
    expect(w.findAll('button').some((b) => b.text().includes('Add a computer'))).toBe(false);
  });

  it('logs the turn, the clues, the cancelling, the guess and the outcome, each once', () => {
    const base = view();
    expect(newEntries(null, base)).toEqual(['Turn 1 of 4: Bob is the guesser. Everyone else is writing a clue.']);
    const written = view({ players: [player(1, 'Ann', { written: true }), player(2, 'Bob'), player(3, 'Cy'), player(4, 'Di')] });
    expect(newEntries(base, written)).toEqual(['Ann has written a clue.']);
    const guessing = view({ phase: 'guessing', clues: [{ id: 3, name: 'Cy', text: 'x', cancelled: false }, { id: 1, name: 'Ann', text: 'r', cancelled: true }, { id: 4, name: 'Di', text: 'r', cancelled: true }] });
    expect(newEntries(written, guessing)).toEqual(['The clues are in. 2 matched and were cancelled.']);
    const guessed = view({ ...guessing, phase: 'choosing', guess: { text: 'apple', correct: true, passed: false } });
    expect(newEntries(guessing, guessed)).toEqual(['Bob guessed “apple”.']);
    const revealed = view({ ...guessed, phase: 'reveal', result: { word: 'apple', correct: true, bestName: 'Cy', bestPoints: 1, guesserName: 'Bob', guesserPoints: 2 } });
    expect(newEntries(guessed, revealed)).toEqual(["Cy's hint was the best (+1). Bob scores 2.", 'The word was “apple”.']);
    expect(newEntries(revealed, revealed)).toEqual([]);
  });
});
