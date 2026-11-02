// What the drawer is drawing with - the tool, the colour, and the brush - and the keys that change it quickly.
// Depends on: Vue only.
import { onBeforeUnmount, onMounted, reactive } from 'vue';

/** The widths of brush offered, in board units (the same four as scribble.rs). */
export const WIDTHS = [8, 16, 24, 32];
/** The tools: a pen, a rubber (which is a pen that paints white), and a paint bucket. */
export const TOOLS = ['pen', 'rubber', 'fill'];

/** Which key picks what.  They sit together on the left of the keyboard, as in scribble.rs, so one hand can reach them
 * while the other draws. */
const KEYS = { q: ['tool', 'pen'], w: ['tool', 'fill'], e: ['tool', 'rubber'], 1: ['width', 8], 2: ['width', 16], 3: ['width', 24], 4: ['width', 32] };

/**
 * The drawing tool, with the keyboard shortcuts for it.
 *
 * Side effects: listens for keydown on the window while the component is mounted (and stops when it unmounts).
 *
 * @param {object} options
 * @param {() => boolean} options.active  whether this viewer may draw at all (the keys do nothing otherwise)
 * @param {() => void} options.undo  what the undo key does
 * @returns {{ tool: object }} `tool` is { kind, colour, width }, which the board and the toolbox share
 */
export function useTools({ active, undo }) {
  const tool = reactive({ kind: 'pen', colour: 13, width: WIDTHS[0] });

  /**
   * A key has been pressed: change the tool, unless the player is typing a guess or cannot draw anyway.
   * @param {KeyboardEvent} event  the key
   * @returns {void}
   * Side effects: may change `tool` or call `undo`.
   */
  function onKey(event) {
    if (!active() || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const change = KEYS[event.key.toLowerCase()];
    if (!change) return;
    event.preventDefault();
    if (change[0] === 'tool') tool.kind = change[1];
    else tool.width = change[1];
  }

  onMounted(() => window.addEventListener('keydown', onKey));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
  return { tool };
}
