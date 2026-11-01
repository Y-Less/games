<script setup>
// The table of sets: wide, a fixed height whatever is laid (a long game scrolls inside it). Every set shows its tiles, a
// hidden-until-needed + button and its live check; dropping tiles on the felt starts a new set, on a set adds to it.
// Props: sets (the shown sets from the working copy), settings (the game's tile settings), selected (selected tile ids),
//   myTurn (it is your turn), dropHint (show the drop outline while dragging), fresh and recent (Sets of tile ids played
//   this turn / by the last player), lockedTile(id), stands(item) and canAddTo(set) (functions from the working copy).
// Emits: pick(id), drop-selected(target) and drop-tiles(target) with a target like { type: 'set', index } or { type: 'new' },
//   and drag-start-tile(event, id) and drag-end-tile().
// Side effects: none beyond the emits.
import Tile from './Tile.vue';

defineProps({
  sets: { type: Array, required: true },
  settings: { type: Object, required: true },
  selected: { type: Array, required: true },
  myTurn: { type: Boolean, default: false },
  dropHint: { type: Boolean, default: false },
  fresh: { type: Set, required: true },
  recent: { type: Set, required: true },
  lockedTile: { type: Function, required: true },
  stands: { type: Function, required: true },
  canAddTo: { type: Function, required: true },
});
defineEmits(['pick', 'drop-selected', 'drop-tiles', 'drag-start-tile', 'drag-end-tile']);

/**
 * The words under a set: its check result, or what is wrong with it.
 *
 * @param {object} set  a shown set
 * @returns {string} e.g. "Run, 12" or the error
 */
const setLabel = (set) => {
  if (!set.result.ok) return set.result.error;
  return `${set.result.kind === 'run' ? 'Run' : 'Group'}, ${set.result.value}`;
};
</script>

<template>
  <section
    class="felt"
    :class="{ dropping: myTurn && dropHint }"
    aria-label="The table"
    @dragover.prevent
    @drop.prevent="$emit('drop-tiles', { type: 'new' })"
  >
    <div v-if="!sets.length" class="muted empty">The table is empty. {{ myTurn ? 'Make a first set from your rack.' : '' }}</div>
    <div class="sets">
      <div
        v-for="set in sets"
        :key="set.ids.join('-')"
        class="set"
        :class="{ bad: !set.result.ok, good: set.result.ok, frozen: set.frozen, target: selected.length && myTurn && !set.frozen }"
        :data-set="set.index"
        @click.self="$emit('drop-selected', { type: 'set', index: set.index })"
        @dragover.prevent
        @drop.prevent.stop="$emit('drop-tiles', { type: 'set', index: set.index })"
      >
        <div class="tiles" @click.self="$emit('drop-selected', { type: 'set', index: set.index })">
          <Tile
            v-for="item in set.items"
            :key="item.id"
            :settings="settings"
            :id="item.id"
            :selected="selected.includes(item.id)"
            :fresh="fresh.has(item.id)"
            :recent="recent.has(item.id) && !fresh.has(item.id)"
            :locked="lockedTile(item.id)"
            :stands="stands(item)"
            :interactive="myTurn"
            @click.stop="$emit('pick', item.id)"
            @dragstart="$emit('drag-start-tile', $event, item.id)"
            @dragend="$emit('drag-end-tile')"
          />
          <!-- always drawn, so a set is the same size on every turn; it only shows when it can be used -->
          <button
            class="add"
            :class="{ ready: canAddTo(set) }"
            :tabindex="canAddTo(set) ? 0 : -1"
            :aria-hidden="canAddTo(set) ? undefined : 'true'"
            :aria-label="`Add the selected tiles to set ${set.index + 1}`"
            @click.stop="$emit('drop-selected', { type: 'set', index: set.index })"
          >+</button>
        </div>
        <small class="label" :class="{ err: !set.result.ok }">{{ setLabel(set) }}</small>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* The table of sets: wide, a fixed height whatever is laid; a long game scrolls inside it. */
.felt {
  grid-column: 1 / -1;
  min-height: 0;
  padding: 0.6rem 0.8rem;
  overflow-y: auto;
}
.empty {
  padding: 0.4rem;
}
/* While tiles are being dragged, the whole felt says it will take them as a new set (dropping on a set adds to that set). */
.felt.dropping {
  outline: 2px dashed var(--amber);
  outline-offset: -4px;
}
.sets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
  align-items: flex-start;
}
.set {
  display: grid;
  gap: 0.25rem;
  padding: 0.45rem 0.5rem 0.3rem;
  border-radius: 12px;
  background: rgb(0 0 0 / 0.22);
  border: 2px solid transparent;
  max-width: 100%;
}
.set.good {
  border-color: rgb(127 174 122 / 0.45);
}
.set.bad {
  border-color: var(--danger);
}
.set.frozen {
  opacity: 0.85;
  border-style: dashed;
}
.set.target {
  cursor: copy;
}
.tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}
.label {
  color: var(--muted);
  font-size: 0.78rem;
  max-width: 18rem;
}
.label.err {
  color: #ffb4a3;
}
.add {
  /* always present (so nothing moves when a tile is picked up); only its visibility changes */
  visibility: hidden;
  width: 2.2rem;
  height: 3.2rem;
  padding: 0;
  border-radius: 7px;
  border-style: dashed;
  font-size: 1.3rem;
}
.add.ready {
  visibility: visible;
}
</style>
