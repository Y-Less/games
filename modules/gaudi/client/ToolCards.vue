<script setup>
// The group of tool cards: in the right-hand column (clickable) or, with `deal`, in the windows phase (explanations only).
// Props: tools (from the view), deal (Boolean), activeId (the tool in use, or null), blockOf (function: tool -> why it cannot
// be used, '' if it can).
// Emits: start (tool), hint (text) as the cards do. Side effects: none.
import CardSection from './CardSection.vue';
import ToolCard from './ToolCard.vue';

defineProps({
  tools: { type: Array, required: true },
  deal: { type: Boolean, default: false },
  activeId: { type: String, default: null },
  blockOf: { type: Function, default: () => () => '' },
});
const emit = defineEmits(['start', 'hint']);
</script>

<template>
  <CardSection label="Tool cards" :deal="deal">
    <ToolCard v-for="tool in tools" :key="tool.id" :tool="tool" :interactive="!deal" :active="activeId === tool.id" :block="blockOf(tool)" @start="emit('start', $event)" @hint="emit('hint', $event)" />
  </CardSection>
</template>
