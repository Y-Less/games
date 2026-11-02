<script setup>
// Another player's details (what plays for them, their score, colour, and what they are doing now), in the standard player
// pop-up that opens from their chip in the score bar (with the host's Remove button, which is in popupProps).
// Props: popupProps (what usePlayerPopup gives the popup, or null when none is open), opened (that player, or null), stage
//   (what they are doing now, or an empty string).
// Slots: none.
// Emits: none.
// Side effects: none.
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import { useGameText } from '../../../src/useGameText.js';

defineProps({
  popupProps: { type: Object, default: null },
  opened: { type: Object, default: null },
  stage: { type: String, default: '' },
});
const { t } = useGameText();
</script>

<template>
  <PlayerPopup v-if="popupProps" v-bind="popupProps">
    <dl v-if="opened" class="facts">
      <template v-if="opened.ai">
        <dt>{{ t('popup.plays') }}</dt>
        <dd>{{ opened.ai.name }}</dd>
      </template>
      <dt>{{ t('popup.score') }}</dt>
      <dd>{{ opened.score }}</dd>
      <dt>{{ t('popup.colour') }}</dt>
      <dd><span class="dot" :style="{ background: opened.colour }" /></dd>
      <template v-if="stage">
        <dt>{{ t('popup.now') }}</dt>
        <dd>{{ stage }}</dd>
      </template>
    </dl>
  </PlayerPopup>
</template>

<style scoped>
.dot {
  display: inline-block;
  vertical-align: middle;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}
</style>
