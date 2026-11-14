// What a drawer is drawing with - the tool, the colour, and the brush - and the keys that change it quickly.  Nothing
// here is ever sent: only the strokes the tool makes are.  Shared by the games that draw (Scribblers, Draw!), with
// src/components/DrawingToolbox.vue as the buttons for the same thing.
// Depends on: Vue only.
import { onBeforeUnmount, onMounted, reactive } from 'vue';

/** The widths of brush offered unless a game says otherwise, in board units (the same four as scribble.rs). */
export const WIDTHS = [8, 16, 24, 32];
/** The tools: a pen, a rubber (which is a pen that paints white), and a paint bucket. */
export const TOOLS = ['pen', 'rubber', 'fill'];

/** Which key picks which tool.  They sit together on the left of the keyboard, as in scribble.rs, so one hand can
 * reach them while the other draws; the number keys beside them pick a brush, the thinnest first. */
const TOOL_KEYS = { q: 'pen', w: 'fill', e: 'rubber' };

/**
 * The drawing tool, with the keyboard shortcuts for it.
 *
 * @param {object} options
 * @param {() => boolean} options.active  whether this viewer may draw at all (the keys do nothing otherwise)
 * @param {() => void} options.undo  what the undo key does
 * @param {number[]} [options.widths]  the brush sizes this game offers, thinnest first (default WIDTHS)
 * @returns {{ tool: { kind: string, colour: number, width: number }, widths: number[] }} `tool` is what the board
 *   and the toolbox share, changed in place; `widths` is handed on to the toolbox
 * Side effects: listens for keydown on the window while the component is mounted (and stops when it unmounts).
 */
export function useDrawingTools({ active, undo, widths = WIDTHS }) {
  const tool = reactive({ kind: 'pen', colour: 13, width: widths[0] });

  /**
   * A key has been pressed: change the tool, unless the player is typing a guess or cannot draw anyway.
   * @param {KeyboardEvent} event  the key
   * @returns {void}
   * Side effects: may change `tool` or call `undo`.
   */
  function onKey(event) {
    if (!active() || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const width = /^[1-9]$/.test(key) ? widths[Number(key) - 1] : undefined;
    if (!TOOL_KEYS[key] && width === undefined) return;
    event.preventDefault();
    if (TOOL_KEYS[key]) tool.kind = TOOL_KEYS[key];
    else tool.width = width;
  }

  onMounted(() => window.addEventListener('keydown', onKey));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
  return { tool, widths };
}
