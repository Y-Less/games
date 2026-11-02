<script setup>
// The score bar at the top of the table, with the scoreboard pop-up it opens.
// Props: state (the server view, for the scoreboard), finished (the game is over), isHost (you may start another game).
// Emits: again (the host chose Play again in the scoreboard pop-up). Other attributes (the player pop-up's props and
//   events) fall through to the scoreboard.
// Exposes: show() and close() for the scoreboard pop-up.
// Slots: none.
// Side effects: none beyond the emits.
import { ref } from 'vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { useGameText } from '../../../src/useGameText.js';

defineProps({
  state: { type: Object, required: true },
  finished: { type: Boolean, default: false },
  isHost: { type: Boolean, default: false },
});
const emit = defineEmits(['again']);
const { t } = useGameText();

// Template ref to the ScoreBoard component, so show() and close() can reach it.
const board = ref(null);
defineExpose({
  /**
   * Opens the scoreboard pop-up.
   * @returns {void}
   * Side effects: opens the pop-up.
   */
  show: () => board.value.show(),
  /**
   * Closes the scoreboard pop-up.
   * @returns {void}
   * Side effects: closes the pop-up.
   */
  close: () => board.value.close(),
});
</script>

<template>
  <ScoreBoard ref="board" :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :target="state.scoreboard.target" :finished="finished" :sticky="false" :round-popups="false">
    <template #footer>
      <button class="primary" data-autofocus @click="board.close()">{{ finished ? t('common.close') : t('scoreboard.continue') }}</button>
      <button v-if="finished && isHost" @click="emit('again'); board.close()">{{ t('table.playAgain') }}</button>
    </template>
  </ScoreBoard>
</template>
