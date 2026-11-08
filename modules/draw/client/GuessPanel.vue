<script setup>
// The guesses panel beside the boards: what everybody has typed, and the one box to type in.  One box, two drawings:
// whatever is typed is tried against both of them.  It is a GameLog, so the newest line stays in view unless the
// reader has scrolled away from it.
// Props: feed (the lines the server sent this viewer), canGuess (may this viewer type), maxLength.
// Emits: guess (the text typed).  Slots: none.
// Side effects: none beyond clearing its own input.
import { ref } from 'vue';
import GameLog from '../../../src/components/GameLog.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({
  feed: { type: Array, default: () => [] },
  canGuess: { type: Boolean, default: false },
  maxLength: { type: Number, default: 60 },
});
const emit = defineEmits(['guess']);
const { t } = useGameText();

const text = ref('');

/**
 * Sends what has been typed, if anything.
 * @returns {void}
 * Side effects: emits `guess` and empties the box.
 */
function send() {
  const typed = text.value.trim();
  if (!typed) return;
  emit('guess', typed);
  text.value = '';
}
</script>

<template>
  <section class="guesses">
    <GameLog :entries="feed" :empty="t('table.nothingYet')" :title="t('table.guessing')" v-slot="{ entry }">
      <span class="line" :class="entry.kind">
        <strong>{{ entry.name }}</strong>
        <template v-if="entry.kind === 'correct'"> {{ t('status.wonIt') }}</template>
        <template v-else>: {{ entry.text }}</template>
      </span>
    </GameLog>
    <form class="row" @submit.prevent="send">
      <input
        v-model="text"
        :maxlength="maxLength"
        :disabled="!canGuess"
        :placeholder="canGuess ? t('table.guessHere') : t('table.youDrawSoNoGuessing')"
        :aria-label="t('table.guessHere')"
        autocomplete="off"
      />
      <button :disabled="!canGuess || !text.trim()">{{ t('table.guessing') }}</button>
    </form>
  </section>
</template>

<style scoped>
.guesses {
  display: grid;
  grid-template-rows: 1fr auto;
  gap: 0.4rem;
  min-height: 0;
  height: 100%;
}
.line.correct {
  color: var(--amber);
}
.line.close {
  color: var(--rust);
}
.row input {
  flex: 1;
  min-width: 0;
}
</style>
