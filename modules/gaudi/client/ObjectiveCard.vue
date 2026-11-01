<script setup>
// One public objective card: its name, its points per set and its rule. On your table it also says how many sets you have.
// Props: objective (card from the view), deal (Boolean, the windows phase: no personal count yet).
// Emits: hint (text, or '' when the pointer or focus leaves) for the Status box. Side effects: none.
import CardFrame from './CardFrame.vue';
import { objectiveHint } from './wording.js';

defineProps({ objective: { type: Object, required: true }, deal: { type: Boolean, default: false } });
const emit = defineEmits(['hint']);
</script>

<template>
  <CardFrame
    class="objective"
    :heading="objective.name"
    :text="objective.text"
    tabindex="0"
    @mouseenter="emit('hint', objectiveHint(objective))"
    @mouseleave="emit('hint', '')"
    @focus="emit('hint', objectiveHint(objective))"
    @blur="emit('hint', '')"
  >
    <template #cost>{{ objective.points }} per {{ objective.unit }}<template v-if="!deal && objective.mine"> · you {{ objective.mine.sets }}</template></template>
  </CardFrame>
</template>
