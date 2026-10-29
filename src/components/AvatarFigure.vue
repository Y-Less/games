<script setup>
// A player's avatar (see shared/avatar.js): a square figure of layered parts. Give it the `avatar` (an object of chosen
// options, or nothing for the default one) and a `size` in CSS units. It is decoration, so it is hidden from screen readers
// unless a `label` is given.
import { computed } from 'vue';
import { avatarMarkup } from '../avatarArt.js';

const props = defineProps({
  avatar: { type: Object, default: null },
  size: { type: String, default: '4rem' },
  label: { type: String, default: '' },
});
const markup = computed(() => avatarMarkup(props.avatar));
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
