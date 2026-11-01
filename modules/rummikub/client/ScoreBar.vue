<script setup>
// The score bar at the top of the table, with the scoreboard pop-up it opens (showing last round's summary between rounds).
// Props: state (the server view: scoreboard, lastRound, seats, you), settings, players (the scoreboard's players with their
//   ready marks), finished, awaiting (the scores are waiting for you to close them), waiting (names still to close them).
// Slots: none.
// Emits: continue (the scores were closed between rounds). Other attributes (the player pop-up's props and events) fall
//   through to the scoreboard.
// Side effects: none beyond the emit.
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import RoundSummary from './RoundSummary.vue';

defineProps({
  state: { type: Object, required: true },
  settings: { type: Object, required: true },
  players: { type: Array, required: true },
  finished: { type: Boolean, default: false },
  awaiting: { type: Boolean, default: false },
  waiting: { type: Array, default: () => [] },
});
defineEmits(['continue']);
</script>

<template>
  <ScoreBoard :players="players" :rounds="state.scoreboard.rounds" :low-is-better="false" :finished="finished" :awaiting="awaiting" :waiting="waiting" :sticky="false" @continue="$emit('continue')">
    <template #round>
      <RoundSummary v-if="state.lastRound" :last-round="state.lastRound" :seats="state.seats" :settings="settings" :you="state.you" />
    </template>
  </ScoreBoard>
</template>
