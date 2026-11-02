<script setup>
// The round track: one slot per round holding the dice left over from that round.  Exchange can take a die from it.
// Props: slots (array of dice arrays or null, one per round), round (the current round), finished (Boolean), mode (the tool in
// use, or null), dieSize (px), chosenId (the track die chosen for Exchange, or null).
// Emits: pick (die) when a die on the track is clicked.  Side effects: none.
import Die from './Die.vue';
import { useGameText } from '../../../src/useGameText.js';

const { t } = useGameText();
defineProps({
  slots: { type: Array, required: true },
  round: { type: Number, default: 1 },
  finished: { type: Boolean, default: false },
  mode: { type: Object, default: null },
  dieSize: { type: Number, required: true },
});
const emit = defineEmits(['pick']);
</script>

<template>
  <div class="track" role="group" :aria-label="t('board.track')">
    <div v-for="(dice, i) in slots" :key="i" class="slot" :class="{ now: i + 1 === round && !finished }" :title="t('scores.round', { n: i + 1 })">
      <span class="muted n">{{ i + 1 }}</span>
      <div class="slot-dice">
        <div v-for="d in dice ?? []" :key="d.id" class="track-die" :class="{ chosen: mode?.trackDie === d.id, live: mode?.kind === 'exchange' }" :role="mode?.kind === 'exchange' ? 'button' : undefined" @click="emit('pick', d)">
          <Die :die="d" :size="dieSize" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.track {
  flex: none;
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 4px;
}
.slot {
  height: 4.4rem;
  padding: 0.15rem 0.2rem;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-sunken) 80%, transparent);
}
.slot.now {
  border-color: var(--amber);
}
.slot .n {
  font-size: 0.7rem;
  line-height: 1;
}
.slot-dice {
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  align-content: flex-start;
  height: calc(100% - 0.8rem);
  gap: 2px;
}
.track-die {
  border: 2px solid transparent;
  border-radius: 6px;
  line-height: 0;
}
.track-die.live {
  cursor: pointer;
}
.track-die.live:hover {
  border-color: #5b7885;
}
.track-die.chosen {
  border-color: var(--amber);
}
</style>
