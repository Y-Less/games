<script setup>
// An animation over the website background (see shared/animations.js): drifting light, stars, snow ... drawn in CSS only.
// `fixed` puts it behind the whole site (App.vue); without it the effect fills its parent box, for the shop's previews.
// It never takes clicks, and it stands still for anyone who has asked their device for less motion.
defineProps({
  effect: { type: String, default: 'none' },
  fixed: { type: Boolean, default: false },
});
</script>

<template>
  <div v-if="effect && effect !== 'none'" class="bg-fx" :class="{ fixed }" :data-fx="effect" aria-hidden="true" />
</template>

<style scoped>
.bg-fx {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
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

/* A soft band of light that crosses the page now and then. */
[data-fx='sweep']::before {
  left: -100%;
  width: 300%;
  background: linear-gradient(105deg, transparent 42%, rgb(255 255 255 / 0.1) 50%, transparent 58%);
  animation: fx-sweep 12s linear infinite;
}
@keyframes fx-sweep {
  to {
    transform: translateX(33.3%);
  }
}

/* Two layers of stars that fade in and out at different speeds. */
[data-fx='stars']::before {
  background-image: radial-gradient(1.5px 1.5px at 20px 30px, #fff, transparent), radial-gradient(1px 1px at 90px 120px, #cfe6ff, transparent), radial-gradient(1.5px 1.5px at 160px 60px, #fff, transparent),
    radial-gradient(1px 1px at 60px 180px, #fff4cf, transparent);
  background-size: 200px 200px;
  animation: fx-twinkle 4s ease-in-out infinite alternate;
}
[data-fx='stars']::after {
  background-image: radial-gradient(1px 1px at 40px 90px, #fff, transparent), radial-gradient(2px 2px at 130px 20px, #ffe9b0, transparent), radial-gradient(1px 1px at 180px 160px, #cfe6ff, transparent);
  background-size: 230px 230px;
  animation: fx-twinkle 6.5s ease-in-out -2s infinite alternate;
}
@keyframes fx-twinkle {
  from {
    opacity: 0.25;
  }
  to {
    opacity: 1;
  }
}

/* Snow falling at two speeds. */
[data-fx='snow']::before {
  background-image: radial-gradient(3px 3px at 30px 40px, rgb(255 255 255 / 0.85), transparent), radial-gradient(2px 2px at 120px 110px, rgb(255 255 255 / 0.7), transparent),
    radial-gradient(3px 3px at 200px 220px, rgb(255 255 255 / 0.8), transparent), radial-gradient(2px 2px at 70px 250px, rgb(255 255 255 / 0.7), transparent);
  background-size: 260px 260px;
  animation: fx-fall 16s linear infinite;
}
[data-fx='snow']::after {
  background-image: radial-gradient(2px 2px at 60px 60px, rgb(255 255 255 / 0.6), transparent), radial-gradient(1.5px 1.5px at 170px 150px, rgb(255 255 255 / 0.6), transparent),
    radial-gradient(2px 2px at 100px 210px, rgb(255 255 255 / 0.55), transparent);
  background-size: 190px 190px;
  animation: fx-fall 26s linear -7s infinite;
}
@keyframes fx-fall {
  to {
    background-position: 40px 260px;
  }
}

/* Embers drifting up from below. */
[data-fx='embers']::before {
  background-image: radial-gradient(2.5px 2.5px at 40px 60px, #ffb35a, transparent), radial-gradient(2px 2px at 140px 150px, #ff7a3d, transparent), radial-gradient(2px 2px at 90px 230px, #ffd07a, transparent),
    radial-gradient(3px 3px at 210px 90px, #ff8f47, transparent);
  background-size: 250px 250px;
  animation:
    fx-rise 14s linear infinite,
    fx-flicker 2.2s ease-in-out infinite alternate;
}
[data-fx='embers']::after {
  background: linear-gradient(to top, rgb(255 110 40 / 0.12), transparent 35%);
}
@keyframes fx-rise {
  to {
    background-position: -30px -250px;
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
  animation: fx-aurora 18s ease-in-out infinite alternate;
}
@keyframes fx-aurora {
  from {
    transform: translateX(-7%) scale(1);
  }
  to {
    transform: translateX(7%) scale(1.15);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bg-fx::before,
  .bg-fx::after {
    animation: none !important;
  }
}
</style>
