<script setup>
// Another player's details (their tile count, first meld, score and whether it is their turn), in the panel of the standard
// player pop-up that opens from their chip in the score bar. It floats over the main area, so nothing moves.
// Props: popupProps (what usePlayerPopup gives the popup, or null when none is open), opened (the opened seat's view, or
//   null), score (their score), playing (the game is in play), turn (whose turn it is).
// Slots: none.
// Emits: none (closing is handled by the popup's own events inside popupProps).
// Side effects: none.
import PlayerPopup from '../../../src/components/PlayerPopup.vue';

defineProps({
  popupProps: { type: Object, default: null },
  opened: { type: Object, default: null },
  score: { type: Number, default: 0 },
  playing: { type: Boolean, default: false },
  turn: { type: Number, default: -1 },
});
</script>

<template>
  <PlayerPopup v-if="popupProps" v-bind="popupProps">
    <dl v-if="opened" class="facts">
      <dt>Tiles in rack</dt>
      <dd>{{ opened.count }}</dd>
      <dt>First meld</dt>
      <dd>{{ opened.melded ? 'made' : 'not yet' }}</dd>
      <dt>Score</dt>
      <dd>{{ score }}</dd>
      <dt>Turn</dt>
      <dd>{{ playing && turn === opened.seat ? 'playing now' : 'waiting' }}</dd>
    </dl>
  </PlayerPopup>
</template>

<style scoped>
.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.2rem 1rem;
  margin: 0;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
