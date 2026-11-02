<script setup>
// The nobles column of the market: the nobles still to visit, two to a row.  While you must choose a noble, the ones on
// offer are highlighted and clickable and the rest are dimmed.
// Props: nobles (noble ids still on the table), bonuses (your five card bonuses, for the progress on each tile),
//   choosing (true while you must choose a noble), canPick (function: is this noble one of your choices).
// Emits: pick(id) when a highlighted noble is clicked.  Slots: none.
// Side effects: none.
import { useGameText } from '../../../src/useGameText.js';
import NobleTile from './NobleTile.vue';

defineProps({
  nobles: { type: Array, required: true },
  bonuses: { type: Array, required: true },
  choosing: { type: Boolean, default: false },
  canPick: { type: Function, required: true },
});
defineEmits(['pick']);
const { t } = useGameText();
</script>

<template>
  <div class="nobles" :aria-label="t('table.nobles')">
    <span class="row-title">{{ t('table.nobles') }}</span>
    <div class="noble-row noble-grid" style="grid-template-columns: repeat(2, 5.8em)">
      <NobleTile v-for="n in nobles" :key="n" :noble="n" :bonuses="bonuses" :clickable="canPick(n)" :highlight="canPick(n)" :dimmed="choosing && !canPick(n)" @pick="$emit('pick', n)" />
      <span v-if="!nobles.length" class="muted">{{ t('table.noNobles') }}</span>
    </div>
  </div>
</template>

<style scoped>
.nobles {
  grid-column: span 2;
  display: flex;
  flex-direction: column;
  gap: 0.15em;
}
.row-title {
  font-size: 0.65em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.noble-row {
  display: flex;
  gap: 0.5em;
  flex-wrap: wrap;
  align-items: flex-start;
}
/* Nobles go two to a row (up to six of them in three rows), so the column never grows taller than the cards beside it. */
.nobles > .noble-grid {
  display: grid;
  gap: 0.5em;
  align-content: start;
  grid-auto-rows: 7.8em;
  justify-content: start;
}
/* a noble is never bigger than a development card (5.8em wide) */
.noble-grid :deep(.noble) {
  width: 100%;
  max-width: 5.8em;
  height: 100%;
  justify-content: center;
}
</style>
