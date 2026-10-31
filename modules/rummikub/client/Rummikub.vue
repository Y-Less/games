<script setup>
// Rummikub: the screens drawn inside the site's play field. The server sends each player their own view of the game as a
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
});
</script>

<template>
  <div class="rummikub stack">
    <p v-if="!loaded" class="muted">Loading your game…</p>
    <RoomEntry
      v-else-if="!state"
      noun="game of Rummikub"
      intro="Build runs and groups from numbered tiles, rearrange the whole table and be first to empty your rack. Two to six players; computer players can fill any empty seats."
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
