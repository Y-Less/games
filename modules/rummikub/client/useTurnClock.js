// The turn timer: counts down the seconds the server says are left this turn.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * The countdown.
 *
 * Side effects: starts an interval timer when the component mounts and clears it before it unmounts; a watcher restarts
 * the countdown from `remaining` whenever the server sends a new version.
 *
 * @param {() => object} getState  returns the server view (version and remaining milliseconds, or null for no limit)
 * @returns {object} secondsLeft (a computed number of seconds, or null when the turn is not timed)
 */
export function useTurnClock(getState) {
  const clock = ref(Date.now()); // "now", refreshed by the ticker so the computed countdown re-evaluates
  const deadline = ref(null); // the wall-clock time the turn ends, or null when there is no time limit
  // Each new server version carries a fresh `remaining`, so re-anchor the deadline to the local clock then (this avoids
  // depending on the server's clock being in step with ours).
  watch(
    () => [getState().version, getState().remaining],
    () => {
      const remaining = getState().remaining;
      deadline.value = remaining === null || remaining === undefined ? null : Date.now() + remaining;
    },
    { immediate: true },
  );
  // Whole seconds left (rounded up, never below 0), or null when the turn is untimed.
  const secondsLeft = computed(() => (deadline.value === null ? null : Math.max(0, Math.ceil((deadline.value - clock.value) / 1000))));
  let ticker = null; // the interval id, kept so it can be cleared on unmount
  // Twice a second is often enough for a whole-seconds display without visibly lagging.
  onMounted(() => {
    ticker = setInterval(() => {
      clock.value = Date.now();
    }, 500);
  });
  onBeforeUnmount(() => clearInterval(ticker));
  return { secondsLeft };
}
