<script setup>
// An animation over the website background (see shared/animations.js): drifting light, stars, snow ... drawn in CSS only.
// `fixed` puts it behind the whole site (App.vue); without it the effect fills its parent box, for the shop's previews.
// It never takes clicks, and it stands still when the player has turned animations off (see style.css).
// `gradient` (the moving fade) slides the gradient from the user's `background` setting; it does nothing for any other kind
// of background, except in a `demo` (the shop's previews), which uses a sample gradient instead.
import { computed } from 'vue';

// Half of the columns (in either Matrix) start at the very top of the screen; the rest start anywhere down it.
const startsAtTop = (next) => next() < 0.5;
// Half of them run on to the bottom of the screen; the rest stop at a random height on the way (what fraction of the way from
// their start to the bottom they cover).
const reach = (next) => (next() < 0.5 ? 1 : 0.15 + 0.75 * next());

// The Matrix rain, as in the film: the letters never move. A bright head steps down each column, one row at a time, and the
// letters it has passed fade away where they stand. A column is one block of text; a mask slides down it in steps to show the
// part the head has just passed (and a second mask shows the head's own, random, glyph), so there is one animation per column
// and none per letter. The columns are laid out from a fixed seed, so the rain looks the same every time (and in tests).
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';
function rain(count, demo) {
  let seed = 20240229;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const glyph = () => GLYPHS[Math.floor(next() * GLYPHS.length)];
  return Array.from({ length: count }, (_, i) => {
    // Each column has its own text size (mostly small, a few large) and, for about a third of them, is dimmer overall.
    const size = 0.55 + 1.5 * next() ** 1.6;
    const dim = next() < 0.35 ? 0.4 + 0.4 * next() : 1;
    // Where the column starts and how far down the screen its head gets (what runs off the bottom is clipped).
    const fullRows = Math.ceil((demo ? 150 : 1200) / (15 * size * 1.15));
    const top = startsAtTop(next) ? 0 : 0.7 * next() ** 1.3;
    const rows = Math.min(120, Math.max(4, Math.round(fullRows * (1 - top) * reach(next))));
    const trail = Math.min(rows, 3 + Math.floor(37 * next() ** 1.5)); // rows that are still lit behind the head: a few to a long trail
    const step = 0.06 + 0.1 * next(); // seconds the head takes per row
    const steps = rows + trail; // the head carries on until the last letter has faded
    const cycle = steps * step / 0.7; // the head's trip is 70% of the cycle; the column rests for the rest
    const text = Array.from({ length: rows }, glyph).join('\n');
    const lead = Array.from({ length: rows }, glyph).join('\n'); // what the head shows as it passes: not the letter it leaves
    const left = ((i + 0.1 + 0.8 * next()) / count) * 100;
    const style = { '--s': size.toFixed(2), '--n': rows, '--t': trail, '--steps': steps - 1, '--c': `${cycle.toFixed(2)}s`, '--ph': `${(next() * cycle).toFixed(2)}s`, opacity: dim.toFixed(2), left: `${left.toFixed(2)}%`, top: `${(top * 100).toFixed(1)}%` };
    return { text, lead, style };
  });
}

// Matrix A: the first Matrix rain, in which each column of letters slides down the screen (and is rubbed out part-way). The
// columns are laid out from a fixed seed, like the other Matrix's.
function rainSliding(count) {
  let seed = 20240229;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  return Array.from({ length: count }, (_, i) => {
    const duration = 6 + next() * 8;
    const length = 3 + Math.floor(37 * next() ** 1.5); // from a few letters to a long trail, with more short ones than long
    // Every letter keeps its own brightness, dim at the back of the column and full at the head. The column is rubbed out
    // from its bottom upwards (see the erase animations below), and where in its fall that happens is its own.
    const letters = Array.from({ length }, (_, k) => ({
      ch: GLYPHS[Math.floor(next() * GLYPHS.length)],
      alpha: Math.min(1, 3 * (0.1 + 0.9 * (k / (length - 1)) ** 1.6)).toFixed(2), // three times as strong as it began: the look of the 300% intensity
    }));
    // Where in its fall a column starts to vanish: a few go almost at once, near the top of the screen, others partway down,
    // and some only as they leave it.
    const roll = next();
    const fade = roll < 0.08 ? 'v1' : roll < 0.2 ? 'v2' : roll < 0.35 ? 'v3' : roll < 0.55 ? 'v4' : roll < 0.75 ? 'v5' : 'v6';
    // Each column has its own text size (mostly small, a few large) and, for about a third of them, a dimmer overall brightness.
    const size = 0.55 + 1.5 * next() ** 1.6;
    const dim = next() < 0.35 ? 0.4 + 0.4 * next() : 1;
    const left = ((i + 0.1 + 0.8 * next()) / count) * 100;
    // A column runs only between its own start and end heights (a band of the screen with soft edges), not the whole height.
    const top = startsAtTop(next) ? 0 : 0.7 * next() ** 1.3;
    const height = (1 - top) * reach(next);
    const wrap = { left: `${left.toFixed(2)}%`, top: `${(top * 100).toFixed(1)}%`, height: `${(height * 100).toFixed(1)}%` };
    return { letters, fade, wrap, style: { '--n': length, '--s': size.toFixed(2), opacity: dim.toFixed(2), '--d': `${duration.toFixed(1)}s`, '--delay': `${(-next() * duration).toFixed(1)}s` } };
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
const slidingColumns = computed(() => (props.effect === 'matrix-a' ? rainSliding(props.demo ? 9 : Math.max(12, Math.round((180 * Math.min(100, props.intensity)) / 100))) : []));
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
/* Green letters that stay where they are. A column is a block of text (one letter per row). A mask slides down it, one row
   every --step, and shows only the part the head has just passed: bright for most of the trail and fading out over the oldest
   third of it (so the letters look as strong as the intensity slider's 300%). The head's own glyph is a second copy of the
   column, in white with a glow, masked to the single row the head is on. The column's head takes 70% of --c, then it rests. */
[data-fx='matrix'] {
  background: rgb(0 18 6 / 0.6);
}
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

/* Green characters falling in columns. Each letter has its own fixed brightness (dim at the back of the column, bright at the
   head). At its vanishing point a column is rubbed out smoothly from its bottom upwards by a moving mask edge, so it never
   pops out of existence. Where that happens differs from column to column (v1 almost at once ... v6 only at the bottom). */
[data-fx='matrix-a'] {
  background: rgb(0 18 6 / 0.6);
}
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
/* --fx-cut is how much of the column is already gone, counting up from its bottom. Each set of keyframes holds it at -40%
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
