<script setup>
// A window: four rows of five spaces showing each space's restriction (a tinted colour with its shape, or faint pips)
// and the dice placed on it. It can highlight spaces (legal ones, ones to pick) and tell the parent which was clicked.
import Die from './Die.vue';
import { COLOUR_HEX, PIPS, SHAPES, SHAPE_OF, colourOfLetter } from './glyphs.js';

const props = defineProps({
  rows: { type: Array, required: true }, // four strings of five characters
  grid: { type: Array, default: () => Array(20).fill(null) }, // 20 dice or nulls
  cell: { type: Number, default: 64 }, // space size in px
  legal: { type: Array, default: () => [] }, // indexes to highlight as legal
  pick: { type: Array, default: () => [] }, // indexes that can be chosen (e.g. dice to move)
  chosen: { type: Array, default: () => [] }, // indexes shown as selected
  titles: { type: Object, default: () => ({}) }, // index -> explanation shown on hover
  interactive: { type: Boolean, default: false },
  label: { type: String, default: 'Window' },
});
const emit = defineEmits(['cell']);

const char = (i) => props.rows[Math.floor(i / 5)]?.[i % 5] ?? '.';
const colourOf = (i) => colourOfLetter[char(i)] ?? null;
const shadeOf = (i) => (/[1-6]/.test(char(i)) ? Number(char(i)) : null);
const classes = (i) => ({
  legal: props.legal.includes(i),
  pick: props.pick.includes(i),
  chosen: props.chosen.includes(i),
  filled: Boolean(props.grid[i]),
  coloured: Boolean(colourOf(i)),
  shaded: Boolean(shadeOf(i)),
});
const describe = (i) => {
  const wants = colourOf(i) ? `${colourOf(i)} space` : shadeOf(i) ? `space for a ${shadeOf(i)}` : 'blank space';
  return `${wants}, row ${Math.floor(i / 5) + 1}, column ${(i % 5) + 1}${props.grid[i] ? `, holds a ${props.grid[i].c} ${props.grid[i].v}` : ''}`;
};
const press = (i) => emit('cell', i);
</script>

<template>
  <div class="window" :style="{ '--cell': `${cell}px` }" role="group" :aria-label="label">
    <div
      v-for="i in 20"
      :key="i - 1"
      class="space"
      :class="classes(i - 1)"
      :role="interactive ? 'button' : undefined"
      :tabindex="interactive ? 0 : undefined"
      :title="titles[i - 1] ?? undefined"
      :aria-label="describe(i - 1)"
      @click="interactive && press(i - 1)"
      @keydown.enter.prevent="interactive && press(i - 1)"
      @keydown.space.prevent="interactive && press(i - 1)"
    >
      <svg v-if="!grid[i - 1] && (colourOf(i - 1) || shadeOf(i - 1))" class="mark" viewBox="0 0 40 40" aria-hidden="true">
        <template v-if="colourOf(i - 1)">
          <rect x="0" y="0" width="40" height="40" :fill="COLOUR_HEX[colourOf(i - 1)]" fill-opacity="0.32" />
          <path :d="SHAPES[SHAPE_OF[colourOf(i - 1)]]" :fill="COLOUR_HEX[colourOf(i - 1)]" fill-opacity="0.55" :stroke="COLOUR_HEX[colourOf(i - 1)]" stroke-width="1.5" stroke-linejoin="round" />
        </template>
        <template v-else>
          <circle v-for="(pip, k) in PIPS[shadeOf(i - 1)]" :key="k" :cx="pip[0]" :cy="pip[1]" r="3.6" fill="#f1e7d2" fill-opacity="0.5" />
        </template>
      </svg>
      <Die v-if="grid[i - 1]" :die="grid[i - 1]" :size="cell - 8" />
    </div>
  </div>
</template>

<style scoped>
.window {
  display: grid;
  grid-template-columns: repeat(5, var(--cell));
  grid-auto-rows: var(--cell);
  gap: 3px;
  padding: 5px;
  width: max-content;
  border-radius: 10px;
  background: linear-gradient(135deg, #3d5560, #26404b);
  border: 2px solid #5b7885;
  box-shadow: inset 0 0 0 2px rgb(0 0 0 / 0.35);
}
.space {
  position: relative;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: var(--bg-sunken);
  border: 1px solid #3e5a67;
  overflow: hidden;
}
.mark {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.space.legal {
  outline: 3px solid var(--moss);
  outline-offset: -3px;
  background: color-mix(in srgb, var(--moss) 22%, var(--bg-sunken));
}
.space.pick {
  outline: 2px dashed var(--amber);
  outline-offset: -3px;
}
.space.chosen {
  outline: 3px solid var(--amber);
  outline-offset: -3px;
}
.space[role='button'] {
  cursor: pointer;
}
.space[role='button']:hover {
  border-color: var(--amber);
}
.space:focus-visible {
  outline: 2px solid var(--amber);
}
</style>
