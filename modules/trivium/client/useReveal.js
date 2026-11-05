// The reveal, as the table plays it out: the markers travel to the answers one at a time, in the order the answers
// arrived, and only once they have all landed is the right answer lit up.
//
// The server says how far into the reveal the room already is (`reveal.since`) rather than what to show, so a person
// who arrives in the middle of one, or whose page was asleep, joins it where everybody else is instead of starting it
// again.  As with the turn clock, the countdown is re-anchored to this browser's own clock every time a new view
// arrives, so nothing depends on the two clocks agreeing.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/** How often the reveal is looked at again.  Twice as often as a step, so no marker is ever visibly late. */
const TICK = 100;

/**
 * The state of the reveal that is running, if one is.
 *
 * @param {() => object} getState  returns the server view
 * @returns {{ shown: import('vue').ComputedRef<number>, answerShown: import('vue').ComputedRef<boolean> }}
 *   how many answers have been revealed so far, and whether the right one is lit up yet
 * Side effects: starts an interval timer when the component mounts and clears it before it unmounts; a watcher
 *   re-anchors the reveal whenever a new view arrives.
 */
export function useReveal(getState) {
  const clock = ref(Date.now()); // "now", refreshed by the ticker so the computed values re-evaluate
  const began = ref(null); // when this browser reckons the reveal started, or null when none is running

  watch(
    () => [getState().version, getState().reveal?.since ?? null],
    () => {
      const reveal = getState().reveal;
      began.value = reveal ? Date.now() - reveal.since : null;
      clock.value = Date.now();
    },
    { immediate: true },
  );

  // How long the reveal has been running, in milliseconds (0 when none is).
  const elapsed = computed(() => (began.value === null ? 0 : Math.max(0, clock.value - began.value)));
  // How long a step of the reveal takes, as the server set it.
  const step = computed(() => getState().reveal?.step ?? 0);
  // How many answers there are to walk through.
  const count = computed(() => getState().result?.entries.length ?? 0);
  // How many of them have been revealed.
  const shown = computed(() => (began.value === null || !step.value ? 0 : Math.min(count.value, Math.floor(elapsed.value / step.value))));
  // Whether the right answer is lit up: one step after the last marker landed.
  const answerShown = computed(() => began.value !== null && step.value > 0 && elapsed.value >= (count.value + 1) * step.value);

  let ticker = null; // the interval id, kept so it can be cleared on unmount
  onMounted(() => {
    ticker = setInterval(() => {
      clock.value = Date.now();
    }, TICK);
  });
  onBeforeUnmount(() => clearInterval(ticker));

  return { shown, answerShown };
}
