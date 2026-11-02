// The player's half-made choices on the table: the pool die selected for placing, the tool being used and the message
// shown in Status.  They are cleared whenever the turn moves on, and a chosen die is dropped when it leaves the pool.
import { ref, watch } from 'vue';

/**
 * Creates the selection state and its resets.
 * @param {import('vue').ComputedRef<object>} s  the view sent by the server
 * @param {(id: number) => (object | null)} poolDie  finds a die in the pool
 * @returns {{ selected: import('vue').Ref, mode: import('vue').Ref, message: import('vue').Ref, clear: () => void }}
 *   selected is the pool die id chosen for placing, mode the tool in use (see toolkit.js), message the warning for Status
 *   clear() drops the selection and the tool (not the message)
 * Side effects: two watchers on the view (stopped with the calling component).
 */
export function useSelection(s, poolDie) {
  const selected = ref(null); // the pool die chosen for placing
  const mode = ref(null); // a tool being used
  const message = ref('');

  /**
   * Drops the selected die and the tool in use.
   * @returns {void}
   * Side effects: sets selected and mode back to null.
   */
  const clear = () => {
    selected.value = null;
    mode.value = null;
  };

  // The key names the turn.  Swift Hand starts an extra turn for the same player without changing turnIndex, so whether the
  // turn is the extra one is part of the key too (otherwise a die or tool chosen in the first turn would still be selected).
  watch(
    () => `${s.value.round}:${s.value.turnIndex}:${s.value.phase}:${s.value.turn?.extra ? 'extra' : 'normal'}`,
    () => {
      clear();
      message.value = '';
    },
  );
  watch(
    () => (s.value.pool ?? []).map((d) => `${d.id}${d.v}`).join(),
    () => {
      if (selected.value !== null && !poolDie(selected.value)) selected.value = null;
      if (mode.value?.die != null && !poolDie(mode.value.die)) mode.value.die = null;
    },
  );

  return { selected, mode, message, clear };
}
