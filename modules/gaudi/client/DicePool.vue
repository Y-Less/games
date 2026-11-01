<script setup>
// The draft pool: the dice still to be taken this round, as a grid of buttons. The room kept for it is fixed (enough rows for
// the biggest possible pool), so nothing moves as dice are taken.
// Props: pool (dice from the view), chosenIds (ids drawn as chosen), perRow (dice in a row), minHeight (px), dieSize (px).
// Emits: pick (die) when a die is clicked or Enter is pressed. Side effects: none.
import Die from './Die.vue';
import { colourName } from './wording.js';

defineProps({
  pool: { type: Array, required: true },
  chosenIds: { type: Array, default: () => [] },
  perRow: { type: Number, required: true },
  minHeight: { type: Number, required: true },
  dieSize: { type: Number, required: true },
});
const emit = defineEmits(['pick']);
</script>

<template>
  <div class="pool" role="group" aria-label="Draft pool" :style="{ gridTemplateColumns: `repeat(${perRow}, auto)`, minHeight: `${minHeight}px` }">
    <div
      v-for="d in pool"
      :key="d.id"
      class="pool-die"
      :class="{ chosen: chosenIds.includes(d.id) }"
      role="button"
      tabindex="0"
      :aria-label="`${colourName(d.c)} ${d.v}`"
      @click="emit('pick', d)"
      @keydown.enter.prevent="emit('pick', d)"
    >
      <Die :die="d" :size="dieSize" />
    </div>
  </div>
</template>

<style scoped>
.pool {
  display: grid;
  justify-content: start;
  align-content: start;
  gap: 4px 6px;
}
.pool-die {
  padding: 3px;
  border-radius: 10px;
  border: 2px solid transparent;
  cursor: pointer;
  line-height: 0;
}
.pool-die:hover {
  border-color: #5b7885;
}
.pool-die.chosen {
  border-color: var(--amber);
  background: color-mix(in srgb, var(--amber) 22%, transparent);
}
</style>
