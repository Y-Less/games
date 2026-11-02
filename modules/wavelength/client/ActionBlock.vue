<script setup>
// The one action of the moment, in a block of fixed height (empty when there is none): the psychic's clue form while the
// clue is due, or the Lock in button while you can guess.
// Props: clueText (v-model: the clue being typed), isPsychic, clueTime (the clue is due), canGuess (you can guess), team
//   (a team game), ready (something is chosen on the dial, so locking in is allowed).
// Slots: none.
// Emits: update:clueText, send-clue and lock-in.
// Side effects: none beyond the emits.
import { useGameText } from '../../../src/useGameText.js';

defineProps({
  clueText: { type: String, default: '' },
  isPsychic: { type: Boolean, default: false },
  clueTime: { type: Boolean, default: false },
  canGuess: { type: Boolean, default: false },
  team: { type: Boolean, default: false },
  ready: { type: Boolean, default: false },
});
defineEmits(['update:clueText', 'send-clue', 'lock-in']);
const { t } = useGameText();
</script>

<template>
  <div class="block action">
    <form v-if="isPsychic && clueTime" class="clue-form row" @submit.prevent="$emit('send-clue')">
      <input :value="clueText" maxlength="80" :placeholder="t('table.cluePlaceholder')" :aria-label="t('table.clueLabel')" @input="$emit('update:clueText', $event.target.value)" />
      <button type="submit" class="primary" :disabled="!clueText.trim()">{{ t('table.sendClue') }}</button>
    </form>
    <button v-else-if="canGuess" class="primary wide" :disabled="!ready" @click="$emit('lock-in')">{{ team ? t('table.lockIn') : t('table.lockInGuess') }}</button>
  </div>
</template>

<style scoped>
.block {
  flex: none;
}
.action {
  height: 2.6rem;
  display: flex;
  align-items: stretch;
}
.action > * {
  flex: 1;
}
.wide {
  width: 100%;
}
.clue-form {
  flex-wrap: nowrap;
  gap: 0.4rem;
}
.clue-form input {
  flex: 1;
  min-width: 0;
}
</style>
