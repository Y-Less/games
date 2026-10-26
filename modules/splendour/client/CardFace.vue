<script setup>
// A development card drawn in CSS and SVG: prestige top left, the bonus gem top right, the cost down the left side.
// Without `card` it is the back of a card of the given level (a face-down reserved card, or a draw pile).
import { computed } from 'vue';
import { CARD_BY_ID } from '../cards.js';
import { GEM_FILL, GEM_NAMES } from './gems.js';
import Gem from './Gem.vue';

const props = defineProps({
  card: { type: String, default: null },
  level: { type: Number, default: 1 }, // for the back of a card
  need: { type: Array, default: null }, // what is left to pay after the owner's bonuses
  affordable: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  clickable: { type: Boolean, default: false },
  dimmed: { type: Boolean, default: false },
  small: { type: Boolean, default: false },
  count: { type: Number, default: null }, // for a pile: how many cards are left
});
defineEmits(['pick']);

const info = computed(() => (props.card ? CARD_BY_ID[props.card] : null));
const costs = computed(() => (info.value ? info.value.cost.flatMap((n, c) => (n > 0 ? [{ colour: c, cost: n, left: props.need ? props.need[c] : n }] : [])) : []));
const tint = computed(() => (info.value ? GEM_FILL[info.value.bonus] : '#3a4d57'));
const description = computed(() => {
  if (!info.value) return `A face-down level ${props.level} card`;
  const cost = costs.value.map((c) => `${c.left}${c.left !== c.cost ? ` (of ${c.cost})` : ''} ${GEM_NAMES[c.colour]}`).join(', ');
  return `Level ${info.value.level} card: ${info.value.points} prestige, gives a ${GEM_NAMES[info.value.bonus]} bonus. Cost ${cost}.`;
});
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    class="dev-card"
    :class="{ back: !card, affordable, selected, dimmed, small, clickable }"
    :style="{ '--tint': tint }"
    :title="description"
    :aria-label="description"
    :aria-pressed="clickable ? selected : undefined"
    @click="clickable && $emit('pick')"
  >
    <template v-if="info">
      <span class="top">
        <b class="points" :class="{ none: !info.points }">{{ info.points || '' }}</b>
        <Gem :colour="info.bonus" :size="small ? 17 : 25" />
      </span>
      <span class="costs">
        <span v-for="c in costs" :key="c.colour" class="cost" :class="{ paid: c.left === 0 }">
          <Gem :colour="c.colour" :size="small ? 15 : 20" :count="c.left" :faded="c.left === 0" />
          <small v-if="c.left !== c.cost" class="was">{{ c.cost }}</small>
        </span>
      </span>
      <span v-if="affordable" class="can">can buy</span>
    </template>
    <template v-else>
      <span class="level" aria-hidden="true">{{ 'I'.repeat(level) }}</span>
      <span v-if="count !== null" class="pile">{{ count }} left</span>
    </template>
  </component>
</template>

<style scoped>
/* Sizes are in em so the whole table scales with the window (see Table.vue). */
.dev-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: stretch;
  flex: none;
  box-sizing: border-box;
  width: 5.2em;
  height: 7em;
  padding: 0.35em 0.4em 0.4em;
  border-radius: 0.6em;
  border: 1px solid color-mix(in srgb, var(--tint) 55%, #000);
  background:
    radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--tint) 38%, transparent) 0, transparent 55%),
    linear-gradient(165deg, color-mix(in srgb, var(--tint) 24%, #20323b) 0%, #172830 70%);
  color: var(--parchment);
  text-align: left;
  font: inherit;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.45);
  overflow: hidden;
}
.dev-card.small {
  width: 3.4em;
  height: 4.6em;
  padding: 0.2em 0.25em 0.25em;
  border-radius: 0.45em;
}
button.dev-card {
  cursor: pointer;
  transition: box-shadow 0.12s, border-color 0.12s;
}
button.dev-card:hover:not(:disabled) {
  box-shadow: 0 0 0 2px var(--parchment), 0 3px 8px rgb(0 0 0 / 0.5);
}
.dev-card.selected,
button.dev-card.selected:hover {
  box-shadow: 0 0 0 3px var(--amber), 0 6px 14px rgb(0 0 0 / 0.55);
}
.dev-card.affordable {
  border-color: var(--moss);
}
.dev-card.affordable:not(.selected) {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--moss) 70%, transparent), 0 2px 6px rgb(0 0 0 / 0.45);
}
.dev-card.dimmed {
  opacity: 0.6;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.points {
  font-family: var(--display);
  font-size: 1.45em;
  line-height: 1;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
}
.small .points {
  font-size: 1em;
}
.costs {
  display: grid;
  grid-template-columns: repeat(2, auto);
  justify-content: start;
  gap: 0.1em 0.3em;
}
.cost {
  display: flex;
  align-items: center;
  gap: 0.1em;
}
.was {
  color: var(--muted);
  text-decoration: line-through;
  font-size: 0.55em;
}
.can {
  position: absolute;
  right: 0.3em;
  bottom: 0.3em;
  font-size: 0.5em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 0.4em;
  border-radius: 999px;
  background: var(--moss);
  color: #10230e;
  font-weight: 700;
}
.dev-card.back {
  align-items: center;
  justify-content: center;
  gap: 0.3em;
  background: var(--card-back, linear-gradient(160deg, #6b1a27, #3c0f18));
  border: 0.2em solid #f4efe3;
}
.level {
  font-family: var(--display);
  font-size: 1.3em;
  color: #f4efe3;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
  letter-spacing: 0.06em;
}
.small .level {
  font-size: 0.9em;
}
.pile {
  font-size: 0.6em;
  padding: 0 0.45em;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.55);
  color: #f4efe3;
}
</style>
