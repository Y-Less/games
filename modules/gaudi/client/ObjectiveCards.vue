<script setup>
// The group of public objective cards: in the right-hand column or, with `deal`, in the windows phase.
// Props: objectives (from the view), deal (Boolean). Emits: hint (text) as the cards do. Side effects: none.
import CardSection from './CardSection.vue';
import ObjectiveCard from './ObjectiveCard.vue';

defineProps({ objectives: { type: Array, required: true }, deal: { type: Boolean, default: false } });
const emit = defineEmits(['hint']);
</script>

<template>
  <CardSection label="Public objectives" :deal="deal">
    <ObjectiveCard v-for="o in objectives" :key="o.id" :objective="o" :deal="deal" @hint="emit('hint', $event)" />
  </CardSection>
</template>
