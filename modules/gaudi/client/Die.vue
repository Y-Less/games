<script setup>
// One die: a coloured glass square with its pips, and a shape behind them that is different for every colour so the
// colours can be told apart without seeing them.
import { computed } from 'vue';
import { COLOUR_HEX, COLOUR_INK, COLOUR_LABEL, PIPS, SHAPES, SHAPE_OF } from './glyphs.js';

const props = defineProps({
  die: { type: Object, required: true }, // { c, v }
  size: { type: Number, default: 44 },
});
const hex = computed(() => COLOUR_HEX[props.die.c] ?? '#888');
const ink = computed(() => COLOUR_INK[props.die.c] ?? '#fff');
const shape = computed(() => SHAPES[SHAPE_OF[props.die.c]]);
const label = computed(() => `${COLOUR_LABEL[props.die.c]} ${props.die.v}`);
</script>

<template>
  <svg class="die" viewBox="0 0 40 40" :width="size" :height="size" role="img" :aria-label="label">
    <title>{{ label }}</title>
    <defs>
      <linearGradient :id="`g-${die.c}`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.35" />
        <stop offset="0.5" stop-color="#fff" stop-opacity="0" />
        <stop offset="1" stop-color="#000" stop-opacity="0.25" />
      </linearGradient>
    </defs>
    <rect x="1.5" y="1.5" width="37" height="37" rx="7" :fill="hex" />
    <rect x="1.5" y="1.5" width="37" height="37" rx="7" :fill="`url(#g-${die.c})`" stroke="rgb(0 0 0 / 0.55)" stroke-width="1.5" />
    <path :d="shape" fill="none" :stroke="ink" stroke-opacity="0.55" stroke-width="1.6" stroke-linejoin="round" />
    <circle v-for="(pip, i) in PIPS[die.v] ?? []" :key="i" :cx="pip[0]" :cy="pip[1]" r="3.3" :fill="ink" />
  </svg>
</template>

<style scoped>
.die {
  display: block;
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.45));
}
</style>
