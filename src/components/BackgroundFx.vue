<script setup>
// An animation over the website background (see shared/animations.js): drifting light, stars, snow ... drawn in CSS only.
// `fixed` puts it behind the whole site (App.vue); without it the effect fills its parent box, for the shop's previews.
// It never takes clicks, and it stands still when the player has turned animations off (see style.css).
// `gradient` (the moving fade) slides the gradient from the user's `background` setting; it does nothing for any other kind
// of background, except in a `demo` (the shop's previews), which uses a sample gradient instead.
import { computed } from 'vue';

// The Matrix rain, as in the film: the letters never move. A bright head steps down each column and leaves a letter in every
// row it passes, and each of those letters then fades away where it stands. The columns are laid out from a fixed seed, so
// the rain looks the same every time (and in tests); only the animation (CSS, below) changes anything.
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';
const TRAIL = [0.06, 0.12, 0.25, 0.45]; // the part of a column's cycle a letter takes to fade: short trails to long ones
function rain(count, demo) {
  let seed = 20240229;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  return Array.from({ length: count }, (_, i) => {
    // Each column has its own text size (mostly small, a few large) and, for about a third of them, is dimmer overall.
    const size = 0.55 + 1.5 * next() ** 1.6;
    const dim = next() < 0.35 ? 0.25 + 0.4 * next() : 1;
    // Enough rows to fill a tall screen at this size (what runs off the bottom is clipped).
    const rows = Math.ceil((demo ? 150 : 1200) / (15 * size * 1.15));
    const letters = Array.from({ length: rows }, (_, k) => ({
      ch: GLYPHS[Math.floor(next() * GLYPHS.length)],
      alpha: (0.1 + 0.9 * (k / (rows - 1)) ** 1.6).toFixed(2), // only seen when animations are off: a still, fading column
    }));
    const trail = Math.floor(next() * TRAIL.length);
    const step = 0.06 + 0.1 * next(); // seconds the head takes per row
    const cycle = ((rows * step) / (1 - TRAIL[trail])) * (1 + 0.5 * next()); // the head's whole trip, plus a rest before the next
    const left = ((i + 0.1 + 0.8 * next()) / count) * 100;
    const style = { '--s': size.toFixed(2), '--step': `${step.toFixed(3)}s`, '--c': `${cycle.toFixed(2)}s`, '--ph': `${(next() * cycle).toFixed(2)}s`, opacity: dim.toFixed(2), left: `${left.toFixed(2)}%` };
    return { letters, fade: `f${trail + 1}`, style };
  });
}

const props = defineProps({
  effect: { type: String, default: 'none' },
  fixed: { type: Boolean, default: false },
  background: { type: Object, default: null },
  demo: { type: Boolean, default: false },
  intensity: { type: Number, default: 100 }, // percent: how strong the effect looks (the player's own slider; previews ignore it)
  speed: { type: Number, default: 100 }, // percent: how fast it moves (likewise)
});
// Above 100% the effect cannot be more opaque, so the alpha of everything it draws is multiplied instead (an SVG filter).
let gains = 0;
const gainId = `fx-gain-${++gains}`;
const SAMPLE = { from: '#16252d', to: '#7a3e55', angle: 160 };
const fade = computed(() => (props.background?.type === 'gradient' ? props.background : props.demo ? SAMPLE : null));
const shown = computed(() => props.effect && props.effect !== 'none' && (props.effect !== 'gradient' || fade.value));
const columns = computed(() => (props.effect === 'matrix' ? rain(props.demo ? 9 : Math.max(12, Math.round((90 * Math.min(100, props.intensity)) / 100)), props.demo) : []));
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
    <span v-for="(column, i) in columns" :key="i" class="mx" :class="column.fade" :style="column.style"><i v-for="(letter, k) in column.letters" :key="k" :style="{ '--k': k, '--a': letter.alpha }">{{ letter.ch }}</i>
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
   the gradient's angle ends where it began. Only a transform moves, which every browser animates. */
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
    background-position: calc(var(--tile) * 0.15) var(--tile);
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
    background-position: calc(var(--tile) * -0.12) calc(var(--tile) * -1);
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

/* Slow ribbons of green, blue and pink light. */
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
/* Green letters that stay where they are. The head of a column steps down it, one row every --step, and each row's letter
   lights bright white with a glow as the head reaches it (the lead letter) and then fades out in place (f1 ... f4: from a short trail to a long one).
   Every letter runs the same cycle (--c), started late by its row, so the head passes through them in turn; the column
   rests for the rest of the cycle, and the columns are all out of step with each other (--ph). */
[data-fx='matrix'] {
  background: rgb(0 18 6 / 0.35);
}
.gain {
  position: absolute;
}
.mx {
  position: absolute;
  top: 0;
  font: 15px/1.15 ui-monospace, 'Courier New', monospace;
  font-size: calc(15px * var(--s, 1));
  text-align: center;
  color: #5dff8a;
}
.mx i {
  display: block;
  font-style: normal;
  opacity: var(--a, 0.5);
  animation: fx-deposit-2 calc(var(--c) / var(--fx-speed)) linear calc((var(--k) * var(--step) + var(--ph) - 2 * var(--c)) / var(--fx-speed)) infinite;
}
.mx.f1 i {
  animation-name: fx-deposit-1;
}
.mx.f3 i {
  animation-name: fx-deposit-3;
}
.mx.f4 i {
  animation-name: fx-deposit-4;
}
@keyframes fx-deposit-1 {
  0% {
    opacity: 1;
    color: #eaffee;
    text-shadow: 0 0 6px #3dff7a;
  }
  1.5% {
    opacity: 0.75;
    color: #5dff8a;
    text-shadow: 0 0 0 transparent;
  }
  6%,
  100% {
    opacity: 0;
  }
}
@keyframes fx-deposit-2 {
  0% {
    opacity: 1;
    color: #eaffee;
    text-shadow: 0 0 6px #3dff7a;
  }
  1.5% {
    opacity: 0.88;
    color: #5dff8a;
    text-shadow: 0 0 0 transparent;
  }
  12%,
  100% {
    opacity: 0;
  }
}
@keyframes fx-deposit-3 {
  0% {
    opacity: 1;
    color: #eaffee;
    text-shadow: 0 0 6px #3dff7a;
  }
  1.5% {
    opacity: 0.94;
    color: #5dff8a;
    text-shadow: 0 0 0 transparent;
  }
  25%,
  100% {
    opacity: 0;
  }
}
@keyframes fx-deposit-4 {
  0% {
    opacity: 1;
    color: #eaffee;
    text-shadow: 0 0 6px #3dff7a;
  }
  1.5% {
    opacity: 0.97;
    color: #5dff8a;
    text-shadow: 0 0 0 transparent;
  }
  45%,
  100% {
    opacity: 0;
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

@keyframes fx-aurora {
  from {
    transform: translateX(-12%) scale(1);
  }
  to {
    transform: translateX(12%) scale(1.15);
  }
}
</style>
