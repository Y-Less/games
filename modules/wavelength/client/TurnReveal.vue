<script setup>
// The summary of one finished turn, shown in the scoreboard pop-up: the dial with every guess on it, the clue, and what each
// player (or the team) scored.
// Props: state (the server view: spectrum, result, bands, clue), markers (pins for the dial, from the result), nameOf
//   (function: a player's name), colourOf (function: a player's colour).
// Slots: none.
// Emits: none.
// Side effects: none.
import { useGameText } from '../../../src/useGameText.js';
import Dial from './Dial.vue';

defineProps({
  state: { type: Object, required: true },
  markers: { type: Array, required: true },
  nameOf: { type: Function, required: true },
  colourOf: { type: Function, required: true },
});
const { t } = useGameText();
</script>

<template>
  <section class="reveal stack" :aria-label="t('reveal.label')">
    <Dial :left="state.spectrum.left" :right="state.spectrum.right" :target="state.result.target" :bands="state.bands" :guesses="markers" :width="320" :reserve-slider="false" />
    <p class="muted clue-line">{{ t('reveal.clueLine', { name: state.result.psychicName, clue: state.clue, points: state.result.psychicPoints }) }}</p>
    <p v-if="state.result.team" class="muted clue-line">{{ t('reveal.teamLocked', { name: nameOf(state.result.lockedBy), points: state.result.psychicPoints }) }}</p>
    <ul v-else class="entries">
      <li v-for="e in state.result.entries" :key="e.id" class="row">
        <span class="dot" :style="{ background: colourOf(e.id) }" />
        <span class="name">{{ e.name }}</span>
        <span :class="e.bullseye ? 'exact' : e.points ? 'close' : 'miss'">{{ e.bullseye ? t('reveal.bullseye') : e.points ? t('reveal.inTarget') : t('reveal.missed') }}</span>
        <strong>+{{ e.points }}</strong>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.reveal {
  margin-bottom: 0.8rem;
  align-items: center;
}
.clue-line {
  margin: 0;
  text-align: center;
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
}
.dot {
  display: inline-block;
  vertical-align: middle;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}
.name {
  font-weight: 600;
}
.exact {
  color: var(--moss);
}
.close {
  color: var(--amber);
}
.miss {
  color: var(--muted);
}
</style>
