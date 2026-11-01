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
  const clock = ref(Date.now());
  const deadline = ref(null);
  watch(
    () => [getState().version, getState().remaining],
    () => {
      const remaining = getState().remaining;
      deadline.value = remaining === null || remaining === undefined ? null : Date.now() + remaining;
    },
    { immediate: true },
  );
  const secondsLeft = computed(() => (deadline.value === null ? null : Math.max(0, Math.ceil((deadline.value - clock.value) / 1000))));
  let ticker = null;
  onMounted(() => {
    ticker = setInterval(() => {
      clock.value = Date.now();
    }, 500);
  });
  onBeforeUnmount(() => clearInterval(ticker));
  return { secondsLeft };
}
