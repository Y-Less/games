// The things you send at the Rummikub table: ending your turn with the laid-out table, drawing a tile, carrying on to the next round.
import { computed, ref } from 'vue';

/**
 * Turn actions.
 *
 * Side effects: endTurn sends 'play' with the working copy's sets; drawTile sends 'draw'; onContinue sends 'next' between
 * rounds. `busy` is true while a request is on its way.
 *
 * @param {object} view  the round view (reactive)
 * @param {object} copy  the working copy (reactive)
 * @param {Function} send  sends an action to the server and resolves with its reply
 * @returns {object} busy, canEnd, endTurn(), drawTile(), onContinue()
 */
export function useTurnActions(view, copy, send) {
  const busy = ref(false);
  // True when End turn would be accepted: it is your turn, the layout is valid and no request is in flight.
  const canEnd = computed(() => view.myTurn && copy.status.ok && !busy.value);

  /**
   * Sends the laid-out table as your move.
   *
   * @returns {Promise<void>} resolves when the server has replied (does nothing if the move is not allowed)
   *
   * Side effects: sets `busy` while waiting; sends the 'play' action.
   */
  async function endTurn() {
    if (!canEnd.value) return;
    busy.value = true;
    try {
      await send('play', { table: copy.arr.sets });
    } finally {
      busy.value = false;
    }
  }
  /**
   * Draws a tile from the pool (or passes when the pool is empty).
   *
   * @returns {Promise<void>} resolves when the server has replied (does nothing if it is not your turn or a request is pending)
   *
   * Side effects: sets `busy` while waiting; sends the 'draw' action.
   */
  async function drawTile() {
    if (!view.myTurn || busy.value) return;
    busy.value = true;
    try {
      await send('draw');
    } finally {
      busy.value = false;
    }
  }
  /**
   * Carries on once the round scores have been seen.
   *
   * @returns {void} nothing (the reply is not awaited)
   *
   * Side effects: sends the 'next' action, but only between rounds.
   */
  const onContinue = () => {
    if (view.state.phase === 'between') send('next');
  };

  return { busy, canEnd, endTurn, drawTile, onContinue };
}
