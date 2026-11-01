<script setup>
// The buttons for what you are doing, shown in the bottom row of your own board (the words are in the Status box):
// confirming a token return, buying or reserving the selected card, reserving from a pile, or confirming picked gems.
// Props: view (reactive table view), card (reactive card choice), take (reactive gem take), give (reactive token return),
//   shared (reactive shared choice state: sel, picks, busy), canPass (the server allows passing).
// Emits: pass. Slots: none.
// Side effects: the buttons call buy, reserve, cancel, setGold, confirmTake, clearPicks, confirmGive and clear on the
//   composables they are given.
defineProps({
  view: { type: Object, required: true },
  card: { type: Object, required: true },
  take: { type: Object, required: true },
  give: { type: Object, required: true },
  shared: { type: Object, required: true },
  canPass: { type: Boolean, default: false },
});
defineEmits(['pass']);
</script>

<template>
  <!-- Returning tokens: the confirm button; the tokens above are the selector -->
  <template v-if="view.pendingMine?.type === 'return'">
    <button class="primary" :disabled="give.giveTotal !== view.pendingMine.count || shared.busy" @click="give.confirmGive">Return {{ give.giveTotal }} of {{ view.pendingMine.count }}</button>
    <button v-if="give.giveTotal" class="quiet" @click="give.clear">Clear</button>
  </template>
  <!-- A card is selected -->
  <template v-else-if="shared.sel?.kind === 'card'">
    <button class="primary" :disabled="!card.quote || !view.myTurn || shared.busy" :title="!view.myTurn ? card.reserveWhy : !card.quote ? 'You cannot afford this card' : ''" @click="card.buy">Buy this card</button>
    <button v-if="!card.inReserve" :disabled="!card.canReserve || shared.busy" :title="card.reserveWhy" @click="card.reserve">Reserve<template v-if="card.goldLeft"> (+1 Gold)</template><template v-else> (no Gold left)</template></button>
    <span v-if="card.quote && card.quote.maxGold > card.quote.minGold" class="gold-choice">
      <span class="muted">Gold:</span>
      <button class="quiet" :disabled="card.goldUsed <= card.quote.minGold" aria-label="Use less Gold" @click="card.setGold(card.goldUsed - 1)">−</button>
      <b>{{ card.goldUsed }}</b>
      <button class="quiet" :disabled="card.goldUsed >= card.quote.maxGold" aria-label="Use more Gold" @click="card.setGold(card.goldUsed + 1)">+</button>
    </span>
    <button class="quiet" @click="card.cancel">Cancel</button>
  </template>
  <!-- A pile is selected -->
  <template v-else-if="shared.sel?.kind === 'deck'">
    <button class="primary" :disabled="!card.canReserve || shared.busy" :title="card.reserveWhy" @click="card.reserve">Reserve the top card</button>
    <button class="quiet" @click="card.cancel">Cancel</button>
  </template>
  <!-- Taking gems: the gems are chosen in the supply -->
  <template v-else-if="!view.pendingMine && !view.finished">
    <template v-if="shared.picks.length">
      <button class="primary" :disabled="!take.takeCheck.ok || !view.myTurn || shared.busy" @click="take.confirmTake">Take {{ shared.picks.length }} {{ shared.picks.length === 1 ? 'gem' : 'gems' }}</button>
      <button class="quiet" @click="take.clearPicks">Clear</button>
    </template>
    <button v-if="canPass" @click="$emit('pass')">Pass (nothing else is possible)</button>
  </template>
</template>

<style scoped>
.gold-choice {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.gold-choice button {
  padding: 0.05rem 0.6rem;
}
</style>
