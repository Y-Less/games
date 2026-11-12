<script setup>
// File: the animated site-background effects (CSS only).  Depends on: Vue only; effect names come from shared/animations.js.
// Props: effect (String, which effect or 'none'), fixed (Boolean, cover the whole site), background (Object|null, the player's
//   background setting, used by the gradient fade), demo (Boolean, shop preview), intensity and speed (Number, percent).
// Emits: none.  Slots: none.
// Side effects: none at runtime; the module-level counter `gains` is bumped once per instance to make a unique SVG filter id.
//   The Matrix columns use a fixed seed, so output is deterministic.
// An animation over the website background (see shared/animations.js): drifting light, stars, snow ... drawn in CSS only.
// `fixed` puts it behind the whole site (App.vue); without it the effect fills its parent box, for the shop's previews.
// It never takes clicks, and it stands still when the player has turned animations off (see style.css).
// `gradient` (the moving fade) slides the gradient from the user's `background` setting; it does nothing for any other kind
// of background, except in a `demo` (the shop's previews), which uses a sample gradient instead.
import { computed } from 'vue';
// Where the letters of the two Matrix rains go: the only part of this file that decides anything, and the only part
// worth testing on its own.  Everything else here is a stylesheet.
import { rain, rainSliding } from '../matrixRain.js';
const props = defineProps({
  effect: { type: String, default: 'none' },
  fixed: { type: Boolean, default: false },
  background: { type: Object, default: null },
  demo: { type: Boolean, default: false },
  intensity: { type: Number, default: 100 }, // percent: how strong the effect looks (the player's own slider; previews ignore it)
  speed: { type: Number, default: 100 }, // percent: how fast it moves (likewise)
});
// Above 100% the effect cannot be more opaque, so the alpha of everything it draws is multiplied instead (an SVG filter).
let gains = 0; // module-wide counter so each instance gets its own filter id
const gainId = `fx-gain-${++gains}`;
const SAMPLE = { from: '#16252d', to: '#7a3e55', angle: 160 };
// The gradient the fade effect slides: the player's own, or a sample in demos; null when there is none (the effect then hides).
const fade = computed(() => (props.background?.type === 'gradient' ? props.background : props.demo ? SAMPLE : null));
// Whether anything is drawn at all.
const shown = computed(() => props.effect && props.effect !== 'none' && (props.effect !== 'gradient' || fade.value));
// Columns for Matrix A (empty for other effects); the count scales with intensity up to 100%.
const slidingColumns = computed(() => (props.effect === 'matrix-a' ? rainSliding(props.demo ? 9 : Math.max(12, Math.round((180 * Math.min(100, props.intensity)) / 100))) : []));
// Columns for the main Matrix (empty for other effects); the count scales with intensity up to 100%.
const columns = computed(() => (props.effect === 'matrix' ? rain(props.demo ? 9 : Math.max(12, Math.round((90 * Math.min(100, props.intensity)) / 100)), props.demo) : []));
// Inline style of the effect's root: gradient colours, speed multiplier, and intensity (opacity, or the gain filter above 100%).
const style = computed(() => {
  const out = {};
  if (props.effect === 'gradient' && fade.value) Object.assign(out, { '--fx-a': fade.value.from, '--fx-b': fade.value.to, '--fx-angle': `${fade.value.angle}deg` });
  if (!props.demo) {
    if (props.speed !== 100) out['--fx-speed'] = (props.speed / 100).toFixed(2);
    if (props.intensity < 100) out.opacity = (props.intensity / 100).toFixed(2);
    if (props.intensity > 100) out.filter = `url(#${gainId})`;
  }
  return out;
});
</script>

<template>
  <div v-if="shown" class="bg-fx" :class="{ fixed, demo }" :data-fx="effect" :style="style" aria-hidden="true">
    <span v-for="(column, i) in columns" :key="i" class="mx" :data-lead="column.lead" :style="column.style">{{ column.text }}</span>
    <span v-for="(column, i) in slidingColumns" :key="i" class="maw" :style="column.wrap"><span class="ma" :class="column.fade" :style="column.style"><i v-for="(letter, k) in column.letters" :key="k" :class="{ head: k === column.letters.length - 1 }" :style="{ opacity: letter.alpha }">{{ letter.ch }}</i></span>
    </span>
    <svg v-if="!demo && intensity > 100" class="gain" width="0" height="0" focusable="false">
      <filter :id="gainId" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="linear" :slope="intensity / 100" /></feComponentTransfer></filter>
    </svg>
  </div>
</template>

<style scoped>
.bg-fx {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
  --fx-speed: 1;
  container-type: size; /* so the rain can fall through exactly this box's height (100cqh), whatever the window or zoom */
  --box: 100cqh;
}
/* In a shop preview the same effect runs faster and in smaller tiles, so a small box shows what it does. */
.bg-fx.demo {
  --fx-speed: 4;
}
.bg-fx.fixed {
  position: fixed;
  z-index: -1;
}
.bg-fx::before,
.bg-fx::after {
  content: '';
  position: absolute;
  inset: 0;
}

/* The user's own gradient, slid along its angle: A to B to A to B, forever, with no jump where it repeats. */
[data-fx='gradient'] {
  --fx-period: max(100vw, 100vh);
}
.bg-fx.demo[data-fx='gradient'] {
  --fx-period: 100px;
}
/* The layer is one period larger on every side and the stripes repeat every period, so sliding it by exactly one period along
   the gradient's angle ends where it began.  Only a transform moves, which every browser animates. */
[data-fx='gradient']::before {
  inset: calc(var(--fx-period) * -1);
  background: repeating-linear-gradient(var(--fx-angle), var(--fx-a) 0, var(--fx-b) calc(var(--fx-period) / 2), var(--fx-a) var(--fx-period));
  animation: fx-gradient calc(24s / var(--fx-speed)) linear infinite;
}
@keyframes fx-gradient {
  to {
    transform: translate(calc(sin(var(--fx-angle)) * var(--fx-period)), calc(cos(var(--fx-angle)) * var(--fx-period) * -1));
  }
}

/* A soft band of light that crosses the page now and then. */
[data-fx='sweep']::before {
  left: -100%;
  width: 300%;
  background: linear-gradient(105deg, transparent 42%, rgb(255 255 255 / 0.1) 50%, transparent 58%);
  animation: fx-sweep calc(12s / var(--fx-speed)) linear infinite;
}
.bg-fx.demo[data-fx='sweep']::before {
  background: linear-gradient(105deg, transparent 42%, rgb(255 255 255 / 0.35) 50%, transparent 58%);
}
@keyframes fx-sweep {
  to {
    transform: translateX(33.3%);
  }
}

/* The dots of the stars, snow and embers are placed as percentages of a tile, so a preview can use smaller tiles. */

/* The drifting effects below (snow, embers, fireflies, rain) move their whole layer with a transform, never by sliding
   `background-position`: that is a paint, and painting the whole window every frame makes the picture tear on some
   machines, which is exactly what a background is not supposed to do.  Embers and fireflies fade at the same time, and
   a layer that is being repainted and faded at once is the worst of it.  The layer is one tile larger on every side and
   the pattern repeats every tile, so moving it by a tile covers the window the whole way and ends where it began.  The
   `gradient` effect above does the same thing for the same reason.  (Rain is already larger than the window, because it
   is turned; it keeps its own `inset`.) */
[data-fx='snow']::before,
[data-fx='snow']::after,
[data-fx='embers']::before,
[data-fx='fireflies']::before,
[data-fx='fireflies']::after {
  inset: calc(var(--tile) * -1);
}

/* Two layers of stars that fade in and out at different speeds. */
[data-fx='stars']::before {
  --tile: 200px;
  background-image: radial-gradient(1.5px 1.5px at 10% 15%, #fff, transparent), radial-gradient(1px 1px at 45% 60%, #cfe6ff, transparent), radial-gradient(1.5px 1.5px at 80% 30%, #fff, transparent),
    radial-gradient(1px 1px at 30% 90%, #fff4cf, transparent);
  background-size: var(--tile) var(--tile);
  animation: fx-twinkle calc(4s / var(--fx-speed)) ease-in-out infinite alternate;
}
[data-fx='stars']::after {
  --tile: 230px;
  background-image: radial-gradient(1px 1px at 17% 39%, #fff, transparent), radial-gradient(2px 2px at 57% 9%, #ffe9b0, transparent), radial-gradient(1px 1px at 78% 70%, #cfe6ff, transparent);
  background-size: var(--tile) var(--tile);
  animation: fx-twinkle calc(6.5s / var(--fx-speed)) ease-in-out calc(-2s / var(--fx-speed)) infinite alternate;
}
.bg-fx.demo[data-fx='stars']::before {
  --tile: 48px;
  background-image: radial-gradient(2px 2px at 10% 15%, #fff, transparent), radial-gradient(1.5px 1.5px at 45% 60%, #cfe6ff, transparent), radial-gradient(2px 2px at 80% 30%, #fff, transparent),
    radial-gradient(1.5px 1.5px at 30% 90%, #fff4cf, transparent);
}
.bg-fx.demo[data-fx='stars']::after {
  --tile: 56px;
  background-image: radial-gradient(1.5px 1.5px at 17% 39%, #fff, transparent), radial-gradient(2.5px 2.5px at 57% 9%, #ffe9b0, transparent), radial-gradient(1.5px 1.5px at 78% 70%, #cfe6ff, transparent);
}
@keyframes fx-twinkle {
  from {
    opacity: 0.1;
  }
  to {
    opacity: 1;
  }
}

/* Snow falling at two speeds. */
[data-fx='snow']::before {
  --tile: 260px;
  background-image: radial-gradient(3px 3px at 12% 15%, rgb(255 255 255 / 0.85), transparent), radial-gradient(2px 2px at 46% 42%, rgb(255 255 255 / 0.7), transparent),
    radial-gradient(3px 3px at 77% 85%, rgb(255 255 255 / 0.8), transparent), radial-gradient(2px 2px at 27% 96%, rgb(255 255 255 / 0.7), transparent);
  background-size: var(--tile) var(--tile);
  animation: fx-fall calc(16s / var(--fx-speed)) linear infinite;
}
[data-fx='snow']::after {
  --tile: 190px;
  background-image: radial-gradient(2px 2px at 31% 32%, rgb(255 255 255 / 0.6), transparent), radial-gradient(1.5px 1.5px at 89% 79%, rgb(255 255 255 / 0.6), transparent),
    radial-gradient(2px 2px at 53% 90%, rgb(255 255 255 / 0.55), transparent);
  background-size: var(--tile) var(--tile);
  animation: fx-fall calc(26s / var(--fx-speed)) linear calc(-7s / var(--fx-speed)) infinite;
}
.bg-fx.demo[data-fx='snow']::before {
  --tile: 52px;
  background-image: radial-gradient(2.5px 2.5px at 12% 15%, rgb(255 255 255 / 0.9), transparent), radial-gradient(2px 2px at 46% 42%, rgb(255 255 255 / 0.8), transparent),
    radial-gradient(2.5px 2.5px at 77% 85%, rgb(255 255 255 / 0.9), transparent), radial-gradient(2px 2px at 27% 96%, rgb(255 255 255 / 0.8), transparent);
}
.bg-fx.demo[data-fx='snow']::after {
  --tile: 38px;
  background-image: radial-gradient(2px 2px at 31% 32%, rgb(255 255 255 / 0.7), transparent), radial-gradient(1.5px 1.5px at 89% 79%, rgb(255 255 255 / 0.7), transparent),
    radial-gradient(2px 2px at 53% 90%, rgb(255 255 255 / 0.65), transparent);
}
@keyframes fx-fall {
  to {
    transform: translate(calc(var(--tile) * 0.15), var(--tile));
  }
}

/* Embers drifting up from below. */
[data-fx='embers']::before {
  --tile: 250px;
  background-image: radial-gradient(2.5px 2.5px at 16% 24%, #ffb35a, transparent), radial-gradient(2px 2px at 56% 60%, #ff7a3d, transparent), radial-gradient(2px 2px at 36% 92%, #ffd07a, transparent),
    radial-gradient(3px 3px at 84% 36%, #ff8f47, transparent);
  background-size: var(--tile) var(--tile);
  animation:
    fx-rise calc(14s / var(--fx-speed)) linear infinite,
    fx-flicker calc(2.2s / var(--fx-speed)) ease-in-out infinite alternate;
}
[data-fx='embers']::after {
  background: linear-gradient(to top, rgb(255 110 40 / 0.12), transparent 35%);
}
.bg-fx.demo[data-fx='embers']::before {
  --tile: 56px;
  background-image: radial-gradient(3px 3px at 16% 24%, #ffb35a, transparent), radial-gradient(2.5px 2.5px at 56% 60%, #ff7a3d, transparent), radial-gradient(2.5px 2.5px at 36% 92%, #ffd07a, transparent),
    radial-gradient(3.5px 3.5px at 84% 36%, #ff8f47, transparent);
}
.bg-fx.demo[data-fx='embers']::after {
  background: linear-gradient(to top, rgb(255 110 40 / 0.3), transparent 50%);
}
@keyframes fx-rise {
  to {
    transform: translate(calc(var(--tile) * -0.12), calc(var(--tile) * -1));
  }
}
@keyframes fx-flicker {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 1;
  }
}

/* Fireflies: soft yellow-green lights that drift slowly across the screen and blink, two layers at different speeds.  The dots
   sit in a tile that slides by exactly one tile, so the drift never jumps where it repeats. */
[data-fx='fireflies']::before {
  --tile: 210px;
  background-image: radial-gradient(4px 4px at 14% 22%, #eaff80, transparent), radial-gradient(3.5px 3.5px at 58% 64%, #c8ff5a, transparent), radial-gradient(4px 4px at 82% 30%, #f3ff9a, transparent),
    radial-gradient(3px 3px at 33% 88%, #d9ff6a, transparent);
  background-size: var(--tile) var(--tile);
  filter: drop-shadow(0 0 6px #d6ff5a);
  animation:
    fx-drift calc(48s / var(--fx-speed)) linear infinite,
    fx-blink calc(3.4s / var(--fx-speed)) ease-in-out infinite alternate;
}
[data-fx='fireflies']::after {
  --tile: 270px;
  background-image: radial-gradient(3.5px 3.5px at 25% 40%, #f3ff9a, transparent), radial-gradient(4px 4px at 71% 12%, #d6ff5a, transparent), radial-gradient(3px 3px at 48% 76%, #eaff80, transparent),
    radial-gradient(3.5px 3.5px at 90% 82%, #c8ff5a, transparent);
  background-size: var(--tile) var(--tile);
  filter: drop-shadow(0 0 6px #d6ff5a);
  animation:
    fx-drift-back calc(70s / var(--fx-speed)) linear infinite,
    fx-blink calc(5.1s / var(--fx-speed)) ease-in-out calc(-2s / var(--fx-speed)) infinite alternate;
}
.bg-fx.demo[data-fx='fireflies']::before {
  --tile: 60px;
  background-image: radial-gradient(3.5px 3.5px at 14% 22%, #eaff80, transparent), radial-gradient(3px 3px at 58% 64%, #c8ff5a, transparent), radial-gradient(3.5px 3.5px at 82% 30%, #f3ff9a, transparent),
    radial-gradient(2.5px 2.5px at 33% 88%, #d9ff6a, transparent);
}
.bg-fx.demo[data-fx='fireflies']::after {
  --tile: 76px;
  background-image: radial-gradient(3px 3px at 25% 40%, #f3ff9a, transparent), radial-gradient(3.5px 3.5px at 71% 12%, #d6ff5a, transparent), radial-gradient(2.5px 2.5px at 48% 76%, #eaff80, transparent),
    radial-gradient(3px 3px at 90% 82%, #c8ff5a, transparent);
}
@keyframes fx-drift {
  to {
    transform: translate(var(--tile), calc(var(--tile) * -1));
  }
}
@keyframes fx-drift-back {
  to {
    transform: translate(calc(var(--tile) * -1), var(--tile));
  }
}
@keyframes fx-blink {
  from {
    opacity: 0.15;
  }
  to {
    opacity: 1;
  }
}

/* Rain: thin slanted drops falling fast, two layers at different speeds.  The layer is turned a little and made larger than the
   screen, so the drops lean and still reach every corner. */
[data-fx='rain']::before,
[data-fx='rain']::after {
  /* A quarter of the window over each edge for the turn, and a tile more for the fall (see the note above the snow). */
  inset: calc(-25% - var(--tile));
  transform: rotate(12deg);
  background-repeat: repeat;
}
[data-fx='rain']::before {
  --tile: 220px;
  background-image: radial-gradient(1px 16px at 12% 20%, rgb(205 225 255 / 0.55), transparent), radial-gradient(1px 12px at 47% 68%, rgb(205 225 255 / 0.45), transparent),
    radial-gradient(1px 18px at 83% 40%, rgb(205 225 255 / 0.5), transparent);
  background-size: var(--tile) var(--tile);
  animation: fx-pour calc(1.1s / var(--fx-speed)) linear infinite;
}
[data-fx='rain']::after {
  --tile: 160px;
  background-image: radial-gradient(1px 10px at 30% 35%, rgb(205 225 255 / 0.35), transparent), radial-gradient(1px 14px at 72% 82%, rgb(205 225 255 / 0.4), transparent),
    radial-gradient(1px 9px at 92% 12%, rgb(205 225 255 / 0.3), transparent);
  background-size: var(--tile) var(--tile);
  animation: fx-pour calc(1.7s / var(--fx-speed)) linear calc(-0.6s / var(--fx-speed)) infinite;
}
.bg-fx.demo[data-fx='rain']::before {
  --tile: 48px;
  background-image: radial-gradient(1.5px 9px at 12% 20%, rgb(205 225 255 / 0.9), transparent), radial-gradient(1.5px 7px at 47% 68%, rgb(205 225 255 / 0.8), transparent),
    radial-gradient(1.5px 10px at 83% 40%, rgb(205 225 255 / 0.85), transparent);
}
.bg-fx.demo[data-fx='rain']::after {
  --tile: 36px;
  background-image: radial-gradient(1.5px 6px at 30% 35%, rgb(205 225 255 / 0.7), transparent), radial-gradient(1.5px 8px at 72% 82%, rgb(205 225 255 / 0.75), transparent),
    radial-gradient(1.5px 5px at 92% 12%, rgb(205 225 255 / 0.6), transparent);
}
/* The turn is repeated in both frames: a transform animation replaces the one on the rule, so the rain would straighten
   up without it, and the drops have to fall along their own slant rather than straight down the window. */
@keyframes fx-pour {
  from {
    transform: rotate(12deg) translateY(0);
  }
  to {
    transform: rotate(12deg) translateY(var(--tile));
  }
}

/* Slow ribbons of green, blue, and pink light. */
[data-fx='aurora']::before {
  inset: -25%;
  background: radial-gradient(40% 28% at 30% 22%, rgb(80 255 170 / 0.3), transparent), radial-gradient(36% 30% at 72% 30%, rgb(120 130 255 / 0.28), transparent),
    radial-gradient(30% 24% at 50% 10%, rgb(255 120 200 / 0.2), transparent);
  filter: blur(18px);
  animation: fx-aurora calc(18s / var(--fx-speed)) ease-in-out infinite alternate;
}
.bg-fx.demo[data-fx='aurora']::before {
  background: radial-gradient(40% 40% at 30% 30%, rgb(80 255 170 / 0.6), transparent), radial-gradient(36% 40% at 72% 40%, rgb(120 130 255 / 0.55), transparent),
    radial-gradient(30% 34% at 50% 15%, rgb(255 120 200 / 0.45), transparent);
  filter: blur(6px);
}
/* Green letters that stay where they are.  A column is a block of text (one letter per row).  A mask slides down it, one row
   every --step, and shows only the part the head has just passed: bright for most of the trail and fading out over the oldest
   third of it (so the letters look as strong as the intensity slider's 300%).  The head's own glyph is a second copy of the
   column, in white with a glow, masked to the single row the head is on.  The column's head takes 70% of --c, then it rests.  Nothing is drawn behind the letters, so the player's own background shows through. */
.gain {
  position: absolute;
}
.mx {
  position: absolute;
  font: 15px/1.15 ui-monospace, 'Courier New', monospace;
  font-size: calc(15px * var(--s, 1));
  white-space: pre;
  text-align: center;
  color: #5dff8a;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 33%, #000);
  mask-image: linear-gradient(to bottom, transparent, #000 33%, #000);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% calc(1.15em * var(--t));
  mask-size: 100% calc(1.15em * var(--t));
  /* Still (animations off): a lit band halfway down the column. */
  -webkit-mask-position: 0 calc(1.15em * (var(--n) * 0.5 - var(--t)));
  mask-position: 0 calc(1.15em * (var(--n) * 0.5 - var(--t)));
  animation: fx-mx-trail calc(var(--c) / var(--fx-speed)) steps(var(--steps), end) calc(-1 * var(--ph) / var(--fx-speed)) infinite;
}
.mx::before {
  content: attr(data-lead);
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  color: #eaffee;
  text-shadow: 0 0 6px #3dff7a;
  -webkit-mask-image: linear-gradient(#000, #000);
  mask-image: linear-gradient(#000, #000);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 1.15em;
  mask-size: 100% 1.15em;
  -webkit-mask-position: 0 -2em;
  mask-position: 0 -2em;
  animation: fx-mx-lead calc(var(--c) / var(--fx-speed)) steps(var(--steps), end) calc(-1 * var(--ph) / var(--fx-speed)) infinite;
}
@keyframes fx-mx-trail {
  0% {
    -webkit-mask-position: 0 calc(1.15em * (1 - var(--t)));
    mask-position: 0 calc(1.15em * (1 - var(--t)));
  }
  70%,
  100% {
    -webkit-mask-position: 0 calc(1.15em * var(--n));
    mask-position: 0 calc(1.15em * var(--n));
  }
}
@keyframes fx-mx-lead {
  0% {
    -webkit-mask-position: 0 0;
    mask-position: 0 0;
  }
  70%,
  100% {
    -webkit-mask-position: 0 calc(1.15em * (var(--n) + var(--t) - 1));
    mask-position: 0 calc(1.15em * (var(--n) + var(--t) - 1));
  }
}
.bg-fx.demo .mx {
  font-size: calc(9px * var(--s, 1));
}
@media (max-width: 700px) {
  .bg-fx:not(.demo) .mx:nth-child(even) {
    display: none;
  }
}

/* Green characters falling in columns.  Each letter has its own fixed brightness (dim at the back of the column, bright at the
   head).  At its vanishing point a column is rubbed out smoothly from its bottom upwards by a moving mask edge, so it never
   pops out of existence.  Where that happens differs from column to column (v1 almost at once ... v6 only at the bottom). */
/* The band of screen a column runs in: it appears at the top of the band and slides out of the bottom, with soft edges. */
.maw {
  position: absolute;
  width: 3rem;
  margin-left: -1.5rem;
  overflow: hidden;
  container-type: size;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 15%, #000 85%, transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 15%, #000 85%, transparent);
}
.ma {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  font: 15px/1.15 ui-monospace, 'Courier New', monospace;
  font-size: calc(15px * var(--s, 1));
  text-align: center;
  color: #1fb853;
  transform: translateY(-100%);
  -webkit-mask-image: linear-gradient(to top, transparent var(--fx-cut), #000 calc(var(--fx-cut) + 40%));
  mask-image: linear-gradient(to top, transparent var(--fx-cut), #000 calc(var(--fx-cut) + 40%));
  animation:
    fx-ma-fall calc(var(--d) / var(--fx-speed)) linear calc(var(--delay) / var(--fx-speed)) infinite,
    fx-ma-erase calc(var(--d) / var(--fx-speed)) linear calc(var(--delay) / var(--fx-speed)) infinite;
}
.ma.v1 {
  animation-name: fx-ma-fall, fx-ma-erase-1;
}
.ma.v2 {
  animation-name: fx-ma-fall, fx-ma-erase-2;
}
.ma.v3 {
  animation-name: fx-ma-fall, fx-ma-erase-3;
}
.ma.v4 {
  animation-name: fx-ma-fall, fx-ma-erase-4;
}
.ma.v5 {
  animation-name: fx-ma-fall, fx-ma-erase-5;
}
.ma i {
  display: block;
  font-style: normal;
}
.ma i.head {
  color: #e6ffe9;
  text-shadow: 0 0 6px #3dff7a;
}
@property --fx-cut {
  syntax: '<percentage>';
  inherits: false;
  initial-value: -40%;
}
/* --fx-cut is how much of the column is already gone, counting up from its bottom.  Each set of keyframes holds it at -40%
   (nothing gone) until the column's vanishing point, then runs it to 100% (all gone) by the percentage given. */
@keyframes fx-ma-erase-1 {
  0%,
  4% {
    --fx-cut: -40%;
  }
  16%,
  100% {
    --fx-cut: 100%;
  }
}
@keyframes fx-ma-erase-2 {
  0%,
  14% {
    --fx-cut: -40%;
  }
  30%,
  100% {
    --fx-cut: 100%;
  }
}
@keyframes fx-ma-erase-3 {
  0%,
  28% {
    --fx-cut: -40%;
  }
  48%,
  100% {
    --fx-cut: 100%;
  }
}
@keyframes fx-ma-erase-4 {
  0%,
  42% {
    --fx-cut: -40%;
  }
  66%,
  100% {
    --fx-cut: 100%;
  }
}
@keyframes fx-ma-erase-5 {
  0%,
  58% {
    --fx-cut: -40%;
  }
  84%,
  100% {
    --fx-cut: 100%;
  }
}
@keyframes fx-ma-erase {
  0%,
  72% {
    --fx-cut: -40%;
  }
  100% {
    --fx-cut: 100%;
  }
}
/*demo*/.bg-fx.demo .ma {
  font-size: calc(9px * var(--s, 1));
}
@media (max-width: 700px) {
  .bg-fx:not(.demo) .maw:nth-child(even) {
    display: none;
  }
}
@keyframes fx-ma-fall {
  to {
    transform: translateY(var(--box));
  }
}

@keyframes fx-aurora {
  from {
    transform: translateX(-12%) scale(1);
  }
  to {
    transform: translateX(12%) scale(1.15);
  }
}
</style>
