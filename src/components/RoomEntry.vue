<script setup>
// The first screen of any room-based game: start a new room, or join one with its three-word code.
// Emits `create` and `join` (with the tidied code). A code in the address (an invite link) can be passed as `initialCode`.
import { computed, ref } from 'vue';
import { normaliseCode } from '../../shared/codes.js';

const props = defineProps({
  noun: { type: String, default: 'game' },
  intro: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  initialCode: { type: String, default: '' },
  createLabel: { type: String, default: '' },
});
const emit = defineEmits(['create', 'join']);

const typed = ref(props.initialCode);
const code = computed(() => normaliseCode(typed.value));
</script>

<template>
  <section class="entry panel stack">
    <p v-if="intro" class="muted intro">{{ intro }}</p>
    <button class="primary wide" :disabled="busy" @click="emit('create')">{{ createLabel || `Start a new ${noun}` }}</button>
    <p class="muted or">or join a friend's {{ noun }}</p>
    <form class="join-row" @submit.prevent="code && emit('join', code)">
      <input v-model="typed" aria-label="Invite code" placeholder="e.g. boss-aware-you" autocomplete="off" autocapitalize="none" spellcheck="false" />
      <button :disabled="busy || !code">Join</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.entry {
  max-width: 420px;
  margin: 1rem auto;
}
.intro,
.or {
  margin: 0;
  text-align: center;
}
.wide {
  width: 100%;
}
.join-row {
  display: flex;
  gap: 0.5rem;
}
.join-row input {
  flex: 1;
  min-width: 0;
}
.error {
  margin: 0;
  color: var(--danger);
}
</style>
