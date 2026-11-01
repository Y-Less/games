<script setup>
// Your side of the table: your own board, big, with your action buttons in its bottom row, and the gem supply under it.
// Props: state (the server view), view, card, take, give (the reactive table view and choices), shared (reactive shared choice
//   state), boardGem and supplyGem (gem sizes in px, from the frame's area).
// Emits: pass (the player passes because nothing else is possible). Slots: none (fills PlayerBoard's `actions` slot).
// Side effects: clicking your cards, your tokens or the supply calls the matching function on `card`, `give` or `take`.
import PlayerBoard from './PlayerBoard.vue';
import ActionBar from './ActionBar.vue';
import GemSupply from './GemSupply.vue';

defineProps({
  state: { type: Object, required: true },
  view: { type: Object, required: true },
  card: { type: Object, required: true },
  take: { type: Object, required: true },
  give: { type: Object, required: true },
  shared: { type: Object, required: true },
  boardGem: { type: Number, required: true },
  supplyGem: { type: Number, required: true },
});
defineEmits(['pass']);
</script>

<template>
  <div class="mine-col">
    <PlayerBoard
      v-if="view.me"
      class="mine-board"
      :seat="view.me"
      is-me
      :is-turn="view.turnIsMine && !view.finished"
      :afford="state.afford ?? {}"
      :selected="card.selectedCard"
      :interactive="!view.finished"
      large
      :gem="boardGem"
      :pick-tokens="view.pendingMine?.type === 'return'"
      :give="shared.giveBack"
      @pick="card.pickCard"
      @token="give.clickToken"
    >
      <template #actions>
        <ActionBar :view="view" :card="card" :take="take" :give="give" :shared="shared" :can-pass="Boolean(state.canPass)" @pass="$emit('pass')" />
      </template>
    </PlayerBoard>
    <GemSupply :supply="view.supply" :picks="shared.picks" :size="supplyGem" @pick="take.clickGem" />
  </div>
</template>

<style scoped>
/* your board, big, with the gem supply under it */
.mine-col {
  grid-column: span 4;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0.6em;
}
.mine-board {
  flex: none;
}
</style>
