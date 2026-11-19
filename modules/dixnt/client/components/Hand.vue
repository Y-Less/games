<script setup>
// Your hand, along the bottom of the main area.  The zone is a fixed size (the cards are sized for a full hand), so it
// never changes between phases or as cards are played.  Click a card to look closer; while cards are being played the
// closer look has the Play button.
//
// A card you have played leaves your hand at once, even though the game holds it back until the turn is over: the
// hand shown here is your hand without your pick.  Playing another card still swaps them, and the first one comes
// back into the hand as it goes.
//
// Props:
//   cardWidth   {number}  required.  Card width in pixels.
//   cardHeight  {number}  required.  Card height in pixels.
// Emits: none.  Slots: none.
// Side effects: sets store.zoom to open the card viewer; the Play button sends a `playCard` request.
import { computed } from 'vue';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';
import CardImg from './CardImg.vue';

defineProps({
  cardWidth: { type: Number, required: true },
  cardHeight: { type: Number, required: true },
});

const { t } = useGameText();
const { send, store } = useDixnt();

// The current state.
const state = computed(() => store.state);
// The cards still in your hand: the one you have played is not among them until the turn is over and it is replaced.
const hand = computed(() => state.value.hand.filter((cardId) => cardId !== state.value.myPick));
// True when the viewer may play a card now: the picking phase, and a turn they are in (everyone is, with no chooser).
const canPlay = computed(() => state.value.phase === 'picking' && state.value.playsCard);

/**
 * Builds the buttons the card viewer shows for one of your cards: a Play button while cards are being played.
 * @param {number} cardId  The card showing in the viewer.
 * @returns {Array<{label: string, primary: boolean, run: () => any}>} The actions (empty when you cannot play);
 *   each label is already in the player's language.
 * Side effects: none (the `run` callback sends `playCard`, which swaps your pick when you have already played).
 */
function actionsFor(cardId) {
  if (!canPlay.value) return [];
  return [{
    label: t(state.value.myPick === null ? 'table.playThis' : 'table.playInstead'),
    primary: true,
    run: () => send('playCard', { cardId }),
  }];
}

/**
 * Opens the card viewer on a card from your hand, with the whole hand to step through.
 * @param {number} cardId  The card clicked.
 * @returns {void}
 * Side effects: sets store.zoom.
 */
function open(cardId) {
  store.zoom = { cardId, cards: [...hand.value], actionsFor };
}
</script>

<template>
  <section class="hand" :aria-label="t('table.yourHand')" :style="{ '--card-w': `${cardWidth}px`, '--card-h': `${cardHeight}px` }">
    <div class="cards">
      <button
        v-for="cardId in hand"
        :key="cardId"
        class="slot"
        :class="{ dim: state.phase === 'picking' && state.myPick !== null }"
        :aria-label="t('table.card', { id: cardId })"
        @click="open(cardId)"
      >
        <CardImg :card-id="cardId" size="small" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.hand {
  height: 100%;
  min-height: 0;
}
.cards {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 10px;
}
.slot {
  position: relative;
  flex: none;
  width: var(--card-w);
  height: var(--card-h);
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: none;
  transition: transform 0.15s, opacity 0.15s, box-shadow 0.15s;
}
.slot :deep(.card-img) {
  height: 100%;
}
.slot:hover:not(:disabled) {
  background: none;
  transform: translateY(-6px);
}
.slot.dim {
  opacity: 0.55;
}
</style>
