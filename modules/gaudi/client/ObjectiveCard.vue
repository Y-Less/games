<script setup>
// One public objective card: its name, its points per set and its rule. On your table it also says how many sets you have.
// Props: objective (card from the view), deal (Boolean, the windows phase: no personal count yet).
// Emits: hint (text, or '' when the pointer or focus leaves) for the Status box. Side effects: none.
import CardFrame from './CardFrame.vue';
import { useGameText } from '../../../src/useGameText.js';
import { objectiveHint, objectiveRate } from './wording.js';

const { t } = useGameText();
defineProps({ objective: { type: Object, required: true }, deal: { type: Boolean, default: false } });
const emit = defineEmits(['hint']);
</script>

<template>
  <CardFrame
    class="objective"
    :heading="t(`objectives.${objective.id}.name`)"
    :text="t(`objectives.${objective.id}.text`)"
    tabindex="0"
    @mouseenter="emit('hint', objectiveHint(t, objective))"
    @mouseleave="emit('hint', '')"
    @focus="emit('hint', objectiveHint(t, objective))"
    @blur="emit('hint', '')"
  >
    <template #cost>{{ objectiveRate(t, objective) }}<template v-if="!deal && objective.mine"> · {{ t('card.youHave', { n: objective.mine.sets }) }}</template></template>
  </CardFrame>
</template>
