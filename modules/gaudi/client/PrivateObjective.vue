<script setup>
// Your private objective, laid out like a public objective card under its own heading: a chip showing its colour and shape,
// its name, what a die is worth at the top right and a one-line description.  On the table the description ends with the
// points so far.
// Props: colour (a colour key), points (number so far), showPoints (Boolean), badPrivate (Boolean, the scoring setting).
// Emits: hint (text, or '' when the pointer or focus leaves) for the Status box.  Side effects: none.
import { computed } from 'vue';
import CardFrame from './CardFrame.vue';
import CardSection from './CardSection.vue';
import { COLOUR_HEX, SHAPES } from './glyphs.js';
import { COLOUR_SHAPES } from '../rules.js';
import { useGameText } from '../../../src/useGameText.js';
import { privateRule, privateSummary } from './wording.js';

const { t } = useGameText();
const props = defineProps({
  colour: { type: String, required: true },
  points: { type: Number, default: 0 },
  showPoints: { type: Boolean, default: false },
  badPrivate: { type: Boolean, default: false },
});
const emit = defineEmits(['hint']);

const summary = computed(() => privateSummary(t, props.badPrivate));
const text = computed(() => (props.showPoints ? t('private.soFar', { text: summary.value.text, points: props.points }) : summary.value.text));
const hint = () => t('hints.private', { colour: t(`colours.${props.colour}`), rule: privateRule(t, props.badPrivate) });
</script>

<template>
  <CardSection :label="t('card.private')">
    <CardFrame
      class="private"
      :heading="t(`colours.${colour}`)"
      :text="text"
      tabindex="0"
      @mouseenter="emit('hint', hint())"
      @mouseleave="emit('hint', '')"
      @focus="emit('hint', hint())"
      @blur="emit('hint', '')"
    >
      <template #icon>
        <svg class="chip" viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
          <rect x="1" y="1" width="38" height="38" rx="8" :fill="COLOUR_HEX[colour]" />
          <path :d="SHAPES[COLOUR_SHAPES[colour]]" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="2" />
        </svg>
      </template>
      <template #cost>{{ summary.points }}</template>
    </CardFrame>
  </CardSection>
</template>

<style scoped>
.private.private {
  border-color: var(--amber);
}
.chip {
  flex: none;
}
</style>
