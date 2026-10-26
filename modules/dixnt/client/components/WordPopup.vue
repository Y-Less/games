<script setup>
// When the chooser locks in the word, it pops up large for everyone at the same moment, and the person who is not told
// the word sees ??? instead, so that they learn a word was chosen when the others do. It floats over the play area (it
// takes no room, so nothing moves), goes by itself after a few seconds, or on a click.
import { onBeforeUnmount, ref, watch } from 'vue';
import { useDixnt } from '../useDixnt.js';

const { store } = useDixnt();
const SHOWN_MS = 4000;
const shown = ref(null);
let timer = null;
const hide = () => {
  clearTimeout(timer);
  shown.value = null;
};
watch(
  () => store.wordPopup,
  (popup) => {
    clearTimeout(timer);
    shown.value = popup;
    if (popup) timer = setTimeout(hide, SHOWN_MS);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <Transition name="fade">
    <button v-if="shown" class="word-popup" :class="{ dark: shown.hidden }" role="status" aria-live="polite" @click="hide">
      <span class="label">{{ shown.hidden ? 'The word has been chosen, but you cannot see it' : 'The word is' }}</span>
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
