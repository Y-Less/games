<script setup>
import { computed, ref } from 'vue';
import RoomEntry from '../../../../src/components/RoomEntry.vue';
import { useDixnt } from '../useDixnt.js';

const { createGame, join, store, user } = useDixnt();

const busy = ref(false);
// An invite link (or a game we were removed from) points at a code that is filled in for us.
const missing = computed(() => (store.code && store.codeExists === false ? 'That game does not exist any more. Ask your friend for a fresh link.' : ''));

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
