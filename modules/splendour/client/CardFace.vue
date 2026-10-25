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
        <Gem :colour="info.bonus" :size="small ? 22 : 30" />
      </span>
      <span class="costs">
        <span v-for="c in costs" :key="c.colour" class="cost" :class="{ paid: c.left === 0 }">
          <Gem :colour="c.colour" :size="small ? 18 : 22" :count="c.left" :faded="c.left === 0" />
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
.dev-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: stretch;
  width: 104px;
  height: 142px;
  padding: 6px 7px 7px;
  border-radius: 10px;
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
  width: 78px;
  height: 108px;
  padding: 4px 5px 5px;
  border-radius: 8px;
}
button.dev-card {
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s;
}
button.dev-card:hover:not(:disabled) {
  transform: translateY(-3px);
}
.dev-card.selected {
  box-shadow: 0 0 0 3px var(--amber), 0 6px 14px rgb(0 0 0 / 0.55);
  transform: translateY(-4px);
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
  font-size: 1.7rem;
  line-height: 1;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
}
.small .points {
  font-size: 1.3rem;
}
.costs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.cost {
  display: flex;
  align-items: center;
  gap: 3px;
}
.was {
  color: var(--muted);
  text-decoration: line-through;
  font-size: 0.68rem;
}
.can {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--moss);
  color: #10230e;
  font-weight: 700;
}
.dev-card.back {
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  background: var(--card-back, linear-gradient(160deg, #6b1a27, #3c0f18));
  border: 3px solid #f4efe3;
}
.level {
  font-family: var(--display);
  font-size: 1.6rem;
  color: #f4efe3;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
  letter-spacing: 0.06em;
}
.pile {
  font-size: 0.72rem;
  padding: 0 0.45rem;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.55);
  color: #f4efe3;
}
</style>
