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
  const canEnd = computed(() => view.myTurn && copy.status.ok && !busy.value);

  /** Sends the laid-out table as your move. */
  async function endTurn() {
    if (!canEnd.value) return;
    busy.value = true;
    try {
      await send('play', { table: copy.arr.sets });
    } finally {
      busy.value = false;
    }
  }
  /** Draws a tile from the pool (or passes when the pool is empty). */
  async function drawTile() {
    if (!view.myTurn || busy.value) return;
    busy.value = true;
    try {
      await send('draw');
    } finally {
      busy.value = false;
    }
  }
  /** Carries on once the round scores have been seen. */
  const onContinue = () => {
    if (view.state.phase === 'between') send('next');
  };

  return { busy, canEnd, endTurn, drawTile, onContinue };
}
