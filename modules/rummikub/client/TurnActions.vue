<script setup>
// The New set area and the four turn buttons (Undo, Reset turn, Draw a tile or Pass, End turn): always in the same place,
// beside the rack.
// Props: myTurn, targeting (tiles are selected, so the New set area is a target), canUndo, changed (the layout differs from
//   the start of the turn), busy (a request is on its way), poolCount (tiles left in the pool), canEnd (the layout is valid).
// Slots: none.
// Emits: drop-selected(target), drop-tiles(target), undo, reset, draw, and end.
// Side effects: none beyond the emits.
import { useGameText } from '../../../src/useGameText.js';

defineProps({
  myTurn: { type: Boolean, default: false },
  targeting: { type: Boolean, default: false },
  canUndo: { type: Boolean, default: false },
  changed: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  poolCount: { type: Number, default: 0 },
  canEnd: { type: Boolean, default: false },
});
defineEmits(['drop-selected', 'drop-tiles', 'undo', 'reset', 'draw', 'end']);
const { t } = useGameText();
</script>

<template>
  <div class="actions">
    <div
      class="set new"
      :class="{ target: targeting && myTurn, idle: !myTurn }"
      role="button"
      :tabindex="myTurn ? 0 : -1"
      :aria-disabled="myTurn ? undefined : 'true'"
      :aria-label="t('table.newSet')"
      @click="$emit('drop-selected', { type: 'new' })"
      @keydown.enter.prevent="$emit('drop-selected', { type: 'new' })"
      @keydown.space.prevent="$emit('drop-selected', { type: 'new' })"
      @dragover.prevent
      @drop.prevent="$emit('drop-tiles', { type: 'new' })"
    >
      <span class="muted">{{ t('table.newSetDrop') }}</span>
    </div>
    <div class="buttons">
      <button :disabled="!myTurn || !canUndo" @click="$emit('undo')">{{ $t('common.undo') }}</button>
      <button :disabled="!myTurn || !changed" @click="$emit('reset')">{{ t('table.resetTurn') }}</button>
      <button :disabled="!myTurn || busy" :title="poolCount ? t('table.drawTitle') : t('table.passTitle')" @click="$emit('draw')">
        {{ poolCount ? t('table.draw') : t('table.pass') }}
      </button>
      <button class="primary" :disabled="!canEnd" @click="$emit('end')">{{ t('table.endTurn') }}</button>
    </div>
  </div>
</template>

<style scoped>
/* The New set area and the four turn buttons: always in the same place, beside the rack. */
.actions {
  grid-column: span 3;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: calc(1.9rem + 0.4rem); /* level with the rack, not with its heading */
}
/* the look of a set (as on the table), as a dashed drop area */
.set {
  display: grid;
  gap: 0.25rem;
  padding: 0.45rem 0.5rem 0.3rem;
  border-radius: 12px;
  max-width: 100%;
}
.set.new {
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  text-align: center;
  border: 2px dashed rgb(241 231 210 / 0.4);
  background: none;
  cursor: pointer;
}
.set.new.idle {
  cursor: default;
  opacity: 0.55;
}
.set.new.target {
  border-color: #4aa3ff;
}
.buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.buttons button {
  height: 2.4rem;
  padding: 0 0.5rem;
  white-space: nowrap;
}
</style>
