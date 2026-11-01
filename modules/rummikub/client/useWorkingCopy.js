// The working copy of the table that you build during your turn: the sets and your rack as you have arranged them so far,
// what that arrangement is worth, which tiles are locked, which are selected, and the moves between them. Undo and Reset
// only touch this copy; the server is told nothing until you end the turn.
import { computed, ref, watch } from 'vue';
import { pinnedJokers } from '../rules.js';
import { JOKER_STAYS, canMove, moveTiles, placedThisTurn, releaseJokers, sameArrangement, sortRack, splitRunAtDuplicate, startArrangement, turnStatus } from './arrangement.js';

export const FROZEN = 'Until your first meld the sets already on the table cannot be changed.';

/**
 * The working copy.
 *
 * Side effects: place, pick, dropSelected, undo and reset change the copy, the selection, the undo list and the hint; a
 * watcher resets the copy whenever the server sends a new version, round, phase or seat.
 *
 * @param {object} view  the round view (reactive, from useRoundView)
 * @returns {object} arr, undoStack, selected, hint, sortMode, status, changed, fresh, recent, rackTiles, unlocked, pinned,
 *   fixedJokers, shownSets, and the functions frozenSet, canAddTo(set), lockedTile(id), stands(item), reset(), undo(),
 *   place(ids, target), pick(id), dropSelected(target)
 */
export function useWorkingCopy(view) {
  const arr = ref(startArrangement(view.state.table, view.state.rack));
  const undoStack = ref([]);
  const selected = ref([]);
  const hint = ref('');
  const sortMode = ref('run');

  /** Throws the working copy away and starts again from what the server says. */
  function reset() {
    arr.value = startArrangement(view.state.table, view.state.rack);
    undoStack.value = [];
    selected.value = [];
    hint.value = '';
  }
  watch(() => [view.state.version, view.state.round, view.state.phase, view.state.you], reset);

  const status = computed(() =>
    turnStatus(view.s, { arr: arr.value, before: view.state.table, rack: view.state.rack, melded: view.melded, meld: view.s.meld }),
  );
  const changed = computed(() => !sameArrangement(arr.value, startArrangement(view.state.table, view.state.rack)));
  const fresh = computed(() => placedThisTurn(arr.value, view.state.table));
  const recent = computed(() => new Set(view.state.lastPlay?.ids ?? []));
  const rackTiles = computed(() => sortRack(view.s, arr.value.rack, sortMode.value));
  const oldIds = computed(() => new Set(view.state.table.flat()));
  // With the "play on after melding" option the table opens as soon as the new sets of your own tiles are worth enough.
  const unlocked = computed(() => view.melded || (view.s.playOnMeld === true && status.value.points >= view.s.meld));
  /**
   * Whether a set holds tiles that were on the table before this turn and cannot be touched yet.
   *
   * @param {number[]} ids  the tile ids of the set
   * @returns {boolean} true when the set is frozen
   */
  const frozenSet = (ids) => !unlocked.value && ids.some((id) => oldIds.value.has(id));
  /**
   * Whether the + button of a set can take the selected tiles right now.
   *
   * @param {object} set  a shown set
   * @returns {boolean} true when it can
   */
  const canAddTo = (set) => view.myTurn && !set.frozen && selected.value.length > 0;
  // Jokers that were on the table when the turn began remember what they stand for, and stay put until a tile that fits is swapped in.
  const pinned = computed(() => pinnedJokers(view.s, view.state.table));
  const fixedJokers = computed(() => new Set([...pinned.value.keys()].filter((id) => !arr.value.freed?.includes(id))));
  /**
   * Whether a tile cannot be moved: it is in a frozen set, or is a joker that must stay.
   *
   * @param {number} id  a tile id
   * @returns {boolean} true when it is locked
   */
  const lockedTile = (id) => (!unlocked.value && oldIds.value.has(id)) || fixedJokers.value.has(id);

  const shownSets = computed(() =>
    arr.value.sets.map((ids, index) => {
      const result = status.value.sets[index];
      const items = result.ok ? result.items : ids.map((id) => ({ id, joker: false }));
      return { index, ids, result, items, frozen: frozenSet(ids) };
    }),
  );
  /**
   * What a joker stands for: what a joker already on the table remembers (one tile, or two to choose between), or what its set makes it.
   *
   * @param {object} item  a set item ({ id, joker, number, colour })
   * @returns {object|null} { number, colour, text? } or null when it stands for nothing yet
   */
  const stands = (item) => {
    const options = fixedJokers.value.has(item.id) ? pinned.value.get(item.id) : null;
    if (options) return { number: options[0].number, colour: options[0].colour, text: [...new Set(options.map((o) => o.number))].join('/') };
    return item.joker && item.number ? { number: item.number, colour: item.colour } : null;
  };

  /** Saves the current arrangement so that Undo can come back to it. */
  function remember() {
    undoStack.value.push({ arr: arr.value });
  }
  /**
   * Moves tiles to a target (a set, the rack or a new set), if the rules allow; otherwise says why in the hint.
   *
   * @param {number[]} ids  the tiles to move
   * @param {object} target  { type: 'set', index } or { type: 'rack' } or { type: 'new' }
   * @returns {boolean} true when the tiles moved
   */
  function place(ids, target) {
    const problem = canMove(arr.value, ids, target, { before: view.state.table, melded: unlocked.value, fixed: fixedJokers.value });
    if (problem) {
      hint.value = problem;
      return false;
    }
    hint.value = '';
    remember();
    const moved = moveTiles(arr.value, ids, target);
    const split = ids.length === 1 ? splitRunAtDuplicate(view.s, arr.value, moved, ids[0]) : null;
    const released = releaseJokers(view.s, split?.arr ?? moved, pinned.value);
    if (split) hint.value = `The run was split at the second ${split.number}.`;
    if (released.freed.length > (moved.freed?.length ?? 0)) hint.value = 'The joker is replaced: it has moved to a set of its own, so use it in a set this turn.';
    arr.value = released;
    selected.value = [];
    return true;
  }
  /**
   * Clicking a tile: select it or deselect it (or explain why it is locked).
   *
   * @param {number} id  a tile id
   */
  function pick(id) {
    if (!view.myTurn) return;
    if (lockedTile(id)) {
      hint.value = fixedJokers.value.has(id) ? JOKER_STAYS : FROZEN;
      return;
    }
    hint.value = '';
    selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id];
  }
  /**
   * Moves the selected tiles to a target (clicking where they should go).
   *
   * @param {object} target  as for place
   */
  function dropSelected(target) {
    if (view.myTurn && selected.value.length) place([...selected.value], target);
  }
  /** Steps back to the arrangement before the last move. */
  function undo() {
    const last = undoStack.value.pop();
    if (!last) return;
    arr.value = last.arr;
    selected.value = [];
    hint.value = '';
  }

  return { arr, undoStack, selected, hint, sortMode, status, changed, fresh, recent, rackTiles, unlocked, pinned, fixedJokers, shownSets, frozenSet, canAddTo, lockedTile, stands, reset, undo, place, pick, dropSelected };
}
