<script setup>
// Dixnt's card viewer: the shared lightbox (src/components/Lightbox.vue) showing one card, opened by setting
// store.zoom ({ cardId, cards?, actions? | actionsFor? }).  If the zoom carries the row of cards it came from, the
// viewer steps through them; each action (for example "Play this card") closes the viewer, then runs.
//
// Props: none.  Emits: none.  Slots: none.
// Side effects: sets store.zoom (to step or close); the shared lightbox listens to window keydown while mounted.
import { computed } from 'vue';
import Lightbox from '../../../../src/components/Lightbox.vue';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';
import CardImg from './CardImg.vue';

const { t } = useGameText();
const { store } = useDixnt();

// A zoom may carry the whole row of cards it came from (cards) so the viewer can step through them, and
// actionsFor(cardId) when the buttons depend on which card is showing.
// The cards that can be stepped through (empty when the zoom is a single card).
const cards = computed(() => store.zoom?.cards ?? []);
// The buttons for the card showing: computed per card when the zoom has `actionsFor`, otherwise its fixed `actions`.
const actions = computed(() => (store.zoom?.actionsFor ? store.zoom.actionsFor(store.zoom.cardId) : (store.zoom?.actions ?? [])));
// Where the card showing is in its row, in words.
const countText = computed(() => t('table.position', { n: cards.value.indexOf(store.zoom?.cardId) + 1, total: cards.value.length }));
</script>

<template>
  <Lightbox
    :open="Boolean(store.zoom)"
    :item="store.zoom?.cardId ?? null"
    :items="cards"
    :actions="actions"
    :label="t('table.cardPreview')"
    :previous-label="t('table.previousCard')"
    :next-label="t('table.nextCard')"
    :count-text="countText"
    @step="(cardId) => (store.zoom = { ...store.zoom, cardId })"
    @close="store.zoom = null"
  >
    <template #default="{ item }"><CardImg :card-id="item" size="medium" class="big" /></template>
  </Lightbox>
</template>

<style scoped>
.big {
  height: min(78vh, 760px);
  width: auto;
  max-width: 92vw;
}
</style>
