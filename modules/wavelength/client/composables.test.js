// Tests for the Wavelength table's composables and the dial layout, on small hand-made views.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { dialLayout } from './layout.js';
import { useGameView } from './useGameView.js';
import { SEND_EVERY, useGuessing } from './useGuessing.js';
import { useStatusText } from './useStatusText.js';

const player = (id, name, extra = {}) => ({ id, name, colour: `#00000${id}`, score: 0, online: true, guessed: false, ready: false, winner: false, ...extra });
const makeState = (extra = {}) => ({
  phase: 'guessing',
  mode: 'solo',
  you: 1,
  psychic: 2,
  turn: 1,
  turnsTotal: 3,
  marker: null,
  guesses: [],
  clue: 'a hot bath',
  result: null,
  players: [player(1, 'Ann'), player(2, 'Bob'), player(3, 'Cy', { guessed: true })],
  ...extra,
});

/**
 * Runs a composable inside a mounted component (so its watchers and unmount hooks work).
 *
 * @param {object} holder  a reactive { state }
 * @param {Function} send  the send function
 * @returns {object} the wrapper, the reactive view, and guessing state
 */
function setup(holder, send = vi.fn(() => Promise.resolve({ ok: true }))) {
  const out = {};
  const wrapper = mount(
    defineComponent({
      setup() {
        out.view = reactive(useGameView(() => holder.state));
        out.guess = reactive(useGuessing(out.view, send));
        out.text = useStatusText(out.view, out.guess);
        return () => h('div');
      },
    }),
  );
  return { wrapper, send, ...out };
}

describe('useGameView', () => {
  it('works out the roles and who has guessed', () => {
    const { view } = setup(reactive({ state: makeState() }));
    expect(view.isPsychic).toBe(false);
    expect(view.psychicName).toBe('Bob');
    expect(view.guessedCount).toBe(1);
    expect(view.canGuess).toBe(true);
    expect(view.others.map((p) => p.name)).toEqual(['Bob', 'Cy']);
    expect(view.nameOf(99)).toBe('Someone');
    expect(view.colourOf(99)).toBe('#fff');
  });

  it('draws the team marker in the team colour in the scores pop-up, and solo guesses in their own colours', () => {
    const team = setup(reactive({ state: makeState({ mode: 'team', marker: 0.4 }) })).view;
    expect(team.popupMarkers).toHaveLength(1);
    expect(team.popupMarkers[0].colour).toBe(team.teamPin()[0].colour);
    expect(team.popupMarkers[0].colour).not.toBe('#fff');
    const solo = setup(reactive({ state: makeState({ phase: 'reveal', result: { entries: [{ id: 3, position: 0.2, name: 'Cy' }] } }) })).view;
    expect(solo.popupMarkers).toEqual([{ id: 3, position: 0.2, name: 'Cy', colour: '#000003' }]);
  });

  it('does not let you guess twice alone, but does in a team', () => {
    const solo = setup(reactive({ state: makeState({ players: [player(1, 'Ann', { guessed: true }), player(2, 'Bob')] }) }));
    expect(solo.view.canGuess).toBe(false);
    const team = setup(reactive({ state: makeState({ mode: 'team', players: [player(1, 'Ann', { guessed: true }), player(2, 'Bob')] }) }));
    expect(team.view.canGuess).toBe(true);
  });
});

describe('useGuessing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns your needle, locks in the guess and clears it', async () => {
    const { guess, send } = setup(reactive({ state: makeState() }));
    expect(guess.needle).toBe(null);
    guess.turn(42);
    expect(guess.needle).toBe(42);
    await guess.lockIn();
    expect(send).toHaveBeenCalledWith('guess', { position: 42 });
    expect(guess.picked).toBe(null);
  });

  it('does not lock in before the dial has been turned', async () => {
    const { guess, send } = setup(reactive({ state: makeState() }));
    await guess.lockIn();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends team marker moves at most every SEND_EVERY ms, the last one always', () => {
    const { guess, send } = setup(reactive({ state: makeState({ mode: 'team' }) }));
    guess.turn(10);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('marker', { position: 10 });
    guess.turn(11);
    guess.turn(12);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SEND_EVERY);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('marker', { position: 12 });
  });

  it('shows your own team position for a moment, then lets the server take over', () => {
    const { guess } = setup(reactive({ state: makeState({ mode: 'team', marker: 50 }) }));
    expect(guess.needle).toBe(50);
    guess.turn(70);
    expect(guess.needle).toBe(70);
    vi.advanceTimersByTime(800);
    expect(guess.needle).toBe(50);
  });

  it('flushes a waiting marker before locking in as a team, and clears timers on unmount', async () => {
    const { guess, send, wrapper } = setup(reactive({ state: makeState({ mode: 'team' }) }));
    guess.turn(10);
    guess.turn(20);
    await guess.lockIn();
    expect(send.mock.calls.map((c) => c[0])).toEqual(['marker', 'marker', 'lock']);
    guess.turn(30);
    wrapper.unmount();
    vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('forgets the clue text when the turn changes', async () => {
    const holder = reactive({ state: makeState() });
    const { guess } = setup(holder);
    guess.clueText = 'hello';
    holder.state = makeState({ turn: 2 });
    await Promise.resolve();
    expect(guess.clueText).toBe('');
  });
});

describe('useStatusText', () => {
  it('tells the psychic what to do, and the guesser to turn the dial', () => {
    const psychic = setup(reactive({ state: makeState({ phase: 'clue', psychic: 1 }) }));
    expect(psychic.text.headline.value).toContain('You are the psychic');
    expect(psychic.text.mineNow.value).toBe(true);
    const guesser = setup(reactive({ state: makeState() }));
    expect(guesser.text.headline.value).toContain('Your turn');
    expect(guesser.text.lines.value[0].text).toContain('Drag on the dial');
    guesser.guess.turn(5);
    expect(guesser.text.lines.value[0].text).toContain('Lock it in');
  });

  it('names the winners at the end', () => {
    const { text } = setup(reactive({ state: makeState({ phase: 'finished', players: [player(1, 'Ann', { score: 5, winner: true }), player(2, 'Bob', { score: 2 })] }) }));
    expect(text.headline.value).toBe('Ann wins with 5 points.');
  });
});

describe('dialLayout', () => {
  const area = (width, height = 700) => ({ width, height, gap: 12, columns: 12 });
  it('takes eight columns on a wide screen and all twelve on a narrow one', () => {
    expect(dialLayout(area(1000)).span).toBe(8);
    expect(dialLayout(area(500)).span).toBe(12);
  });
  it('never makes the dial wider than its column', () => {
    const wide = dialLayout(area(1000, 2000));
    expect(wide.width).toBeLessThanOrEqual(1000);
    expect(dialLayout(area(1000, 300)).width).toBeLessThan(wide.width);
  });
});
