<script setup>
// The show: each hand (and the box) laid out with the starter and an itemised count.
import { computed } from 'vue';
import { rankOf, SUIT_SYMBOLS, suitOf } from '../../../shared/cards.js';
import CardRow from './CardRow.vue';
import { seatColour } from './colours.js';

const props = defineProps({ state: { type: Object, required: true } });

const entries = computed(() => props.state.show?.entries ?? []);
const text = (cards) => cards.map((c) => `${rankOf(c)}${SUIT_SYMBOLS[suitOf(c)]}`).join(' ');
const nameOf = (seat) => props.state.seats[seat].name;
</script>

<template>
  <div class="show stack">
    <div v-for="entry in entries" :key="`${entry.kind}-${entry.seat}`" class="entry" :style="{ borderLeftColor: seatColour(entry.seat) }">
      <h3>
        <span class="title">{{ nameOf(entry.seat) }}<span v-if="entry.seat === state.you" class="muted"> (you)</span>: {{ entry.kind === 'crib' ? 'the box' : 'hand' }}</span>
        <strong class="total">{{ entry.total }}</strong>
      </h3>
      <div class="laid">
        <CardRow :cards="entry.cards" :highlight="[]" />
        <span class="plus muted">+</span>
        <CardRow :cards="[state.starter]" />
      </div>
      <ul v-if="entry.items.length" class="items">
        <li v-for="(item, i) in entry.items" :key="i">
          <span class="what">{{ item.label }}</span>
          <span class="which muted">{{ text(item.cards) }}</span>
          <strong class="pts">{{ item.points }}</strong>
        </li>
      </ul>
      <p v-else class="muted nothing">Nothing to count: a hand of nought.</p>
      <p class="muted after">{{ nameOf(entry.seat) }} is on {{ entry.after }}.</p>
    </div>
  </div>
</template>

<style scoped>
.entry {
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--line);
  border-left-width: 6px;
  border-radius: var(--radius);
  background: var(--bg-sunken);
}
h3 {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 1.05rem;
  margin-bottom: 0.4rem;
}
.total {
  margin-left: auto;
  color: var(--amber);
  font-size: 1.4rem;
  font-family: var(--display);
}
.laid {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.items {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.items li {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
}
.which {
  flex: 1;
  min-width: 0;
}
.pts {
  min-width: 1.5rem;
  text-align: right;
}
.nothing,
.after {
  margin: 0.4rem 0 0;
  font-size: 0.9rem;
}
</style>
