<script setup>
// The clue box: the psychic's clue in big letters, or a caption saying what will appear. Its height is fixed, and it is
// there in every phase for every role, so nothing moves.
// Props: clue (the clue, or an empty string), psychicName, isPsychic (you are the psychic), playing (a turn is in play).
// Slots: none.
// Emits: none.
// Side effects: none.
defineProps({
  clue: { type: String, default: '' },
  psychicName: { type: String, required: true },
  isPsychic: { type: Boolean, default: false },
  playing: { type: Boolean, default: false },
});
</script>

<template>
  <div class="block clue-block">
    <span class="muted caption">
      <template v-if="clue">{{ psychicName }}'s clue</template>
      <template v-else-if="isPsychic && playing">Only you can see the target.</template>
      <template v-else-if="playing">The clue will appear here.</template>
    </span>
    <p class="clue" :class="{ hidden: !clue }">&ldquo;{{ clue || '...' }}&rdquo;</p>
  </div>
</template>

<style scoped>
.block {
  flex: none;
}
.clue-block {
  height: 6.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  overflow: hidden;
}
.caption {
  font-size: 0.9rem;
  min-height: 1.2rem;
}
.clue {
  font-family: var(--display);
  font-size: 1.35rem;
  line-height: 1.25;
  margin: 0;
  color: var(--amber);
  overflow: hidden;
}
.clue.hidden {
  visibility: hidden;
}
</style>
