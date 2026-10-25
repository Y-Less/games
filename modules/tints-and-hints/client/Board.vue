<script setup>
// The colour grid. Guesses are drawn as nested rings in each player's colour: dotted for the first round and solid
// for the second. The grid scrolls sideways on a narrow screen so that every square stays easy to tap.
import { computed } from 'vue';
import { COLS, ROWS, cellColour } from '../grid.js';

const props = defineProps({
  guesses: { type: Array, default: () => [] },
  players: { type: Array, default: () => [] },
  target: { type: String, default: null },
  selected: { type: String, default: null },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['pick']);

const byId = computed(() => new Map(props.players.map((p) => [p.id, p])));
const markers = computed(() => {
  const map = {};
  for (const g of props.guesses) (map[g.cell] ??= []).push({ ...g, colour: byId.value.get(g.id)?.colour ?? '#fff', name: byId.value.get(g.id)?.name ?? '' });
  return map;
});
const label = (cell) => {
  const here = markers.value[cell] ?? [];
  return [cell, props.target === cell ? 'the tint' : '', ...here.map((m) => `${m.name} round ${m.round}`)].filter(Boolean).join(', ');
};
</script>

<template>
  <div class="scroller">
    <div class="board" role="group" aria-label="Colour grid">
      <span class="head" />
      <span v-for="c in COLS" :key="c" class="head">{{ c }}</span>
      <template v-for="r in ROWS" :key="r">
        <span class="head">{{ r }}</span>
        <button
          v-for="c in COLS"
          :key="c + r"
          class="cell"
          :class="{ selected: selected === c + r, target: target === c + r }"
          :style="{ background: cellColour(c + r) }"
          :disabled="disabled"
          :aria-label="label(c + r)"
          :title="label(c + r)"
          @click="emit('pick', c + r)"
        >
          <span
            v-for="(m, i) in markers[c + r]"
            :key="m.id + '-' + m.round"
            class="ring"
            :class="m.round === 1 ? 'first' : 'second'"
            :style="{ inset: `${2 + i * 4}px`, borderColor: m.colour }"
          />
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.scroller {
  overflow-x: auto;
  padding-bottom: 0.4rem;
}
.board {
  --cell: 28px;
  display: grid;
  grid-template-columns: 1.2rem repeat(24, minmax(var(--cell), 1fr));
  gap: 1px;
  min-width: max-content;
  width: 100%;
}
.head {
  display: grid;
  place-items: center;
  font-size: 0.75rem;
  color: var(--muted);
}
.cell {
  position: relative;
  aspect-ratio: 1;
  min-width: var(--cell);
  padding: 0;
  border: 0;
  border-radius: 3px;
}
.cell:hover:not(:disabled) {
  filter: brightness(1.15);
}
.cell:disabled {
  opacity: 1;
  cursor: default;
}
.cell.selected {
  outline: 3px solid var(--amber);
  outline-offset: -2px;
  z-index: 2;
}
.cell.target::after {
  content: '\2605';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 1.1rem;
  color: #fff;
  text-shadow: 0 0 3px #000, 0 0 3px #000;
}
.ring {
  position: absolute;
  border-width: 3px;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.7), inset 0 0 0 1px rgb(0 0 0 / 0.7);
}
.ring.first {
  border-style: dotted;
}
.ring.second {
  border-style: solid;
}
</style>
