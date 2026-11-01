<script setup>
// Your side of the table: your name, window name and favour tokens above your window, and beside the window the draft pool,
// the turn buttons and the round track (those three are left out once the game is over).
// Props: me (your seat from the view), myTurn, finished (Booleans), grid (the window to show: the real one or a tool preview),
// highlight ({ legal, pick, chosen, titles } from useBoardClicks), pool (dice), chosenIds (pool die ids drawn as chosen),
// canUndo (Boolean), mode (tool in use or null), modeDie, toolParams (see TurnActions), slots (the round track), round (number),
// sizes ({ cell, die, perRow, poolHeight, trackDie } in px, from layout.js).
// Emits: cell (index), pool (die), track (die), end, undo, cancel, apply (extra parameters). All are passed straight on from
// the window, pool, buttons and track. Side effects: none.
import DicePool from './DicePool.vue';
import RoundTrack from './RoundTrack.vue';
import TokenDot from './TokenDot.vue';
import TurnActions from './TurnActions.vue';
import WindowGrid from './WindowGrid.vue';

defineProps({
  me: { type: Object, default: null },
  myTurn: { type: Boolean, default: false },
  finished: { type: Boolean, default: false },
  grid: { type: Array, required: true },
  highlight: { type: Object, required: true },
  pool: { type: Array, default: () => [] },
  chosenIds: { type: Array, default: () => [] },
  canUndo: { type: Boolean, default: false },
  mode: { type: Object, default: null },
  modeDie: { type: Object, default: null },
  toolParams: { type: Object, default: null },
  slots: { type: Array, required: true },
  round: { type: Number, default: 1 },
  sizes: { type: Object, required: true },
});
const emit = defineEmits(['cell', 'pool', 'track', 'end', 'undo', 'cancel', 'apply']);
</script>

<template>
  <section class="mine" :class="{ turn: myTurn }">
    <div class="head">
      <strong>{{ me?.name }}</strong><span class="muted">(you)</span>
      <span class="muted wname">{{ me?.window?.name }}</span>
      <span class="tokens" title="Favour tokens"><TokenDot v-for="n in me?.tokens ?? 0" :key="n" /><b>{{ me?.tokens }}</b> favour</span>
    </div>
    <div class="play">
      <WindowGrid
        v-if="me?.window"
        :rows="me.window.rows"
        :grid="grid"
        :cell="sizes.cell"
        :legal="highlight.legal"
        :pick="highlight.pick"
        :chosen="highlight.chosen"
        :titles="highlight.titles"
        :interactive="myTurn"
        label="Your window"
        @cell="emit('cell', $event)"
      />

      <div v-if="!finished" class="pool-col">
        <DicePool :pool="pool" :chosen-ids="chosenIds" :per-row="sizes.perRow" :min-height="sizes.poolHeight" :die-size="sizes.die" @pick="emit('pool', $event)" />
        <TurnActions :my-turn="myTurn" :can-undo="canUndo" :mode="mode" :mode-die="modeDie" :tool-params="toolParams" @end="emit('end')" @undo="emit('undo')" @cancel="emit('cancel')" @apply="emit('apply', $event)" />
        <RoundTrack :slots="slots" :round="round" :finished="finished" :mode="mode" :die-size="sizes.trackDie" @pick="emit('track', $event)" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.mine {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0.4rem 0 0.5rem;
}
.head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  height: 1.5rem;
  white-space: nowrap;
  overflow: hidden;
}
.wname {
  overflow: hidden;
  text-overflow: ellipsis;
}
.tokens {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.play {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.play :deep(.window) {
  flex: none;
}
.pool-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
