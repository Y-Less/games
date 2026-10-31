<script setup>
// The error message a game shows when the server refuses a request: a toast over the top of the game rather than a line
// in it (an error must not push the whole table down). The game decides when to show it, e.g. `v-if="notice"`.
defineProps({ text: { type: String, required: true } });
</script>

<template>
  <p class="notice" role="alert">{{ text }}</p>
</template>

<style scoped>
.notice {
  /* A toast over the top of the game rather than a line in it: an error must not push the whole table down. */
  position: fixed;
  top: calc((var(--hub-bar-height, 3.4rem) + 0.5rem) / var(--fit-zoom, 1)); /* the game may be scaled down to fit the window */
  left: calc(50vw / var(--fit-zoom, 1)); /* the middle of the window, however much the game is scaled */
  transform: translateX(-50%);
  z-index: 30;
  width: max-content;
  max-width: 40rem;
  margin: 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--danger);
  border-radius: 12px;
  background: var(--bg-raised);
  box-shadow: 0 4px 18px rgb(0 0 0 / 0.5);
  color: var(--danger);
}
</style>
