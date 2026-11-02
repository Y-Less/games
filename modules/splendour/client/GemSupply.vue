<script setup>
// The gem supply: one button per gem colour (click to pick it for a take action) and the Gold, which is only gained by reserving.
// Props: supply (six counts), picks (the gem colours chosen so far), size (the gem size in px).
// Emits: pick(colour) when a gem stack is clicked.  Slots: none.
// Side effects: none.
import { useGameText } from '../../../src/useGameText.js';
import Gem from './Gem.vue';
import { GEM_KEYS } from './gems.js';

defineProps({
  supply: { type: Array, required: true },
  picks: { type: Array, required: true },
  size: { type: Number, required: true },
});
defineEmits(['pick']);
const { t } = useGameText();
// The name of a gem colour, from the locale file.
const gemName = (c) => t(`gems.${GEM_KEYS[c]}`);
</script>

<template>
  <section class="supply" :aria-label="t('table.supplyLabel')">
    <span class="row-title">{{ t('table.supply') }}</span>
    <div class="stacks">
      <button
        v-for="c in [0, 1, 2, 3, 4]"
        :key="c"
        class="stack-btn"
        :class="{ picked: picks.includes(c) }"
        :aria-pressed="picks.includes(c)"
        :aria-label="t('table.stackLabel', { gem: gemName(c), count: supply[c] }, supply[c])"
        @click="$emit('pick', c)"
      >
        <Gem :colour="c" :size="size" :count="supply[c]" :faded="supply[c] === 0" />
        <span v-if="picks.filter((x) => x === c).length" class="badge">{{ picks.filter((x) => x === c).length }}</span>
        <small class="muted">{{ gemName(c) }}</small>
      </button>
      <span class="stack-btn gold" :title="t('table.goldTitle')">
        <Gem :colour="5" :size="size" :count="supply[5]" :faded="supply[5] === 0" />
        <small class="muted">{{ gemName(5) }}</small>
      </span>
    </div>
  </section>
</template>

<style scoped>
.supply {
  flex: none;
}
.row-title {
  font-size: 0.65em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.supply .stacks {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.3em;
  margin-top: 0.2em;
}
.stack-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.05em;
  padding: 0.2em 0.1em 0.1em;
  border-radius: 0.7em;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
  min-width: 0;
}
span.stack-btn {
  opacity: 0.95;
}
.stack-btn small {
  font-size: 0.55em;
}
.stack-btn.picked {
  border-color: var(--amber);
  box-shadow: 0 0 0 2px var(--amber);
}
.badge {
  position: absolute;
  top: -0.4em;
  right: -0.2em;
  min-width: 1.2em;
  height: 1.2em;
  border-radius: 999px;
  background: var(--amber);
  color: var(--amber-ink);
  font-size: 0.7em;
  font-weight: 700;
  display: grid;
  place-items: center;
}
</style>
