<script setup>
// One tool card.  Interactive (your table): a button that starts guided use of the tool, greyed when it cannot be used now,
// with the favour tokens already on it.  Not interactive (the windows phase): a plain card that only explains itself.
// Props: tool (card from the view), interactive (Boolean), active (Boolean, the tool in use), block (why it cannot be used, '' if it can).
// Emits: start (tool) when clicked or Enter is pressed; hint (text, or '' when the pointer or focus leaves) for the Status box.
// Side effects: none.
import CardFrame from './CardFrame.vue';
import TokenDot from './TokenDot.vue';
import { useGameText } from '../../../src/useGameText.js';
import { toolHint } from './wording.js';

const { t } = useGameText();
defineProps({
  tool: { type: Object, required: true },
  interactive: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  block: { type: String, default: '' },
});
const emit = defineEmits(['start', 'hint']);
</script>

<template>
  <CardFrame
    class="tool"
    :class="{ static: !interactive, active, usable: interactive && !block }"
    :heading="t(`tools.${tool.id}.name`)"
    :text="t(`tools.${tool.id}.text`)"
    :cost-title="interactive ? t(tool.spent ? 'card.costUsed' : 'card.costFresh') : undefined"
    :role="interactive ? 'button' : undefined"
    tabindex="0"
    :title="interactive ? block || t('card.clickToUse') : undefined"
    @click="interactive && emit('start', tool)"
    @keydown.enter.prevent="interactive && emit('start', tool)"
    @mouseenter="emit('hint', toolHint(t, tool))"
    @mouseleave="emit('hint', '')"
    @focus="emit('hint', toolHint(t, tool))"
    @blur="emit('hint', '')"
  >
    <template #cost>
      <template v-if="interactive">
        <TokenDot v-for="n in tool.spent" :key="n" class="spent" :title="t('card.tokensOnCard', { count: tool.spent }, tool.spent)" />
      </template>
      {{ t('card.costs', { n: tool.cost }) }}
    </template>
  </CardFrame>
</template>

<style scoped>
.card.tool {
  cursor: not-allowed;
  opacity: 0.8;
}
.card.tool.static {
  cursor: default;
  opacity: 1;
}
.card.tool.usable {
  cursor: pointer;
  opacity: 1;
}
.card.tool.usable:hover {
  border-color: var(--amber);
}
.card.tool.active {
  border-color: var(--amber);
  box-shadow: 0 0 0 1px var(--amber);
}
</style>
