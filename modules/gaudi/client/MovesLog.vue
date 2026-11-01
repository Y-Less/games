<script setup>
// The "Recent moves" list: newest first, your own moves in the lighter colour. The box around it is a fixed size (GameFrame).
// Props: entries (the log from the view, { seat, text }), you (your seat number). Emits: none. Side effects: none.
import GameLog from '../../../src/components/GameLog.vue';

defineProps({ entries: { type: Array, required: true }, you: { type: Number, default: null } });
</script>

<template>
  <GameLog :entries="entries" newest-first empty="Nothing has happened yet." v-slot="{ entry }">
    <span :class="{ own: entry.seat === you }">{{ entry.text }}</span>
  </GameLog>
</template>

<style scoped>
.own {
  color: var(--parchment);
}
</style>
