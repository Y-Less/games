<script setup>
// The spinner: a pie of the categories, each wedge as wide as that category has questions, with a pointer at the top.
// The server has already decided where it stops and told everybody the same angle, so every table watches the same
// wheel land on the same wedge; all this does is turn it there.
// Props: wheel (the slices), spin ({ category, angle } or null), left (milliseconds it is still turning, or null),
//   size (how wide to draw it, in pixels).
// Emits: none.  Slots: none.
// Side effects: none beyond a CSS transition (a watcher sets the rotation each time a new spin arrives).
import { computed, ref, watch } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
import { CATEGORY_ORDER, slices } from '../wheel.js';

const props = defineProps({
  wheel: { type: Array, required: true },
  spin: { type: Object, default: null },
  left: { type: Number, default: null },
  size: { type: Number, default: 320 },
});
const { t } = useGameText();

/** A colour for each category, in the order of CATEGORY_ORDER, so a category always looks the same. */
const COLOURS = ['#e8743b', '#3b6fe8', '#d94f4f', '#e8c53b', '#2fa05a', '#8a5fd6', '#1fb5c4', '#5a8f2f', '#d6598a', '#b5762f'];
/** How many whole turns the wheel makes before it stops. */
const TURNS = 4;
/** A wedge narrower than this (degrees) has no room for its name. */
const LABEL_WIDTH = 17;
/** The circle the wedges are drawn in, inside a 100 by 100 box. */
const CENTRE = 50;
const RADIUS = 47;
/** How far out from the middle a wedge's name sits, as a share of the radius. */
const LABEL_AT = 0.64;

// Where a point on the rim is, for an angle measured clockwise from the top.
const edge = (degrees, radius = RADIUS) => {
  const turn = ((degrees - 90) * Math.PI) / 180;
  return { x: CENTRE + radius * Math.cos(turn), y: CENTRE + radius * Math.sin(turn) };
};

// The drawing instructions for one wedge, and for the circle a single category makes (an arc cannot draw a whole one).
const wedgePath = (from, to, wide) => ['M', CENTRE, CENTRE, 'L', from.x, from.y, 'A', RADIUS, RADIUS, 0, wide > 180 ? 1 : 0, 1, to.x, to.y, 'Z'].join(' ');
const wholePath = () => ['M', CENTRE, CENTRE - RADIUS, 'A', RADIUS, RADIUS, 0, 1, 1, CENTRE - 0.01, CENTRE - RADIUS, 'Z'].join(' ');

// The wedges, each with the path that draws it, the colour it always has, and where its name goes.
const wedges = computed(() =>
  slices(props.wheel).map((slice) => {
    const from = edge(slice.from);
    const to = edge(slice.to);
    const wide = slice.to - slice.from;
    const middle = edge(slice.from + wide / 2, RADIUS * LABEL_AT);
    // One category with everything is a circle, which an arc cannot draw; everything else is a wedge.
    const path = wide >= 359.9 ? wholePath() : wedgePath(from, to, wide);
    return { category: slice.category, path, colour: COLOURS[CATEGORY_ORDER.indexOf(slice.category)] ?? COLOURS[0], label: wide >= LABEL_WIDTH, at: middle };
  }),
);

// How far the wheel has been turned, in degrees: every spin adds whole turns, so it only ever goes forwards.
const rotation = ref(0);
// How long the turn takes; a page that joins a spin already under way catches it up in whatever is left of it.
const turning = ref(0);
let spun = 0;
watch(
  () => (props.spin ? `${props.spin.angle}` : null),
  (angle, before) => {
    if (angle === null || angle === before) return;
    spun++;
    turning.value = Math.max(200, props.left ?? 0);
    rotation.value = spun * TURNS * 360 + Number(angle);
  },
  { immediate: true },
);

// The style of the turning group: where it is now, and how long it takes to get there.
const spinStyle = computed(() => ({ transform: `rotate(${rotation.value}deg)`, transitionDuration: `${turning.value}ms` }));
/**
 * The style of one wedge's name: carried round with its wedge, but turned back by as much as the wheel has turned, so
 * that it is the right way up wherever the wheel stops.  It is given the same transition as the wheel, so the two
 * stay in step the whole way round.
 *
 * @param {{ at: { x: number, y: number } }} wedge  the wedge, with where its name sits in the wheel's own coordinates
 * @returns {object} the inline style
 * Side effects: none.
 */
const labelStyle = (wedge) => ({ transform: `translate(${wedge.at.x}px, ${wedge.at.y}px) rotate(${-rotation.value}deg)`, transitionDuration: `${turning.value}ms` });
</script>

<template>
  <div class="wheel" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg viewBox="0 0 100 100" role="img" :aria-label="t('wheel.label')">
      <g class="turn" :style="spinStyle">
        <path v-for="wedge in wedges" :key="wedge.category" :d="wedge.path" :fill="wedge.colour" stroke="#101010" stroke-width="0.8" />
        <g v-for="wedge in wedges.filter((w) => w.label)" :key="`${wedge.category}-name`" class="label" :style="labelStyle(wedge)">
          <text text-anchor="middle" dominant-baseline="middle">{{ t(`categoryShort.${wedge.category}`) }}</text>
        </g>
      </g>
      <circle :cx="CENTRE" :cy="CENTRE" r="5" fill="#101010" />
    </svg>
    <div class="pointer" aria-hidden="true" />
  </div>
</template>

<style scoped>
.wheel {
  position: relative;
  max-width: 100%;
}
svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.turn,
.label {
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.16, 0.68, 0.18, 1);
}
.turn {
  transform-origin: 50px 50px;
}
.label {
  transform-origin: 0 0; /* the translate in the style puts it where it goes, so it turns about its own middle */
}
text {
  font-size: 4.6px;
  font-weight: 650;
  fill: #ffffff;
  stroke: rgba(0, 0, 0, 0.55);
  stroke-width: 1.4px;
  paint-order: stroke;
  pointer-events: none;
}
.pointer {
  position: absolute;
  top: -2px;
  left: 50%;
  width: 0;
  height: 0;
  transform: translateX(-50%);
  border-left: 0.75rem solid transparent;
  border-right: 0.75rem solid transparent;
  border-top: 1.4rem solid var(--danger, #d94f4f);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
@media (prefers-reduced-motion: reduce) {
  .turn,
  .label {
    transition-duration: 0ms !important;
  }
}
</style>
