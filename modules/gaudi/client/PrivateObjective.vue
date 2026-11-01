<script setup>
// Your private objective: a chip showing its colour and shape and its name. On the table it also shows the points so far.
// Props: colour (a colour key), points (number so far), showPoints (Boolean), badPrivate (Boolean, the scoring setting).
// Emits: hint (text, or '' when the pointer leaves) for the Status box. Side effects: none.
import { COLOUR_HEX, SHAPES } from './glyphs.js';
import { COLOUR_SHAPES } from '../rules.js';
import { colourName, privateRule } from './wording.js';

defineProps({
  colour: { type: String, required: true },
  points: { type: Number, default: 0 },
  showPoints: { type: Boolean, default: false },
  badPrivate: { type: Boolean, default: false },
});
const emit = defineEmits(['hint']);
</script>

<template>
  <section class="private" aria-label="Your private objective" @mouseenter="emit('hint', `Your private objective: ${colourName(colour)}. ${privateRule(badPrivate)}`)" @mouseleave="emit('hint', '')">
    <svg class="chip" viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="8" :fill="COLOUR_HEX[colour]" />
      <path :d="SHAPES[COLOUR_SHAPES[colour]]" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="2" />
    </svg>
    <div class="private-text">
      <span class="row-title">Your private objective</span>
      <span class="private-line"><strong>{{ colourName(colour) }}</strong> <span v-if="showPoints" class="muted">· {{ points }} points so far</span></span>
    </div>
  </section>
</template>

<style scoped>
.private {
  flex: none;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--amber);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-sunken) 85%, transparent);
}
.row-title {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  line-height: 1.1;
}
.private-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 0.85rem;
}
.private-line {
  white-space: nowrap;
}
.chip {
  flex: none;
}
</style>
