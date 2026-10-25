<script setup>
// A large pop-up for any game: dims the page, traps Esc/backdrop clicks, and keeps focus inside while it is open.
// Slots: default (the body), #footer (buttons). Use v-model:open (or the `close` event).
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  size: { type: String, default: 'lg' }, // 'md' | 'lg' | 'xl'
  closable: { type: Boolean, default: true },
});
const emit = defineEmits(['update:open', 'close']);

const panel = ref(null);
let opener = null;

function close() {
  if (!props.closable) return;
  emit('update:open', false);
  emit('close');
}

function onKey(event) {
  if (event.key === 'Escape') close();
  if (event.key !== 'Tab' || !panel.value) return;
  const focusable = [...panel.value.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      opener = document.activeElement;
      document.addEventListener('keydown', onKey);
      await nextTick();
      (panel.value?.querySelector('[data-autofocus]') ?? panel.value)?.focus();
    } else {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="close">
      <div ref="panel" class="modal panel" :class="size" role="dialog" aria-modal="true" :aria-label="title || 'Dialog'" tabindex="-1">
        <header v-if="title || closable" class="modal-head">
          <h2>{{ title }}</h2>
          <button v-if="closable" class="quiet" aria-label="Close" @click="close">Close</button>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.footer" class="modal-foot"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  grid-template-columns: minmax(0, 1fr); /* lets a wide table scroll inside the pop-up instead of widening it */
  place-items: center;
  padding: 1rem;
  background: rgb(0 0 0 / 0.65);
}
.modal {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  width: 100%;
  min-width: 0;
  max-height: calc(100vh - 2rem);
  background: var(--bg-raised);
  outline: none;
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.6);
}
.md {
  max-width: 480px;
}
.lg {
  max-width: 760px;
}
.xl {
  max-width: 1000px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.modal-head h2 {
  color: var(--amber);
}
.modal-body {
  overflow: auto;
  min-height: 0;
}
.modal-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.6rem;
}
</style>
