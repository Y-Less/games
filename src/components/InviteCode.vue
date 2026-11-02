<script setup>
// File: the invite-code button of a waiting room.  Depends on: the browser clipboard API (falls back to window.prompt).
// Props: code (String, required, the room code), label (String, hint text shown beside the code).
// Emits: none.  Slots: none.
// Side effects: writes the invite link to the clipboard on click (or opens a prompt if that is refused); schedules a 2s timer that
//   clears the "Link copied" hint, cleared again on unmount.
// Shows a room's invite code and copies its invite link (this game's address with ?<code>) on click.
import { onBeforeUnmount, ref } from 'vue';
import { useGameText } from '../useGameText.js';

const props = defineProps({ code: { type: String, required: true }, label: { type: String, default: '' } }); // label '' : "Copy invite link"
const { t } = useGameText();

const copied = ref(false); // true for two seconds after a successful copy, to show "Link copied"
let timer = null; // the pending timeout that resets `copied`
// Returns the invite link: this page's own address with the room code as the query string.
const link = () => `${window.location.origin}${window.location.pathname}?${props.code}`;

/**
 * Copies the invite link to the clipboard, falling back to a prompt the player can copy from by hand.
 * @returns {Promise<void>}  resolves once the copy (or fallback prompt) is done
 * Side effects: writes to the clipboard, may open window.prompt, sets `copied`, and schedules the timer that clears it.
 */
async function copy() {
  try {
    await navigator.clipboard.writeText(link());
    copied.value = true;
  } catch {
    window.prompt(t('invite.prompt'), link());
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => (copied.value = false), 2000);
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <button class="invite quiet" :title="label || t('invite.copy')" @click="copy">
    <span class="code">{{ code }}</span>
    <span class="hint muted" aria-live="polite">{{ copied ? t('invite.copied') : label || t('invite.copy') }}</span>
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
