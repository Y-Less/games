<script setup>
// A small pop-up that tells a player it is their turn. It appears the moment `active` becomes true (or when it is already
// true as the component first appears, such as after coming back to a game), and goes away by itself after `duration`
// milliseconds, or at once when the player clicks OK, or when `active` goes false again (they have acted, or the turn
// moved on). It sits over the top of the page, takes no focus and blocks nothing, so play can carry straight on.
// GameStatus draws one for every game from its `mine` flag (see there); use this directly for anything else.
import { onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  active: { type: Boolean, default: false },
  message: { type: String, default: "It's your turn" },
  duration: { type: Number, default: 3000 }, // milliseconds before it closes itself
});

const open = ref(false);
let timer = null;

function close() {
  open.value = false;
  clearTimeout(timer);
  timer = null;
}
function show() {
  open.value = true;
  clearTimeout(timer);
  timer = setTimeout(close, props.duration);
}
watch(() => props.active, (on) => (on ? show() : close()), { immediate: true });
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <Teleport to="body">
    <Transition name="your-turn">
      <div v-if="open" class="your-turn" role="status" aria-live="polite">
        <span class="message">{{ message }}</span>
        <button type="button" class="primary ok" @click="close">OK</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.your-turn {
  position: fixed;
  z-index: 60;
  top: calc(var(--hub-bar-height, 3.4rem) + 0.75rem);
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
.message {
  min-width: 0;
}
.ok {
  flex: none;
}
.your-turn-enter-active,
.your-turn-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.your-turn-enter-from,
.your-turn-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-0.6rem);
}
</style>
