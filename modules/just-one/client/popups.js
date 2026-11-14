// What is worth announcing to the whole table at once, worked out from the change between one state and the next:
// in Just One, the word a new turn is about.  The root component shows it in the shared word pop-up
// (src/components/WordPopup.vue), in the player's own language.
// Depends on: nothing.

/**
 * The word a turn has just begun with, if this change of state is a turn beginning.
 *
 * Everybody writing a clue is shown the word; the guesser, who must not see it, is told at the same moment that
 * there is one (`hidden`).  Somebody only watching is told nothing, and nor is anybody by the first state they are
 * sent (arriving, or reloading the page, in the middle of a turn).
 *
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 * @returns {{ word: string | null, hidden: boolean } | null} the word, or that it is hidden from this player, or
 *   null when there is no news
 * Side effects: none.
 */
export function wordAnnounced(next, previous) {
  if (!next || !previous || next.phase !== 'clues') return null;
  if (previous.phase === 'clues' && previous.turn === next.turn) return null;
  if (next.guesser === next.you) return { word: null, hidden: true };
  return next.word ? { word: next.word, hidden: false } : null;
}
