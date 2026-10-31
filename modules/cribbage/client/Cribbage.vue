<script setup>
// Cribbage: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
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

const { state, loaded, busy, notice, send } = useGameSocket({
  socket: props.socket,
  search: props.search,
  setSearch: props.setSearch,
  leaveConfirm: (state) => state.phase !== 'lobby' && state.phase !== 'finished' ? 'A computer player takes your seat if you leave.' : '',
});
</script>

<template>
  <div class="cribbage stack">
    <ErrorToast v-if="loaded && state && notice" :text="notice" />
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry v-else-if="!state" noun="game" intro="Cribbage for two to four players, with computer players to fill any empty seat." :busy="busy" :error="notice" :initial-code="search.replace(/^\?/, '')" @create="send('create')" @join="(code) => send('join', { code })" />

    <template v-else>
      <Lobby v-if="state.phase === 'lobby'" :state="state" :send="send" />
      <Table v-else :state="state" :send="send" />
    </template>
  </div>
</template>
