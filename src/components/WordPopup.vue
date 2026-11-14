<script setup>
// A word shown large to everybody at the same moment: the word a chooser has just locked in, the hint a hinter has
// just given, the word a table is about to write clues for.  It floats over the play area (it takes no room, so
// nothing moves), goes by itself after a few seconds, or on a click.  A player who is kept from the word is shown
// the same pop-up in its `dark` colours, with whatever the game puts in its place ("???"), so that they learn a word
// was chosen when the others do.
//
// The words are the game's, so they arrive already in the player's language (see GameShell on why a shared component
// asks for none of its own).
// Depends on: Vue only.
// Props: popup ({ label, word, dark?, at } or null: the line above, the word itself, whether this viewer is the one
//   kept in the dark, and when it was announced, in the browser's clock), duration (milliseconds it stays up).
// Emits: none.  Slots: none.
// Side effects: watches `popup`; sets a timer to hide itself (cleared on hide, on a new pop-up, and on unmount).
import { onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  popup: { type: Object, default: null },
  duration: { type: Number, default: 4000 },
});

// The pop-up being shown, or null.
const shown = ref(null);
let timer = null; // the pending hide, if any
/**
 * Hides the pop-up now.
 * @returns {void}
 * Side effects: cancels the timer and clears `shown`.
 */
const hide = () => {
  clearTimeout(timer);
  shown.value = null;
};
watch(
  () => props.popup,
  (popup) => {
    clearTimeout(timer);
    // A pop-up that was already shown (and has gone) is not shown again when this component is mounted later.
    const age = popup?.at ? Date.now() - popup.at : 0;
    shown.value = popup && age < props.duration ? popup : null;
    if (shown.value) timer = setTimeout(hide, props.duration - age);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <Transition name="fade">
    <button v-if="shown" class="word-popup" :class="{ dark: shown.dark }" role="status" aria-live="polite" @click="hide">
      <span class="label">{{ shown.label }}</span>
      <span class="word">{{ shown.word }}</span>
    </button>
  </Transition>
</template>

<style scoped>
.word-popup {
  position: fixed;
  top: 32%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  max-width: min(70rem, 90vw);
  padding: 1.2rem 2.5rem;
  border: 2px solid var(--amber);
  border-radius: 18px;
  background: color-mix(in srgb, var(--bg-raised) 94%, black);
  box-shadow: 0 14px 50px rgb(0 0 0 / 0.65);
  text-align: center;
}
.word-popup.dark {
  border-color: var(--rust);
}
.label {
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
}
.word {
  font-family: var(--display);
  font-size: clamp(2.4rem, 6vw, 4.5rem);
  line-height: 1.1;
  color: var(--amber);
  overflow-wrap: anywhere;
}
.dark .word {
  color: var(--danger);
  letter-spacing: 0.2em;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
