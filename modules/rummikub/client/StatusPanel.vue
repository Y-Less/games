<script setup>
// The Status box: the headline, the round, the pool, the first-meld target and the turn timer, the live message about your
// layout, and (once the game is over) Play again.
// Props: headline, mine (it is your move), lines (the Status lines), round, rounds (rounds in the game), poolCount, meld (the
//   first-meld target), showPoints (show how many points you have towards it), points (your layout's points), secondsLeft
//   (the turn timer, or null), finished, isHost.
// Emits: again (Play again).
// Side effects: none beyond the emit.
import GameStatus from '../../../src/components/GameStatus.vue';

defineProps({
  headline: { type: String, required: true },
  mine: { type: Boolean, default: false },
  lines: { type: Array, required: true },
  round: { type: Number, required: true },
  rounds: { type: Number, default: 1 },
  poolCount: { type: Number, default: 0 },
  meld: { type: Number, required: true },
  showPoints: { type: Boolean, default: false },
  points: { type: Number, default: 0 },
  secondsLeft: { type: Number, default: null },
  finished: { type: Boolean, default: false },
  isHost: { type: Boolean, default: false },
});
defineEmits(['again']);
</script>

<template>
  <GameStatus :headline="headline" :mine="mine" :lines="lines">
    <template #facts>
      <strong>Round {{ round }}<template v-if="rounds > 1"> of {{ rounds }}</template></strong>
      <span class="pool" :title="`${poolCount} tiles in the pool`"><span class="back" aria-hidden="true"></span>{{ poolCount }} in the pool</span>
      <span>First meld: {{ meld }} points<template v-if="showPoints"> (you have {{ points }})</template></span>
      <span v-if="secondsLeft !== null" class="timer" :class="{ low: secondsLeft <= 10 }" aria-label="Time left this turn">{{ secondsLeft }}s left</span>
    </template>
    <div v-if="finished" class="row">
      <button v-if="isHost" class="primary" @click="$emit('again')">Play again</button>
      <span v-else class="muted">Waiting for the host to play again.</span>
    </div>
  </GameStatus>
</template>

<style scoped>
.pool {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.back {
  display: inline-block;
  width: 0.8rem;
  height: 1.05rem;
  border-radius: 3px;
  border: 1px solid #b7a98a;
  background: repeating-linear-gradient(45deg, #6b5a3a, #6b5a3a 3px, #85714a 3px, #85714a 6px);
}
.timer {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--parchment);
}
.timer.low {
  color: var(--danger);
}
</style>
