<script setup>
// The summary of one finished turn, shown in the scoreboard pop-up: the dial with every guess on it, the clue, and what each
// player (or the team) scored.
// Props: state (the server view: spectrum, result, bands, clue), markers (pins for the dial, from the result), nameOf
//   (function: a player's name), colourOf (function: a player's colour).
// Emits: none.
// Side effects: none.
import Dial from './Dial.vue';

defineProps({
  state: { type: Object, required: true },
  markers: { type: Array, required: true },
  nameOf: { type: Function, required: true },
  colourOf: { type: Function, required: true },
});
</script>

<template>
  <section class="reveal stack" aria-label="This turn">
    <Dial :left="state.spectrum.left" :right="state.spectrum.right" :target="state.result.target" :bands="state.bands" :guesses="markers" :width="320" :reserve-slider="false" />
    <p class="muted clue-line">{{ state.result.psychicName }}'s clue: <strong>&ldquo;{{ state.clue }}&rdquo;</strong> &middot; {{ state.result.psychicName }} scores {{ state.result.psychicPoints }}.</p>
    <p v-if="state.result.team" class="muted clue-line">
      {{ nameOf(state.result.lockedBy) }} locked it in for the team: <strong>+{{ state.result.psychicPoints }} for everyone</strong>.
    </p>
    <ul v-else class="entries">
      <li v-for="e in state.result.entries" :key="e.id" class="row">
        <span class="dot" :style="{ background: colourOf(e.id) }" />
        <span class="name">{{ e.name }}</span>
        <span :class="e.bullseye ? 'exact' : e.points ? 'close' : 'miss'">{{ e.bullseye ? 'Bullseye' : e.points ? 'In the target' : 'Missed' }}</span>
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
