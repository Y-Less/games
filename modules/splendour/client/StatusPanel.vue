<script setup>
// The Status box: the headline, the facts about the round and piles, the lines for what you are doing and, once the game is
// over, the standings with Play again and Show the scores.
// Props: state (the server view), banner (the headline), lines (the Status lines), mine (it is your move), finished (the game
//   is over), isHost (you may start another game), standings (final standings with names).
// Emits: again (Play again) and show-scores (open the scoreboard pop-up).
// Side effects: none beyond the emits.
import GameStatus from '../../../src/components/GameStatus.vue';

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
const levels = [3, 2, 1];
</script>

<template>
  <GameStatus :headline="banner" :mine="mine" :lines="lines">
    <template #facts>
      <strong>Round {{ state.round }}</strong>
      <span>First to {{ state.settings.target }} prestige</span>
      <span>Piles left: {{ levels.map((l) => `${state.decks[l]} (level ${l})`).join(', ') }}</span>
    </template>
    <template v-if="finished">
      <ol class="standings">
        <li v-for="x in standings" :key="x.seat">
          <b>{{ x.name }}</b> <span>{{ x.prestige }} prestige</span> <span class="muted">{{ x.cards }} {{ x.cards === 1 ? 'card' : 'cards' }}, {{ x.nobles }} {{ x.nobles === 1 ? 'noble' : 'nobles' }}</span>
        </li>
      </ol>
      <div class="end-actions">
        <button v-if="isHost" class="primary" @click="$emit('again')">Play again</button>
        <span v-else class="muted">Waiting for the host to start another game, or leave (top right).</span>
        <button @click="$emit('show-scores')">Show the scores</button>
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
