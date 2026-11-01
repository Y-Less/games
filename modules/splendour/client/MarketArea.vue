<script setup>
// The market: the nobles (two columns of the frame's grid) beside the three rows of cards (six columns).
// Props: state (the server view: nobles, board, decks, afford), view (the reactive table view), card (the reactive card choice),
//   noble (the reactive token-return and noble choice).
// Emits: none (clicks go straight to the card and noble choices it is given).
// Side effects: clicking a card, a pile or a noble calls the matching function on `card` or `noble`.
import CardRows from './CardRows.vue';
import NobleRow from './NobleRow.vue';

defineProps({
  state: { type: Object, required: true },
  view: { type: Object, required: true },
  card: { type: Object, required: true },
  noble: { type: Object, required: true },
});
</script>

<template>
  <section class="market" aria-label="The cards">
    <NobleRow :nobles="state.nobles" :bonuses="view.bonuses" :choosing="noble.choosingNoble" :can-pick="noble.canPickNoble" @pick="noble.chooseNoble" />
    <CardRows
      :board="state.board"
      :decks="state.decks"
      :afford="state.afford ?? {}"
      :need-of="view.needOf"
      :selected-card="card.selectedCard"
      :selected-level="card.selectedLevel"
      @pick-card="card.pickCard"
      @pick-deck="card.pickDeck"
    />
  </section>
</template>

<style scoped>
.market {
  grid-column: span 8;
  display: grid;
  grid-template-columns: subgrid; /* nobles: 2 columns, cards: 6 */
  grid-template-rows: minmax(0, 1fr);
}
</style>
