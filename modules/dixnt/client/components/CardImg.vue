<script setup>
import { useDixnt } from '../useDixnt.js';

const { cardUrl } = useDixnt();

defineProps({
  cardId: { type: Number, required: true },
  size: { type: String, default: 'medium' },
});
</script>

<template>
  <img class="card-img" :src="cardUrl(cardId, size)" :alt="`Card ${cardId}`" loading="lazy" draggable="false" />
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
