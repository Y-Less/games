<script setup>
// An animation over the website background (see shared/animations.js): drifting light, stars, snow ... drawn in CSS only.
// `fixed` puts it behind the whole site (App.vue); without it the effect fills its parent box, for the shop's previews.
// It never takes clicks, and it stands still when the player has turned animations off (see style.css).
// `gradient` (the moving fade) slides the gradient from the user's `background` setting; it does nothing for any other kind
// of background, except in a `demo` (the shop's previews), which uses a sample gradient instead.
import { computed } from 'vue';

// The Matrix rain: columns of characters, each falling at its own speed. The columns are laid out from a fixed seed, so the
// rain looks the same every time (and in tests); only the animation moves them.
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';
function rain(count) {
  let seed = 20240229;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  return Array.from({ length: count }, (_, i) => {
    const duration = 6 + next() * 8;
    const length = 14 + Math.floor(next() * 12);
    const text = Array.from({ length }, () => GLYPHS[Math.floor(next() * GLYPHS.length)]).join('\n');
    return { text, style: { left: `${(((i + 0.5) / count) * 100).toFixed(2)}%`, '--d': `${duration.toFixed(1)}s`, '--delay': `${(-next() * duration).toFixed(1)}s` } };
  });
}

const props = defineProps({
  effect: { type: String, default: 'none' },
  fixed: { type: Boolean, default: false },
  background: { type: Object, default: null },
  demo: { type: Boolean, default: false },
});
const SAMPLE = { from: '#16252d', to: '#7a3e55', angle: 160 };
const fade = computed(() => (props.background?.type === 'gradient' ? props.background : props.demo ? SAMPLE : null));
const shown = computed(() => props.effect && props.effect !== 'none' && (props.effect !== 'gradient' || fade.value));
const columns = computed(() => (props.effect === 'matrix' ? rain(props.demo ? 9 : 44) : []));
const style = computed(() => (props.effect === 'gradient' && fade.value ? { '--fx-a': fade.value.from, '--fx-b': fade.value.to, '--fx-angle': `${fade.value.angle}deg` } : undefined));
</script>

<template>
  <div v-if="shown" class="bg-fx" :class="{ fixed, demo }" :data-fx="effect" :style="style" aria-hidden="true">
    <span v-for="(column, i) in columns" :key="i" class="mx" :style="column.style">{{ column.text }}</span>
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
@property --fx-shift {
  syntax: '<length>';
  inherits: false;
  initial-value: 0px;
}
[data-fx='gradient'] {
  --fx-period: max(100vw, 100vh);
  background: repeating-linear-gradient(var(--fx-angle), var(--fx-a) var(--fx-shift), var(--fx-b) calc(var(--fx-period) / 2 + var(--fx-shift)), var(--fx-a) calc(var(--fx-period) + var(--fx-shift)));
  animation: fx-gradient calc(24s / var(--fx-speed)) linear infinite;
}
.bg-fx.demo[data-fx='gradient'] {
  --fx-period: 100px;
}
@keyframes fx-gradient {
  to {
    --fx-shift: var(--fx-period);
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
/* Green characters falling in columns, bright at the head and fading away behind it. */
[data-fx='matrix'] {
  background: rgb(0 18 6 / 0.35);
}
.mx {
  position: absolute;
  top: 0;
  white-space: pre;
  font: 15px/1.15 ui-monospace, 'Courier New', monospace;
  text-align: center;
  color: transparent;
  background: linear-gradient(to bottom, transparent, #0b8a3a 55%, #3dff7a 92%, #e6ffe9);
  -webkit-background-clip: text;
  background-clip: text;
  opacity: 0.75;
  transform: translateY(-100%);
  /* Late in its fall a column is rubbed out from the top, one letter after another (--fx-cut moves down it), so it never
     pops out of existence: by the time it starts again every letter has already faded. */
  -webkit-mask-image: linear-gradient(to bottom, transparent var(--fx-cut), #000 calc(var(--fx-cut) + 40%));
  mask-image: linear-gradient(to bottom, transparent var(--fx-cut), #000 calc(var(--fx-cut) + 40%));
  animation:
    fx-matrix calc(var(--d) / var(--fx-speed)) linear calc(var(--delay) / var(--fx-speed)) infinite,
    fx-erase calc(var(--d) / var(--fx-speed)) linear calc(var(--delay) / var(--fx-speed)) infinite;
}
@property --fx-cut {
  syntax: '<percentage>';
  inherits: false;
  initial-value: -40%;
}
@keyframes fx-erase {
  0%,
  55% {
    --fx-cut: -40%;
  }
  100% {
    --fx-cut: 100%;
  }
}
.bg-fx.demo .mx {
  font-size: 9px;
  opacity: 1;
}
@media (max-width: 700px) {
  .bg-fx:not(.demo) .mx:nth-child(even) {
    display: none;
  }
}
@keyframes fx-matrix {
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
