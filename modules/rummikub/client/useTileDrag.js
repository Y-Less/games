// Dragging tiles with the mouse at the Rummikub table: which tiles are being dragged and whether the table shows its drop outline.
import { ref } from 'vue';

/**
 * Drag and drop.
 *
 * Side effects: dragStart sets the drag data on the event and, a moment later, the drop outline; drop places the dragged
 * tiles through the working copy.
 *
 * @param {object} view  the round view (reactive)
 * @param {object} copy  the working copy (reactive, from useWorkingCopy)
 * @returns {object} dragging, dropHint, dragStart(event, id), drop(target), dragEnd()
 */
export function useTileDrag(view, copy) {
  const dragging = ref([]);
  const dropHint = ref(false); // the table's outline while dragging: set a moment after the drag starts (see dragStart)

  /**
   * A drag begins on a tile: it takes the whole selection with it when it is part of it.
   *
   * @param {DragEvent} event  the browser's dragstart event
   * @param {number} id  the dragged tile
   * @returns {void} nothing
   *
   * Side effects: cancels the drag when it is not your turn or the tile is locked; otherwise sets `dragging`, writes the ids to
   * the event's dataTransfer and schedules `dropHint` to be set on the next tick.
   */
  function dragStart(event, id) {
    if (!view.myTurn || copy.lockedTile(id)) {
      event.preventDefault();
      return;
    }
    dragging.value = copy.selected.includes(id) ? [...copy.selected] : [id];
    try {
      event.dataTransfer.setData('text/plain', dragging.value.join(','));
      event.dataTransfer.effectAllowed = 'move';
    } catch {
      // an environment without data transfer (the tests)
    }
    // Changing the page inside dragstart can make the browser cancel the drag, so the outline waits until it has begun.
    setTimeout(() => {
      dropHint.value = dragging.value.length > 0;
    }, 0);
  }
  /**
   * The dragged tiles are dropped on a target.
   *
   * @param {object} target  { type: 'set', index } or { type: 'rack' } or { type: 'new' }
   * @returns {void} nothing
   *
   * Side effects: clears `dragging` and `dropHint`; moves the tiles through copy.place when it is your turn.
   */
  function drop(target) {
    const ids = dragging.value;
    dragging.value = [];
    dropHint.value = false;
    if (view.myTurn && ids.length) copy.place(ids, target);
  }
  /**
   * The drag ended (dropped or cancelled).
   *
   * @returns {void} nothing
   *
   * Side effects: clears `dragging` and `dropHint`.
   */
  const dragEnd = () => {
    dragging.value = [];
    dropHint.value = false;
  };

  return { dragging, dropHint, dragStart, drop, dragEnd };
}
