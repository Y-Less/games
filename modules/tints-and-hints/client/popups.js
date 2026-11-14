// What is worth announcing to the whole table at once, worked out from the change between one state and the next:
// in Tints and Hints, a hint the hinter has just given.  The root component shows it in the shared word pop-up
// (src/components/WordPopup.vue), in the player's own language.
// Depends on: nothing.

/**
 * The hint that has just been given, if this change of state is one arriving.
 *
 * Both hints are announced, each when its words first appear or are changed, and to everybody but the hinter, who
 * wrote them.  Nothing is announced by the first state a player is sent (arriving, or reloading the page, in the
 * middle of a turn): the hint was news to the table when it was given, not when this player looked.
 *
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 * @returns {{ hintNumber: 1 | 2, word: string } | null} which hint and what it says, or null when there is no news
 * Side effects: none.
 */
export function hintAnnounced(next, previous) {
  if (!next || !previous || next.hinter === next.you) return null;
  if (!['guessing1', 'guessing2'].includes(next.phase)) return null;
  const sameTurn = previous.turn === next.turn && previous.phase !== 'lobby';
  for (const [hintNumber, which] of [[2, 'second'], [1, 'first']]) {
    const now = next.hints?.[which] ?? '';
    const before = sameTurn ? (previous.hints?.[which] ?? '') : '';
    if (now && now !== before) return { hintNumber, word: now };
  }
  return null;
}
