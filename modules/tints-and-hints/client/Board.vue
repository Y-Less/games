<script setup>
// The colour grid. Guesses are drawn as nested rings in each player's colour: dotted for the first round and solid
// for the second. It is drawn at an exact size (`cell`, the side of one square in pixels) so that it fits the room the
// table gives it and never changes size while the game is played.
import { computed } from 'vue';
import { COLS, ROWS, cellColour } from '../grid.js';
import { GAP, HEAD } from './layout.js';

const props = defineProps({
  guesses: { type: Array, default: () => [] },
  players: { type: Array, default: () => [] },
  target: { type: String, default: null },
  selected: { type: String, default: null },
  disabled: { type: Boolean, default: false },
  cell: { type: Number, default: 28 },
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
const style = computed(() => ({
  '--cell': `${props.cell}px`,
  '--head': `${HEAD}px`,
  '--gap': `${GAP}px`,
  '--ring': `${Math.max(2, Math.round(props.cell / 12))}px`,
  '--step': `${Math.max(3, Math.round(props.cell / 8))}px`,
}));
</script>

<template>
  <div class="board" role="group" aria-label="Colour grid" :style="style">
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
          :style="{ inset: `calc(var(--ring) * 0.7 + ${i} * var(--step))`, borderColor: m.colour }"
        />
      </button>
    </template>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: var(--head) repeat(v-bind('COLS.length'), var(--cell));
  grid-template-rows: var(--head) repeat(v-bind('ROWS.length'), var(--cell));
  gap: var(--gap);
  width: max-content;
  height: max-content;
}
.head {
  display: grid;
  place-items: center;
  font-size: 0.72rem;
  color: var(--muted);
}
.cell {
  position: relative;
  width: var(--cell);
  height: var(--cell);
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
  font-size: max(12px, calc(var(--cell) * 0.9));
  color: #fff;
  text-shadow: 0 0 3px #000, 0 0 3px #000;
}
.ring {
  position: absolute;
  border-width: var(--ring);
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
