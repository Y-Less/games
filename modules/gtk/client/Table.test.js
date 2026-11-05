// The GTK screen mounted with a fake socket: what each player sees in each phase, and what the controls send.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Gtk from './Gtk.vue';
import { newEntries } from './moveLog.js';
import { messageText } from '../../../src/messageText.js';

// A log line (a message) in English, as the table draws it.
const words = (line) => messageText(line, 'gtk');

const player = (id, name, extra = {}) => ({ id, name, score: 0, online: true, bot: false, ai: null, subject: false, written: false, picked: false, ready: false, placement: null, winner: false, ...extra });
const who = (id, name) => ({ id, name });

/** A view of a four-player game in which the round is about Bob (player 2) and you are Ann (player 1). */
function view(extra = {}) {
  const players = extra.players ?? [player(1, 'Ann'), player(2, 'Bob', { subject: true }), player(3, 'Cy'), player(4, 'Di')];
  return {
    code: 'a-b-c',
    phase: 'writing',
    you: 1,
    hostId: 1,
    roundsEach: 1,
    round: 1,
    roundsTotal: 4,
    question: 1,
    questionsPerRound: 2,
    seconds: 60,
    remaining: 42000,
    subject: 2,
    subjectName: 'Bob',
    isSubject: false,
    prompts: ['What is Bob’s favourite fruit?', 'What is Bob’s favourite colour?'],
    yourAnswers: null,
    options: [],
    yoursWasTrue: false,
    truth: null,
    points: { correct: 2, fooled: 1, matched: 1 },
    players,
    scoreboard: { players: players.map((p) => ({ id: p.id, name: p.name, score: p.score, isMe: p.id === 1, away: false, current: false })), rounds: [], lowIsBetter: false },
    limits: { min: 3, max: 8, rounds: { min: 1, max: 3, default: 1 }, questions: { min: 1, max: 4, default: 2 }, time: { min: 15, max: 180, step: 15, default: 60 }, answer: 60 },
    ...extra,
  };
}
/** The same game seen by the player it is about (you are Bob, player 2). */
const asSubject = (extra = {}) =>
  view({
    you: 2,
    isSubject: true,
    prompts: ['What is your favourite fruit?', 'What is your favourite colour?'],
    players: [player(1, 'Ann'), player(2, 'Bob', { subject: true }), player(3, 'Cy'), player(4, 'Di')],
    ...extra,
  });
/** Four answers on the table, the second one yours. */
const openOptions = () => [
  { n: 0, text: 'Mango', yours: false, canPick: true },
  { n: 1, text: 'Satsumas', yours: true, canPick: false },
  { n: 2, text: 'Pears', yours: false, canPick: true },
  { n: 3, text: 'Blackberries', yours: false, canPick: true },
];
/** The same four, scored and revealed: Mango was Bob's own and two people found it.  */
const revealedOptions = () => [
  { n: 0, text: 'Mango', truth: true, authors: [], pickedBy: [who(1, 'Ann'), who(4, 'Di')], yours: false },
  { n: 1, text: 'Satsumas', truth: false, authors: [who(1, 'Ann')], pickedBy: [], yours: true },
  { n: 2, text: 'Pears', truth: false, authors: [who(3, 'Cy')], pickedBy: [who(3, 'Cy')], yours: false },
  { n: 3, text: 'Blackberries', truth: false, authors: [who(4, 'Di')], pickedBy: [], yours: false },
];

function fakeSocket() {
  const handlers = {};
  return { connected: false, handlers, emit: vi.fn((event, payload, ack) => ack?.({ ok: true })), on: vi.fn((e, f) => (handlers[e] = f)), off: vi.fn((e) => delete handlers[e]) };
}
let wrapper;
async function mountGame(state) {
  const socket = fakeSocket();
  wrapper = mount(Gtk, { props: { socket, setSearch: vi.fn() }, attachTo: document.body });
  socket.handlers.state(state);
  await flushPromises();
  return { socket, show: async (next) => { socket.handlers.state(next); await flushPromises(); } };
}
const button = (text) => wrapper.findAll('button').find((b) => b.text() === text);
const sent = (socket, event) => socket.emit.mock.calls.filter((c) => c[0] === event).map((c) => c[1]);
const cards = () => wrapper.findAll('.answers-box .card').map((c) => (c.find('.answer-text').exists() ? c.find('.answer-text').text() : c.text()));
const answerBox = (n) => wrapper.findAll('.write-form input')[n - 1];

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('GTK: writing the answers', () => {
  it('asks everybody else about the subject and takes both answers at once', async () => {
    const { socket } = await mountGame(view());
    expect(wrapper.text()).toContain('What is Bob’s favourite fruit?');
    expect(wrapper.text()).toContain('What is Bob’s favourite colour?');
    expect(wrapper.text()).toContain('Make up an answer to each question that could pass for Bob’s own.');
    expect(button('Send all your answers').attributes('disabled')).toBeDefined();
    await answerBox(1).setValue('Satsumas');
    expect(button('Send all your answers').attributes('disabled')).toBeDefined();
    await answerBox(2).setValue('Green');
    expect(button('Send all your answers').attributes('disabled')).toBeUndefined();
    await wrapper.find('form.write-form').trigger('submit');
    expect(sent(socket, 'answers')).toEqual([{ texts: ['Satsumas', 'Green'] }]);
  });

  it('asks the subject the same two questions about themselves', async () => {
    await mountGame(asSubject());
    expect(wrapper.text()).toContain('What is your favourite fruit?');
    expect(wrapper.text()).toContain('The questions are all about you.');
    expect(wrapper.text()).not.toContain('What is Bob’s favourite fruit?');
  });

  it('shows what you sent, and who the game is still waiting for', async () => {
    await mountGame(view({
      yourAnswers: ['Satsumas', 'Green'],
      players: [player(1, 'Ann', { written: true }), player(2, 'Bob', { subject: true, written: true }), player(3, 'Cy'), player(4, 'Di')],
    }));
    expect(wrapper.text()).toContain('Satsumas');
    expect(wrapper.text()).toContain('Answers sent. Waiting for the others (2 of 4).');
    expect(wrapper.find('form.write-form').exists()).toBe(false);
    const ticked = wrapper.findAll('.who li.done').map((li) => li.text().replace(/\s*✓$/, ''));
    expect(ticked).toEqual(['Ann', 'Bob']);
  });

  it('puts each question straight above its own box, and takes however many the round has', async () => {
    const { socket } = await mountGame(view({ questionsPerRound: 3, prompts: ['First?', 'Second?', 'Third?'] }));
    expect(wrapper.findAll('.write-form .field .question').map((q) => q.text())).toEqual(['First?', 'Second?', 'Third?']);
    expect(wrapper.findAll('.write-form input')).toHaveLength(3);
    for (const [n, text] of ['A', 'B', 'C'].entries()) await answerBox(n + 1).setValue(text);
    await wrapper.find('form.write-form').trigger('submit');
    expect(sent(socket, 'answers')).toEqual([{ texts: ['A', 'B', 'C'] }]);
  });

  it('says "answer" rather than "all your answers" when a round has only one question', async () => {
    await mountGame(view({ questionsPerRound: 1, prompts: ['Only one?'] }));
    expect(button('Send your answer')).toBeTruthy();
    expect(button('Send all your answers')).toBeUndefined();
    expect(wrapper.text()).toContain('Make up an answer that could pass for Bob’s own.');
  });

  it('empties the boxes when the next round starts', async () => {
    const { show } = await mountGame(view());
    await answerBox(1).setValue('Satsumas');
    expect(answerBox(1).element.value).toBe('Satsumas');
    await show(view({ round: 2, subject: 3, subjectName: 'Cy', prompts: ['What is Cy’s dream job?', 'What is Cy’s worst chore?'] }));
    expect(answerBox(1).element.value).toBe('');
  });
});

describe('GTK: picking the true answer', () => {
  const picking = (extra = {}) => view({ phase: 'picking', options: openOptions(), yourAnswers: ['Satsumas', 'Green'], ...extra });

  it('shows every answer and makes all but your own a button', async () => {
    const { socket } = await mountGame(picking());
    expect(cards()).toEqual(['Mango', 'Satsumas', 'Pears', 'Blackberries']);
    expect(wrapper.findAll('button.card.pick').map((b) => b.text())).toEqual(['Mango', 'Pears', 'Blackberries']);
    expect(wrapper.text()).toContain('Which of these is Bob’s own answer? You cannot pick your own.');
    expect(wrapper.text()).toContain('The true answer is worth 2; a made-up answer earns 1 for every player who picks it.');
    await wrapper.findAll('button.card.pick')[1].trigger('click');
    expect(sent(socket, 'choose')).toEqual([{ n: 2 }]);
  });

  it('says nothing about who wrote what, or which is true', async () => {
    await mountGame(picking());
    const box = wrapper.find('.answers-box').text();
    expect(box).not.toContain('Written by');
    expect(box).not.toContain('Bob’s own answer');
    expect(box).not.toContain('Nobody chose this');
    expect(box).not.toContain('Chose');
  });

  it('gives the subject nothing to press, and says the others are choosing', async () => {
    await mountGame(picking({ you: 2, isSubject: true, yourAnswers: ['Mango', 'Red'], options: openOptions().map((o) => ({ ...o, canPick: false, yours: o.n === 0 })) }));
    expect(wrapper.findAll('button.card.pick')).toHaveLength(0);
    expect(wrapper.text()).toContain('The others are picking which answer is really yours.');
    expect(wrapper.text()).toContain('Waiting for the others to pick.');
  });

  it('tells somebody whose made-up answer was the truth that there is nothing to pick', async () => {
    await mountGame(picking({ yoursWasTrue: true, options: openOptions().map((o) => ({ ...o, canPick: false })) }));
    expect(wrapper.findAll('button.card.pick')).toHaveLength(0);
    expect(wrapper.text()).toContain('You wrote the true answer, so this one is already yours.');
  });

  it('once you have picked, it waits for the rest', async () => {
    await mountGame(picking({
      players: [player(1, 'Ann', { picked: true }), player(2, 'Bob', { subject: true }), player(3, 'Cy', { picked: true }), player(4, 'Di')],
      options: openOptions().map((o) => ({ ...o, canPick: false })),
    }));
    expect(wrapper.text()).toContain('Picked. Waiting for the others (2 of 3).');
  });
});

describe('GTK: the clock', () => {
  it('counts the seconds down and warns when they are nearly gone', async () => {
    // The clock re-anchors to the local clock on every view and ticks twice a second, so the second shown may have
    // just turned over; what matters is that it counts the server's milliseconds down in seconds.
    const shown = () => Number(wrapper.find('.clock').text().match(/\d+/)[0]);
    const { show } = await mountGame(view({ remaining: 42000 }));
    expect(wrapper.find('.clock').text()).toMatch(/seconds left$/);
    expect(shown()).toBeGreaterThanOrEqual(42);
    expect(shown()).toBeLessThanOrEqual(43);
    expect(wrapper.find('.clock').classes()).not.toContain('low');
    expect(wrapper.text()).not.toContain('an answer will be made up for you');
    await show(view({ remaining: 5000 }));
    expect(shown()).toBeGreaterThanOrEqual(5);
    expect(shown()).toBeLessThanOrEqual(6);
    expect(wrapper.find('.clock').classes()).toContain('low');
    expect(wrapper.text()).toContain('The time is nearly up: an answer will be made up for you.');
  });

  it('warns about the pick instead while you are picking', async () => {
    await mountGame(view({ phase: 'picking', options: openOptions(), yourAnswers: ['Satsumas', 'Green'], remaining: 4000 }));
    expect(wrapper.text()).toContain('The time is nearly up: a pick will be made for you.');
  });

  it('says nothing about the clock once you have sent your answers, or at the reveal', async () => {
    const { show } = await mountGame(view({ remaining: 3000, yourAnswers: ['Satsumas', 'Green'] }));
    expect(wrapper.find('.clock').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('The time is nearly up');
    await show(view({ phase: 'reveal', options: revealedOptions(), truth: 'Mango', remaining: null }));
    expect(wrapper.find('.clock').exists()).toBe(false);
  });
});

describe('GTK: the reveal', () => {
  const revealed = (extra = {}) => view({ phase: 'reveal', options: revealedOptions(), truth: 'Mango', yourAnswers: ['Satsumas', 'Green'], ...extra });

  it('names the true answer, who wrote each of the others, and who fell for them', async () => {
    await mountGame(revealed());
    expect(wrapper.text()).toContain('Bob’s answer was “Mango”.');
    expect(wrapper.text()).toContain('Bob’s own answer');
    expect(wrapper.text()).toContain('Written by Cy');
    expect(wrapper.text()).toContain('Chose Cy');
    expect(wrapper.text()).toContain('Nobody chose this');
  });

  it('asks you to close the scores, then waits for the others', async () => {
    const { socket, show } = await mountGame(revealed());
    expect(wrapper.text()).toContain('Close the scores when you are ready to carry on.');
    await show(revealed({ players: [player(1, 'Ann', { ready: true }), player(2, 'Bob', { subject: true, ready: true }), player(3, 'Cy'), player(4, 'Di')] }));
    expect(wrapper.text()).toContain('Waiting for Cy and Di to be ready for the next question.');
    expect(socket.emit).toBeTruthy();
  });

  it('calls the last question of the last round the final scores', async () => {
    await mountGame(revealed({ round: 4, question: 2, players: [player(1, 'Ann', { ready: true }), player(2, 'Bob', { subject: true }), player(3, 'Cy'), player(4, 'Di')] }));
    expect(wrapper.text()).toContain('to be ready for the final scores');
  });
});

describe('GTK: the end of the game', () => {
  it('announces the winner', async () => {
    const players = [player(1, 'Ann', { score: 9, winner: true, placement: 1 }), player(2, 'Bob', { score: 4, placement: 2 }), player(3, 'Cy', { score: 3, placement: 3 }), player(4, 'Di', { score: 2, placement: 4 })];
    await mountGame(view({ phase: 'finished', players, options: revealedOptions(), truth: 'Mango', scoreboard: { players: players.map((p) => ({ id: p.id, name: p.name, score: p.score, isMe: p.id === 1, away: false, current: false })), rounds: [], lowIsBetter: false } }));
    expect(wrapper.text()).toContain('Ann wins with 9 points.');
    expect(wrapper.text()).toContain('Game over');
  });
});

describe('GTK: the Recent moves list', () => {
  it('says when a round starts, who has written, and which question is up', () => {
    expect(newEntries(null, view()).map(words)).toEqual(['Round 1 of 4: this one is about Bob.']);
    const before = view({ players: [player(1, 'Ann'), player(2, 'Bob', { subject: true }), player(3, 'Cy'), player(4, 'Di')] });
    const after = view({ players: [player(1, 'Ann', { written: true }), player(2, 'Bob', { subject: true }), player(3, 'Cy'), player(4, 'Di')] });
    expect(newEntries(before, after).map(words)).toEqual(['Ann has written their answers.']);
    const picking = view({ phase: 'picking', options: openOptions() });
    expect(newEntries(before, picking).map(words)).toEqual(['The answers are in.', 'Question 1: What is Bob’s favourite fruit?']);
  });

  it('reports the true answer and who was fooled once the question is scored', () => {
    const picking = view({ phase: 'picking', options: openOptions() });
    const revealed = view({ phase: 'reveal', options: revealedOptions(), truth: 'Mango' });
    expect(newEntries(picking, revealed).map(words)).toEqual([
      'The true answer was “Mango”.',
      '2 players spotted the true answer.',
      'Cy fooled 1 player with “Pears”.',
    ]);
  });

  it('says nothing in the lobby, and announces the winners at the end', () => {
    expect(newEntries(null, view({ phase: 'lobby' }))).toEqual([]);
    const players = [player(1, 'Ann', { winner: true }), player(2, 'Bob'), player(3, 'Cy'), player(4, 'Di')];
    expect(newEntries(view({ phase: 'reveal' }), view({ phase: 'finished', players })).map(words)).toEqual(['Ann wins.']);
  });
});
