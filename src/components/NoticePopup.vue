<script setup>
// File: the generic non-blocking pop-up. Depends on: Vue only.
// Props: active (Boolean), duration (Number, ms), autoHide (Boolean), name (String, extra class), row (Number, vertical slot).
// Emits: close (closed by timer or OK; not when `active` goes false).  Slots: default (the content).
// Side effects: schedules a setTimeout to auto-close while shown; clears it on hide and on unmount.
// A small pop-up over the top of the page: the generic one behind "It's your turn" (YourTurnPopup) and the achievement
// unlocks. It appears the moment `active` becomes true (or when it is already true as the component first appears), and
// goes away by itself after `duration` milliseconds (unless `autoHide` is false, and then it stays until the player clicks
// OK), or at once when the player clicks OK, or when `active` goes false again. It takes no focus and blocks nothing, so play can carry straight on. The content is the default slot.
//   autoHide  false to keep it open until OK (default true: it closes after `duration`)
//   name      an extra class for the pop-up's box (styling hooks such as "your-turn")
//   row       0 for the top of the page; 1, 2 ... place it lower so that two pop-ups can show together
//   close     emitted when it closes by itself or by OK (not when `active` goes false)
import { onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  active: { type: Boolean, default: false },
  duration: { type: Number, default: 3000 }, // milliseconds before it closes itself
  autoHide: { type: Boolean, default: true },
  name: { type: String, default: '' },
  row: { type: Number, default: 0 },
});
const emit = defineEmits(['close']);

const open = ref(false);
let timer = null; // the pending auto-close timeout, or null

/**
 * Hides the pop-up silently.
 * @returns {void}
 * Side effects: clears `open` and cancels the auto-close timer; emits nothing.
 */
function stop() {
  open.value = false;
  clearTimeout(timer);
  timer = null;
}
/**
 * Hides the pop-up because it timed out or OK was clicked, and tells the parent.
 * @returns {void}
 * Side effects: as stop(), plus emits close.
 */
function dismiss() {
  stop();
  emit('close');
}
/**
 * Shows the pop-up and (re)starts the auto-close timer when autoHide is on.
 * @returns {void}
 * Side effects: sets `open`, replaces the timer.
 */
function show() {
  open.value = true;
  clearTimeout(timer);
  if (props.autoHide) timer = setTimeout(dismiss, props.duration);
}
watch(() => props.active, (on) => (on ? show() : stop()), { immediate: true });
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <Teleport to="body">
    <Transition name="notice">
      <div v-if="open" class="notice" :class="name" :style="{ '--row': row }" role="status" aria-live="polite">
        <div class="content"><slot /></div>
        <button type="button" class="primary ok" @click="dismiss">{{ $t('common.ok') }}</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.notice {
  position: fixed;
  z-index: 60;
  top: calc(var(--hub-bar-height, 3.4rem) + 0.75rem + var(--row, 0) * 5.2rem);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.9rem;
  max-width: calc(100vw - 2rem);
  padding: 0.6rem 0.7rem 0.6rem 1.1rem;
  border: 2px solid var(--amber);
  border-radius: 14px;
  background: var(--bg-raised);
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.55);
  font-family: var(--display);
  font-size: 1.15rem;
  color: var(--amber);
}
.content {
  min-width: 0;
}
.ok {
  flex: none;
}
.notice-enter-active,
.notice-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-0.6rem);
}
</style>
