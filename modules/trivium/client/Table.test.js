// The Trivium screen mounted on a fake socket: what is drawn in each part of a round, what pressing an answer sends,
// and the one thing this table does that no other does - a marker that travels from a name to the spot on the button
// where that player's finger came down.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Trivium from './Trivium.vue';
import { MARKER, boardLayout, homeOf, spotOf } from './layout.js';

const WHEEL = [{ category: 'history', weight: 400 }, { category: 'music', weight: 200 }, { category: 'science', weight: 100 }];
const COLOURS = ['#ffffff', '#000000', '#808080', '#ff2d95'];

const player = (id, name, extra = {}) => ({ id, name, colour: COLOURS[id - 1], score: 0, online: true, bot: false, ai: null, answered: false, placement: null, winner: false, ...extra });

/** A view in whatever part of a round the test wants; the defaults are a question up and nothing answered. */
function view(extra = {}) {
  const players = extra.players ?? [player(1, 'Ann'), player(2, 'Bob'), player(3, 'Cy')];
  return {
    code: 'a-b-c',
    phase: 'question',
    you: 1,
    hostId: 1,
    rounds: 2,
    perRound: 3,
    round: 1,
    ask: 2,
    wheel: WHEEL,
    spin: { category: 'history', angle: 123 },
    spinLeft: null,
    question: { id: 'q1', text: 'Who did the thing in the place?', answers: ['Neil Armstrong', 'Albert Einstein', 'Winston Churchill', 'Tom Jones'], category: 'history', difficulty: 'medium' },
    correct: null,
    mine: null,
    result: null,
    reveal: null,
    remaining: 9000,
    version: '0:1:question',
    players,
    scoreboard: { players: players.map((p) => ({ id: p.id, name: p.name, score: p.score, isMe: p.id === 1, away: false, bot: false, current: !p.answered })), rounds: [], lowIsBetter: false },
    colours: COLOURS,
    canCustomColour: false,
    limits: { min: 2, max: 8, rounds: { min: 1, max: 8, default: 3 }, perRound: { min: 1, max: 10, default: 5 }, points: 10 },
    ...extra,
  };
}

/** A view at the reveal, with two answers in and one player who said nothing. */
const revealed = (since, extra = {}) =>
  view({
    phase: 'reveal',
    correct: 1,
    remaining: null,
    version: '0:1:reveal',
    reveal: { since, step: 500 },
    result: {
      correct: 1,
      category: 'history',
      entries: [
        { id: 2, name: 'Bob', choice: 1, x: 0.2, y: 0.7, at: 1200, right: true, points: 10 },
        { id: 1, name: 'Ann', choice: 3, x: 0.6, y: 0.4, at: 4400, right: false, points: 0 },
      ],
      missed: [{ id: 3, name: 'Cy' }],
    },
    ...extra,
  });

function fakeSocket() {
  const handlers = {};
  return { connected: false, handlers, emit: vi.fn((event, payload, ack) => ack?.({ ok: true })), on: vi.fn((e, f) => (handlers[e] = f)), off: vi.fn((e) => delete handlers[e]) };
}

let wrapper;
async function mountGame(state) {
  const socket = fakeSocket();
  wrapper = mount(Trivium, { props: { socket, setSearch: vi.fn() }, attachTo: document.body });
  socket.handlers.state(state);
  await flushPromises();
  return {
    socket,
    show: async (next) => {
      socket.handlers.state(next);
      await flushPromises();
    },
  };
}
const sent = (socket, event) => socket.emit.mock.calls.filter((call) => call[0] === event).map((call) => call[1]);
const answerButtons = () => wrapper.findAll('button.answer');
const markers = () => wrapper.findAll('.marker');

/**
 * Presses a button the way a finger does: a real click with a place on the screen.  `trigger` cannot set `detail`
 * (it is read-only on a UIEvent), and `detail` is exactly what tells a press apart from a keyboard activation.
 *
 * @param {object} button  the button wrapper
 * @param {object} [at]  where the press landed, and the box the button is pretending to be
 * @returns {Promise<void>}
 */
async function press(button, at = null) {
  if (at) button.element.getBoundingClientRect = () => ({ left: at.left, top: at.top, width: at.width, height: at.height });
  button.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: at ? 1 : 0, clientX: at?.x ?? 0, clientY: at?.y ?? 0 }));
  await flushPromises();
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

describe('the waiting room', () => {
  it('shows the invite code and the two settings, and starts the quiz', async () => {
    const { socket } = await mountGame(view({ phase: 'lobby', question: null, spin: null, remaining: null }));
    expect(wrapper.text()).toContain('a-b-c');
    expect(wrapper.text()).toContain('2 rounds');
    expect(wrapper.text()).toContain('3 questions a round');
    expect(wrapper.text()).toContain('6 questions in all');
    const start = wrapper.findAll('button').find((b) => b.text() === 'Start the game');
    await start.trigger('click');
    expect(sent(socket, 'start')).toHaveLength(1);
  });
});

describe('the wheel', () => {
  it('is drawn while the round is being chosen, and no question is drawn with it', async () => {
    await mountGame(view({ phase: 'spin', question: null, spinLeft: 3000, remaining: null }));
    expect(wrapper.find('.wheel').exists()).toBe(true);
    expect(answerButtons()).toHaveLength(0);
    expect(wrapper.text()).toContain('Spinning for a category');
  });

  it('plays the turn as an animation, from where it was round to where it stops', async () => {
    // The turn is a Web Animations one rather than a CSS transition, because the site stops every transition when the
    // device asks for less motion and no per-element rule can undo that.  jsdom has no such API, so stand one in.
    const played = [];
    Element.prototype.animate = function stand(frames, options) {
      played.push({ frames, options });
      return { cancel() {} };
    };
    try {
      await mountGame(view({ phase: 'spin', question: null, spinLeft: 3000, remaining: null }));
      await flushPromises();
      expect(played).toHaveLength(1);
      expect(played[0].frames.map((f) => f.transform)).toEqual(['rotate(0deg)', `rotate(${4 * 360 + 123}deg)`]);
      expect(played[0].options.duration).toBe(3000); // what is left of the spin, so a latecomer catches it up
      // And it is left resting where the server said, whether or not the turn was ever played.
      expect(wrapper.find('.turn').attributes('style')).toContain(`rotate(${4 * 360 + 123}deg)`);
    } finally {
      delete Element.prototype.animate;
    }
  });

  it('does not claim to be spinning for a player who has asked for no motion', async () => {
    // This jsdom has no matchMedia at all, which is itself "no preference stated"; give it one that asks for less motion.
    const had = Object.hasOwn(window, 'matchMedia') ? window.matchMedia : null;
    window.matchMedia = (query) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    try {
      await mountGame(view({ phase: 'spin', question: null, spinLeft: 3000, remaining: null }));
      expect(wrapper.text()).not.toContain('Spinning for a category');
      expect(wrapper.text()).toContain('The wheel stopped on History.');
    } finally {
      if (had) window.matchMedia = had;
      else delete window.matchMedia;
    }
  });

  it('gives nothing away about where it is landing until it has landed', async () => {
    const { show } = await mountGame(view({ phase: 'spin', question: null, spinLeft: 3000, remaining: null }));
    expect(wrapper.text()).not.toContain('Category: History');
    expect(wrapper.find('.game-log, .log').text()).not.toContain('Round 1 of 2: History');
    await show(view({ ask: 1 }));
    expect(wrapper.text()).toContain('Category: History');
    expect(wrapper.find('.game-log, .log').text()).toContain('Round 1 of 2: History');
  });

  it('names every wedge that has room for a name', async () => {
    await mountGame(view({ phase: 'spin', question: null, spinLeft: 3000, remaining: null }));
    const names = wrapper.findAll('.wheel text').map((t) => t.text());
    expect(names).toContain('History');
    expect(names).toContain('Music');
  });
});

describe('a question', () => {
  it('draws the question and its answers, and says what is at stake', async () => {
    await mountGame(view());
    expect(wrapper.text()).toContain('Who did the thing in the place?');
    expect(answerButtons().map((b) => b.text())).toEqual(['Neil Armstrong', 'Albert Einstein', 'Winston Churchill', 'Tom Jones']);
    expect(wrapper.text()).toContain('Round 1 of 2');
    expect(wrapper.text()).toContain('Question 2 of 3');
    expect(wrapper.text()).toContain('Category: History');
    expect(wrapper.text()).toContain('the quickest right answer scores 10');
  });

  it('sends which button was pressed and where on it', async () => {
    const { socket } = await mountGame(view());
    await press(answerButtons()[2], { left: 100, top: 50, width: 200, height: 80, x: 150, y: 110 });
    expect(sent(socket, 'answer')).toEqual([{ choice: 2, x: 0.25, y: 0.75 }]);
  });

  it('counts a press with no place of its own as the middle of the button', async () => {
    const { socket } = await mountGame(view());
    await press(answerButtons()[0]);
    expect(sent(socket, 'answer')).toEqual([{ choice: 0, x: 0.5, y: 0.5 }]);
  });

  it('locks the buttons once you have answered, and marks the one you chose', async () => {
    const { socket, show } = await mountGame(view());
    await show(view({ mine: { choice: 1, x: 0.5, y: 0.5 }, players: [player(1, 'Ann', { answered: true }), player(2, 'Bob'), player(3, 'Cy')] }));
    expect(answerButtons().every((b) => b.attributes('disabled') !== undefined)).toBe(true);
    expect(answerButtons()[1].classes()).toContain('chosen');
    expect(wrapper.text()).toContain('Your answer is in.');
    await answerButtons()[0].trigger('click');
    expect(sent(socket, 'answer')).toHaveLength(0);
  });

  it('keeps every marker at home while the question is open', async () => {
    await mountGame(view());
    const board = boardLayout({ width: 240, height: 240 }, 4, 3);
    expect(markers()).toHaveLength(3);
    expect(markers().every((m) => m.classes().includes('waiting'))).toBe(true);
    expect(markers()[0].attributes('style')).toContain(`top: ${homeOf(board, 0).y - MARKER / 2}px`);
  });
});

describe('the reveal', () => {
  it('leaves every marker at home at the very start of it', async () => {
    await mountGame(revealed(0));
    expect(markers().every((m) => m.classes().includes('waiting'))).toBe(true);
    expect(wrapper.find('button.answer.right').exists()).toBe(false);
  });

  it('moves the markers to the spots their players pressed, in the order the answers came', async () => {
    await mountGame(revealed(600)); // one step in: the first answer has landed, the second has not
    const board = boardLayout({ width: 240, height: 240 }, 4, 3);
    const bob = markers()[1];
    expect(bob.classes()).not.toContain('waiting');
    const landed = spotOf(board, { choice: 1, x: 0.2, y: 0.7 });
    expect(bob.attributes('style')).toContain(`left: ${landed.x - MARKER / 2}px`);
    expect(markers()[0].classes()).toContain('waiting');
    expect(markers()[2].classes()).toContain('waiting');
  });

  it('lights the right answer up once every marker has landed, and never before', async () => {
    const { show } = await mountGame(revealed(1200));
    expect(wrapper.find('button.answer.right').exists()).toBe(false);
    await show(revealed(1600));
    expect(answerButtons()[1].classes()).toContain('right');
    expect(answerButtons()[0].classes()).toContain('wrong');
    expect(wrapper.text()).toContain('The answer was');
  });

  it('leaves the marker of somebody who said nothing where it was, for ever', async () => {
    await mountGame(revealed(9000));
    expect(markers()[2].classes()).toContain('waiting');
    expect(wrapper.text()).toContain('Not this time.');
  });

  it('writes what happened into the recent moves', async () => {
    const { show } = await mountGame(view());
    await show(revealed(0));
    const log = wrapper.find('.game-log, .log').text();
    expect(log).toContain('Bob got it');
    expect(log).toContain('The answer was');
  });
});

describe('the end', () => {
  it('shows the final scores and says the quiz is over', async () => {
    await mountGame(
      view({
        phase: 'finished',
        question: null,
        remaining: null,
        correct: null,
        result: null,
        players: [player(1, 'Ann', { score: 20, placement: 1, winner: true }), player(2, 'Bob', { score: 9, placement: 2 }), player(3, 'Cy', { score: 0, placement: 3 })],
      }),
    );
    expect(wrapper.text()).toContain('That is the lot.');
    expect(wrapper.text()).toContain('Ann');
  });

  it('says so plainly when the questions ran out', async () => {
    await mountGame(view({ phase: 'abandoned', question: null, remaining: null, correct: null, result: null }));
    expect(wrapper.text()).toContain('There were no more questions to be had.');
    expect(wrapper.text()).toContain('The questions ran out');
  });
});
