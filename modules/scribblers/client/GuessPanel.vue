<script setup>
// File: the guesses panel beside the board - what everybody has typed, and the box to type in.
// Depends on: Vue, GameLog (the scrolling list that keeps the newest line in view) and useGameText.
// Props: feed (the lines the server sent this viewer), canGuess (may this viewer type), youDraw (the drawer sees the
//   guesses but talks only to the others who know the word), height (pixels).
// Emits: guess (the text typed).  Slots: none.
// Side effects: none beyond clearing its own input.
import { computed, ref } from 'vue';
import GameLog from '../../../src/components/GameLog.vue';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({
  feed: { type: Array, default: () => [] },
  canGuess: { type: Boolean, default: false },
  youDraw: { type: Boolean, default: false },
  height: { type: Number, default: 300 },
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
  text.value = '';
  emit('guess', typed);
}

// What the box invites: the drawer may only talk to the others who know the word, everybody else is guessing.
const placeholder = computed(() => (props.youDraw ? t('panel.sayPlaceholder') : t('panel.guessPlaceholder')));
</script>

<template>
  <section class="guess-panel panel" :style="{ height: `${height}px` }">
    <h3 class="title">{{ t('panel.title') }}</h3>
    <div class="feed">
      <GameLog :entries="feed" :label="t('panel.title')" :empty="t('panel.nothingYet')">
        <template #default="{ entry }">
          <span class="line" :class="entry.kind">
            <template v-if="entry.kind === 'correct'">{{ t('panel.gotIt', { name: entry.name }) }}</template>
            <template v-else>
              <span class="who">{{ entry.name }}</span>
              <span class="said">{{ entry.text }}</span>
              <em v-if="entry.kind === 'close'" class="hint">{{ t('panel.close') }}</em>
            </template>
          </span>
        </template>
      </GameLog>
    </div>
    <form class="ask" @submit.prevent="send">
      <input v-model="text" type="text" autocomplete="off" maxlength="60" :disabled="!canGuess" :placeholder="placeholder" :aria-label="placeholder" />
      <button type="submit" class="primary" :disabled="!canGuess || !text.trim()">{{ t('panel.send') }}</button>
    </form>
  </section>
</template>

<style scoped>
.guess-panel {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 0;
  padding: 0.5rem 0.7rem 0.6rem;
}
.title {
  flex: none;
  margin: 0;
  font-size: 0.95rem;
  color: var(--amber);
}
.feed {
  flex: 1;
  min-height: 0;
  --log-height: 100%;
}
.line {
  display: block;
  overflow-wrap: anywhere;
  font-size: 0.9rem;
}
.line.correct {
  color: var(--amber);
  font-weight: 600;
}
.line.chat {
  color: var(--muted);
}
.who {
  color: var(--muted);
}
.who::after {
  content: ':';
  margin-right: 0.3rem;
}
.hint {
  margin-left: 0.35rem;
  color: var(--amber);
  font-size: 0.8rem;
}
.ask {
  display: flex;
  flex: none;
  gap: 0.4rem;
}
.ask input {
  flex: 1;
  min-width: 0;
}
</style>
