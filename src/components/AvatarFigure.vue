<script setup>
// File: renders an avatar or robot as inline SVG. Depends on: ../avatarArt.js (markup builders).
// Props: avatar (Object|null, chosen options), robot (Boolean, draw the computer-player robot), seed (String, picks the robot's
//   background colour), size (String, CSS width and height), label (String, accessible name; empty hides it from screen readers).
// Emits: none.  Slots: none.
// Side effects: none. The markup comes from our own avatarArt.js (never user text), which is why v-html is safe here.
// A player's avatar (see shared/avatar.js): a square figure of layered parts. Give it the `avatar` (an object of chosen
// options, or nothing for the default one) and a `size` in CSS units. With `robot` it is the computer players' square robot instead, its background chosen by `seed`. It is decoration, so it is hidden from screen readers
// unless a `label` is given.
import { computed } from 'vue';
import { avatarMarkup, robotMarkup } from '../avatarArt.js';

const props = defineProps({
  avatar: { type: Object, default: null },
  robot: { type: Boolean, default: false },
  seed: { type: String, default: '' }, // a robot's background colour comes from this
  size: { type: String, default: '4rem' },
  label: { type: String, default: '' },
});
// The SVG inner markup for the robot or the chosen avatar; recomputed only when the props change.
const markup = computed(() => (props.robot ? robotMarkup(props.seed) : avatarMarkup(props.avatar)));
</script>

<template>
  <svg class="avatar-figure" viewBox="0 0 100 100" :style="{ width: size, height: size }" :role="label ? 'img' : undefined" :aria-label="label || undefined" :aria-hidden="label ? undefined : 'true'" v-html="markup" />
</template>

<style scoped>
.avatar-figure {
  display: block;
  flex: none;
  border-radius: 14%;
  box-shadow: 0 0 0 2px var(--line);
}
</style>
