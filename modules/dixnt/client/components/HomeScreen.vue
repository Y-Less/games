<script setup>
// Dixnt start screen: create a game or join one by code, through the shared RoomEntry form. An invite link's code is
// filled in for you, and a message appears if that game no longer exists.
//
// Props: none. Emits: none. Slots: none.
// Side effects: sends `create` or `join` requests (through the store) one at a time; `busy` disables the form meanwhile.
import { computed, ref } from 'vue';
import RoomEntry from '../../../../src/components/RoomEntry.vue';
import { useDixnt } from '../useDixnt.js';

const { createGame, join, store, user } = useDixnt();

// True while a create or join request is in flight, so the buttons cannot be pressed twice.
const busy = ref(false);
// An invite link (or a game we were removed from) points at a code that is filled in for us.
const missing = computed(() => (store.code && store.codeExists === false ? 'That game does not exist any more. Ask your friend for a fresh link.' : ''));

/**
 * Runs a create or join request unless one is already running, keeping the form busy meanwhile.
 * @param {() => Promise<any>} task  The request to run.
 * @returns {Promise<void>}
 * Side effects: toggles `busy`; whatever `task` does (sends a request).
 */
async function run(task) {
  if (busy.value) return;
  busy.value = true;
  await task();
  busy.value = false;
}
</script>

<template>
  <RoomEntry
    noun="game"
    :intro="`One of you is in the dark. Can the rest of you work out who? You will play as ${user.displayName}.`"
    :initial-code="store.code"
    :busy="busy"
    :error="missing"
    @create="run(() => createGame())"
    @join="(code) => run(() => join(code))"
  />
</template>
