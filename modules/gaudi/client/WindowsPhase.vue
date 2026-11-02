<script setup>
// The first step of the game: everyone picks one of the windows on offer at the same time, with the cards dealt for this game
// shown below. The pick is kept here until it is confirmed.
// Props: state (the server's view), optionCell (px size of a space in the offered windows), send (sends a request to the server).
// Emits: hint (text, or '' when the pointer leaves) for the Status box.
// Side effects: "Choose this window" sends a 'window' request; the pick is cleared once the server accepts it.
import { ref } from 'vue';
import ObjectiveCards from './ObjectiveCards.vue';
import PrivateObjective from './PrivateObjective.vue';
import ToolCards from './ToolCards.vue';
import TokenDot from './TokenDot.vue';
import WindowGrid from './WindowGrid.vue';
import { useGameText } from '../../../src/useGameText.js';

const { t } = useGameText();
const props = defineProps({
  state: { type: Object, required: true },
  optionCell: { type: Number, required: true },
  send: { type: Function, required: true },
});
const emit = defineEmits(['hint']);

const picked = ref(null); // the window chosen but not yet confirmed

/**
 * Sends the window picked in the options. The pick is kept if the server refuses it, and cleared once it is accepted.
 * @returns {Promise<void>} resolves when the server has answered (immediately if nothing is picked)
 * Side effects: sends 'window'; clears picked on success.
 */
async function chooseWindow() {
  if (!picked.value) return;
  const reply = await props.send('window', { pid: picked.value });
  if (reply.ok) picked.value = null;
}

/**
 * Picks an offered window (nothing happens once you have chosen).
 * @param {string} pid  the window's id
 * @returns {void}
 * Side effects: sets picked (unless the choice is already locked in).
 */
const pick = (pid) => {
  if (!props.state.chosen) picked.value = pid;
};
</script>

<template>
  <section class="windows-phase" :aria-label="t('windows.title')">
    <div v-if="state.options.length" class="options">
      <div
        v-for="o in state.options"
        :key="o.pid"
        class="option"
        :class="{ picked: picked === o.pid || state.chosen === o.pid, locked: Boolean(state.chosen) }"
        :role="state.chosen ? undefined : 'button'"
        :tabindex="state.chosen ? undefined : 0"
        @click="pick(o.pid)"
        @keydown.enter.prevent="pick(o.pid)"
      >
        <WindowGrid :rows="o.rows" :cell="optionCell" :label="t(`patterns.${o.pid}`)" />
        <div class="option-info">
          <strong>{{ t(`patterns.${o.pid}`) }}</strong>
          <span class="tokens" :title="t('windows.tokens', { count: o.difficulty }, o.difficulty)"><TokenDot v-for="n in o.difficulty" :key="n" />{{ t('windows.tokens', { count: o.difficulty }, o.difficulty) }}</span>
        </div>
      </div>
    </div>
    <div class="row choose-row">
      <button class="primary" :disabled="!picked || Boolean(state.chosen)" @click="chooseWindow">{{ t('windows.choose') }}</button>
    </div>
    <div v-if="state.privateObjective" class="deal" :aria-label="t('windows.deal')">
      <ToolCards :tools="state.tools" deal @hint="emit('hint', $event)" />
      <ObjectiveCards :objectives="state.publicObjectives" deal @hint="emit('hint', $event)" />
      <PrivateObjective :colour="state.privateObjective.colour" :bad-private="Boolean(state.badPrivate)" @hint="emit('hint', $event)" />
    </div>
  </section>
</template>

<style scoped>
.windows-phase {
  grid-column: 1 / -1;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
}
.options {
  display: flex;
  justify-content: center;
  gap: 1rem;
}
.option {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem;
  border: 2px solid var(--line);
  border-radius: 12px;
  background: var(--bg-sunken);
}
.option[role='button'] {
  cursor: pointer;
}
.option[role='button']:hover {
  border-color: #5b7885;
}
.option.picked {
  border-color: var(--amber);
}
.option.locked:not(.picked) {
  opacity: 0.55;
}
.option-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.tokens {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.choose-row {
  flex: none;
}
.deal {
  flex: none;
  width: 100%;
  display: grid;
  grid-template-columns: 5fr 5fr 2fr;
  gap: 12px;
  align-items: start;
}
</style>
