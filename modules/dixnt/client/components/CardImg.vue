<script setup>
// One card's picture, loaded lazily and not draggable. Sized by its parent's CSS.
//
// Props:
//   cardId  {number}  required. The card's number.
//   size    {string}  image size folder to load (default 'medium'; the hand uses 'small').
// Emits: none. Slots: none.
// Side effects: none (the browser fetches the image).
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';

const { t } = useGameText();
const { cardUrl } = useDixnt();

defineProps({
  cardId: { type: Number, required: true },
  size: { type: String, default: 'medium' },
});
</script>

<template>
  <img class="card-img" :src="cardUrl(cardId, size)" :alt="t('table.card', { id: cardId })" loading="lazy" draggable="false" />
</template>

<style scoped>
.card-img {
  display: block;
  width: 100%;
  aspect-ratio: 640 / 936;
  object-fit: cover;
  border-radius: 10px;
  background: var(--bg-sunken);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
}
</style>
