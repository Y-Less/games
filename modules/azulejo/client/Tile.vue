<script setup>
// One tile, drawn in SVG. Every colour has its own pattern so that colour is never the only clue:
// 0 Cobalt: nested diamonds, 1 Saffron: a sun, 2 Terracotta: a four-petal flower, 3 Verdigris: a lattice, 4 Plum: waves.
// colour -1 is the first-player marker (a golden medallion). `ghost` draws a faint hint of the tile that belongs somewhere.
import { computed } from 'vue';
import { COLOUR_NAMES } from '../rules.js';
import { TILE_STYLE } from './tiles.js';

const props = defineProps({
  colour: { type: Number, required: true },
  size: { type: Number, default: 40 },
  ghost: { type: Boolean, default: false },
});
const style = computed(() => TILE_STYLE[props.colour] ?? TILE_STYLE[0]);
const label = computed(() => (props.colour === -1 ? 'First-player marker' : COLOUR_NAMES[props.colour]));
</script>

<template>
  <svg class="tile" :class="{ ghost }" :width="size" :height="size" viewBox="0 0 40 40" role="img" :aria-label="ghost ? `${label} (place for)` : label">
    <title>{{ label }}</title>
    <template v-if="colour === -1">
      <circle cx="20" cy="20" r="17" :fill="style.base" :stroke="style.dark" stroke-width="2" />
      <circle cx="20" cy="20" r="12.5" fill="none" :stroke="style.dark" stroke-width="1.2" />
      <path d="M20 9.5 L23.2 16.4 L30.6 17.2 L25 22.2 L26.6 29.5 L20 25.8 L13.4 29.5 L15 22.2 L9.4 17.2 L16.8 16.4 Z" :fill="style.dark" />
    </template>
    <template v-else>
      <rect x="2" y="2" width="36" height="36" rx="6" :fill="style.base" :stroke="style.dark" stroke-width="2" />
      <rect x="5" y="5" width="30" height="30" rx="3.5" fill="none" :stroke="style.accent" stroke-width="0.8" opacity="0.55" />
      <g :stroke="style.accent" :fill="'none'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <template v-if="colour === 0">
          <path d="M20 7 L33 20 L20 33 L7 20 Z" />
          <path d="M20 13 L27 20 L20 27 L13 20 Z" />
          <circle cx="20" cy="20" r="2" :fill="style.accent" stroke="none" />
        </template>
        <template v-else-if="colour === 1">
          <circle cx="20" cy="20" r="5.5" :fill="style.accent" stroke="none" />
          <path d="M20 8 V12 M20 28 V32 M8 20 H12 M28 20 H32 M11.5 11.5 L14.3 14.3 M25.7 25.7 L28.5 28.5 M28.5 11.5 L25.7 14.3 M14.3 25.7 L11.5 28.5" />
        </template>
        <template v-else-if="colour === 2">
          <circle cx="14.5" cy="14.5" r="5.2" />
          <circle cx="25.5" cy="14.5" r="5.2" />
          <circle cx="14.5" cy="25.5" r="5.2" />
          <circle cx="25.5" cy="25.5" r="5.2" />
          <circle cx="20" cy="20" r="2" :fill="style.accent" stroke="none" />
        </template>
        <template v-else-if="colour === 3">
          <path d="M6 20 L20 6 M6 32 L32 6 M14 34 L34 14 M26 34 L34 26" />
          <path d="M34 20 L20 6 M34 32 L8 6 M26 34 L6 14 M14 34 L6 26" opacity="0.55" />
        </template>
        <template v-else>
          <path d="M6 13 q3.5 -5 7 0 t7 0 t7 0 t7 0" />
          <path d="M6 21 q3.5 -5 7 0 t7 0 t7 0 t7 0" />
          <path d="M6 29 q3.5 -5 7 0 t7 0 t7 0 t7 0" />
        </template>
      </g>
    </template>
  </svg>
</template>

<style scoped>
.tile {
  display: block;
  flex: none;
  filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.45));
}
.tile.ghost {
  opacity: 0.2;
  filter: none;
}
</style>
