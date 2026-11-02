<script setup>
// Your hand, along the bottom of the main area. The zone is a fixed size (the cards are sized for a full hand), so it
// never changes between phases or as cards are played. Click a card to look closer; while cards are being played the
// closer look has the Play button.
//
// Props:
//   cardWidth   {number}  required. Card width in pixels.
//   cardHeight  {number}  required. Card height in pixels.
// Emits: none. Slots: none.
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
// True when the viewer may play a card now: picking phase, and not the chooser or waiting for the next round.
const canPlay = computed(() => state.value.phase === 'picking' && !state.value.me.isChooser && !state.value.me.waiting);

/**
 * Builds the buttons the card viewer shows for one of your cards: a Play button while cards are being played.
 * @param {number} cardId  The card showing in the viewer.
 * @returns {Array<{label: string, primary: boolean, run: () => any}>} The actions (empty when you cannot play);
 *   each label is already in the player's language.
 * Side effects: none (the `run` callback sends `playCard` unless that card is already the one played).
 */
function actionsFor(cardId) {
  const actions = [];
  if (canPlay.value) {
    const chosen = state.value.me.myPick === cardId;
    actions.push({
      label: t(chosen ? 'table.alreadyPlayed' : state.value.me.myPick === null ? 'table.playThis' : 'table.playInstead'),
      primary: true,
      run: () => !chosen && send('playCard', { cardId }),
    });
  }
  return actions;
}

/**
 * Opens the card viewer on a card from your hand, with the whole hand to step through.
 * @param {number} cardId  The card clicked.
 * @returns {void}
 * Side effects: sets store.zoom.
 */
function open(cardId) {
  store.zoom = { cardId, cards: [...state.value.me.hand], actionsFor };
}
</script>

<template>
  <section class="hand" :aria-label="t('table.yourHand')" :style="{ '--card-w': `${cardWidth}px`, '--card-h': `${cardHeight}px` }">
    <div class="cards">
      <button
        v-for="cardId in state.me.hand"
        :key="cardId"
        class="slot"
        :class="{ played: state.phase === 'picking' && state.me.myPick === cardId, dim: state.phase === 'picking' && state.me.myPick !== null && state.me.myPick !== cardId }"
        :aria-label="t(state.phase === 'picking' && state.me.myPick === cardId ? 'table.cardPlayed' : 'table.card', { id: cardId })"
        @click="open(cardId)"
      >
        <CardImg :card-id="cardId" size="small" />
        <span v-if="state.phase === 'picking' && state.me.myPick === cardId" class="badge">{{ t('table.played') }}</span>
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
.slot.played {
  box-shadow: 0 0 0 3px var(--amber);
}
.slot.dim {
  opacity: 0.55;
}
.badge {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  background: var(--amber);
  color: var(--amber-ink);
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
}
</style>
