// The Scribblers table mounted with a fake socket: what each player sees in each phase, what the controls send, and
// the drawing - a stroke made here goes to the server, and one from the server goes on to the board.
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Board from './Board.vue';
import Table from './Table.vue';
import { newEntries } from './moveLog.js';
import { messageText } from '../../../src/messageText.js';

/** A log line (a message) in English, as the table draws it. */
const words = (line) => messageText(line, 'scribblers');

const player = (id, name, extra = {}) => ({ id, name, score: 0, lastScore: 0, online: true, bot: false, drawing: false, guessed: false, ready: false, placement: null, winner: false, ...extra });

/** A view of a game of three, where you are player 1 and player 2 is drawing, unless said otherwise. */
function view(extra = {}) {
  const players = extra.players ?? [player(1, 'Ann'), player(2, 'Bob', { drawing: true }), player(3, 'Cy')];
  const hints = extra.hints ?? [...'house'].map((ch) => ({ ch: null, fixed: false, shown: false }));
  return {
    code: 'a-b-c',
    phase: 'drawing',
    you: 1,
    hostId: 1,
    round: 1,
    rounds: 3,
    turn: 1,
    turns: 3,
    drawer: 2,
    drawerName: 'Bob',
    youDraw: false,
    word: null,
    choices: [],
    guessedCount: 0,
    youGuessed: false,
    feed: [],
    reveal: null,
    remaining: 30000,
    drawTime: 90,
    votes: { up: 0, down: 0, you: null, can: true },
    ...extra,
    hints,
    players,
    scoreboard: extra.scoreboard ?? { players: players.map((p) => ({ id: p.id, name: p.name, score: p.score, isMe: p.id === 1, away: false })), rounds: [], lowIsBetter: false },
    limits: { min: 2, max: 12, rounds: { min: 1, max: 10 }, drawTime: { min: 30, max: 240 }, wordChoices: { min: 2, max: 5 }, voteStep: 0.05 },
    settings: { rounds: 3, drawTime: 90, wordChoices: 3 },
  };
}

/** A fake module socket that records what was sent and can fire events back. */
function fakeSocket() {
  const handlers = {};
  return {
    connected: true,
    handlers,
    emit: vi.fn((event, payload, ack) => ack?.({ ok: true })),
    on: vi.fn((event, handler) => (handlers[event] = handler)),
    off: vi.fn((event) => delete handlers[event]),
    fire: (event, ...args) => handlers[event]?.(...args),
  };
}

/**
 * A stand-in for the board: it takes the same props and records the instructions the table puts on it, so that a test
 * can see the drawing wiring without a canvas (jsdom has none).
 */
const boardCalls = { apply: vi.fn(), reset: vi.fn() };
const BoardStub = {
  name: 'Board',
  props: { active: Boolean, tool: Object, width: Number, height: Number },
  // Vue binds `methods` to the instance, so each one passes the call out to a mock that a test can read.
  methods: {
    apply: (...args) => boardCalls.apply(...args),
    reset: (...args) => boardCalls.reset(...args),
  },
  template: '<div class="board-stub" />',
};

/** Mounts the table on a view, with a fake socket and a recording `send`. */
function table(state = view(), { stubBoard = false } = {}) {
  const socket = fakeSocket();
  const send = vi.fn(() => Promise.resolve({ ok: true }));
  const stubs = stubBoard ? { Board: BoardStub } : {};
  const wrapper = mount(Table, { props: { state, send, socket, log: [] }, global: { stubs } });
  return { wrapper, socket, send, board: stubBoard ? wrapper.findComponent(BoardStub) : wrapper.findComponent(Board) };
}

describe('what a guesser sees while somebody draws', () => {
  it('shows the word as blanks, the clock, and a box to guess in', () => {
    const { wrapper } = table();
    expect(wrapper.text()).toContain('_');
    expect(wrapper.text()).toContain('Bob is drawing');
    const input = wrapper.find('.guess-panel input');
    expect(input.exists()).toBe(true);
    expect(input.attributes('disabled')).toBeUndefined();
  });

  it('gives the drawing a thumb, and is shown which one it gave', async () => {
    const { wrapper, send } = table(view({ votes: { up: 2, down: 1, you: 'up', can: true } }));
    const thumbs = wrapper.findAll('.thumb');
    expect(thumbs.map((b) => b.attributes('aria-label'))).toEqual(['Thumbs up: 5% more for the drawer', 'Thumbs down: 5% less for the drawer']);
    expect(thumbs[0].classes()).toContain('picked');
    expect(thumbs[1].classes()).not.toContain('picked');
    expect(wrapper.find('.votes').text()).toBe('', 'the counts are not on the board');
    await thumbs[1].trigger('click');
    expect(send).toHaveBeenCalledWith('vote', { dir: 'down' });
  });

  it('shows no toolbox: only the drawer has one', () => {
    const { wrapper } = table();
    expect(wrapper.find('.toolbox').exists()).toBe(false);
  });

  it('sends what is typed as a guess', async () => {
    const { wrapper, send } = table();
    await wrapper.find('.guess-panel input').setValue('house');
    await wrapper.find('.guess-panel form').trigger('submit');
    expect(send).toHaveBeenCalledWith('guess', { text: 'house' });
  });

  it('marks a close guess for its writer and shows the others only the words', () => {
    const feed = [
      { n: 1, kind: 'guess', id: 3, name: 'Cy', text: 'mouse' },
      { n: 2, kind: 'close', id: 1, name: 'Ann', text: 'hous' },
      { n: 3, kind: 'correct', id: 3, name: 'Cy', text: '' },
    ];
    const { wrapper } = table(view({ feed }));
    expect(wrapper.text()).toContain('so close!');
    expect(wrapper.text()).toContain('Cy has the word!');
  });
});

describe('what the drawer sees', () => {
  it('is offered words to choose from, and asks for the one it picks', async () => {
    const { wrapper, send } = table(view({ phase: 'choosing', youDraw: true, drawer: 1, drawerName: 'Ann', choices: ['house', 'tree', 'cat'], hints: [] }));
    const buttons = wrapper.findAll('.choices button');
    expect(buttons.map((b) => b.text())).toEqual(['house', 'tree', 'cat']);
    await buttons[1].trigger('click');
    expect(send).toHaveBeenCalledWith('word', { n: 1 });
  });

  it('gets the toolbox, the whole word, and the undo and clear buttons', async () => {
    const { wrapper, send } = table(view({ youDraw: true, drawer: 1, drawerName: 'Ann', word: 'house', hints: [...'house'].map((ch) => ({ ch, fixed: false, shown: false })) }));
    expect(wrapper.find('.toolbox').exists()).toBe(true);
    expect(wrapper.text()).toContain('Your turn: draw');
    await wrapper.find('[aria-label="Clear the board"]').trigger('click');
    expect(send).toHaveBeenCalledWith('clear');
    await wrapper.find('[aria-label="Undo the last stroke (Ctrl+Z)"]').trigger('click');
    expect(send).toHaveBeenCalledWith('undo');
  });

  it('is shown no thumbs: nobody judges their own drawing', () => {
    const { wrapper } = table(view({ youDraw: true, drawer: 1, drawerName: 'Ann', word: 'house', votes: { up: 3, down: 0, you: null, can: false } }));
    expect(wrapper.find('.votes').exists()).toBe(false);
  });

  it('changes the colour and the brush from the toolbox', async () => {
    const { wrapper } = table(view({ youDraw: true, drawer: 1, drawerName: 'Ann', word: 'house' }));
    const board = wrapper.findComponent(Board);
    expect(board.props('tool')).toMatchObject({ kind: 'pen', width: 8 });
    await wrapper.findAll('.swatch')[2].trigger('click');
    expect(board.props('tool').colour).toBe(2);
    await wrapper.findAll('[aria-label="Brush of 24"]')[0].trigger('click');
    expect(board.props('tool').width).toBe(24);
    await wrapper.find('[aria-label="Fill (W)"]').trigger('click');
    expect(board.props('tool').kind).toBe('fill');
  });
});

describe('the drawing travels both ways', () => {
  it('asks the server for the board when the table opens in the middle of a turn', () => {
    const { send } = table();
    expect(send).toHaveBeenCalledWith('canvas');
  });

  it('sends one stroke as a line and several as a batch', async () => {
    const { wrapper, send } = table(view({ youDraw: true, drawer: 1, drawerName: 'Ann', word: 'house' }));
    const board = wrapper.findComponent(Board);
    board.vm.$emit('ops', [{ t: 'line', x: 1, y: 2, x2: 3, y2: 4, c: 5, w: 8 }]);
    await flushPromises();
    expect(send).toHaveBeenCalledWith('line', { x: 1, y: 2, x2: 3, y2: 4, c: 5, w: 8 });
    board.vm.$emit('ops', [
      { t: 'line', x: 1, y: 2, x2: 3, y2: 4, c: 5, w: 8 },
      { t: 'line', x: 3, y: 4, x2: 5, y2: 6, c: 5, w: 8 },
    ]);
    await flushPromises();
    expect(send).toHaveBeenCalledWith('draw', { ops: expect.any(Array) });
    board.vm.$emit('ops', [{ t: 'fill', x: 1, y: 2, c: 5 }]);
    await flushPromises();
    expect(send).toHaveBeenCalledWith('fill', { x: 1, y: 2, c: 5 });
  });

  it('puts strokes from the server on the board, and a whole board when one comes', () => {
    const { socket } = table(view(), { stubBoard: true });
    boardCalls.apply.mockClear();
    boardCalls.reset.mockClear();
    const ops = [{ t: 'line', x: 1, y: 1, x2: 2, y2: 2, c: 1, w: 8 }];
    socket.fire('draw', { ops });
    expect(boardCalls.apply).toHaveBeenCalledWith(ops);
    socket.fire('canvas', { ops, first: true, done: false });
    expect(boardCalls.reset).toHaveBeenCalledWith(ops);
    socket.fire('canvas', { ops, first: false, done: true });
    expect(boardCalls.apply).toHaveBeenCalledTimes(2);
  });

  it('blanks the board when the turn moves on', async () => {
    const { wrapper } = table(view(), { stubBoard: true });
    boardCalls.reset.mockClear();
    await wrapper.setProps({ state: view({ turn: 2, drawer: 3, drawerName: 'Cy' }) });
    expect(boardCalls.reset).toHaveBeenCalledWith([]);
  });
});

describe('between the turns and at the end', () => {
  it('shows the word and what everybody scored', () => {
    const reveal = { word: 'house', drawer: 2, reason: 'allGuessed', points: { 1: 150, 2: 120 }, guessed: [1] };
    const { wrapper } = table(view({ phase: 'between', reveal, word: 'house', hints: [...'house'].map((ch) => ({ ch, fixed: false, shown: true })) }));
    expect(wrapper.text()).toContain('The word was');
    expect(wrapper.text()).toContain('house');
    expect(wrapper.text()).toContain('+150');
  });

  it('says who is still to close the round scores', () => {
    const players = [player(1, 'Ann', { ready: true }), player(2, 'Bob'), player(3, 'Cy')];
    const { wrapper } = table(view({ phase: 'scores', players, hints: [] }));
    expect(wrapper.text()).toContain('Waiting for Bob and Cy');
  });

  it('shows the winner when the game is over', () => {
    const players = [player(1, 'Ann', { score: 300, winner: true, placement: 1 }), player(2, 'Bob', { score: 100, placement: 2 }), player(3, 'Cy', { score: 50, placement: 3 })];
    const { wrapper } = table(view({ phase: 'finished', players, hints: [] }));
    expect(wrapper.text()).toContain('Ann wins with 300 points');
  });
});

describe('the Recent moves list', () => {
  it('reads as sentences for the turn, the guesses and the word', () => {
    const before = view({ phase: 'choosing' });
    const started = view({ phase: 'drawing' });
    const got = view({ phase: 'drawing', players: [player(1, 'Ann', { guessed: true }), player(2, 'Bob', { drawing: true }), player(3, 'Cy')] });
    const over = view({ phase: 'between', reveal: { word: 'house', drawer: 2, reason: 'allGuessed', points: { 1: 150 }, guessed: [1] } });
    expect(newEntries(null, before).map(words)).toEqual(['Turn 1 of 3: Bob draws.']);
    expect(newEntries(before, started).map(words)).toEqual(['Bob starts drawing.']);
    expect(newEntries(started, got).map(words)).toEqual(['Ann got the word.']);
    expect(newEntries(got, over).map(words)).toEqual(['Ann scores 150.', 'The word was “house”.']);
  });
});
