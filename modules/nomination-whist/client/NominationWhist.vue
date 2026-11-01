<script setup>
// Props: socket {Object, required} platform socket; user {Object|null} signed-in user; search {String} current URL query string;
// setSearch {Function} updates the URL query string. Emits: none. Slots: none.
// Side effects: useGameSocket subscribes to the socket's `state` events and syncs the invite code with the URL for the life of the component.
// Nomination Whist: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
// `state` event (null when not in a game); everything the player does is a request to the server (see useGameSocket).
import ErrorToast from '../../../src/components/ErrorToast.vue';
import RoomEntry from '../../../src/components/RoomEntry.vue';
import { useGameSocket } from '../../../src/useGameSocket.js';
import Lobby from './Lobby.vue';
import Table from './Table.vue';

const props = defineProps({
  socket: { type: Object, required: true },
  user: { type: Object, default: null },
  search: { type: String, default: '' },
  setSearch: { type: Function, default: () => {} },
});

const { state, loaded, busy, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // Returns the warning shown when leaving mid-game ('' when leaving is harmless).
  leaveConfirm: (state) => ['nominating', 'playing', 'roundEnd'].includes(state.phase) ? 'A computer player takes your seat if you leave.' : '',
});
</script>

<template>
  <div class="whist stack">
    <ErrorToast v-if="notice && state" :text="notice" />
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game"
      intro="Oh Hell-style whist for 3 to 7 players: nominate exactly how many tricks you will win."
      :busy="busy"
      :error="notice"
      :initial-code="initialCode"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <Lobby v-else-if="state.phase === 'lobby'" :state="state" :send="send" />
    <Table v-else :state="state" :send="send" />
  </div>
</template>
