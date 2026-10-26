<script setup>
// Your hand, along the bottom of the main area. The zone is a fixed size (the cards are sized for a full hand), so it
// never changes between phases or as cards are played. Click a card to look closer; while cards are being played the
// closer look has the Play button.
import { computed } from 'vue';
import { useDixnt } from '../useDixnt.js';
import CardImg from './CardImg.vue';

defineProps({
  cardWidth: { type: Number, required: true },
  cardHeight: { type: Number, required: true },
});

const { send, store } = useDixnt();

const state = computed(() => store.state);
const canPlay = computed(() => state.value.phase === 'picking' && !state.value.me.isChooser && !state.value.me.waiting);

function actionsFor(cardId) {
  const actions = [];
  if (canPlay.value) {
    const chosen = state.value.me.myPick === cardId;
    actions.push({
      label: chosen ? 'Already played' : state.value.me.myPick === null ? 'Play this card' : 'Play this one instead',
      primary: true,
      run: () => !chosen && send('playCard', { cardId }),
    });
  }
  return actions;
}

function open(cardId) {
  store.zoom = { cardId, cards: [...state.value.me.hand], actionsFor };
}
</script>

<template>
  <section class="hand" aria-label="Your hand" :style="{ '--card-w': `${cardWidth}px`, '--card-h': `${cardHeight}px` }">
    <div class="cards">
      <button
        v-for="cardId in state.me.hand"
        :key="cardId"
        class="slot"
        :class="{ played: state.phase === 'picking' && state.me.myPick === cardId, dim: state.phase === 'picking' && state.me.myPick !== null && state.me.myPick !== cardId }"
        :aria-label="`Card ${cardId}${state.phase === 'picking' && state.me.myPick === cardId ? ', played' : ''}`"
        @click="open(cardId)"
      >
        <CardImg :card-id="cardId" size="small" />
        <span v-if="state.phase === 'picking' && state.me.myPick === cardId" class="badge">Played</span>
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
