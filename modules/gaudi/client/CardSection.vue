<script setup>
// A titled group of cards (Tool cards, Public objectives): a small heading and the cards below it.  In the right-hand column
// the cards stack; with `deal` (the windows phase) they sit three to a row.
// Props: label (heading and aria-label), deal (Boolean, three to a row).  Slots: default (the cards).
// Emits: none.  Side effects: none.
defineProps({ label: { type: String, required: true }, deal: { type: Boolean, default: false } });
</script>

<template>
  <section class="furniture" :aria-label="label">
    <span class="row-title">{{ label }}</span>
    <div :class="deal ? 'deal-items' : 'items'"><slot /></div>
  </section>
</template>

<style scoped>
.furniture {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row-title {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  line-height: 1.1;
}
.items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.deal-items {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
</style>
