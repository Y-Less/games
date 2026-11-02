// The choices a player is part-way through making at the Splendour table, shared by the gem, card and token-return
// composables (choosing one kind of thing clears the others).
import { ref, watch } from 'vue';

/**
 * Six zeros: no tokens marked to give back (one slot per colour, Gold last).
 * @returns {number[]} a fresh array of six zeros
 * Side effects: none.
 */
export const noTokens = () => [0, 0, 0, 0, 0, 0];

/**
 * Creates the shared refs, so that the gem, card and token composables all read and write the same half-made choice.
 *
 * Side effects: none (creates refs only; nothing is mutated until a composable writes to them).
 *
 * @returns {object} picks (gem colours chosen to take), sel ({ kind: 'card', id } or { kind: 'deck', level } or null),
 *   message (a warning for the Status box, as a message or null), payGold (Gold chosen by hand, or null), giveBack
 *   (tokens marked to give back) and busy (a request is on its way)
 */
export function createChoiceState() {
  return { picks: ref([]), sel: ref(null), message: ref(null), payGold: ref(null), giveBack: ref(noTokens()), busy: ref(false) };
}

/**
 * Forgets half-made choices whenever the turn, the round or the kind of pending choice changes.
 *
 * Side effects: a watcher that resets picks, giveBack, payGold and message on the shared state.
 *
 * @param {object} view    the table view (reactive)
 * @param {object} shared  the shared choice state (reactive)
 * @returns {void}
 */
export function useChoiceReset(view, shared) {
  // A key that changes whenever the turn, round or pending choice does; any such change makes half-made picks stale.
  watch(
    () => `${view.s.turn}:${view.s.round}:${view.s.pending?.type ?? ''}`,
    () => {
      shared.picks = [];
      shared.giveBack = noTokens();
      shared.payGold = null;
      shared.message = null;
    },
  );
}
