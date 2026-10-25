<script setup>
// Shows a room's invite code and copies its invite link (this game's address with ?<code>) on click.
import { onBeforeUnmount, ref } from 'vue';

const props = defineProps({ code: { type: String, required: true }, label: { type: String, default: 'Copy invite link' } });

const copied = ref(false);
let timer = null;
const link = () => `${window.location.origin}${window.location.pathname}?${props.code}`;

async function copy() {
  try {
    await navigator.clipboard.writeText(link());
    copied.value = true;
  } catch {
    window.prompt('Copy this invite link:', link());
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => (copied.value = false), 2000);
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <button class="invite quiet" :title="label" @click="copy">
    <span class="code">{{ code }}</span>
    <span class="hint muted" aria-live="polite">{{ copied ? 'Link copied' : label }}</span>
  </button>
</template>

<style scoped>
.invite {
  display: inline-flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.35rem 0.9rem;
}
.code {
  color: var(--amber);
  font-weight: 600;
}
.hint {
  font-size: 0.8rem;
}
</style>
