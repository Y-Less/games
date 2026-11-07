<script setup>
// Dixnt start screen: create a game or join one by code, through the shared RoomEntry form.  An invite link's code is
// filled in for you, and the server's refusal (a game that has gone, one you are already in) is shown under the form.
//
// Props: none.  Emits: none.  Slots: none.
// Side effects: sends `create` or `join` requests (through the store) one at a time; `busy` disables the form meanwhile.
import { ref } from 'vue';
import RoomEntry from '../../../../src/components/RoomEntry.vue';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';

const { t } = useGameText();
const { createGame, join, store, user } = useDixnt();

// True while a create or join request is in flight, so the buttons cannot be pressed twice.
const busy = ref(false);

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
    :noun="t('entry.noun')"
    :intro="t('entry.intro', { name: user.displayName })"
    :initial-code="store.code"
    :busy="busy"
    :error="store.notice"
    @create="run(() => createGame())"
    @join="(code) => run(() => join(code))"
  />
</template>
