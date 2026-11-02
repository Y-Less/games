<script setup>
// File: the header Help dialog.  Depends on: nothing beyond the window keydown event.
// Props: html (String|null, pre-rendered safe Markdown HTML; null while loading), title (String, the dialog's name; 'Help' by default).
// Emits: close (Close button, Escape, or a click on the backdrop).
// Slots: none.
// Side effects: adds a window keydown listener on mount and removes it on unmount.
// The pop-up for the header's Help button: some Markdown (already rendered to safe HTML) in a dialog that closes with the
// Close button, Escape, or a click outside it. `html` is null while it loads.
import { onBeforeUnmount, onMounted } from 'vue';

defineProps({ html: { type: String, default: null }, title: { type: String, default: '' } }); // title '' : "Help"
const emit = defineEmits(['close']);

// Handler for window keydown: emits close when Escape is pressed (returns false or the emit result; the value is unused).
const closeOnEsc = (event) => event.key === 'Escape' && emit('close');
onMounted(() => window.addEventListener('keydown', closeOnEsc));
onBeforeUnmount(() => window.removeEventListener('keydown', closeOnEsc));
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog panel" role="dialog" :aria-label="title || $t('common.help')">
      <button class="quiet close" @click="emit('close')">{{ $t('common.close') }}</button>
      <div class="help" v-html="html ?? $t('common.loading')" />
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgb(0 0 0 / 0.6);
  display: grid;
  place-items: center;
  padding: 1rem;
}
.dialog {
  position: relative;
  max-width: 640px;
  max-height: 85vh;
  overflow: auto;
  background: var(--bg-raised);
}
.close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
}
.help :deep(h1),
.help :deep(h2),
.help :deep(h3),
.help :deep(h4) {
  margin: 1rem 0 0.3rem;
  color: var(--amber);
}
.help :deep(h1:first-child),
.help :deep(h2:first-child) {
  margin-top: 0;
}
.help :deep(p),
.help :deep(li) {
  line-height: 1.5;
}
</style>
