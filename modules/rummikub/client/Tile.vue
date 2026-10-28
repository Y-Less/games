<script setup>
// One Rummikub tile: the number in the colour's hue with the colour's own shape beneath it. A wildcard is a dark tile with a
// star-burst. It is a span with the button role, not a <button>, because Firefox will not start a drag from a button.
// `stands` (for a wildcard inside a set) shows what the wildcard has been worked out to stand for.
import { computed } from 'vue';
import { tileOf } from '../rules.js';
import { SHAPES, colourInfo } from './colours.js';

const props = defineProps({
  settings: { type: Object, required: true }, // numbers, colours, wildcards
  id: { type: Number, required: true },
  size: { type: String, default: 'md' }, // sm | md
  selected: { type: Boolean, default: false },
  fresh: { type: Boolean, default: false }, // played from the rack this turn
  recent: { type: Boolean, default: false }, // played by the last player
  drawn: { type: Boolean, default: false }, // drawn from the pool, until its owner's next turn
  locked: { type: Boolean, default: false },
  stands: { type: Object, default: null }, // { number, colour } for a wildcard
  interactive: { type: Boolean, default: true },
});

const tile = computed(() => tileOf(props.settings, props.id));
const info = computed(() => (tile.value.joker ? null : colourInfo(tile.value.colour)));
const shape = computed(() => (info.value ? SHAPES[info.value.shape] : null));
const label = computed(() => {
  if (tile.value.joker) return props.stands ? `Wildcard standing for ${props.stands.number}` : 'Wildcard';
  return `${info.value.name} ${tile.value.number}`;
});
</script>

<template>
  <span
    class="tile"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive ? 0 : undefined"
    @keydown.enter.prevent="interactive && $event.currentTarget.click()"
    @keydown.space.prevent="interactive && $event.currentTarget.click()"
    :class="[size, { selected, fresh, recent, drawn, locked, joker: tile.joker }]"
    :style="info ? { '--hue': info.hue } : undefined"
    :draggable="interactive && !locked"
    :aria-label="label"
    :aria-pressed="interactive ? selected : undefined"
    :title="label"
    :data-id="id"
  >
    <template v-if="tile.joker">
      <svg class="burst" viewBox="0 0 12 12" aria-hidden="true">
        <polygon points="6,0.4 7.3,4.1 11.2,3.2 8.5,6 11.2,8.8 7.3,7.9 6,11.6 4.7,7.9 0.8,8.8 3.5,6 0.8,3.2 4.7,4.1" />
      </svg>
      <span v-if="stands" class="as">{{ stands.number }}</span>
    </template>
    <template v-else>
      <span class="num">{{ tile.number }}</span>
      <svg class="shape" viewBox="0 0 12 12" aria-hidden="true">
        <circle v-if="shape.circle" :cx="shape.circle[0]" :cy="shape.circle[1]" :r="shape.circle[2]" />
        <rect v-else-if="shape.rect" :x="shape.rect[0]" :y="shape.rect[1]" :width="shape.rect[2]" :height="shape.rect[3]" rx="1" />
        <polygon v-else :points="shape.points" />
      </svg>
    </template>
  </span>
</template>

<style scoped>
.tile {
  --hue: #444;
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.05em;
  flex: none;
  width: 2.7rem;
  height: 3.5rem;
  padding: 0;
  border-radius: 7px;
  border: 1px solid #b7a98a;
  border-bottom-width: 3px;
  background: linear-gradient(180deg, #fbf5e6, #efe3c8);
  color: var(--hue);
  font-family: var(--display);
  font-weight: 700;
  font-size: 1.45rem;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.4);
}
.tile:hover:not(:disabled) {
  background: linear-gradient(180deg, #fffaf0, #f5ead0);
  border-color: #b7a98a;
}
.tile.sm {
  width: 2.15rem;
  height: 2.8rem;
  font-size: 1.15rem;
}
.tile:not([role='button']) {
  cursor: default;
}
.shape {
  width: 0.62em;
  height: 0.62em;
  fill: var(--hue);
}
.joker {
  background: linear-gradient(180deg, #3c2f4f, #241a35);
  border-color: #170f23;
  color: #f4d27a;
}
.joker:hover:not(:disabled) {
  background: linear-gradient(180deg, #46375c, #2a1f3d);
}
.burst {
  width: 1.15em;
  height: 1.15em;
  fill: #f4d27a;
}
.as {
  font-size: 0.55em;
  color: #e9dcc0;
}
.fresh {
  outline: 3px solid var(--amber);
  outline-offset: 1px;
}
.recent {
  box-shadow: 0 0 0 2px var(--moss), 0 1px 2px rgb(0 0 0 / 0.4);
}
/* The tile you drew: a warm glow and a "new" tag, so it can be found in the rack until your next turn. */
.drawn {
  box-shadow: 0 0 0 2px #fff7d6, 0 0 0.5rem 0.1rem var(--amber);
}
.drawn::after {
  content: 'new';
  position: absolute;
  top: -0.5rem;
  right: -0.4rem;
  padding: 0 0.3rem;
  border-radius: 0.5rem;
  background: var(--amber);
  color: #2b2110;
  font-family: var(--body, inherit);
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1rem;
  text-transform: uppercase;
  pointer-events: none;
}
.selected {
  transform: translateY(-5px);
  outline: 3px solid #4aa3ff;
  outline-offset: 1px;
}
.locked {
  filter: saturate(0.75);
}
</style>
