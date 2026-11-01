<script setup>
// The row of buttons under the pool: End turn, Undo turn and, while a tool is in use, that tool's own buttons. The row has a
// fixed height, so buttons appearing never move anything.
// Props: myTurn (Boolean), canUndo (Boolean), mode (the tool in use, or null), modeDie (the pool die chosen for it, or null),
// toolParams (what the tool would send, null while something is still to be chosen).
// Emits: end, undo, cancel (no payload); apply (extra parameters, e.g. { delta: 1 }) to send the tool.
// Side effects: none.
defineProps({
  myTurn: { type: Boolean, default: false },
  canUndo: { type: Boolean, default: false },
  mode: { type: Object, default: null },
  modeDie: { type: Object, default: null },
  toolParams: { type: Object, default: null },
});
const emit = defineEmits(['end', 'undo', 'cancel', 'apply']);
</script>

<template>
  <div class="actions">
    <button class="primary" :disabled="!myTurn" @click="emit('end')">End turn</button>
    <button :disabled="!myTurn || !canUndo" title="Take this whole turn back to how it began" @click="emit('undo')">Undo turn</button>
    <template v-if="mode">
      <button v-if="mode.kind === 'delta'" :disabled="!modeDie || modeDie.v >= 6" @click="emit('apply', { delta: 1 })">Raise by one</button>
      <button v-if="mode.kind === 'delta'" :disabled="!modeDie || modeDie.v <= 1" @click="emit('apply', { delta: -1 })">Lower by one</button>
      <button v-if="mode.kind !== 'delta' && mode.kind !== 'free'" class="primary" :disabled="!toolParams" @click="emit('apply', {})">Use {{ mode.name }}</button>
      <button class="quiet" @click="emit('cancel')">Cancel</button>
    </template>
  </div>
</template>

<style scoped>
.actions {
  flex: none;
  height: 2.4rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
}
.actions button {
  white-space: nowrap;
}
</style>
