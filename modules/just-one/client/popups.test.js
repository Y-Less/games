// The word a turn begins with is announced to the table at once: the writers are shown it, the guesser is told only
// that there is one, and nobody is told anything by the first state they are sent.
import { describe, expect, it } from 'vitest';
import { wordAnnounced } from './popups.js';

/** A writer's view (player 2; player 1 guesses) of a turn's clues being written, with whatever the test changes. */
const view = (over = {}) => ({ phase: 'clues', turn: 1, guesser: 1, you: 2, word: 'lighthouse', ...over });

describe('the word announced to the table', () => {
  it('shows a writer the word as the game starts and as each turn begins', () => {
    expect(wordAnnounced(view(), { phase: 'lobby', turn: 1 })).toEqual({ word: 'lighthouse', hidden: false });
    expect(wordAnnounced(view({ turn: 2, word: 'anchor' }), view({ phase: 'reveal' }))).toEqual({ word: 'anchor', hidden: false });
  });

  it('tells the guesser that there is a word, and not what it is', () => {
    expect(wordAnnounced(view({ you: 1, word: null }), { phase: 'lobby', turn: 1 })).toEqual({ word: null, hidden: true });
  });

  it('announces a turn that follows a skipped one, which never left the writing of clues', () => {
    expect(wordAnnounced(view({ turn: 2, word: 'anchor' }), view({ turn: 1 }))).toEqual({ word: 'anchor', hidden: false });
  });

  it('says nothing while the same turn goes on', () => {
    expect(wordAnnounced(view(), view())).toBeNull();
    expect(wordAnnounced(view({ phase: 'guessing' }), view())).toBeNull();
  });

  it('says nothing to somebody only watching, who is sent no word', () => {
    expect(wordAnnounced(view({ you: 9, word: null }), { phase: 'lobby', turn: 1 })).toBeNull();
  });

  it('says nothing to somebody arriving in the middle of a turn, or leaving the game', () => {
    expect(wordAnnounced(view(), null)).toBeNull();
    expect(wordAnnounced(null, view())).toBeNull();
  });
});
