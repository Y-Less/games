<script setup>
// The guesses panel of the games that draw (Scribblers, Draw!): what everybody has typed, and the box to type in.  It
// is a GameLog, so the newest line stays in view unless the reader has scrolled away from it.
// Depends on: GameLog.vue and src/useGameText.js.
// Props: feed (the lines the server sent this viewer: { n, kind: 'guess' | 'close' | 'correct' | 'chat', name, text }),
//   canGuess (may this viewer type), maxLength (the longest guess the server takes), placeholder (what the box
//   invites, in the game's own words; '' for "Your guess"), height (pixels; 0 fills whatever it is put in), bare
//   (true leaves off the panel and its title, for a game that puts it in a box that already has both).
// Emits: guess (the text typed).  Slots: none.
// Side effects: none beyond clearing its own input.
import { computed, ref } from 'vue';
import GameLog from './GameLog.vue';
import { useGameText } from '../useGameText.js';

const props = defineProps({
  feed: { type: Array, default: () => [] },
  canGuess: { type: Boolean, default: false },
  maxLength: { type: Number, default: 60 },
  placeholder: { type: String, default: '' },
  height: { type: Number, default: 0 },
  bare: { type: Boolean, default: false },
});
const emit = defineEmits(['guess']);
const { t } = useGameText();

const text = ref('');
// What the box invites.
const invitation = computed(() => props.placeholder || t('board.guessPlaceholder'));

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
</script>

<template>
  <section class="guess-panel" :class="{ panel: !bare, bare }" :style="{ height: height ? `${height}px` : '100%' }">
    <h3 v-if="!bare" class="title">{{ t('board.guesses') }}</h3>
    <div class="feed">
      <GameLog :entries="feed" :label="t('board.guesses')" :empty="t('board.nothingYet')">
        <template #default="{ entry }">
          <span class="line" :class="entry.kind">
            <template v-if="entry.kind === 'correct'">{{ t('board.gotIt', { name: entry.name }) }}</template>
            <template v-else>
              <span class="who">{{ entry.name }}</span>
              <span class="said">{{ entry.text }}</span>
              <em v-if="entry.kind === 'close'" class="hint">{{ t('board.close') }}</em>
            </template>
          </span>
        </template>
      </GameLog>
    </div>
    <form class="ask" @submit.prevent="send">
      <input v-model="text" type="text" autocomplete="off" :maxlength="maxLength" :disabled="!canGuess" :placeholder="invitation" :aria-label="invitation" />
      <button type="submit" class="primary" :disabled="!canGuess || !text.trim()">{{ t('board.send') }}</button>
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
.guess-panel.bare {
  padding: 0;
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
