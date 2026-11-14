// A hint is announced to the table as it is given: to the guessers, once for each time its words change, and never
// to the hinter or to somebody who has only just arrived.
import { describe, expect, it } from 'vitest';
import { hintAnnounced } from './popups.js';

/** A guesser's view (player 2; player 1 is the hinter) of a turn, with whatever the test changes. */
const view = (over = {}) => ({ phase: 'guessing1', turn: 1, hinter: 1, you: 2, hints: { first: '', second: '' }, ...over });

describe('the hint announced to the table', () => {
  it('announces the first hint when it is given', () => {
    expect(hintAnnounced(view({ hints: { first: 'warm', second: '' } }), view())).toEqual({ hintNumber: 1, word: 'warm' });
  });

  it('announces the second hint when the guessing moves on to it', () => {
    const before = view({ hints: { first: 'warm', second: '' } });
    const after = view({ phase: 'guessing2', hints: { first: 'warm', second: 'like a brick' } });
    expect(hintAnnounced(after, before)).toEqual({ hintNumber: 2, word: 'like a brick' });
  });

  it('announces a hint again when the hinter changes its words, and not when nothing about it changed', () => {
    const before = view({ hints: { first: 'warm', second: '' } });
    expect(hintAnnounced(view({ hints: { first: 'warmer', second: '' } }), before)).toEqual({ hintNumber: 1, word: 'warmer' });
    expect(hintAnnounced(view({ hints: { first: 'warm', second: '' } }), before)).toBeNull();
  });

  it('announces the first hint of a new turn even when it is the same words as the last turn\'s', () => {
    const lastTurn = view({ phase: 'reveal', hints: { first: 'warm', second: 'brick' } });
    expect(hintAnnounced(view({ turn: 2, hints: { first: 'warm', second: '' } }), lastTurn)).toEqual({ hintNumber: 1, word: 'warm' });
  });

  it('says nothing to the hinter, who wrote it', () => {
    expect(hintAnnounced(view({ you: 1, hints: { first: 'warm', second: '' } }), view({ you: 1 }))).toBeNull();
  });

  it('says nothing to somebody arriving in the middle of a turn, or leaving the game', () => {
    expect(hintAnnounced(view({ hints: { first: 'warm', second: '' } }), null)).toBeNull();
    expect(hintAnnounced(null, view())).toBeNull();
  });

  it('says nothing once the guessing is over', () => {
    const before = view({ phase: 'guessing2', hints: { first: 'warm', second: '' } });
    expect(hintAnnounced(view({ phase: 'reveal', hints: { first: 'warm', second: 'brick' } }), before)).toBeNull();
  });
});
