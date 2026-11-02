<script setup>
// The Status box: the headline, the facts about the round and piles, the lines for what you are doing and, once the game is
// over, the standings with Play again and Show the scores.
// Props: state (the server view), banner (the headline), lines (the Status lines), mine (it is your move), finished (the game
//   is over), isHost (you may start another game), standings (final standings with names).
// Emits: again (Play again) and show-scores (open the scoreboard pop-up). Slots: none (fills GameStatus's facts slot).
// Side effects: none beyond the emits.
import GameStatus from '../../../src/components/GameStatus.vue';
import { useGameText } from '../../../src/useGameText.js';

defineProps({
  state: { type: Object, required: true },
  banner: { type: String, required: true },
  lines: { type: Array, required: true },
  mine: { type: Boolean, default: false },
  finished: { type: Boolean, default: false },
  isHost: { type: Boolean, default: false },
  standings: { type: Array, default: () => [] },
});
defineEmits(['again', 'show-scores']);
const { t, list } = useGameText();
// Card levels in display order, top first, for the piles' counts in the facts.
const levels = [3, 2, 1];
</script>

<template>
  <GameStatus :headline="banner" :mine="mine" :lines="lines">
    <template #facts>
      <strong>{{ t('round', { n: state.round }) }}</strong>
      <span>{{ t('facts.target', { n: state.settings.target }) }}</span>
      <span>{{ t('facts.piles', { piles: list(levels.map((l) => t('facts.pileCount', { count: state.decks[l], level: l }))) }) }}</span>
    </template>
    <template v-if="finished">
      <ol class="standings">
        <li v-for="x in standings" :key="x.seat">
          <b>{{ x.name }}</b> <span>{{ t('facts.prestigeCount', { n: x.prestige }) }}</span> <span class="muted">{{ list([t('facts.cardsCount', { count: x.cards }, x.cards), t('facts.noblesCount', { count: x.nobles }, x.nobles)]) }}</span>
        </li>
      </ol>
      <div class="end-actions">
        <button v-if="isHost" class="primary" @click="$emit('again')">{{ t('table.playAgain') }}</button>
        <span v-else class="muted">{{ t('status.waitingHost') }}</span>
        <button @click="$emit('show-scores')">{{ t('table.showScores') }}</button>
      </div>
    </template>
  </GameStatus>
</template>

<style scoped>
.standings {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.85rem;
}
.standings li {
  display: flex;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.end-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
</style>
