<script setup>
// The Wavelength dial: a half circle between two opposites. Drag on it (or use the slider under it, which also works
// with a keyboard) to turn the needle. When the target is known it is drawn as three bands; at the reveal every
// guess is drawn as a marker in its player's colour. Sized by the `width` it is given, never by what it shows.
import { computed, ref } from 'vue';
import { VIEW, clampPosition, pointAt, positionAt, targetWedges, wedgePath } from './dial.js';

const props = defineProps({
  left: { type: String, default: '' },
  right: { type: String, default: '' },
  target: { type: Number, default: null }, // null: hidden
  bands: { type: Array, default: () => [] }, // [{ within, points }]
  guesses: { type: Array, default: () => [] }, // [{ id, position, colour, name }], drawn as markers
  selected: { type: Number, default: null }, // the needle of the person turning the dial
  colour: { type: String, default: '#ffd400' }, // the needle's colour
  interactive: { type: Boolean, default: false },
  width: { type: Number, default: 440 },
  reserveSlider: { type: Boolean, default: true }, // keep the slider's room under a dial that is not being turned
});
const emit = defineEmits(['pick']);

const svg = ref(null);
const dragging = ref(false);
const height = computed(() => Math.round((props.width * VIEW.height) / VIEW.width));
const wedges = computed(() => (props.target === null ? [] : targetWedges(props.target, props.bands)));
// The points of each band, written on the left half of that band (the middle band is the bullseye in the centre).
const bandLabels = computed(() => {
  if (props.target === null) return [];
  let inner = 0;
  return [...props.bands].sort((a, b) => a.within - b.within).map((band) => {
    const at = pointAt(clampPosition(props.target - (inner + band.within) / 2), VIEW.radius - 7);
    inner = band.within;
    return { points: band.points, x: at.x, y: at.y + 2.5 };
  });
});
// The ends are big and bold, and grow with the dial (never with what they say, so nothing moves from turn to turn).
const endSize = computed(() => Math.round(Math.min(24, Math.max(17, props.width / 18))));
const needle = computed(() => (props.selected === null ? null : pointAt(props.selected, VIEW.radius - 4)));
const pins = computed(() => props.guesses.map((g) => ({ ...g, tip: pointAt(g.position, VIEW.radius), base: pointAt(g.position, VIEW.radius - 22) })));

function turnTo(event) {
  if (!props.interactive || !svg.value) return;
  const box = svg.value.getBoundingClientRect();
  if (!box.width) return;
  const x = ((event.clientX - box.left) * VIEW.width) / box.width;
  const y = ((event.clientY - box.top) * VIEW.height) / box.height;
  emit('pick', positionAt(x, y));
}
function down(event) {
  if (!props.interactive) return;
  dragging.value = true;
  svg.value.setPointerCapture?.(event.pointerId);
  turnTo(event);
}
const move = (event) => dragging.value && turnTo(event);
const up = (event) => {
  dragging.value = false;
  svg.value?.releasePointerCapture?.(event.pointerId);
};
</script>

<template>
  <div class="dial" :style="{ width: `${width}px` }">
    <svg
      ref="svg"
      class="face"
      :class="{ interactive }"
      :viewBox="`0 0 ${VIEW.width} ${VIEW.height}`"
      :width="width"
      :height="height"
      role="img"
      :aria-label="`A dial from ${left} to ${right}`"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <path class="plate" :d="wedgePath(0, 100)" />
      <path v-for="w in wedges" :key="w.points" class="wedge" :class="`w${w.points}`" :d="wedgePath(w.from, w.to)" />
      <text v-for="l in bandLabels" :key="`t${l.points}`" class="band-label" :x="l.x" :y="l.y">{{ l.points }}</text>
      <path class="rim" :d="`M ${pointAt(0).x} ${pointAt(0).y} A ${VIEW.radius} ${VIEW.radius} 0 0 1 ${pointAt(100).x} ${pointAt(100).y}`" />
      <g v-for="p in pins" :key="p.id" class="pin">
        <title>{{ p.name }}</title>
        <line :x1="VIEW.cx" :y1="VIEW.cy" :x2="p.base.x" :y2="p.base.y" :stroke="p.colour" class="spoke" />
        <circle :cx="p.tip.x" :cy="p.tip.y" r="5.5" :fill="p.colour" class="knob" />
      </g>
      <g v-if="needle" class="needle">
        <line :x1="VIEW.cx" :y1="VIEW.cy" :x2="needle.x" :y2="needle.y" :stroke="colour" />
        <circle :cx="needle.x" :cy="needle.y" r="6" :fill="colour" />
      </g>
      <circle class="hub" :cx="VIEW.cx" :cy="VIEW.cy" r="7" />
    </svg>
    <div class="ends" :style="{ fontSize: `${endSize}px` }">
      <span class="end left">{{ left }}</span>
      <span class="end right">{{ right }}</span>
    </div>
    <input
      v-if="interactive || reserveSlider"
      class="slider"
      :class="{ idle: !interactive }"
      :disabled="!interactive"
      type="range"
      min="0"
      max="100"
      step="0.5"
      :value="selected ?? 50"
      :aria-label="`Turn the dial from ${left} to ${right}`"
      @input="emit('pick', clampPosition($event.target.valueAsNumber))"
    />
  </div>
</template>

<style scoped>
.dial {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-width: 100%;
}
.face {
  display: block;
  touch-action: none;
  user-select: none;
  overflow: visible;
}
.face.interactive {
  cursor: pointer;
}
.plate {
  fill: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  stroke: none;
}
.wedge.w2 {
  fill: color-mix(in srgb, var(--amber) 40%, transparent);
}
.wedge.w3 {
  fill: color-mix(in srgb, var(--amber) 70%, transparent);
}
.wedge.w4 {
  fill: var(--moss);
}
.band-label {
  font-size: 7px;
  font-weight: 700;
  text-anchor: middle;
  fill: #10200f;
  pointer-events: none;
}
.rim {
  fill: none;
  stroke: var(--parchment);
  stroke-width: 2;
}
.spoke {
  stroke-width: 1.4;
  opacity: 0.85;
}
.knob {
  stroke: var(--parchment);
  stroke-width: 1.5;
}
.needle line {
  stroke-width: 3;
  stroke-linecap: round;
}
.needle circle {
  stroke: var(--parchment);
  stroke-width: 2;
}
.hub {
  fill: var(--parchment);
}
.ends {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 0.6em;
  min-height: 2.75em; /* room for two lines, so a long label never changes the height */
  line-height: 1.1;
}
.end {
  display: flex;
  align-items: center;
  max-width: 48%;
  padding: 0.25em 0.7em;
  border-radius: 999px;
  font-weight: 800;
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
  color: #10200f;
}
.end.left {
  background: #5fc1e8;
  text-align: left;
}
.end.right {
  background: #ee8a5e;
  text-align: right;
  margin-left: auto;
}
.slider {
  width: 100%;
  accent-color: var(--amber);
}
.slider.idle {
  visibility: hidden; /* keeps its room, so the dial never changes size */
}
</style>
