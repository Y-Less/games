<script setup>
// A noble tile: worth 3 prestige, visits a player whose card bonuses meet the requirement.
import { computed } from 'vue';
import { NOBLE_BY_ID } from '../cards.js';
import Gem from './Gem.vue';
import { GEM_NAMES } from './gems.js';

const props = defineProps({
  noble: { type: String, required: true },
  clickable: { type: Boolean, default: false },
  highlight: { type: Boolean, default: false },
  dimmed: { type: Boolean, default: false }, // not a choice while another noble is being chosen
  small: { type: Boolean, default: false },
  bonuses: { type: Array, default: null }, // the viewer's bonuses, to show how close they are
});
defineEmits(['pick']);

const info = computed(() => NOBLE_BY_ID[props.noble]);
const needs = computed(() => Object.entries(info.value.requires).map(([colour, count]) => ({ colour: Number(colour), count })));
const description = computed(() => `${props.clickable ? 'Choose ' : ''}${info.value.name}: worth ${info.value.points} prestige. Needs ${needs.value.map((n) => `${n.count} ${GEM_NAMES[n.colour]}`).join(', ')} cards.`);
</script>

<template>
  <component :is="clickable ? 'button' : 'div'" class="noble" :class="{ highlight, small, clickable, dimmed }" :title="description" :aria-label="description" @click="clickable && $emit('pick')">
    <svg class="crest" viewBox="0 0 24 24"  aria-hidden="true">
      <path d="M3 18 L2 7 L8 12 L12 4 L16 12 L22 7 L21 18 Z" fill="#e0a84a" stroke="#fff0c6" stroke-width="1" stroke-linejoin="round" />
      <rect x="3" y="19" width="18" height="2.4" rx="1" fill="#c8603f" />
    </svg>
    <b class="points">{{ info.points }}</b>
    <span class="name">{{ info.name }}</span>
    <span class="needs">
      <span v-for="n in needs" :key="n.colour" class="need" :class="{ met: bonuses && bonuses[n.colour] >= n.count }">
        <Gem :colour="n.colour" :size="small ? 15 : 18" :count="n.count" />
        <small v-if="bonuses" class="have">{{ Math.min(bonuses[n.colour], n.count) }}/{{ n.count }}</small>
      </span>
    </span>
  </component>
</template>

<style scoped>
.noble {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1em;
  flex: none;
  box-sizing: border-box;
  width: 5.2em;
  padding: 0.25em 0.3em 0.3em;
  border-radius: 0.7em;
  border: 1px solid #8a6a2c;
  background: linear-gradient(170deg, #3d3220 0%, #251d10 100%);
  color: var(--parchment);
  font: inherit;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.45), inset 0 0 0 2px rgb(224 168 74 / 0.18);
}
.noble.small {
  width: 4.2em;
  padding: 0.15em;
}
button.noble {
  cursor: pointer;
}
.noble.dimmed {
  opacity: 0.4;
}
.noble.clickable.highlight {
  animation: choose-me 1.4s ease-in-out infinite;
}
@keyframes choose-me {
  50% {
    box-shadow: 0 0 0 3px var(--amber), 0 0 16px 4px rgb(224 168 74 / 0.6);
  }
}
@media (prefers-reduced-motion: reduce) {
  .noble.clickable.highlight {
    animation: none;
  }
}
button.noble:hover {
  box-shadow: 0 0 0 2px var(--parchment), 0 3px 8px rgb(0 0 0 / 0.5);
}
.noble.highlight {
  box-shadow: 0 0 0 3px var(--amber), 0 4px 12px rgb(0 0 0 / 0.5);
}
.crest {
  position: absolute;
  left: 0.3em;
  top: 0.25em;
  width: 1.1em;
  height: 1.1em;
}
.points {
  font-family: var(--display);
  font-size: 1.25em;
  line-height: 1;
  color: var(--amber);
}
.name {
  font-size: 0.55em;
  text-align: center;
  line-height: 1.1;
  min-height: 2.2em;
  color: var(--muted);
}
.needs {
  display: flex;
  gap: 0.2em;
  flex-wrap: wrap;
  justify-content: center;
}
.need {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.have {
  font-size: 0.55em;
  color: var(--muted);
}
.need.met .have {
  color: var(--moss);
}
</style>
