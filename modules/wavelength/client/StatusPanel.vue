<script setup>
// The Status box: the headline, the turn and the psychic, and the lines for what to do now.
// Props: headline, mine (it is your move), turn (the psychic is to give a clue), lines (the Status lines), state (the server
//   view: turn and turnsTotal), ended (the game is over), psychicName.
// Slots: none.
// Emits: none.
// Side effects: none.
import GameStatus from '../../../src/components/GameStatus.vue';
import { useGameText } from '../../../src/useGameText.js';

defineProps({
  headline: { type: String, required: true },
  mine: { type: Boolean, default: false },
  turn: { type: Boolean, default: false },
  lines: { type: Array, required: true },
  state: { type: Object, required: true },
  ended: { type: Boolean, default: false },
  psychicName: { type: String, required: true },
});
const { t } = useGameText();
</script>

<template>
  <GameStatus :headline="headline" :mine="mine" :turn="turn" :lines="lines">
    <template #facts>
      <strong v-if="!ended">{{ t('facts.turn', { n: state.turn, total: state.turnsTotal }) }}</strong>
      <strong v-else>{{ t('facts.gameOver') }}</strong>
      <span v-if="!ended">{{ t('facts.psychic', { name: psychicName }) }}</span>
    </template>
  </GameStatus>
</template>
