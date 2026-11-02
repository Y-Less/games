<script setup>
// The "Recent moves" list: newest first, your own moves in the lighter colour. The box around it is a fixed size (GameFrame).
// Props: entries (the log from the view: messages, `{ seat, key, params }`, which `text()` puts into the player's
// language), you (your seat number). Emits: none. Side effects: none.
import GameLog from '../../../src/components/GameLog.vue';
import { useGameText } from '../../../src/useGameText.js';

defineProps({ entries: { type: Array, required: true }, you: { type: Number, default: null } });
const { t, text } = useGameText();
</script>

<template>
  <GameLog :entries="entries" newest-first :empty="t('log.empty')" v-slot="{ entry }">
    <span :class="{ own: entry.seat === you }">{{ text(entry) }}</span>
  </GameLog>
</template>

<style scoped>
.own {
  color: var(--parchment);
}
</style>
