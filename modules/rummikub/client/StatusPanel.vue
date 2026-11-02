<script setup>
// The Status box: the headline, the round, the pool, the first-meld target and the turn timer, the live message about your
// layout, and (once the game is over) Play again.
// Props: headline, mine (it is your move), lines (the Status lines), round, rounds (rounds in the game), poolCount, meld (the
//   first-meld target), showPoints (show how many points you have towards it), points (your layout's points), secondsLeft
//   (the turn timer, or null), finished, isHost.
// Slots: none.
// Emits: again (Play again).
// Side effects: none beyond the emit.
import GameStatus from '../../../src/components/GameStatus.vue';
import { useGameText } from '../../../src/useGameText.js';

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
const { t } = useGameText();
</script>

<template>
  <GameStatus :headline="headline" :mine="mine" :lines="lines">
    <template #facts>
      <strong>{{ rounds > 1 ? t('facts.roundOf', { n: round, total: rounds }) : t('round', { n: round }) }}</strong>
      <span class="pool" :title="t('facts.poolTitle', { count: poolCount }, poolCount)"><span class="back" aria-hidden="true"></span>{{ t('facts.pool', { count: poolCount }) }}</span>
      <span>{{ showPoints ? t('facts.meldWithPoints', { n: meld, points }) : t('facts.meld', { n: meld }) }}</span>
      <span v-if="secondsLeft !== null" class="timer" :class="{ low: secondsLeft <= 10 }" :aria-label="t('facts.timeLeft')">{{ t('facts.secondsLeft', { n: secondsLeft }) }}</span>
    </template>
    <div v-if="finished" class="row">
      <button v-if="isHost" class="primary" @click="$emit('again')">{{ t('table.playAgain') }}</button>
      <span v-else class="muted">{{ t('status.waitingHostAgain') }}</span>
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
