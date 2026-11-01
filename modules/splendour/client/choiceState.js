// The choices a player is part-way through making at the Splendour table, shared by the gem, card and token-return
// composables (choosing one kind of thing clears the others).
import { ref, watch } from 'vue';

/** Six zeros: no tokens marked to give back. */
export const noTokens = () => [0, 0, 0, 0, 0, 0];

/**
 * Creates the shared refs.
 *
 * @returns {object} picks (gem colours chosen to take), sel ({ kind: 'card', id } or { kind: 'deck', level } or null),
 *   message (a warning for the Status box), payGold (Gold chosen by hand, or null), giveBack (tokens marked to give
 *   back) and busy (a request is on its way)
 */
export function createChoiceState() {
  return { picks: ref([]), sel: ref(null), message: ref(''), payGold: ref(null), giveBack: ref(noTokens()), busy: ref(false) };
}

/**
 * Forgets half-made choices whenever the turn, the round or the kind of pending choice changes.
 *
 * Side effects: a watcher that resets picks, giveBack, payGold and message on the shared state.
 *
 * @param {object} view    the table view (reactive)
 * @param {object} shared  the shared choice state (reactive)
 */
export function useChoiceReset(view, shared) {
  watch(
    () => `${view.s.turn}:${view.s.round}:${view.s.pending?.type ?? ''}`,
    () => {
      shared.picks = [];
      shared.giveBack = noTokens();
      shared.payGold = null;
      shared.message = '';
    },
  );
}
