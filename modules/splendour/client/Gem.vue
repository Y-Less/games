<script setup>
// One gem drawn in SVG: its own shape and colour. `size` is in pixels at the normal text size (it scales with the em, so the
// whole table can be scaled to the window by changing its font size). With `count` the number is written on the gem (costs, tokens).
import { computed } from 'vue';
import { GEM_FILL, GEM_INK, GEM_NAMES, GEM_SHAPES, GEM_STROKE, SHAPES } from './gems.js';

const props = defineProps({
  colour: { type: Number, required: true }, // 0 to 4, or 5 for Gold
  size: { type: Number, default: 24 },
  count: { type: [Number, String], default: null },
  faded: { type: Boolean, default: false },
});
const shape = computed(() => SHAPES[GEM_SHAPES[props.colour]]);
const label = computed(() => (props.count === null ? GEM_NAMES[props.colour] : `${props.count} ${GEM_NAMES[props.colour]}`));
</script>

<template>
  <svg class="gem" :class="{ faded }" :style="{ width: `${size / 16}em`, height: `${size / 16}em` }" viewBox="0 0 24 24" role="img" :aria-label="label">
    <title>{{ label }}</title>
    <polygon v-if="shape.polygon" :points="shape.polygon" :fill="GEM_FILL[colour]" :stroke="GEM_STROKE[colour]" stroke-width="1.2" stroke-linejoin="round" />
    <path v-else :d="shape.outline" :fill="GEM_FILL[colour]" :stroke="GEM_STROKE[colour]" stroke-width="1.2" stroke-linejoin="round" />
    <path :d="shape.facet" fill="#fff" opacity="0.28" />
    <text v-if="count !== null" x="12" y="12.2" text-anchor="middle" dominant-baseline="central" :fill="GEM_INK[colour]" class="num">{{ count }}</text>
  </svg>
</template>

<style scoped>
.gem {
  display: inline-block;
  flex: none;
  filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.5));
}
.gem.faded {
  opacity: 0.35;
}
.num {
  font: 700 11.5px var(--body);
  paint-order: stroke;
}
</style>
