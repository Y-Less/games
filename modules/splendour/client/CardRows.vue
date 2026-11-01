<script setup>
// The three rows of development cards (level 3 at the top), each led by its face-down pile, which you can select to
// reserve its top card blind.
// Props: board (card ids per level, with empty slots), decks (cards left per level), afford (what you can afford, by card id),
//   needOf (function: a card's cost to you), selectedCard (id or null), selectedLevel (level of the selected pile or null).
// Emits: pick-card(id) and pick-deck(level).
// Side effects: none.
import CardFace from './CardFace.vue';

defineProps({
  board: { type: Object, required: true },
  decks: { type: Object, required: true },
  afford: { type: Object, default: () => ({}) },
  needOf: { type: Function, required: true },
  selectedCard: { type: String, default: null },
  selectedLevel: { type: Number, default: null },
});
defineEmits(['pick-card', 'pick-deck']);
const levels = [3, 2, 1];
</script>

<template>
  <div class="levels">
    <div v-for="level in levels" :key="level" class="level-row" :aria-label="`Level ${level} cards`">
      <button
        class="pile-button"
        :class="{ chosen: selectedLevel === level }"
        :disabled="!decks[level]"
        :title="`Reserve the top card of the level ${level} pile without seeing it`"
        :aria-label="`Level ${level} pile, ${decks[level]} cards. Select to reserve the top card.`"
        @click="$emit('pick-deck', level)"
      >
        <CardFace :level="level" :count="decks[level]" />
      </button>
      <template v-for="(id, slot) in board[level]" :key="`${level}-${slot}`">
        <CardFace v-if="id" clickable :card="id" :need="needOf(id)" :affordable="Boolean(afford?.[id])" :selected="selectedCard === id" @pick="$emit('pick-card', id)" />
        <span v-else class="empty-slot" aria-hidden="true" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.levels {
  grid-column: span 6;
  padding-bottom: 0.4em; /* room for the shadow cards behind each pile */
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.level-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.empty-slot {
  flex: none;
  width: 5.8em;
  height: 7.8em;
  box-sizing: border-box;
  border-radius: 0.6em;
  border: 2px dashed var(--line);
}
.pile-button {
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 0.6em;
  background: none;
  position: relative;
}
.pile-button::before,
.pile-button::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.6em;
  background: var(--card-back, #4a1420);
  border: 0.2em solid #f4efe3;
  z-index: -1;
  transform: translate(0.15em, 0.15em);
}
.pile-button::after {
  transform: translate(0.3em, 0.3em);
  opacity: 0.7;
}
.pile-button:hover:not(:disabled) {
  background: none;
}
.pile-button.chosen :deep(.dev-card) {
  box-shadow: 0 0 0 3px var(--amber);
}
.pile-button:disabled {
  opacity: 0.3;
}
</style>
