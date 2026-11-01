<script setup>
// The panel beside the dial (under it on a narrow screen): the clue, the one action of the moment, the final scores and
// the legend. The same blocks in every phase and for every role, so nothing moves: a block with nothing to show is empty.
// Props: state (the server view), view (the reactive game view), guess (the reactive guessing state), span (how many frame
//   columns it takes).
// Slots: none.
// Emits: none (typing and locking in go straight to `guess`).
// Side effects: the clue form and the Lock in button call sendClue and lockIn on `guess`.
import ActionBlock from './ActionBlock.vue';
import ClueBox from './ClueBox.vue';
import FinalScores from './FinalScores.vue';

defineProps({
  state: { type: Object, required: true },
  view: { type: Object, required: true },
  guess: { type: Object, required: true },
  span: { type: Number, required: true },
});
</script>

<template>
  <aside class="side" :style="{ gridColumn: `span ${span}` }" aria-label="Clue and guess">
    <ClueBox :clue="state.clue" :psychic-name="view.psychicName" :is-psychic="view.isPsychic" :playing="view.playing" />
    <ActionBlock
      v-model:clue-text="guess.clueText"
      :is-psychic="view.isPsychic"
      :clue-time="view.clueTime"
      :can-guess="view.canGuess"
      :team="view.team"
      :ready="view.team ? guess.needle !== null : guess.picked !== null"
      @send-clue="guess.sendClue"
      @lock-in="guess.lockIn"
    />
    <FinalScores v-if="state.phase === 'finished'" :standings="view.standings" />
    <p class="legend muted">
      <template v-if="view.team">One marker for the whole team. </template>The target has three bands: 4, 3 and 2 points.
      <span v-if="view.mine" class="mark"><span class="dot" :style="{ background: view.mine.colour }" />your colour</span>
    </p>
  </aside>
</template>

<style scoped>
.side {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.7rem 0.8rem;
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.legend {
  margin: auto 0 0;
  font-size: 0.85rem;
}
.mark {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: 0.5rem;
}
.dot {
  display: inline-block;
  vertical-align: middle;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}
</style>
