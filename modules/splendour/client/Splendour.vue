<script setup>
// Props: socket (the platform socket), user (the signed-in user or null), search (the current URL query string),
//   setSearch (function that updates the URL query string). Emits: none. Slots: none.
// Side effects: useGameSocket subscribes to the socket's `state` events and syncs the invite code with the URL.
// Splendour: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
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

const { state, loaded, notice, initialCode, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  // Returns the warning shown when leaving mid-game ('' when leaving is harmless).
  leaveConfirm: (state) => state.phase === 'playing' ? 'A computer player takes your seat if you leave.' : '',
});
</script>

<template>
  <div class="splendour stack">
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game of Splendour"
      intro="Two to four players collect gems, buy cards and win the favour of nobles. Computer players can fill any empty seats."
      :initial-code="initialCode"
      :error="notice"
      @create="send('create')"
      @join="(code) => send('join', { code })"
    />
    <template v-else>
      <ErrorToast v-if="notice" :text="notice" />
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" />
    </template>
  </div>
</template>
