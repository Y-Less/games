<script setup>
// Your rack: the most prominent thing, directly under the table, with room for a fixed number of rows of tiles (set by the
// arena's --rack-rows) and the two ways of sorting it.
// Props: tiles (the rack's tile ids, already sorted), count (how many tiles are in the rack), sortMode ('run' or 'group'),
//   settings (the game's tile settings), selected (selected tile ids), myTurn, drawn (the tile just drawn, or null),
//   playing (the game is in play, so the drawn mark shows), span (how many grid columns it takes).
// Slots: none.
// Emits: update:sortMode, pick(id), drop-selected(target), drop-tiles(target), drag-start-tile(event, id), and drag-end-tile().
// Side effects: none beyond the emits.
import { useGameText } from '../../../src/useGameText.js';
import Tile from './Tile.vue';

defineProps({
  tiles: { type: Array, required: true },
  count: { type: Number, required: true },
  sortMode: { type: String, required: true },
  settings: { type: Object, required: true },
  selected: { type: Array, required: true },
  myTurn: { type: Boolean, default: false },
  drawn: { type: Number, default: null },
  playing: { type: Boolean, default: false },
  span: { type: Number, required: true },
});
defineEmits(['update:sortMode', 'pick', 'drop-selected', 'drop-tiles', 'drag-start-tile', 'drag-end-tile']);
const { t } = useGameText();
</script>

<template>
  <section class="rack-panel" :class="{ mine: myTurn }" :aria-label="t('table.yourRack')" :style="{ gridColumn: `span ${span}` }">
    <div class="rack-head">
      <strong>{{ t('table.yourRack') }}<span class="muted"> {{ t('table.rackCount', { count }, count) }}</span></strong>
      <div class="seg" role="group" :aria-label="t('table.sortRack')">
        <button :class="{ primary: sortMode === 'run' }" :aria-pressed="sortMode === 'run'" :title="t('table.runsTitle')" @click="$emit('update:sortMode', 'run')">{{ t('table.runs') }}</button>
        <button :class="{ primary: sortMode === 'group' }" :aria-pressed="sortMode === 'group'" :title="t('table.groupsTitle')" @click="$emit('update:sortMode', 'group')">{{ t('table.groups') }}</button>
      </div>
    </div>
    <div
      class="rack"
      :class="{ target: selected.length && myTurn }"
      data-rack
      @click.self="$emit('drop-selected', { type: 'rack' })"
      @dragover.prevent
      @drop.prevent="$emit('drop-tiles', { type: 'rack' })"
    >
      <Tile
        v-for="id in tiles"
        :key="id"
        :settings="settings"
        :id="id"
        :selected="selected.includes(id)"
        :drawn="id === drawn && playing"
        :interactive="myTurn"
        @click.stop="$emit('pick', id)"
        @dragstart="$emit('drag-start-tile', $event, id)"
        @dragend="$emit('drag-end-tile')"
      />
      <span v-if="!tiles.length" class="muted">{{ t('table.rackEmpty') }}</span>
    </div>
  </section>
</template>

<style scoped>
/* Your rack: the most prominent thing, directly under the table, with room for a fixed number of rows of tiles. */
.rack-panel {
  --rows: var(--rack-rows, 2);
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.rack-head {
  height: 1.9rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}
.seg {
  display: inline-flex;
  gap: 0.3rem;
}
.seg button {
  padding-top: 0.15rem;
  padding-bottom: 0.15rem;
}
.rack {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 0.3rem;
  padding: 0.6rem;
  box-sizing: border-box;
  height: calc(var(--rows) * 3.5rem + (var(--rows) - 1) * 0.3rem + 1.4rem);
  overflow-y: auto;
  border-radius: 12px;
  background: linear-gradient(180deg, #5b4527, #46341c);
  border: 1px solid #2c200f;
}
.rack-panel.mine .rack {
  border-color: var(--amber);
}
.rack.target {
  outline: 2px dashed #4aa3ff;
}
</style>
