<script setup>
// The spinner: a pie of the categories, each wedge as wide as that category has questions, with a pointer at the top.
// The server has already decided where it stops and told everybody the same angle, so every table watches the same
// wheel land on the same wedge; all this does is turn it there.
// Props: wheel (the slices), spin ({ category, angle } or null), left (milliseconds it is still turning, or null),
//   size (how wide to draw it, in pixels).
// Emits: none.  Slots: none.
// Side effects: a watcher runs the turn as an animation each time a new spin arrives.
//
// **Why the turn is an animation and not a transition.**  A wheel that does not turn is a wheel that tells you
// nothing, and the site stops every CSS transition when the device asks for less motion (src/style.css), which no
// per-element rule can undo.  So the turn is played with the Web Animations API, which that rule does not reach, and
// is asked for only when `animationsPlaying()` says this player wants motion - their Profile choice first, and the
// device's own setting when they have not made one.  A player who wants none sees the wheel already on its wedge.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { animationsPlaying } from '../../../src/appearance.js';
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
/** A wedge narrower than this (degrees) has no room for its name across it. */
const LABEL_WIDTH = 10;
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
    const down = slice.from + wide / 2; // the line from the middle of the wheel out through the middle of the wedge
    // One category with everything is a circle, which an arc cannot draw; everything else is a wedge.
    const path = wide >= 359.9 ? wholePath() : wedgePath(from, to, wide);
    // The name lies along that line, reading outwards: level at three o'clock, upside down at nine (see `tilt`).
    return { category: slice.category, path, colour: COLOURS[CATEGORY_ORDER.indexOf(slice.category)] ?? COLOURS[0], label: wide >= LABEL_WIDTH, at: edge(down, RADIUS * LABEL_AT), tilt: down - 90 };
  }),
);

/** How the wheel slows as it comes to rest. */
const EASING = 'cubic-bezier(0.16, 0.68, 0.18, 1)';

// Where the wheel is resting, in degrees: every spin adds whole turns, so it only ever goes forwards.
const rotation = ref(0);
const turn = ref(null); // the group the wheel is drawn in, which is what actually turns
let spun = 0;
let was = 0; // the rotation the next turn starts from
let playing = null; // the turn that is running, so a new one can replace it

/**
 * Plays the turn from where the wheel was to where it now rests.  It is asked for after the group has been drawn, so
 * that there is something to animate; a browser without the Web Animations API, or a player who wants no motion,
 * simply finds the wheel already on its wedge.
 *
 * @param {number} from  the rotation it starts from, in degrees
 * @param {number} to  the rotation it comes to rest at, in degrees
 * @param {number} takes  how long it should take, in milliseconds
 * @returns {void}
 * Side effects: cancels any turn already running and starts one on the group.
 */
function play(from, to, takes) {
  const group = turn.value;
  if (!group || typeof group.animate !== 'function' || !animationsPlaying()) return;
  playing?.cancel();
  playing = group.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], { duration: takes, easing: EASING });
}

/**
 * Sets the wheel turning to where this spin stops.
 *
 * @param {string} angle  where the wheel comes to rest, in degrees
 * @returns {void}
 * Side effects: moves the wheel to its resting place and, once it has been drawn there, plays the turn.
 */
function turnTo(angle) {
  spun++;
  const from = was;
  const target = spun * TURNS * 360 + Number(angle);
  was = target;
  rotation.value = target;
  const takes = Math.max(200, props.left ?? 0);
  nextTick(() => play(from, target, takes));
}

watch(
  () => (props.spin ? `${props.spin.angle}` : null),
  (angle, before) => {
    if (angle === null || angle === before) return;
    turnTo(angle);
  },
  { immediate: true },
);
onBeforeUnmount(() => playing?.cancel());

// The style of the turning group: where it has come to rest.  The turn itself is played over the top of this (see play).
const spinStyle = computed(() => ({ transform: `rotate(${rotation.value}deg)` }));
/**
 * Where one wedge's name goes: out along the middle of the wedge, lying on that line.  It is fixed in the wheel's own
 * coordinates, so the name simply rides round with its wedge and needs no turning of its own.
 *
 * @param {{ at: { x: number, y: number }, tilt: number }} wedge  where the name sits, and how far over it lies
 * @returns {string} the SVG transform
 * Side effects: none.
 */
const labelAt = (wedge) => `translate(${wedge.at.x} ${wedge.at.y}) rotate(${wedge.tilt})`;
</script>

<template>
  <div class="wheel" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg viewBox="0 0 100 100" role="img" :aria-label="t('wheel.label')">
      <g ref="turn" class="turn" :style="spinStyle">
        <path v-for="wedge in wedges" :key="wedge.category" :d="wedge.path" :fill="wedge.colour" stroke="#101010" stroke-width="0.8" />
        <g v-for="wedge in wedges.filter((w) => w.label)" :key="`${wedge.category}-name`" :transform="labelAt(wedge)">
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
.turn {
  transform-box: view-box; /* the wheel turns about the middle of the drawing, not of its own bounding box */
  transform-origin: 50px 50px;
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
/* A device asking for less motion stops the turn: src/style.css does that for every transition on the site. */
</style>
