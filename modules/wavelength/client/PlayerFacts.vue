<script setup>
// Another player's details (what plays for them, their score, colour and what they are doing now), in the standard player
// pop-up that opens from their chip in the score bar (with the host's Remove button, which is in popupProps).
// Props: popupProps (what usePlayerPopup gives the popup, or null when none is open), opened (that player, or null), stage
//   (what they are doing now, or an empty string).
// Emits: none.
// Side effects: none.
import PlayerPopup from '../../../src/components/PlayerPopup.vue';

defineProps({
  popupProps: { type: Object, default: null },
  opened: { type: Object, default: null },
  stage: { type: String, default: '' },
});
</script>

<template>
  <PlayerPopup v-if="popupProps" v-bind="popupProps">
    <dl v-if="opened" class="facts">
      <template v-if="opened.ai">
        <dt>Plays</dt>
        <dd>{{ opened.ai.name }}</dd>
      </template>
      <dt>Score</dt>
      <dd>{{ opened.score }}</dd>
      <dt>Colour</dt>
      <dd><span class="dot" :style="{ background: opened.colour }" /></dd>
      <template v-if="stage">
        <dt>Now</dt>
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
