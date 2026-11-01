// Fits a game to the window: the game is drawn at its natural size, and if that is taller than the room below the
// title it is scaled down (never up) so the page does not need to scroll while playing. The natural height only ever
// grows within a window size, so the scale settles instead of bouncing as panels come and go.
// Depends on: vue only (plus the browser's ResizeObserver and MutationObserver).
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

// The smallest zoom a game is ever shrunk to, so it never becomes unreadable.
const MIN_SCALE = 0.55;

/**
 * Scales the frame's first element down to fit the window (call from a component's setup).
 * @returns {{ frame: import('vue').Ref<HTMLElement | null> }}  bind `frame` to the element that holds the game
 * Side effects: while the component is mounted, listens for window resizes, observes the game's first element (waiting
 * for one to appear if need be) and sets `zoom` and `--fit-zoom` on the frame; all of it is undone on unmount.
 */
export function useFrameFit() {
  const frame = ref(null);
  let natural = 0;
  let observer = null;
  let waiting = null; // the MutationObserver waiting for the game's first element to appear, if any

  /**
   * Measures the game and sets the frame's zoom.
   * @returns {void}
   * Side effects: may set `zoom` and `--fit-zoom` on the frame and raise `natural`.
   * A screen that lays itself out to fit the window (its root has data-fits-window) is never scaled.
   */
  function fit() {
    const el = frame.value;
    const inner = el?.firstElementChild;
    if (!el || !inner || !el.offsetParent) return;
    const current = Number.parseFloat(el.style.zoom) || 1;
    if (el.querySelector('[data-fits-window]')) {
      natural = 0;
      if (current !== 1) {
        el.style.zoom = '1';
        el.style.setProperty('--fit-zoom', '1');
      }
      return;
    }
    natural = Math.max(natural, inner.getBoundingClientRect().height / current);
    const top = el.getBoundingClientRect().top + window.scrollY;
    const room = window.innerHeight - top - 12;
    const scale = natural > 0 ? Math.min(1, Math.max(MIN_SCALE, room / natural)) : 1;
    const next = Math.floor(scale * 100) / 100;
    if (Math.abs(next - current) >= 0.01) {
      el.style.zoom = String(next);
      el.style.setProperty('--fit-zoom', String(next)); // sticky bars inside the game divide their offset by this
    }
  }

  /**
   * Forgets the measured height and fits again (the window changed size).
   * @returns {void}
   * Side effects: as `fit`.
   */
  function refit() {
    natural = 0;
    fit();
  }

  // Starts listening once the DOM exists. Side effects: adds the resize listener and creates the ResizeObserver.
  onMounted(() => {
    window.addEventListener('resize', refit);
    observer = new ResizeObserver(fit);
  });

  /**
   * Watches the game's frame: measures its first element, or waits for one to appear.
   * @param {HTMLElement | null} el  the new frame element
   * @param {HTMLElement | null} old  the previous one
   * @returns {void}
   * Side effects: moves the ResizeObserver; replaces any pending MutationObserver (disconnecting the old one).
   */
  watch(frame, (el, old) => {
    waiting?.disconnect();
    waiting = null;
    if (old) observer?.unobserve(old.firstElementChild ?? old);
    if (el?.firstElementChild) observer?.observe(el.firstElementChild);
    else if (el) {
      waiting = new MutationObserver(() => {
        if (!el.firstElementChild) return;
        observer?.observe(el.firstElementChild);
        waiting?.disconnect();
        waiting = null;
      });
      waiting.observe(el, { childList: true });
    }
  });

  /** Stops listening when the page goes away. Side effects: removes the resize listener, disconnects both observers. */
  onBeforeUnmount(() => {
    window.removeEventListener('resize', refit);
    waiting?.disconnect();
    waiting = null;
    observer?.disconnect();
  });

  return { frame };
}
