// What the site header shows while a game is being played: the game's title and Rules button (put there by the play
// view), and a "Leave game" button that the game itself switches on and describes. A game client calls `useLeave`
// once from its top component; the header does the rest. Nothing here knows about any particular game.
import { onBeforeUnmount, shallowReactive, unref } from 'vue';

export const playBar = shallowReactive({
  game: null, // { name, hasRules, openRules } while a game is open
  leave: null, // the registration made by useLeave, or null
});

/** The value of a plain value, a ref/computed or a function (so that a game can pass whichever is handiest). */
const read = (value) => (typeof value === 'function' ? value() : unref(value));

/**
 * Registers the game's "Leave game" action with the header. Call it from a component's setup; it is removed again when
 * that component unmounts.
 *   canLeave     boolean, ref or function: whether leaving is possible right now (false hides the button)
 *   leave        function: does the leaving (may return a promise); only called after any confirmation
 *   confirmText  optional string, ref or function: when it gives a non-empty text the header asks the player to
 *                confirm with that text first; an empty text leaves at once
 */
export function useLeave({ canLeave = true, leave, confirmText = '' }) {
  const entry = { canLeave, leave, confirmText };
  playBar.leave = entry;
  onBeforeUnmount(() => {
    if (playBar.leave === entry) playBar.leave = null;
  });
}

/** What the header should draw for the leave button, or null when there is none: { confirmText, leave }. */
export function leaveOffer() {
  const entry = playBar.leave;
  if (!entry || !read(entry.canLeave)) return null;
  return { confirmText: read(entry.confirmText) || '', leave: entry.leave };
}
