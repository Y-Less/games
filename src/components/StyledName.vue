<script setup>
// A player's name in the style they bought (a small border and background, see shared/nameStyles.js). Give it the
// name to show (and an animation on its border, see shared/animations.js) and, for a real player, their account id as `userId` (games send it as `userId` on their scoreboard
// players): the style is then looked up from the site. Without a userId (a computer player, say) the name is plain.
import { computed } from 'vue';
import { nameStyleById } from '../../shared/nameStyles.js';
import { profileOf } from '../profiles.js';

const props = defineProps({
  name: { type: String, required: true },
  userId: { type: Number, default: null },
  styleId: { type: String, default: null }, // show this style whatever the player owns (the shop's previews)
  animationId: { type: String, default: null }, // and this animation
});

const style = computed(() => nameStyleById(props.styleId ?? profileOf(props.userId)?.nameStyle?.style));
const animation = computed(() => props.animationId ?? profileOf(props.userId)?.nameStyle?.animation ?? 'none');
const styled = computed(() => style.value.id !== 'plain' || animation.value !== 'none');
// A plain name that has an animation glows in gold.
const glow = computed(() => (style.value.border === 'transparent' ? '#e0b84a' : style.value.border));
const css = computed(() =>
  styled.value ? { '--ns-border': style.value.border, '--ns-fill': style.value.fill, '--ns-glow': glow.value, ...(style.value.text ? { '--ns-text': style.value.text } : {}) } : undefined,
);
</script>

<template>
  <span class="styled-name" :class="{ styled }" :data-name-style="style.id" :data-animation="animation" :style="css">{{ name }}</span>
</template>

<style scoped>
.styled-name.styled {
  display: inline-block;
  max-width: 100%;
  box-sizing: border-box;
  padding: 0 0.45em;
  border: 1px solid var(--ns-border);
  border-radius: 999px;
  background: var(--ns-fill);
  color: var(--ns-text, inherit);
  line-height: 1.35;
  vertical-align: baseline;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.styled-name[data-animation='glow'] {
  animation: ns-glow 2.4s ease-in-out infinite alternate;
}
.styled-name[data-animation='pulse'] {
  animation: ns-pulse 1.8s ease-in-out infinite alternate;
}
.styled-name[data-animation='shimmer'] {
  background: linear-gradient(100deg, transparent 35%, rgb(255 255 255 / 0.5) 50%, transparent 65%) 150% 0 / 250% 100% no-repeat, var(--ns-fill);
  animation: ns-shimmer 3.2s linear infinite;
}
.styled-name[data-animation='rainbow'] {
  animation: ns-rainbow 6s linear infinite;
}
.styled-name[data-animation='flow'] {
  background: linear-gradient(110deg, rgb(255 90 120 / 0.55), rgb(255 190 80 / 0.55), rgb(80 200 160 / 0.55), rgb(90 140 255 / 0.55), rgb(255 90 120 / 0.55)) 0 0 / 300% 100%, var(--ns-fill);
  animation: ns-flow 7s linear infinite;
}
.styled-name[data-animation='stripes'] {
  background: repeating-linear-gradient(120deg, rgb(255 255 255 / 0.2) 0 0.4em, transparent 0.4em 0.8em) 0 0 / 0.8em 100%, var(--ns-fill);
  animation: ns-stripes 1.4s linear infinite;
}
.styled-name[data-animation='sparkle'] {
  position: relative;
}
.styled-name[data-animation='sparkle']::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1.5px 1.5px at 65% 70%, #fff, transparent), radial-gradient(1px 1px at 85% 25%, #fff4cf, transparent),
    radial-gradient(1px 1px at 40% 80%, #cfe6ff, transparent);
  background-size: 3.2em 100%;
  animation: ns-sparkle 1.6s ease-in-out infinite alternate;
}
@keyframes ns-flow {
  to {
    background-position: -300% 0, 0 0;
  }
}
@keyframes ns-stripes {
  to {
    background-position: 0.8em 0, 0 0;
  }
}
@keyframes ns-sparkle {
  from {
    opacity: 0.2;
  }
  to {
    opacity: 1;
  }
}
@keyframes ns-glow {
  from {
    box-shadow: 0 0 1px var(--ns-glow);
  }
  to {
    box-shadow: 0 0 9px 1px var(--ns-glow);
  }
}
@keyframes ns-pulse {
  from {
    box-shadow: inset 0 0 0 0 var(--ns-glow);
  }
  to {
    box-shadow: inset 0 0 0.7em 0.1em var(--ns-glow);
  }
}
@keyframes ns-shimmer {
  to {
    background-position: -150% 0, 0 0;
  }
}
@keyframes ns-rainbow {
  0%,
  100% {
    border-color: #ff5a5a;
  }
  17% {
    border-color: #ffb347;
  }
  33% {
    border-color: #f4e04d;
  }
  50% {
    border-color: #5ad17a;
  }
  67% {
    border-color: #4fa8ff;
  }
  83% {
    border-color: #b86bff;
  }
}
@media (prefers-reduced-motion: reduce) {
  .styled-name,
  .styled-name::before {
    animation: none !important;
  }
}
</style>
