<script setup>
// The pop-up over the middle of the table that shows another player's board (or your own summary) when their name is
// clicked in the score bar.  Nothing else on the table moves.
// Props: popupProps (what usePlayerPopup gives the popup, or null when none is open), seat (the opened seat's view, or null),
//   you (your seat number), turn (whose turn it is), finished (the game is over), gem (gem size in px).
// Slots: none.
// Emits: none (closing is handled by the popup's own events inside popupProps).
// Side effects: none.
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import PlayerBoard from './PlayerBoard.vue';

defineProps({
  popupProps: { type: Object, default: null },
  seat: { type: Object, default: null },
  you: { type: Number, required: true },
  turn: { type: Number, default: -1 },
  finished: { type: Boolean, default: false },
  gem: { type: Number, required: true },
});
</script>

<template>
  <PlayerPopup v-if="popupProps" v-bind="popupProps">
    <PlayerBoard v-if="seat" :seat="seat" :is-me="seat.seat === you" :is-turn="turn === seat.seat && !finished" :gem="gem" />
  </PlayerPopup>
</template>
