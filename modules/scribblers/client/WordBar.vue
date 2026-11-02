<script setup>
// File: the bar over the board - the word as the viewer may see it (blanks for the letters still hidden), how many
// letters it has, and how long is left.
// Depends on: Vue and useGameText.
// Props: hints (one entry per character: { ch, fixed, shown }), secondsLeft (or null when nothing is being timed),
//   youDraw, drawerName, phase.
// Emits: none.  Slots: none.  Side effects: none.
import { computed } from 'vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({
  hints: { type: Array, default: () => [] },
  secondsLeft: { type: Number, default: null },
  youDraw: { type: Boolean, default: false },
  drawerName: { type: String, default: '' },
  phase: { type: String, default: 'drawing' },
});
const { t } = useGameText();

// How many characters of the word are letters to guess (the spaces and hyphens are shown from the start).
const letters = computed(() => props.hints.filter((hint) => !hint.fixed).length);
// The last ten seconds are shown in a warmer colour, so the table can feel the time going.
const urgent = computed(() => props.secondsLeft !== null && props.secondsLeft <= 10);
</script>

<template>
  <div class="word-bar">
    <p v-if="phase === 'choosing'" class="choosing muted">{{ youDraw ? t('word.yourChoice') : t('word.choosing', { name: drawerName }) }}</p>
    <p v-else class="word" :aria-label="youDraw ? t('word.yours') : t('word.sofar')">
      <span v-for="(hint, n) in hints" :key="n" class="ch" :class="{ blank: hint.ch === null, fixed: hint.fixed }">{{ hint.ch === null ? '_' : hint.ch }}</span>
    </p>
    <p v-if="phase !== 'choosing' && letters" class="count muted">{{ t('word.letters', { count: letters }, letters) }}</p>
    <p v-if="secondsLeft !== null" class="clock" :class="{ urgent }">
      <span aria-hidden="true">⏱</span> <span>{{ t('word.seconds', { count: secondsLeft }, secondsLeft) }}</span>
    </p>
  </div>
</template>

<style scoped>
.word-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  height: 44px;
  min-height: 0;
  overflow: hidden;
}
.word-bar > p {
  margin: 0;
}
.word {
  display: flex;
  gap: 0.15rem;
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
  font-size: 1.25rem;
  letter-spacing: 0.05em;
  color: var(--parchment);
}
.ch {
  min-width: 0.8em;
  text-align: center;
}
.ch.blank {
  color: var(--muted);
}
.ch.fixed {
  color: var(--muted);
}
.count,
.clock {
  font-size: 0.9rem;
  white-space: nowrap;
}
.clock {
  color: var(--parchment);
}
.clock.urgent {
  color: var(--amber);
  font-weight: 600;
}
</style>
