<script setup>
// The show: each hand (and the box) laid out with the starter and an itemised count.
//
// Props:
//   state  {Object}  required.  The view during the show: show.entries ({ kind, seat, cards, items, total, after }), starter, seats, you.
// Emits: none.  Slots: none.
// Side effects: none (pure rendering).
import { computed } from 'vue';
import { rankOf, SUIT_SYMBOLS, suitOf } from '../../../shared/cards.js';
import { useGameText } from '../../../src/useGameText.js';
import CardRow from './CardRow.vue';
import { seatColour } from './colours.js';

const props = defineProps({ state: { type: Object, required: true } });
const { t, text } = useGameText();

// The hands to show, in order ([] when there is no show yet).
const entries = computed(() => props.state.show?.entries ?? []);
// Returns the cards as short symbols, each as rank then suit symbol, separated by spaces (no words in any language).
const cardSymbols = (cards) => cards.map((c) => `${rankOf(c)}${SUIT_SYMBOLS[suitOf(c)]}`).join(' ');
// Returns the name of a seat, marked "(you)" for the viewer.
const nameOf = (seat) => (seat === props.state.you ? t('show.you', { name: props.state.seats[seat].name }) : props.state.seats[seat].name);
// The heading of one entry: whose hand (or box) it is.
const titleOf = (entry) => t(entry.kind === 'crib' ? 'show.crib' : 'show.hand', { who: nameOf(entry.seat) });
</script>

<template>
  <div class="show stack">
    <div v-for="entry in entries" :key="`${entry.kind}-${entry.seat}`" class="entry" :style="{ borderLeftColor: seatColour(entry.seat) }">
      <h3>
        <span class="title">{{ titleOf(entry) }}</span>
        <strong class="total">{{ entry.total }}</strong>
      </h3>
      <div class="laid">
        <CardRow :cards="entry.cards" :highlight="[]" />
        <span class="plus muted">+</span>
        <CardRow :cards="[state.starter]" />
      </div>
      <ul v-if="entry.items.length" class="items">
        <li v-for="(item, i) in entry.items" :key="i">
          <span class="what">{{ text(item.label) }}</span>
          <span class="which muted">{{ cardSymbols(item.cards) }}</span>
          <strong class="pts">{{ item.points }}</strong>
        </li>
      </ul>
      <p v-else class="muted nothing">{{ t('show.nothing') }}</p>
      <p class="muted after">{{ t('show.after', { name: state.seats[entry.seat].name, score: entry.after }) }}</p>
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
