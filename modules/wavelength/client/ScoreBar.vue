<script setup>
// The score bar at the top of the table, with the scoreboard pop-up it opens (showing the turn's summary).
// Props: state (the server view), view (the reactive game view, for the ready marks and names).
// Slots: none.
// Emits: ready (the scores were closed after a reveal). Other attributes (the player pop-up's props and events) fall
//   through to the scoreboard.
// Side effects: none beyond the emit.
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import TurnReveal from './TurnReveal.vue';

defineProps({
  state: { type: Object, required: true },
  view: { type: Object, required: true },
});
defineEmits(['ready']);
</script>

<template>
  <ScoreBoard :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :finished="state.phase === 'finished'" :awaiting="view.reveal && !view.mine?.ready" :waiting="view.waitingFor" :sticky="false" @continue="$emit('ready')">
    <template #round>
      <TurnReveal v-if="state.result && state.spectrum" :state="state" :markers="view.popupMarkers" :name-of="view.nameOf" :colour-of="view.colourOf" />
    </template>
  </ScoreBoard>
</template>
