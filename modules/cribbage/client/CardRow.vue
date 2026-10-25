<script setup>
// A row of small cards, optionally overlapped, used for sequences and the show.
import PlayingCard from '../../../src/components/PlayingCard.vue';

defineProps({ cards: { type: Array, required: true }, size: { type: String, default: 'sm' }, dim: { type: Boolean, default: false }, highlight: { type: Array, default: () => [] } });
</script>

<template>
  <div class="cards" :class="[size, { dim }]">
    <PlayingCard v-for="(card, i) in cards" :key="`${card}-${i}`" :card="card" :size="size" :class="{ lit: highlight.includes(card) }" />
  </div>
</template>

<style scoped>
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.dim {
  opacity: 0.45;
}
.cards :deep(.playing-card) {
  --w: clamp(2.4rem, 11vw, 3rem);
}
</style>
