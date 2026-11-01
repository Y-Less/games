<script setup>
// Props: socket {Object, required} platform socket; user {Object|null} signed-in user; search {String} current URL query string;
// setSearch {Function} updates the URL query string. Emits: none. Slots: none.
// Side effects: useGameSocket subscribes to the socket's `state` events and syncs the invite code with the URL;
// onState rewrites the local Recent moves log (kept to the last 200 lines) on every state.
// Tints and Hints: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
import { ref } from 'vue';
import ErrorToast from '../../../src/components/ErrorToast.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import { useGameSocket } from '../../../src/useGameSocket.js';
import Lobby from './Lobby.vue';
import { newEntries } from './moveLog.js';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});

const log = ref([]); // "Recent moves": worked out here from the changes between one state and the next
/**
 * Works the "Recent moves" list out from the change between one state and the next.
 *
 * Side effects: replaces `log`.
 *
 * @param {object | null} next  the new state
 * @param {object | null} previous  the state it replaces
 */
function onState(next, previous) {
  log.value = !next || next.phase === 'lobby' ? [] : [...log.value, ...newEntries(previous, next)].slice(-200);
}

const { state, loaded, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // Returns the warning shown when leaving mid-game ('' when leaving is harmless).
  leaveConfirm: (state) => ['guessing1', 'guessing2', 'reveal'].includes(state.phase) ? 'You will not be able to come back.' : '',
  onState,
});
</script>

<template>
  <div class="tints stack">
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game of Tints and Hints"
      intro="Describe a secret colour, and see how close your friends can get. You get a code to share."
      :initial-code="initialCode"
      :error="notice"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <template v-else>
      <ErrorToast v-if="notice" :text="notice" />
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" :log="log" />
    </template>
  </div>
</template>
